"""Prompt, chunking and response validation for clip selection (brief 4.4)."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from clipbot.select.llm import InvalidOutput
from clipbot.select.snap import RISK_FLAGS, Candidate

CHUNK_ABOVE = 25 * 60  # transcripts longer than this are split
WINDOW = 20 * 60
OVERLAP = 2 * 60
MAX_HOOK_WORDS = 9
MAX_TITLE = 80

CLIP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clips"],
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "start_sec",
                    "end_sec",
                    "score",
                    "hook",
                    "title",
                    "summary",
                    "hashtags",
                    "standalone",
                    "risk_flags",
                ],
                "properties": {
                    "start_sec": {"type": "number"},
                    "end_sec": {"type": "number"},
                    "score": {"type": "integer"},
                    "hook": {"type": "string"},
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                    "standalone": {"type": "boolean"},
                    "risk_flags": {
                        "type": "array",
                        "items": {"type": "string", "enum": sorted(RISK_FLAGS)},
                    },
                },
            },
        }
    },
}

SYSTEM = """You are a short-form video editor. You pick moments from a long video's \
transcript that work as standalone vertical clips for TikTok. You only ever quote what \
was said: you never invent, reword or merge lines. You answer with JSON only."""

RULES = """Rules for every clip:
- It must make sense to someone who has not seen the rest of the video.
- It starts at the beginning of a sentence and ends at the end of a complete thought.
- Length {min_s:g} to {max_s:g} seconds.
- The first 3 seconds carry a clear hook: a question, a surprising claim, a conflict \
or a concrete number.
- Skip intros, outros, sponsor reads, ads, calls to subscribe and housekeeping.
- Clips must not overlap each other.
- start_sec and end_sec are seconds from the start of the video, read from the \
[mm:ss.s] timestamps of the transcript lines.

For each clip return:
- score: 0-100, how likely a stranger scrolling TikTok stops and watches to the end.
- hook: at most {hook_words} words, shown on screen at the start. Punchy, no emoji, \
no hashtags, true to what is said.
- title: at most {title_len} characters.
- summary: one sentence of context for the caption.
- hashtags: 3 to 5 specific topic tags, lower case, no '#'.
- standalone: false if the clip needs earlier context.
- risk_flags: any of {flags} that apply, or ["none"]. Mark sponsor_read for any ad or \
sponsor mention, financial_claim or medical_claim for money or health statements.

Return {{"clips": [...]}} with up to {n} of the best clips, best first. Return \
{{"clips": []}} if nothing qualifies."""


def fmt_ts(sec: float) -> str:
    m, s = divmod(max(sec, 0.0), 60)
    return f"{int(m):02d}:{s:04.1f}"


def windows(duration: float) -> list[tuple[float, float]]:
    """One window for short videos; otherwise 20-minute windows overlapping by 2."""
    if duration <= CHUNK_ABOVE:
        return [(0.0, duration)]
    out = []
    start = 0.0
    while True:
        end = min(start + WINDOW, duration)
        out.append((start, end))
        if end >= duration:
            break
        start = end - OVERLAP
    # A tiny last window has no room for a clip: fold it into the previous one.
    if len(out) > 1 and out[-1][1] - out[-1][0] < 5 * 60:
        last = out.pop()
        out[-1] = (out[-1][0], last[1])
    return out


def transcript_lines(segments: Sequence[Any], start: float, end: float) -> str:
    return "\n".join(
        f"[{fmt_ts(s.start)}] {s.text}" for s in segments if start <= s.start < end and s.text
    )


def build_messages(
    lines: str,
    *,
    topics_hint: str,
    min_s: float,
    max_s: float,
    n: int,
    window: tuple[float, float] | None = None,
) -> list[dict[str, str]]:
    rules = RULES.format(
        min_s=min_s,
        max_s=max_s,
        hook_words=MAX_HOOK_WORDS,
        title_len=MAX_TITLE,
        flags=", ".join(sorted(RISK_FLAGS - {"none"})),
        n=n,
    )
    where = ""
    if window:
        where = f"\nThis is the part of the video from {fmt_ts(window[0])} to {fmt_ts(window[1])}."
    about = f"\nThe channel is about: {topics_hint}" if topics_hint else ""
    user = f"{rules}{about}{where}\n\nTranscript:\n{lines}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


# --------------------------------------------------------------------------- parsing

_TAG_OK = re.compile(r"^[a-z0-9_]{2,40}$")


def _clean_tags(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, list):
        raise ValueError("hashtags is not a list")
    out: list[str] = []
    for t in raw:
        t = str(t).strip().lstrip("#").lower().replace(" ", "")
        if _TAG_OK.match(t) and t not in out:
            out.append(t)
    if len(out) < 3:
        raise ValueError("fewer than 3 usable hashtags")
    return tuple(out[:5])


def parse_candidate(d: Any) -> Candidate:
    """One clip object. Raises ValueError with the reason when it is unusable."""
    if not isinstance(d, dict):
        raise ValueError("clip is not an object")
    try:
        start, end = float(d["start_sec"]), float(d["end_sec"])
        score = round(float(d["score"]))
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"bad times or score: {e}") from None
    if not 0 <= score <= 100:
        raise ValueError(f"score {score} out of range")
    hook = " ".join(str(d.get("hook", "")).split())
    if not hook or len(hook.split()) > MAX_HOOK_WORDS:
        raise ValueError(f"hook must be 1-{MAX_HOOK_WORDS} words")
    title = " ".join(str(d.get("title", "")).split())
    if not title:
        raise ValueError("empty title")
    if len(title) > MAX_TITLE:
        title = title[: MAX_TITLE - 1].rstrip() + "…"
    summary = " ".join(str(d.get("summary", "")).split())
    if not summary:
        raise ValueError("empty summary")
    standalone = d.get("standalone")
    if not isinstance(standalone, bool):
        raise ValueError("standalone is not a boolean")
    flags_raw = d.get("risk_flags")
    if not isinstance(flags_raw, list):
        raise ValueError("risk_flags is not a list")
    flags = tuple(sorted({str(f).strip().lower() for f in flags_raw} - {"none"}))
    unknown = set(flags) - RISK_FLAGS
    if unknown:
        raise ValueError(f"unknown risk flags {sorted(unknown)}")
    return Candidate(
        start, end, score, hook, title, summary, _clean_tags(d.get("hashtags")), standalone, flags
    )


def parse_selection(data: Any) -> tuple[list[Candidate], list[str]]:
    """Validate a whole response. Individual bad clips are dropped with a reason;
    a response with the wrong overall shape raises InvalidOutput so the router
    tries another model."""
    if isinstance(data, list):  # some models drop the wrapper object
        data = {"clips": data}
    if not isinstance(data, dict) or not isinstance(data.get("clips"), list):
        raise InvalidOutput('expected {"clips": [...]}')
    good: list[Candidate] = []
    errors: list[str] = []
    for i, d in enumerate(data["clips"]):
        try:
            good.append(parse_candidate(d))
        except ValueError as e:
            errors.append(f"clip {i}: {e}")
    if data["clips"] and not good:
        raise InvalidOutput("no usable clip in response: " + "; ".join(errors[:3]))
    return good, errors
