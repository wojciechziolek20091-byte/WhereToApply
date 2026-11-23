"""Automated QA gates (brief 4.6). Every gate must pass before a clip can post.

Measurements come from the rendered file itself (stream info, ebur128, blackdetect,
freezedetect) and from the clip's transcript. The safety gate asks a free model
and fails closed: if no model answers, the clip waits; it is never waved through.
"""

from __future__ import annotations

import itertools
import re
import subprocess
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from clipbot.media import MediaInfo, ProbeError, probe
from clipbot.models import Word
from clipbot.render.captions import count_caption_words, has_hook
from clipbot.select.llm import InvalidOutput
from clipbot.tools import ffmpeg_exe

MAX_SIZE = 500 * 1024 * 1024
MIN_SPEECH = 0.70
MAX_SILENCE = 2.5
SPEECH_BRIDGE = 0.5  # gaps shorter than this between words still count as speech
LOUD_RANGE = (-16.0, -12.0)
MAX_BLACK_OR_FROZEN = 1.0
CAPTION_TOLERANCE = 0.02
DUPLICATE_OVERLAP = 0.30
# Technical gates: a failure here is a warning unless strict QA is on. They catch
# imperfect clips, not harmful ones. Everything else always blocks.
SOFT_GATES = frozenset({"speech", "loudness", "visual", "caption_sync"})
ACTIVE_STATES = ("qa_passed", "awaiting_approval", "scheduled", "publishing", "published")


@dataclass
class Gate:
    ok: bool
    detail: str
    data: dict[str, Any] = field(default_factory=dict)


def blocking(name: str, strict: bool) -> bool:
    return strict or name not in SOFT_GATES


@dataclass
class QAResult:
    gates: dict[str, Gate]
    strict: bool = True

    @property
    def passed(self) -> bool:
        return all(g.ok for n, g in self.gates.items() if blocking(n, self.strict))

    @property
    def first_failure(self) -> str | None:
        for name, g in self.gates.items():
            if not g.ok and blocking(name, self.strict):
                return f"{name}: {g.detail}"
        return None

    @property
    def warnings(self) -> list[str]:
        return [
            f"{n}: {g.detail}"
            for n, g in self.gates.items()
            if not g.ok and not blocking(n, self.strict)
        ]

    def to_json(self) -> dict[str, Any]:
        return {k: asdict(v) for k, v in self.gates.items()}


# --------------------------------------------------------------------------- 1 spec


def gate_spec(info: MediaInfo | None, min_s: float, max_s: float, err: str = "") -> Gate:
    if info is None:
        return Gate(False, f"unreadable file: {err}")
    problems = []
    if info.vcodec != "h264":
        problems.append(f"codec {info.vcodec}")
    if not 23 <= info.fps <= 60.01:
        problems.append(f"{info.fps:.2f} fps")
    if info.width < 720:
        problems.append(f"width {info.width}")
    if not min_s - 0.5 <= info.duration <= max_s + 0.5:
        problems.append(f"duration {info.duration:.1f}s")
    if info.size_bytes >= MAX_SIZE:
        problems.append(f"size {info.size_bytes / 2**20:.0f} MB")
    if not info.has_audio:
        problems.append("no audio stream")
    data = {
        "codec": info.vcodec,
        "fps": info.fps,
        "size": f"{info.width}x{info.height}",
        "duration": info.duration,
        "mb": round(info.size_bytes / 2**20, 1),
    }
    if problems:
        return Gate(False, ", ".join(problems), data)
    return Gate(
        True,
        f"h264 {info.width}x{info.height} {info.fps:.0f}fps {info.duration:.1f}s {data['mb']}MB",
        data,
    )


# --------------------------------------------------------------------------- 2 speech


def speech_stats(words: Sequence[Word], duration: float) -> tuple[float, float]:
    """(share of the clip with speech, longest silence) from clip-time words."""
    if not words or duration <= 0:
        return 0.0, duration
    spans: list[list[float]] = []
    for w in sorted(words, key=lambda w: w.start):
        if spans and w.start - spans[-1][1] <= SPEECH_BRIDGE:
            spans[-1][1] = max(spans[-1][1], w.end)
        else:
            spans.append([w.start, w.end])
    covered = sum(min(b, duration) - max(a, 0) for a, b in spans if b > 0 and a < duration)
    gaps = [spans[0][0]] + [b[0] - a[1] for a, b in itertools.pairwise(spans)]
    gaps.append(duration - spans[-1][1])
    return covered / duration, max(gaps)


def gate_speech(words: Sequence[Word], duration: float) -> Gate:
    share, silence = speech_stats(words, duration)
    data = {"speech_share": round(share, 3), "longest_silence": round(silence, 2)}
    if share < MIN_SPEECH:
        return Gate(False, f"only {share:.0%} speech (min {MIN_SPEECH:.0%})", data)
    if silence > MAX_SILENCE:
        return Gate(False, f"{silence:.1f}s silence (max {MAX_SILENCE}s)", data)
    return Gate(True, f"{share:.0%} speech, longest pause {silence:.1f}s", data)


# --------------------------------------------------------------------------- 3 & 4 ffmpeg


def _ffmpeg_stderr(args: list[str], timeout: float = 600) -> str:
    p = subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-nostats", *args, "-f", "null", "-"],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    return p.stderr


def measure_lufs(path: Path) -> float | None:
    err = _ffmpeg_stderr(["-i", str(path), "-vn", "-af", "ebur128=peak=true"])
    m = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", err)
    if not m or m[-1] == "-inf":
        return None
    return float(m[-1])


def gate_loudness(lufs: float | None) -> Gate:
    lo, hi = LOUD_RANGE
    if lufs is None:
        return Gate(False, "no measurable audio")
    if not lo <= lufs <= hi:
        return Gate(False, f"{lufs:.1f} LUFS (want {lo:g} to {hi:g})", {"lufs": lufs})
    return Gate(True, f"{lufs:.1f} LUFS", {"lufs": lufs})


FREEZE_NOISE = 0.003


def _freezes(err: str, duration: float) -> list[tuple[float, float]]:
    starts = [float(x) for x in re.findall(r"freeze_start:\s*([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"freeze_end:\s*([\d.]+)", err)]
    # A freeze that runs to the end of the file has a start but no end line.
    ends += [duration] * (len(starts) - len(ends))
    return list(zip(starts, ends, strict=True))


def measure_black_and_frozen(path: Path) -> tuple[float, list[tuple[float, float]]]:
    """Longest black stretch, and every frozen (start, end) stretch, in seconds."""
    err = _ffmpeg_stderr(
        [
            "-i",
            str(path),
            "-an",
            "-vf",
            f"blackdetect=d=0.5:pix_th=0.10,freezedetect=n={FREEZE_NOISE}:d=0.5",
        ]
    )
    black = [float(x) for x in re.findall(r"black_duration:\s*([\d.]+)", err)]
    return max(black, default=0.0), _freezes(err, probe(path).duration)


def source_static_share(source: Path, start: float, end: float) -> float:
    """Share of [start, end] of the source video that is itself frozen. A freeze in
    the clip that the source also has is still content (slides), not a bad render."""
    dur = end - start
    if dur <= 0:
        return 0.0
    err = _ffmpeg_stderr(
        [
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{dur:.3f}",
            "-i",
            str(source),
            "-an",
            "-vf",
            f"freezedetect=n={FREEZE_NOISE}:d=0.3",
        ]
    )
    spans = _freezes(err, dur)
    return sum(min(b, dur) - max(a, 0) for a, b in spans) / dur


def gate_visual(
    black: float,
    freezes: Sequence[tuple[float, float]],
    source_static: dict[tuple[float, float], float] | None = None,
) -> Gate:
    """Fails on black over 1 s, or a freeze over 1 s that the source does not have."""
    source_static = source_static or {}
    long_freezes = [f for f in freezes if f[1] - f[0] > MAX_BLACK_OR_FROZEN]
    unexplained = [f for f in long_freezes if source_static.get(f, 0.0) < 0.9]
    longest = max((b - a for a, b in unexplained), default=0.0)
    data = {
        "longest_black": round(black, 2),
        "frozen": [list(f) for f in freezes],
        "static_source": len(long_freezes) - len(unexplained),
    }
    bad = []
    if black > MAX_BLACK_OR_FROZEN:
        bad.append(f"{black:.1f}s black")
    if unexplained:
        bad.append(f"{longest:.1f}s frozen")
    if bad:
        return Gate(False, ", ".join(bad), data)
    if long_freezes:
        return Gate(True, "no black; still stretches match a static source", data)
    return Gate(True, "no black or frozen stretch over 1s", data)


# --------------------------------------------------------------------------- 5 captions


def gate_caption_sync(ass_text: str, transcript_words: int) -> Gate:
    cap = count_caption_words(ass_text)
    data = {"caption_words": cap, "transcript_words": transcript_words}
    if transcript_words == 0:
        return Gate(cap == 0, "no words in range", data)
    diff = abs(cap - transcript_words) / transcript_words
    if diff > CAPTION_TOLERANCE:
        return Gate(False, f"{cap} caption words vs {transcript_words} spoken", data)
    return Gate(True, f"{cap}/{transcript_words} words captioned", data)


# --------------------------------------------------------------------------- 6 safety

SAFETY_CATEGORIES = (
    "none",
    "hate",
    "harassment",
    "sexual",
    "graphic_violence",
    "dangerous_acts",
    "medical_advice",
    "financial_advice",
    "personal_data",
    "sponsor_read",
)

SAFETY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["decision", "category", "reason"],
    "properties": {
        "decision": {"type": "string", "enum": ["allow", "block"]},
        "category": {"type": "string", "enum": list(SAFETY_CATEGORIES)},
        "reason": {"type": "string"},
    },
}

SAFETY_SYSTEM = """You review short video clips before they are posted to TikTok. You \
read the spoken transcript and the caption and decide allow or block. Answer with JSON \
only."""

SAFETY_RULES = """Block the clip if it contains any of:
- hate: attacks on people for a protected trait
- harassment: insults or threats aimed at a real person
- sexual: sexual content
- graphic_violence: graphic violence or gore
- dangerous_acts: instructions or encouragement for dangerous or illegal acts
- medical_advice: medical advice stated as fact (diagnosis, treatment, dosing)
- financial_advice: telling people what to buy, sell or invest in, stated as fact
- personal_data: personal data of private people (phone, address, email, ID)
- sponsor_read: an ad or sponsor mention
General facts, stories and opinions are fine. Neutral education about health or \
money with clear caveats is fine.

Return {"decision": "allow" | "block", "category": one of the categories above or \
"none", "reason": one short sentence}."""


@dataclass(frozen=True)
class SafetyVerdict:
    decision: str
    category: str
    reason: str


def parse_safety(data: Any) -> SafetyVerdict:
    if not isinstance(data, dict):
        raise InvalidOutput("expected an object")
    d = str(data.get("decision", "")).strip().lower()
    c = str(data.get("category", "none")).strip().lower()
    if d not in ("allow", "block"):
        raise InvalidOutput(f"bad decision {d!r}")
    if c not in SAFETY_CATEGORIES:
        c = "other" if d == "block" else "none"
    return SafetyVerdict(d, c, str(data.get("reason", ""))[:300])


def safety_messages(transcript: str, post_text: str) -> list[dict[str, str]]:
    user = (
        f'{SAFETY_RULES}\n\nTranscript of the clip:\n"""\n{transcript}\n"""\n\n'
        f'Caption:\n"""\n{post_text}\n"""'
    )
    return [{"role": "system", "content": SAFETY_SYSTEM}, {"role": "user", "content": user}]


def gate_safety(v: SafetyVerdict, model: str) -> Gate:
    data = {"category": v.category, "model": model, "reason": v.reason}
    if v.decision == "block":
        return Gate(False, f"blocked ({v.category}): {v.reason}", data)
    return Gate(True, f"allowed by {model}", data)


# --------------------------------------------------------------------------- 7 & 8


def gate_transformation(
    ass_text: str, rights: str | None, post_text: str, credit_word: str = "Source:"
) -> Gate:
    missing = []
    if count_caption_words(ass_text) == 0:
        missing.append("captions")
    if not has_hook(ass_text):
        missing.append("hook overlay")
    if rights != "own" and credit_word not in post_text:
        missing.append("attribution")
    if missing:
        return Gate(False, "missing " + ", ".join(missing))
    return Gate(True, "captions, hook" + (", attribution" if rights != "own" else ""))


def gate_duplicates(
    clip_id: str, start: float, end: float, others: Sequence[tuple[str, float, float]]
) -> Gate:
    """`others`: (id, start, end) of the same video's clips that already passed."""
    from clipbot.select.snap import overlap_ratio

    for oid, a, b in others:
        if oid == clip_id:
            return Gate(False, "this clip id was already used")
        r = overlap_ratio((start, end), (a, b))
        if r > DUPLICATE_OVERLAP:
            return Gate(False, f"overlaps clip {oid} by {r:.0%}", {"other": oid})
    return Gate(True, "new")


def probe_or_none(path: Path) -> tuple[MediaInfo | None, str]:
    try:
        return probe(path), ""
    except ProbeError as e:
        return None, str(e)
