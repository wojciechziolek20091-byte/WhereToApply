"""Retention: old downloads, source cuts and renders are deleted (cleanup.py)."""

from __future__ import annotations

from datetime import timedelta

from clipbot import cleanup, db
from clipbot.config import RetentionSettings
from clipbot.web.status import clip_views
from tests.test_scheduler import DAY1, build

KEEP = RetentionSettings(raw_days=3, render_days=14)


def add_video(env, vid: str, state: str, age_days: float) -> dict:
    """A video with a full download, an info.json and one source cut per clip."""
    _, paths, conn = env
    t = db.iso(DAY1 - timedelta(days=age_days))
    raw = paths.raw_video(vid)
    raw.write_bytes(b"raw" * 100)
    work = paths.work_dir(vid)
    work.mkdir(parents=True, exist_ok=True)
    (work / "info.json").write_text("{}")
    (work / "transcript.small.json").write_text("{}")
    conn.execute(
        "INSERT INTO videos(id, source_id, title, channel_title, license, state, "
        "state_changed_at, raw_path, created_at, updated_at) "
        "VALUES (?, 'mine', 'T', 'Chan', 'youtube', ?, ?, ?, ?, ?)",
        (vid, state, t, str(raw), t, t),
    )
    return {"raw": raw, "info": work / "info.json", "transcript": work / "transcript.small.json"}


def add_clip(env, vid: str, cid: str, state: str, age_days: float) -> dict:
    _, paths, conn = env
    t = db.iso(DAY1 - timedelta(days=age_days))
    render, sheet = paths.render(cid), paths.contact_sheet(cid)
    poster = render.with_suffix(".poster.jpg")
    for f in (render, sheet, poster):
        f.write_bytes(b"x" * 10)
    cut = paths.work_dir(vid) / "render" / cid
    cut.mkdir(parents=True, exist_ok=True)
    (cut / "source.mp4").write_bytes(b"cut")
    (cut / "source.json").write_text('{"offset": 0}')
    (cut / "caption.pl.json").write_text("{}")
    conn.execute(
        "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, summary, state, "
        "state_changed_at, render_path, contact_sheet_path, post_text, created_at, updated_at) "
        "VALUES (?, ?, 0, 30000, 70, 'h', 't', 's', ?, ?, ?, ?, 'cap', ?, ?)",
        (cid, vid, state, t, str(render), str(sheet), t, t),
    )
    return {
        "render": render,
        "sheet": sheet,
        "poster": poster,
        "cut": cut / "source.mp4",
        "cut_meta": cut / "source.json",
        "caption": cut / "caption.pl.json",
    }


def row(env, table: str, rid: str):
    return env[2].execute(f"SELECT * FROM {table} WHERE id = ?", (rid,)).fetchone()


def test_old_finished_video_loses_raw_info_and_cuts(env) -> None:
    v = add_video(env, "oldvideo001", "done", age_days=4)
    c = add_clip(env, "oldvideo001", "c_queued", "qa_passed", age_days=4)
    res = cleanup.cleanup(env[2], env[1], KEEP, DAY1)
    assert res.videos == ["oldvideo001"]
    assert not v["raw"].exists() and not v["info"].exists()
    assert not c["cut"].exists() and not c["cut_meta"].exists()
    assert row(env, "videos", "oldvideo001")["raw_path"] is None
    # Small files stay, and a clip waiting to post keeps its render.
    assert v["transcript"].exists() and c["caption"].exists()
    assert c["render"].exists() and row(env, "clips", "c_queued")["render_path"]
    ev = env[2].execute("SELECT * FROM events WHERE kind = 'cleanup'").fetchone()
    assert ev is not None and "oldvideo001" in ev["data_json"]


def test_video_kept_when_recent_unfinished_or_busy(env) -> None:
    files = {
        vid: add_video(env, vid, state, age)
        for vid, state, age in (
            ("recent00001", "done", 2),
            ("working0001", "transcribed", 10),
            ("retrying001", "acquire_failed", 10),
            ("checking001", "done", 10),
        )
    }
    # A clip still waiting for its check reads the source cut: keep the video's files.
    add_clip(env, "checking001", "c_check", "rendered", age_days=10)
    for state in ("skipped", "failed"):
        files[f"{state}0001"] = add_video(env, f"{state}0001", state, 10)
    res = cleanup.cleanup(env[2], env[1], KEEP, DAY1)
    assert sorted(res.videos) == ["failed0001", "skipped0001"]
    for vid in ("recent00001", "working0001", "retrying001", "checking001"):
        assert files[vid]["raw"].exists(), vid
        assert row(env, "videos", vid)["raw_path"]


def test_busy_video_is_skipped(env, monkeypatch) -> None:
    v = add_video(env, "busyvideo01", "done", age_days=10)
    monkeypatch.setattr("clipbot.runner.running", lambda: {"busyvideo01"})
    assert cleanup.cleanup(env[2], env[1], KEEP, DAY1).videos == []
    assert v["raw"].exists()


def test_renders_deleted_only_for_finished_old_clips(env) -> None:
    add_video(env, "vvvvvvvvvvv", "done", age_days=1)  # recent: raw stays
    finished = ("published", "rejected", "qa_rejected", "skipped", "failed")
    waiting = ("qa_passed", "scheduled", "awaiting_approval", "publishing")
    files = {s: add_clip(env, "vvvvvvvvvvv", f"old_{s}", s, age_days=15) for s in finished}
    files |= {s: add_clip(env, "vvvvvvvvvvv", f"old_{s}", s, age_days=30) for s in waiting}
    files["recent"] = add_clip(env, "vvvvvvvvvvv", "new_published", "published", age_days=13)
    res = cleanup.cleanup(env[2], env[1], KEEP, DAY1)
    assert sorted(res.clips) == sorted(f"old_{s}" for s in finished)
    for s in finished:
        f = files[s]
        assert not f["render"].exists() and not f["sheet"].exists() and not f["poster"].exists()
        r = row(env, "clips", f"old_{s}")
        assert r["render_path"] is None and r["contact_sheet_path"] is None
        assert r["state"] == s  # only the files go
    for s in (*waiting, "recent"):
        f = files[s]
        assert f["render"].exists() and f["sheet"].exists(), s
    assert row(env, "clips", "new_published")["render_path"]


def test_files_outside_the_data_folder_are_never_deleted(env, tmp_path) -> None:
    _, paths, conn = env
    outside = tmp_path / "elsewhere.mp4"
    outside.write_bytes(b"mine")
    add_video(env, "vvvvvvvvvvv", "done", age_days=1)
    add_clip(env, "vvvvvvvvvvv", "c1", "published", age_days=30)
    conn.execute("UPDATE clips SET render_path = ? WHERE id = 'c1'", (str(outside),))
    add_video(env, "wwwwwwwwwww", "done", age_days=30)
    conn.execute("UPDATE videos SET raw_path = ? WHERE id = 'wwwwwwwwwww'", (str(outside),))
    cleanup.cleanup(conn, paths, KEEP, DAY1)
    assert outside.exists()
    assert not paths.render("c1").exists()  # the clip's own render file still goes


def test_zero_days_deletes_at_once_and_second_run_is_a_noop(env) -> None:
    add_video(env, "vvvvvvvvvvv", "done", age_days=0.01)
    add_clip(env, "vvvvvvvvvvv", "c1", "published", age_days=0.01)
    now = RetentionSettings(raw_days=0, render_days=0)
    first = cleanup.cleanup(env[2], env[1], now, DAY1)
    assert first.files == 7  # raw, info.json, source cut + its meta; render, poster, sheet
    again = cleanup.cleanup(env[2], env[1], now, DAY1)
    assert again.files == 0 and again.videos == [] and again.clips == []


def test_scheduler_cleans_once_a_day(env) -> None:
    v = add_video(env, "oldvideo001", "done", age_days=10)
    c = add_clip(env, "oldvideo001", "c1", "published", age_days=20)
    sched, _, _, clock = build(env)
    clock[0] = DAY1 + timedelta(hours=1)
    rep = sched.tick()
    assert any(a.startswith("cleanup:") for a in rep.actions)
    assert not v["raw"].exists() and not c["render"].exists()
    assert db.kv_get(env[2], "last_cleanup") == "2026-11-23"

    # Same day: nothing runs, even when new files are old enough.
    v2 = add_video(env, "oldvideo002", "done", age_days=10)
    clock[0] = DAY1 + timedelta(hours=5)
    sched.tick()
    assert v2["raw"].exists()
    # Next day it runs again.
    clock[0] = DAY1 + timedelta(days=1, hours=1)
    sched.tick()
    assert not v2["raw"].exists()


def test_scheduler_cleans_while_paused(env) -> None:
    v = add_video(env, "oldvideo001", "done", age_days=10)
    sched, _, _, _ = build(env)
    sched.paths.pause_file.write_text("")
    sched.tick()
    assert not v["raw"].exists()


def test_dashboard_handles_deleted_render(env, config_dir) -> None:
    from tests.test_web import client

    add_video(env, "vvvvvvvvvvv", "done", age_days=30)
    add_clip(env, "vvvvvvvvvvv", "c1", "published", age_days=30)
    env[2].execute("UPDATE clips SET published_at = state_changed_at WHERE id = 'c1'")
    cleanup.cleanup(env[2], env[1], KEEP, DAY1)
    (view,) = clip_views(env[2], ("published",))
    assert not view.has_video and not view.has_sheet
    c = client(config_dir)
    for page in ("/", "/clips?tab=posted", "/clips?video=vvvvvvvvvvv"):
        r = c.get(page)
        assert r.status_code == 200, page
        assert "#clip-c1" in r.text or 'id="clip-c1"' in r.text, page
        assert "/clips/c1/video" not in r.text and "/clips/c1/poster" not in r.text, page
    for media in ("video", "poster", "sheet"):
        assert c.get(f"/clips/c1/{media}").status_code == 404
