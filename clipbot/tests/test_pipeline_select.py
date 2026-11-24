from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from clipbot import db
from clipbot.select.llm import Attempt, LLMAuthError, LLMResult, NoFreeModelAvailable
from clipbot.select.prompt import parse_selection
from clipbot.transcribe import Segment, Transcript
from tests.factories import make_mp4
from tests.test_ingest import T0, FakeYT, make, state
from tests.test_select import WORDS, speech


def fake_transcript(words=WORDS) -> Transcript:
    segs, cur = [], []
    for w in words:
        cur.append(w)
        if w.w.endswith("."):
            segs.append(Segment(cur[0].start, cur[-1].end, " ".join(x.w for x in cur), cur))
            cur = []
    return Transcript("small", "en", 0.99, words[-1].end + 1, segs)


class FakeTranscriber:
    def __init__(self, tr: Transcript) -> None:
        self.tr = tr

    def __call__(self, media, work_dir, ws, hint, models_dir, progress=None):
        assert Path(media).is_file()
        self.tr.save(work_dir / f"transcript.{self.tr.model}.json")
        return self.tr


class FakeRouter:
    def __init__(self, outcomes: list[Any]) -> None:
        self.outcomes = outcomes
        self.calls: list[list[dict]] = []

    def complete_json(self, *, purpose, messages, validate, **kw):
        self.calls.append(messages)
        o = self.outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return LLMResult(
            validate(o), "free/model", json.dumps(o), 1200, 300, 0.0, [Attempt("free/model", "ok")]
        )


def clip(start: float, end: float, score: int = 85, **kw: Any) -> dict:
    d = {
        "start_sec": start,
        "end_sec": end,
        "score": score,
        "hook": "A surprising fact",
        "title": "Title",
        "summary": "Summary.",
        "hashtags": ["one", "two", "three"],
        "standalone": True,
        "risk_flags": ["none"],
    }
    d.update(kw)
    return d


def to_transcribed(env, router, tr=None):
    p = make(env, yt=FakeYT([]))
    p._router = router
    p._transcribe = FakeTranscriber(tr or fake_transcript())
    src = make_mp4(env[1].root / "in" / "ep1.mp4", seconds=181)
    reg = p.ingest_file(src, "mine", title="Episode 1")
    assert reg.state == "discovered"
    p.acquire(reg.video_id)
    p.transcribe(reg.video_id)
    p.step(reg.video_id)  # select (rendering is tested separately)
    return p, reg.video_id


def test_full_select_flow(env) -> None:
    router = FakeRouter(
        [
            {
                "clips": [
                    clip(10.4, 43.5, 90),
                    clip(50, 80, 88),
                    clip(52, 82, 70),  # overlaps the 88 one
                    clip(100, 130, 95, risk_flags=["sponsor_read"]),
                    clip(140, 170, 80, standalone=False),
                ]
            }
        ]
    )
    p, vid = to_transcribed(env, router)
    conn = env[2]
    assert state(conn, vid) == "selected"
    rows = conn.execute(
        "SELECT start_ms, end_ms, score, state FROM clips ORDER BY score DESC"
    ).fetchall()
    assert [(r["start_ms"], r["end_ms"], r["score"]) for r in rows] == [
        (9800, 44300, 90),
        (49800, 79300, 88),
    ]
    plan = json.loads((p.paths.work_dir(vid) / "select" / "plan.json").read_text())
    assert sorted(d["reason"] for d in plan["dropped"]) == [
        "blocked risk flag: sponsor_read",
        "not standalone",
        "overlaps a higher-scoring clip",
    ]
    call = json.loads((p.paths.work_dir(vid) / "select" / "window_0.json").read_text())
    assert call["input_tokens"] == 1200 and call["cost_usd"] == 0.0 and call["messages"]
    ev = conn.execute("SELECT data_json FROM events WHERE kind='llm_call'").fetchone()
    assert json.loads(ev[0])["model"] == "free/model"


def test_no_clip_passes_marks_video_done(env) -> None:
    _, vid = to_transcribed(env, FakeRouter([{"clips": []}]))
    assert state(env[2], vid) == "done"


def test_busy_free_models_retry_later(env) -> None:
    router = FakeRouter(
        [
            NoFreeModelAvailable("select", [Attempt("m", "rate_limited")]),
            {"clips": [clip(10.4, 43.5)]},
        ]
    )
    now = [T0]
    p, vid = to_transcribed(env, router)
    p.now = lambda: now[0]
    conn = env[2]
    assert state(conn, vid) == "transcribed"
    assert p.step(vid) is None  # not due yet
    now[0] += timedelta(minutes=31)
    assert p.step(vid) == "selected"


def test_bad_key_pauses(env) -> None:
    _, vid = to_transcribed(env, FakeRouter([LLMAuthError("401")]))
    conn = env[2]
    assert state(conn, vid) == "transcribed" and db.get_pause(conn).paused
    assert conn.execute("SELECT COUNT(*) FROM events WHERE level='alert'").fetchone()[0] == 1


def test_long_video_is_chunked(env) -> None:
    long_words = speech(sentences=600)  # 600 * 5 s = 50 minutes
    router = FakeRouter([{"clips": [clip(100.4, 133.5)]}, {"clips": [clip(2300.4, 2333.5)]}])
    to_transcribed(env, router, fake_transcript(long_words))
    assert len(router.calls) == 2  # both windows asked at the same time
    prompts = " ".join(c[1]["content"] for c in router.calls)
    assert "from 00:00.0 to 30:00.0" in prompts and "from 28:00.0 to " in prompts
    assert env[2].execute("SELECT COUNT(*) FROM clips").fetchone()[0] == 2


def test_local_file_needs_a_source_whose_rights_apply(env, config_dir: Path) -> None:
    p = make(env)
    with pytest.raises(LookupError, match="no source"):
        p.ingest_file(make_mp4(env[1].root / "x.mp4"), "nope")


def test_parse_selection_used_by_router_validates() -> None:
    with pytest.raises(Exception):  # noqa: B017
        parse_selection({"nope": 1})


def test_clip_count_chosen_per_video(env) -> None:
    router = FakeRouter([{"clips": [clip(10.4, 43.5, 90), clip(50, 80, 88), clip(100, 130, 86)]}])
    p = make(env, yt=FakeYT([]))
    p._router = router
    p._transcribe = FakeTranscriber(fake_transcript())
    src = make_mp4(env[1].root / "in" / "ep1.mp4", seconds=181)
    vid = p.ingest_file(src, "mine", title="Episode 1").video_id
    env[2].execute(
        "UPDATE videos SET meta_json = json_set(meta_json, '$.clip_count', 1) WHERE id = ?",
        (vid,),
    )
    p.acquire(vid)
    p.transcribe(vid)
    p.step(vid)
    rows = env[2].execute("SELECT score FROM clips WHERE video_id = ?", (vid,)).fetchall()
    assert [r["score"] for r in rows] == [90]  # only the best one, as asked
    plan = json.loads((p.paths.work_dir(vid) / "select" / "plan.json").read_text())
    assert any("per_video=1" in d["reason"] for d in plan["dropped"])
