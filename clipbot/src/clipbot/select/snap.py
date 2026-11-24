"""Turn model-proposed clips into exact, safe clip boundaries. Pure functions.

Whatever the model returns, this code decides the final times (brief 4.4):
1. snap start/end to word boundaries within 1.5 s, preferring sentence edges
2. add pre-roll and post-roll
3. enforce min/max length (trimming an over-long clip back to a sentence end)
4. drop clips that are not standalone, carry a blocked risk flag, or score low
5. drop clips overlapping a better one by more than 20 %
6. keep the best `per_video`
7. clip_id = sha1(video:start_ms:end_ms)[:16]
"""

from __future__ import annotations

import bisect
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from clipbot.models import Word, make_clip_id

# Flags that only hold a clip back while there are enough others.
SOFT_FLAGS = frozenset({"medical_claim", "financial_claim", "politics", "profanity"})
RISK_FLAGS = frozenset(
    {
        "profanity",
        "hate",
        "sexual",
        "violence",
        "medical_claim",
        "financial_claim",
        "politics",
        "sponsor_read",
        "personal_data",
        "copyrighted_music",
        "none",
    }
)
SNAP_TOLERANCE = 1.5
MAX_OVERLAP = 0.20
_SENTENCE_END = (".", "?", "!", "…")
_CLOSERS = "\"')]}\u201d\u2019"  # closing quotes and brackets after a full stop


@dataclass(frozen=True)
class Candidate:
    """One clip as proposed by the model, already shape-validated."""

    start_sec: float
    end_sec: float
    score: int
    hook: str
    title: str
    summary: str
    hashtags: tuple[str, ...]
    standalone: bool
    risk_flags: tuple[str, ...]
    # The TikTok caption written in the same call: (first line, text, hashtags),
    # in the language asked for. None when no caption language was asked.
    caption: tuple[str, str, tuple[str, ...]] | None = None


@dataclass(frozen=True)
class PlannedClip:
    clip_id: str
    video_id: str
    start: float
    end: float
    candidate: Candidate

    @property
    def start_ms(self) -> int:
        return round(self.start * 1000)

    @property
    def end_ms(self) -> int:
        return round(self.end * 1000)

    @property
    def length(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class Dropped:
    candidate: Candidate
    reason: str


@dataclass
class Plan:
    kept: list[PlannedClip] = field(default_factory=list)
    dropped: list[Dropped] = field(default_factory=list)


@dataclass(frozen=True)
class SnapRules:
    min_seconds: float = 20
    max_seconds: float = 60
    pre_roll: float = 0.2
    post_roll: float = 0.4
    min_score: int = 70
    per_video: int = 3
    blocked_flags: frozenset[str] = frozenset()
    tolerance: float = SNAP_TOLERANCE
    max_overlap: float = MAX_OVERLAP


# --------------------------------------------------------------------------- words


def ends_sentence(w: Word) -> bool:
    return w.w.rstrip(_CLOSERS).endswith(_SENTENCE_END)


def snap_start(t: float, words: Sequence[Word], tol: float = SNAP_TOLERANCE) -> float | None:
    """Nearest word start within `tol`, preferring one that begins a sentence."""
    best: tuple[float, float] | None = None  # (cost, time)
    for i, w in enumerate(words):
        d = abs(w.start - t)
        if d > tol:
            if w.start > t + tol:
                break
            continue
        sentence = i == 0 or ends_sentence(words[i - 1])
        cost = d - (tol if sentence else 0.0)  # any sentence start beats any mid-sentence word
        if best is None or cost < best[0]:
            best = (cost, w.start)
    return best[1] if best else None


def snap_end(t: float, words: Sequence[Word], tol: float = SNAP_TOLERANCE) -> float | None:
    """Nearest word end within `tol`, preferring one that ends a sentence."""
    best: tuple[float, float] | None = None
    for w in words:
        d = abs(w.end - t)
        if d > tol:
            if w.start > t + tol:
                break
            continue
        cost = d - (tol if ends_sentence(w) else 0.0)
        if best is None or cost < best[0]:
            best = (cost, w.end)
    return best[1] if best else None


def trim_to_sentence(start: float, limit: float, words: Sequence[Word]) -> float | None:
    """Latest sentence end in (start, limit]. None if there is none."""
    ends = [w.end for w in words if start < w.end <= limit and ends_sentence(w)]
    return ends[-1] if ends else None


def words_between(words: Sequence[Word], start: float, end: float) -> list[Word]:
    starts = [w.start for w in words]
    i = bisect.bisect_left(starts, start - 1e-6)
    out = []
    for w in words[i:]:
        if w.start >= end:
            break
        if w.end <= end + 1e-6:
            out.append(w)
    return out


# --------------------------------------------------------------------------- geometry


def overlap_ratio(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Shared time as a share of the shorter clip."""
    inter = min(a[1], b[1]) - max(a[0], b[0])
    if inter <= 0:
        return 0.0
    shorter = min(a[1] - a[0], b[1] - b[0])
    return inter / shorter if shorter > 0 else 1.0


def drop_overlaps(
    clips: Iterable[PlannedClip], max_overlap: float = MAX_OVERLAP
) -> tuple[list[PlannedClip], list[PlannedClip]]:
    """Greedy by score: keep a clip unless it overlaps a kept one too much."""
    kept: list[PlannedClip] = []
    lost: list[PlannedClip] = []
    for c in sorted(clips, key=lambda c: (-c.candidate.score, c.start)):
        if any(overlap_ratio((c.start, c.end), (k.start, k.end)) > max_overlap for k in kept):
            lost.append(c)
        else:
            kept.append(c)
    return kept, lost


def merge_window_candidates(per_window: Iterable[Iterable[Candidate]]) -> list[Candidate]:
    """Windows overlap by two minutes, so the same moment can be proposed twice.
    Exact duplicates collapse here; near-duplicates fall to the overlap rule."""
    seen: dict[tuple[float, float], Candidate] = {}
    for window in per_window:
        for c in window:
            key = (round(c.start_sec, 1), round(c.end_sec, 1))
            if key not in seen or c.score > seen[key].score:
                seen[key] = c
    return sorted(seen.values(), key=lambda c: c.start_sec)


# --------------------------------------------------------------------------- plan


def place(
    c: Candidate, words: Sequence[Word], duration: float, r: SnapRules
) -> tuple[float, float] | str:
    """Final (start, end) for one candidate, or the reason it cannot be placed."""
    if c.end_sec <= c.start_sec:
        return "end before start"
    s = snap_start(c.start_sec, words, r.tolerance)
    if s is None:
        return f"no word within {r.tolerance}s of start {c.start_sec:.1f}"
    e = snap_end(c.end_sec, words, r.tolerance)
    if e is None:
        return f"no word within {r.tolerance}s of end {c.end_sec:.1f}"
    if e <= s:
        return "snapped end before start"

    # Too short (models often pick just the peak line): reach back for the build-up,
    # to the start of a word, then forward if the video starts too soon.
    target = r.min_seconds + 0.5 - r.pre_roll - r.post_roll
    if e - s < target:
        want = e - target
        earlier = [w.start for w in words if w.start <= max(want, 0.0)]
        s = earlier[-1] if earlier else (words[0].start if words else s)
        if e - s < target:
            later = [w.end for w in words if w.end >= s + target]
            if later:
                e = later[0]

    # Too long: cut back to the last full sentence that fits.
    limit = s - r.pre_roll + r.max_seconds - r.post_roll
    if e > limit:
        cut = trim_to_sentence(s, limit, words)
        if cut is None:
            return f"too long ({e - s:.1f}s) and no sentence end to trim to"
        e = cut

    start = max(0.0, s - r.pre_roll)
    end = min(duration, e + r.post_roll) if duration > 0 else e + r.post_roll
    length = end - start
    if length < r.min_seconds:
        return f"too short ({length:.1f}s < {r.min_seconds:g}s)"
    if length > r.max_seconds + 1e-6:
        return f"too long ({length:.1f}s > {r.max_seconds:g}s)"
    return round(start, 3), round(end, 3)


def plan_clips(
    video_id: str,
    candidates: Iterable[Candidate],
    words: Sequence[Word],
    duration: float,
    rules: SnapRules,
    taken: Sequence[tuple[float, float]] = (),
) -> Plan:
    """`taken`: (start, end) of this video's clips from earlier rounds; new clips
    must be different moments (a re-sent link asks for more clips)."""
    plan = Plan()
    placed: list[PlannedClip] = []
    for c in candidates:
        if not c.standalone:
            plan.dropped.append(Dropped(c, "not standalone"))
            continue
        bad = sorted(set(c.risk_flags) & rules.blocked_flags)
        if bad:
            plan.dropped.append(Dropped(c, f"blocked risk flag: {', '.join(bad)}"))
            continue
        if c.score < rules.min_score:
            plan.dropped.append(Dropped(c, f"score {c.score} < {rules.min_score}"))
            continue
        where = place(c, words, duration, rules)
        if isinstance(where, str):
            plan.dropped.append(Dropped(c, where))
            continue
        start, end = where
        if any(overlap_ratio((start, end), t) > rules.max_overlap for t in taken):
            plan.dropped.append(Dropped(c, "same moment as an earlier clip"))
            continue
        clip_id = make_clip_id(video_id, round(start * 1000), round(end * 1000))
        placed.append(PlannedClip(clip_id, video_id, start, end, c))

    kept, lost = drop_overlaps(placed, rules.max_overlap)
    for c in lost:
        plan.dropped.append(Dropped(c.candidate, "overlaps a higher-scoring clip"))
    if len(kept) < rules.per_video:
        # Fewer than asked for: take the best of the ones held back only for a
        # low score or a cautious flag (health or money talk, politics, swearing).
        # The safety review still checks each one before it can be posted.
        for d in sorted(plan.dropped, key=lambda d: -d.candidate.score):
            if len(kept) >= rules.per_video:
                break
            c = d.candidate
            flags = set(c.risk_flags) & rules.blocked_flags
            if not (d.reason.startswith("score ") or (flags and flags <= SOFT_FLAGS)):
                continue
            where = place(c, words, duration, rules)
            if isinstance(where, str):
                continue
            start, end = where
            span = (start, end)
            if any(overlap_ratio(span, t) > rules.max_overlap for t in taken) or any(
                overlap_ratio(span, (k.start, k.end)) > rules.max_overlap for k in kept
            ):
                continue
            cid = make_clip_id(video_id, round(start * 1000), round(end * 1000))
            kept.append(PlannedClip(cid, video_id, start, end, c))
            plan.dropped.remove(d)
    kept.sort(key=lambda c: (-c.candidate.score, c.start))
    for c in kept[rules.per_video :]:
        plan.dropped.append(Dropped(c.candidate, f"beyond per_video={rules.per_video}"))
    plan.kept = kept[: rules.per_video]
    return plan


def fix_time_units(cands: Sequence[Candidate], duration: float) -> list[Candidate]:
    """Some models answer in milliseconds although seconds were asked for. A clip
    past the end of the video whose times fit once divided by 1000 is converted."""
    from dataclasses import replace

    out = []
    for c in cands:
        if c.end_sec > duration + 5 and c.end_sec / 1000 <= duration + 5:
            c = replace(c, start_sec=c.start_sec / 1000, end_sec=c.end_sec / 1000)
        out.append(c)
    return out
