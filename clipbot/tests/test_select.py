from __future__ import annotations

import hashlib

import pytest

from clipbot.models import Word
from clipbot.select.llm import InvalidOutput
from clipbot.select.prompt import (
    build_messages,
    fmt_ts,
    parse_selection,
    transcript_lines,
    windows,
)
from clipbot.select.snap import (
    Candidate,
    PlannedClip,
    SnapRules,
    drop_overlaps,
    merge_window_candidates,
    overlap_ratio,
    plan_clips,
    snap_end,
    snap_start,
)
from clipbot.transcribe import Segment


def speech(sentences: int = 40, words_per: int = 8, step: float = 0.5) -> list[Word]:
    """Sentences of `words_per` words, `step` seconds per word, 1 s pause between."""
    out, t = [], 0.0
    for s in range(sentences):
        for i in range(words_per):
            last = i == words_per - 1
            out.append(Word(f"w{s}_{i}{'.' if last else ''}", round(t, 3), round(t + 0.4, 3)))
            t += step
        t += 1.0
    return out


# sentence k starts at k*5.0 and its last word ends at k*5.0 + 3.9
WORDS = speech()
DURATION = WORDS[-1].end + 2


def cand(start: float, end: float, score: int = 80, **kw) -> Candidate:
    base = dict(
        start_sec=start,
        end_sec=end,
        score=score,
        hook="Why this matters",
        title="t",
        summary="s",
        hashtags=("a1", "b2", "c3"),
        standalone=True,
        risk_flags=(),
    )
    base.update(kw)
    return Candidate(**base)


RULES = SnapRules(
    min_seconds=20,
    max_seconds=60,
    pre_roll=0.2,
    post_roll=0.4,
    min_score=70,
    per_video=3,
    blocked_flags=frozenset({"sponsor_read", "financial_claim"}),
)


# ---------------------------------------------------------------- snapping


def test_snap_start_prefers_sentence_start() -> None:
    # 10.6 is nearest to word w2_1 (10.5) mid-sentence, but sentence 2 starts at 10.0
    assert snap_start(10.6, WORDS) == 10.0


def test_snap_start_nearest_word_when_no_sentence_start_in_range() -> None:
    assert snap_start(12.6, WORDS) == 12.5  # sentence starts at 10 and 15: both > 1.5 away


def test_snap_start_none_outside_tolerance() -> None:
    gap = [Word("a.", 0, 0.4), Word("b", 10, 10.4)]
    assert snap_start(5.0, gap) is None


def test_snap_end_prefers_sentence_end() -> None:
    assert snap_end(23.0, WORDS) == 23.9  # end of sentence 4 (20.0 + 3.9)
    assert snap_end(22.4, WORDS) == 22.4  # w4_4 ends 22.4; sentence end 23.9 is 1.5 away
    assert snap_end(50.0, [Word("x", 0, 1)]) is None


def test_quotes_after_full_stop_count_as_sentence_end() -> None:
    ws = [
        Word("He", 0, 0.3),
        Word("said", 0.4, 0.7),
        Word('"no."', 0.8, 1.2),
        Word("Then", 1.5, 1.8),
    ]
    assert snap_end(1.6, ws) == 1.2


# ---------------------------------------------------------------- placing


def test_plan_snaps_and_adds_rolls() -> None:
    plan = plan_clips("vid", [cand(10.4, 43.5)], WORDS, DURATION, RULES)
    (c,) = plan.kept
    assert (c.start, c.end) == (round(10.0 - 0.2, 3), round(43.9 + 0.4, 3))
    assert c.clip_id == hashlib.sha1(b"vid:9800:44300").hexdigest()[:16]  # noqa: S324


def test_rolls_clamp_to_video_bounds() -> None:
    plan = plan_clips("vid", [cand(0.0, 28.9)], WORDS, 29.0, RULES)
    assert plan.kept[0].start == 0.0 and plan.kept[0].end == 29.0


def test_too_long_is_trimmed_to_last_full_sentence() -> None:
    plan = plan_clips("vid", [cand(10.0, 98.9)], WORDS, DURATION, RULES)
    (c,) = plan.kept
    assert c.end - c.start <= 60
    assert round(c.end - 0.4, 3) == 68.9  # last sentence end within 10 - 0.2 + 60 - 0.4
    assert any(round(w.end, 3) == round(c.end - 0.4, 3) and w.w.endswith(".") for w in WORDS)


def test_too_long_without_sentence_end_is_dropped() -> None:
    run_on = [Word(f"w{i}", i * 0.5, i * 0.5 + 0.4) for i in range(300)]
    plan = plan_clips("vid", [cand(0.0, 100.4)], run_on, 200, RULES)
    assert not plan.kept and "no sentence end" in plan.dropped[0].reason


def test_too_short_reaches_back_for_the_build_up() -> None:
    plan = plan_clips("vid", [cand(40.0, 48.9)], WORDS, DURATION, RULES)
    (c,) = plan.kept
    assert c.end - c.start >= RULES.min_seconds and round(c.end - 0.4, 3) == 48.9
    assert any(abs(w.start - (c.start + 0.2)) < 1e-6 for w in WORDS)  # starts on a word


def test_too_short_video_is_dropped() -> None:
    tiny = [w for w in WORDS if w.end < 12]
    plan = plan_clips("vid", [cand(1.0, 8.0)], tiny, 12, RULES)
    assert "too short" in plan.dropped[0].reason


def test_hallucinated_times_are_dropped() -> None:
    plan = plan_clips("vid", [cand(5000.0, 5030.0)], WORDS, DURATION, RULES)
    assert "no word within" in plan.dropped[0].reason
    plan = plan_clips("vid", [cand(30.0, 10.0)], WORDS, DURATION, RULES)
    assert plan.dropped[0].reason == "end before start"


# ---------------------------------------------------------------- filters


def test_filters() -> None:
    cs = [
        cand(10, 33.9, standalone=False),
        cand(40, 63.9, risk_flags=("sponsor_read",)),
        cand(70, 93.9, score=69),
        cand(100, 123.9, risk_flags=("politics",)),  # flagged but not blocked
    ]
    plan = plan_clips("vid", cs, WORDS, DURATION, RULES)
    reasons = [d.reason for d in plan.dropped]
    assert reasons == ["not standalone", "blocked risk flag: sponsor_read", "score 69 < 70"]
    assert len(plan.kept) == 1 and plan.kept[0].candidate.risk_flags == ("politics",)


def test_per_video_keeps_best() -> None:
    cs = [cand(i * 30, i * 30 + 23.9, score=70 + i) for i in range(6)]
    plan = plan_clips("vid", cs, WORDS, DURATION, RULES)
    assert [c.candidate.score for c in plan.kept] == [75, 74, 73]
    assert sum("per_video" in d.reason for d in plan.dropped) == 3


# ---------------------------------------------------------------- overlap


def pc(start: float, end: float, score: int) -> PlannedClip:
    return PlannedClip(f"{start}", "v", start, end, cand(start, end, score))


def test_overlap_ratio() -> None:
    assert overlap_ratio((0, 10), (10, 20)) == 0
    assert overlap_ratio((0, 10), (8, 30)) == pytest.approx(0.2)
    assert overlap_ratio((0, 30), (5, 15)) == 1.0  # fully inside the shorter clip


def test_drop_overlaps_keeps_higher_score_and_allows_20_percent() -> None:
    kept, lost = drop_overlaps([pc(0, 10, 70), pc(8, 30, 90), pc(5, 9, 95)])
    # (5,9) wins; (8,30) overlaps it by 1/4 = 25% -> lost; (0,10) overlaps (5,9) fully
    assert [k.start for k in kept] == [5] and len(lost) == 2
    kept, _ = drop_overlaps([pc(0, 10, 80), pc(8, 30, 70)])  # exactly 20%: allowed
    assert len(kept) == 2


def test_chunk_merge_dedupes_overlap_windows() -> None:
    a = [cand(1190.0, 1220.0, 80), cand(100.0, 130.0, 75)]
    b = [cand(1190.04, 1220.02, 85), cand(1300.0, 1330.0, 90)]  # same moment, seen twice
    merged = merge_window_candidates([a, b])
    assert [(c.start_sec, c.score) for c in merged] == [(100.0, 75), (1190.04, 85), (1300.0, 90)]


# ---------------------------------------------------------------- chunking


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [
        (19, [(0, 19)]),
        (45, [(0, 45)]),
        (50, [(0, 30), (28, 50)]),
        (60, [(0, 30), (28, 60)]),  # 4-minute tail folded into the previous window
        (90, [(0, 30), (28, 58), (56, 86), (84, 90)]),
    ],
)
def test_windows(minutes: int, expected: list[tuple[int, int]]) -> None:
    got = windows(minutes * 60.0)
    assert [(a / 60, b / 60) for a, b in got] == expected


def test_transcript_lines_and_prompt() -> None:
    segs = [
        Segment(0.0, 2.0, "Hello there."),
        Segment(65.25, 70.0, "Next bit."),
        Segment(1300.0, 1302.0, "Later."),
    ]
    lines = transcript_lines(segs, 0, 1200)
    assert lines == "[0.0] Hello there.\n[65.2] Next bit."
    assert fmt_ts(3725.0) == "62:05.0"
    msgs = build_messages(
        lines, topics_hint="science facts", min_s=20, max_s=60, n=6, window=(0, 1200)
    )
    user = msgs[1]["content"]
    assert "20 to 60 seconds" in user and "science facts" in user and "[65.2]" in user
    assert (
        "Never return a single line" in user
        and "cliffhanger" in user
        and "Skip intros and outros" in user
        and "sponsor mention" in user
    )
    assert "00:00.0 to 20:00.0" in user and "caption_title" not in user
    pl = build_messages(lines, topics_hint="", min_s=20, max_s=60, n=6, language="Polish")
    assert "caption_title: in Polish" in pl[1]["content"] and "SZOK" in pl[1]["content"]


# ---------------------------------------------------------------- schema

GOOD = {
    "start_sec": 10,
    "end_sec": 40,
    "score": 88,
    "hook": "You forget most of it",
    "title": "The forgetting curve",
    "summary": "Why memory fades.",
    "hashtags": ["#Memory", "learning", "study tips", "memory"],
    "standalone": True,
    "risk_flags": ["none"],
}


def test_parse_good_response() -> None:
    cands, errors = parse_selection({"clips": [GOOD]})
    (c,) = cands
    assert errors == [] and c.score == 88 and c.risk_flags == ()
    assert c.hashtags == ("memory", "learning", "studytips")  # '#', case, spaces, dupes


def test_parse_accepts_bare_list_and_empty() -> None:
    assert len(parse_selection([GOOD])[0]) == 1
    assert parse_selection({"clips": []}) == ([], [])


@pytest.mark.parametrize(
    "bad",
    [
        "not json at all",
        None,
        42,
        {"clip": []},
        {"clips": "x"},
        {"clips": [{"start_sec": "soon"}]},  # every clip unusable
    ],
)
def test_malformed_responses_raise(bad: object) -> None:
    with pytest.raises(InvalidOutput):
        parse_selection(bad)


@pytest.mark.parametrize(
    ("patch", "reason"),
    [
        ({"hook": "one two three four five six seven eight nine ten"}, "hook must be"),
        ({"risk_flags": ["weird"]}, "unknown risk flags"),
        ({"risk_flags": "none"}, "risk_flags is not a list"),
        ({"score": 140}, "out of range"),
        ({"hashtags": ["a"]}, "fewer than 3"),
        ({"summary": " "}, "empty summary"),
    ],
)
def test_bad_clips_are_dropped_individually(patch: dict, reason: str) -> None:
    cands, errors = parse_selection({"clips": [GOOD, {**GOOD, **patch}]})
    assert len(cands) == 1 and reason in errors[0]


def test_lenient_coercions() -> None:
    (c,), _ = parse_selection({"clips": [{**GOOD, "score": "91.6", "title": "x" * 100}]})
    assert c.score == 92 and len(c.title) == 80 and c.title.endswith("…")


def test_caption_fields_ride_along() -> None:
    from clipbot.select.prompt import clip_schema

    item = clip_schema("Polish")["properties"]["clips"]["items"]
    assert "caption_title" in item["required"] and "standalone" not in item["required"]
    d = {**GOOD, "caption_title": "SZOK! Mózg zapomina", "caption_text": "Dlaczego?",
         "caption_hashtags": ["#Mózg", "nauka", "dla ciebie"]}  # fmt: skip
    (c,), _ = parse_selection({"clips": [d]})
    assert c.caption == ("SZOK! Mózg zapomina", "Dlaczego?", ("mózg", "nauka", "dlaciebie"))
    (c,), _ = parse_selection({"clips": [GOOD]})
    assert c.caption is None


def test_millisecond_answers_are_converted() -> None:
    from clipbot.select.snap import fix_time_units

    fixed = fix_time_units([cand(54272.0, 59520.0), cand(10.0, 40.0)], 1145.0)
    assert [(c.start_sec, c.end_sec) for c in fixed] == [(54.272, 59.52), (10.0, 40.0)]
