"""Re-sending a link, and never leaving a video stuck half-way."""

from __future__ import annotations

import json
from datetime import timedelta

from clipbot import db
from clipbot.pipeline import Pipeline
from clipbot.sources.providers.ytdlp import YtDlpProvider
from clipbot.web.status import progress
from tests.factories import make_mp4
from tests.test_pipeline_select import clip, fake_transcript
from tests.test_youtube_fast import POLISH, BatchRouter, NoFaces, Proc, local_info, split_streams

VID = "abcdefghijk"


def setup(env, monkeypatch, tmp_path, outcomes):
    cfg, paths, conn = env
    object.__setattr__(cfg.settings.post, "language", "pl")
    object.__setattr__(cfg.settings.safety, "strict_qa", False)
    v, a = split_streams(make_mp4(tmp_path / "src.mp4", seconds=181))
    info = local_info(v, a, language="en", duration=181)
    provider = YtDlpProvider(runner=lambda cmd, **kw: Proc(0, out=json.dumps(info)))
    monkeypatch.setattr("clipbot.pipeline.captions_transcript", lambda i: fake_transcript())
    monkeypatch.setattr(Pipeline, "face_detector", lambda self: NoFaces())
    router = BatchRouter(outcomes)
    p = Pipeline(conn, cfg, paths, providers={"local_folder": provider}, router=router)
    now = db.iso(p.now())
    conn.execute(
        "INSERT INTO videos(id, source_id, title, channel_title, state, state_changed_at, "
        "license, created_at, updated_at) VALUES (?, 'mine', 'T', 'Chan', 'discovered', ?, "
        "'youtube', ?, ?)",
        (VID, now, now, now),
    )
    return p, router


def again(p):
    return p._again(VID, p._row(VID), None)


def test_resent_link_makes_different_clips(env, monkeypatch, tmp_path) -> None:
    p, router = setup(env, monkeypatch, tmp_path, [{"clips": [clip(10.4, 43.5, 90) | POLISH]}])
    assert p.fast_process(VID)[-1] == "done"
    first = {r["id"] for r in p.conn.execute("SELECT id FROM clips")}

    # The same link again: back to clip picking, the old moment off limits.
    router.outcomes.append({"clips": [clip(10.4, 43.5, 95) | POLISH, clip(100, 130) | POLISH]})
    reg = again(p)
    assert reg.again == "more" and reg.state == "transcribed"
    assert p.fast_process(VID)[-1] == "done"
    prompt = router.calls[-2][1]["content"]
    assert "already clipped" in prompt and "10." in prompt
    rows = p.conn.execute("SELECT id, start_ms, state FROM clips").fetchall()
    new = [r for r in rows if r["id"] not in first]
    assert len(rows) == 2 and len(new) == 1 and new[0]["start_ms"] >= 99000
    plan = json.loads((p.paths.work_dir(VID) / "select" / "plan.json").read_text())
    assert any(d["reason"] == "same moment as an earlier clip" for d in plan["dropped"])
    # The progress panel counts this round's clip only.
    (job,) = progress(p.conn, p.now() + timedelta(seconds=1))
    assert job["round"] == 2 and job["total"] == 1


def test_failed_link_is_retried_and_refused_stays_refused(env, monkeypatch, tmp_path) -> None:
    p, _ = setup(env, monkeypatch, tmp_path, [])
    p.conn.execute("UPDATE videos SET state = 'failed', next_attempt_at = NULL")
    assert again(p).again == "retry" and p._row(VID)["state"] == "discovered"
    p.conn.execute("UPDATE videos SET state = 'skipped', state_reason = 'no rights'")
    reg = again(p)
    assert reg.again == "refused" and p._row(VID)["state"] == "skipped"
    p.conn.execute("UPDATE videos SET state = 'acquiring'")
    assert again(p).again == "busy"


def test_unexpected_error_never_leaves_video_stuck(env, monkeypatch, tmp_path) -> None:
    p, _ = setup(env, monkeypatch, tmp_path, [RuntimeError("database is locked")])
    assert p.fast_process(VID) == ["interrupted"]
    row = p._row(VID)
    assert row["state"] == "transcribed" and "interrupted" in row["state_reason"]
    assert row["next_attempt_at"] is not None  # tried again in a minute
    assert db.claimed_videos(p.conn) == set()  # claim released


def test_one_worker_per_video(env, monkeypatch, tmp_path) -> None:
    p, _ = setup(env, monkeypatch, tmp_path, [])
    assert db.claim_video(p.conn, VID, "someone-else")
    assert p.fast_process(VID) == []  # left alone
    assert p._row(VID)["state"] == "discovered"


def test_recovery_skips_claimed_videos(env) -> None:
    _, _, conn = env
    old = db.iso(db.utcnow() - timedelta(hours=1))
    conn.execute(
        "INSERT INTO videos(id, source_id, state, prev_state, state_changed_at, created_at, "
        "updated_at) VALUES ('aaaaaaaaaaa', 'mine', 'selecting', 'transcribed', ?, ?, ?), "
        "('bbbbbbbbbbb', 'mine', 'selecting', 'transcribed', ?, ?, ?)",
        (old, old, old, old, old, old),
    )
    db.claim_video(conn, "aaaaaaaaaaa", "live-worker")
    assert db.recover_stuck(conn) == [("videos", "bbbbbbbbbbb")]


def test_paused_bot_is_shown_as_paused(env) -> None:
    _, _, conn = env
    now = db.utcnow()
    conn.execute(
        "INSERT INTO videos(id, source_id, title, state, state_changed_at, created_at, "
        "updated_at) VALUES ('ccccccccccc', 'mine', 'T', 'discovered', ?, ?, ?)",
        (db.iso(now), db.iso(now), db.iso(now)),
    )
    db.set_pause(conn, "testing")
    (job,) = progress(conn, now)
    assert "paused" in job["wait"]
