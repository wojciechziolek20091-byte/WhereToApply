"""Prompt, chunking and response validation for clip selection (brief 4.4)."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from clipbot.config import CAPTION_LANGUAGES as _LANG_NAMES
from clipbot.select.llm import InvalidOutput
from clipbot.select.snap import RISK_FLAGS, Candidate

CHUNK_ABOVE = 45 * 60  # transcripts longer than this are split (windows run in parallel)
WINDOW = 30 * 60
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
                    "risk_flags": {
                        "type": "array",
                        "items": {"type": "string", "enum": sorted(RISK_FLAGS)},
                    },
                },
            },
        }
    },
}

SYSTEM = """You cut viral TikTok clips out of long videos. You read the transcript \
once, pick the cliffhanger moments fast and do not overthink. You only use what was \
said: never invent, reword or merge lines. You answer with JSON only."""

RULES = """Find the {n} strongest cliffhanger moments: stretches where tension builds \
so a viewer cannot scroll away. A question is raised, a reveal or twist is coming, a \
conflict escalates, a risk or a surprising number is set up.
- Each clip is {min_s:g} to {max_s:g} seconds long (end_sec minus start_sec), so it \
spans several transcript lines. It starts on the line that opens the tension and \
builds up through the following lines to the peak: it ends on the reveal, or just \
before it. Never return a single line.
- Clips do not overlap. Skip intros and outros. A clip must not contain any part of \
an ad, sponsor mention, product plug, discount code or "link in the description".
- Each transcript line starts with its time in seconds, like [125.4]. Copy those \
numbers: start_sec is the time of the clip's first line, end_sec the time of the line \
right after its last line. Plain seconds, never minutes or milliseconds.

For each clip:
- score: 0-100, how hard it is to scroll past.
- hook: at most {hook_words} words shown on screen at the start, in the video's \
language. Punchy, true to what is said, no emoji or hashtags.
- title: at most {title_len} characters. summary: one sentence.
- hashtags: 3 to 5 topic tags, lower case, no '#'.
- risk_flags: any of {flags} that apply, or ["none"]. Use sponsor_read if any \
sponsor or product is mentioned.{caption_rules}

Return {{"clips": [...]}}, best first. Return {{"clips": []}} if nothing qualifies."""

CAPTION_RULES = """
- caption_title: in {language}, at most 100 characters. The first line of the TikTok \
caption: full of tension and viral buzzwords{examples}. It may tease, but must not \
claim anything the clip does not show.
- caption_text: in {language}, one or two punchy sentences that build suspense and do \
not give away the ending. Buzzwords welcome; may end with a question.
- caption_hashtags: 4 or 5 tags in {language} that viewers search for, no '#', lower \
case, no spaces. At least 3 about the topic."""

BUZZWORDS = {
    "pl": " such as SZOK, Nie uwierzysz, To zmienia wszystko, Mało kto o tym wie, "
    "Musisz to zobaczyć, Zwrot akcji",
    "en": " such as SHOCKING, You won't believe, This changes everything, Nobody talks "
    "about this, Wait for it",
}


def clip_schema(language: str | None = None) -> dict[str, Any]:
    """The JSON schema for a selection; with a caption language it also asks for
    the TikTok caption, so no second AI call is needed."""
    if not language:
        return CLIP_SCHEMA
    import copy

    schema = copy.deepcopy(CLIP_SCHEMA)
    item = schema["properties"]["clips"]["items"]
    item["properties"].update(
        {
            "caption_title": {"type": "string"},
            "caption_text": {"type": "string"},
            "caption_hashtags": {"type": "array", "items": {"type": "string"}},
        }
    )
    item["required"] = [*item["required"], "caption_title", "caption_text", "caption_hashtags"]
    return schema


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
    """One line per segment, prefixed with its start in plain seconds: models copy
    these reliably, while converting mm:ss made some answer in made-up units."""
    return "\n".join(
        f"[{s.start:.1f}] {s.text}" for s in segments if start <= s.start < end and s.text
    )


def build_messages(
    lines: str,
    *,
    topics_hint: str,
    min_s: float,
    max_s: float,
    n: int,
    window: tuple[float, float] | None = None,
    language: str | None = None,
) -> list[dict[str, str]]:
    """`language`: a language name (e.g. "Polish") to also get the TikTok caption."""
    caption_rules = ""
    if language:
        code = next((k for k, v in _LANG_NAMES.items() if v == language), "")
        caption_rules = CAPTION_RULES.format(
            language=language, examples=BUZZWORDS.get(code, f" in {language}")
        )
    rules = RULES.format(
        caption_rules=caption_rules,
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
    standalone = d.get("standalone", True)
    if not isinstance(standalone, bool):
        standalone = True
    flags_raw = d.get("risk_flags")
    if not isinstance(flags_raw, list):
        raise ValueError("risk_flags is not a list")
    flags = tuple(sorted({str(f).strip().lower() for f in flags_raw} - {"none"}))
    unknown = set(flags) - RISK_FLAGS
    if unknown:
        raise ValueError(f"unknown risk flags {sorted(unknown)}")
    return Candidate(
        start,
        end,
        score,
        hook,
        title,
        summary,
        _clean_tags(d.get("hashtags")),
        standalone,
        flags,
        _caption(d),
    )


def _caption(d: dict[str, Any]) -> tuple[str, str, tuple[str, ...]] | None:
    """The optional caption fields; a clip without them still counts (the caption
    is then written by a separate call)."""
    head = " ".join(str(d.get("caption_title") or "").split())[:150]
    text = " ".join(str(d.get("caption_text") or "").split())[:600]
    raw = d.get("caption_hashtags")
    if not head or not isinstance(raw, list):
        return None
    tags: list[str] = []
    for t in raw:
        t = "".join(ch for ch in str(t).lstrip("#").lower() if ch.isalnum() or ch == "_")
        if t and t not in tags:
            tags.append(t)
    return head, text, tuple(tags[:6])


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
