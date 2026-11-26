"""Home stats, Deploy all, the clip showcase and the clip editor."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest

from clipbot import db, stats
from clipbot.pipeline import EditError, Pipeline, framing_override
from clipbot.publish import deploy, tiktok_url
from tests.test_pipeline_select import clip
from tests.test_resend import VID, setup
from tests.test_scheduler import DAY1, build, seed_clips
from tests.test_youtube_fast import POLISH

PAGE = (
    '<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'
    + json.dumps(
        {
            "__DEFAULT_SCOPE__": {
                "webapp.video-detail": {
                    "itemInfo": {"itemStruct": {"stats": {"playCount": 48712, "diggCount": 3}}}
                }
            }
        }
    )
    + "</script></html>"
)


# ---------------------------------------------------------------- views


def test_play_count_from_a_tiktok_page() -> None:
    assert stats.parse_play_count(PAGE) == 48712
    assert stats.parse_play_count('<html>"playCount":17</html>') == 17
    assert stats.parse_play_count("<html>nothing</html>") is None
    assert stats.tiktok_video_id(tiktok_url("7710348513128828191")) == "7710348513128828191"
    assert tiktok_url(None) is None and tiktok_url("dryrun://x") is None


def test_compact_numbers() -> None:
    assert [stats.compact(n) for n in (0, 987, 12345, 120000, 1250000)] == [
        "0", "987", "12.3K", "120K", "1.25M",
    ]  # fmt: skip


def test_net_views_this_month(env) -> None:
    _, _, conn = env
    seed_clips(env, 2, state="published")
    conn.execute(
        "UPDATE clips SET published_at = ?, post_url = 'https://www.tiktok.com/@_/video/123456789'",
        (db.iso(DAY1 - timedelta(days=40)),),
    )
    month = stats.month_start(DAY1 + timedelta(days=3), DAY1.tzinfo)
    for cid, before, after in (("clip00", 1000, 1600), ("clip01", 200, 250)):
        for when, views in (
            (month - timedelta(days=2), before),
            (month + timedelta(days=2), after),
        ):
            conn.execute(
                "INSERT INTO clip_views(clip_id, ts, views) VALUES (?, ?, ?)",
                (cid, db.iso(when), views),
            )
    assert stats.net_views(conn, month) == 650  # only what was gained this month


def test_views_are_read_for_posted_clips(env) -> None:
    _, _, conn = env
    seed_clips(env, 2, state="published")
    conn.execute(
        "UPDATE clips SET published_at = ?, post_url = 'https://www.tiktok.com/@_/video/' || "
        "CASE id WHEN 'clip00' THEN '111111111' ELSE '222222222' END",
        (db.iso(DAY1),),
    )
    seen = []

    def fetch(vid):
        seen.append(vid)
        return {"111111111": 500, "222222222": None}[vid]

    assert stats.refresh_views(conn, DAY1, fetch=fetch, pause_s=0) == 1
    assert sorted(seen) == ["111111111", "222222222"]
    assert conn.execute("SELECT views FROM clips WHERE id = 'clip00'").fetchone()[0] == 500
    # Read again only once they are stale.
    assert stats.refresh_views(conn, DAY1 + timedelta(hours=1), fetch=fetch, pause_s=0) == 0
    s = stats.home_stats(conn, DAY1 + timedelta(hours=1), DAY1.tzinfo)
    assert s["views"] == 500 and s["posted"] == 2 and s["tracked"] == 2


# ---------------------------------------------------------------- deploy


def test_deploy_posts_outside_windows_but_keeps_limits(env) -> None:
    ids = seed_clips(env, 2)
    sched, _, _, clock = build(env)
    clock[0] = DAY1 + timedelta(hours=8)  # 08:00, outside the 12-14 and 17-21 windows
    ok, why = sched.can_publish()
    assert not ok and "window" in why
    assert deploy(env[2], "aaaaaaaaaaa", clock[0]) == 2
    states = {r[0] for r in env[2].execute("SELECT state FROM clips")}
    assert states == {"scheduled"}
    ok, _ = sched.can_publish()
    assert ok and sched.next_clip() in ids
    assert deploy(env[2], "aaaaaaaaaaa", clock[0]) == 0  # already queued


# ---------------------------------------------------------------- editor


def test_framing_override() -> None:
    (crop,) = framing_override({"framing": "crop", "crop_x": 1.0}, 1920, 1080, 30)
    assert crop.mode == "crop" and crop.crop_x + crop.crop_w == 1920
    (full,) = framing_override({"framing": "full"}, 1920, 1080, 30)
    assert full.mode == "blur_pad"
    assert framing_override({"framing": "auto"}, 1920, 1080, 30) == []


def test_edit_remakes_the_clip_with_the_changes(env, monkeypatch, tmp_path) -> None:
    p, _ = setup(env, monkeypatch, tmp_path, [{"clips": [clip(10.4, 43.5, 90) | POLISH]}])
    assert p.fast_process(VID)[-1] == "done"
    c = p.conn.execute("SELECT * FROM clips").fetchone()
    assert c["state"] == "qa_passed"
    tr_lines = p.clip_lines(c, _tr(p))
    first = tr_lines[len(tr_lines) // 2]  # a line well inside the new range

    with pytest.raises(EditError, match="seconds long"):
        p.apply_edit(c["id"], {"start": 10, "end": 12, "hook": "x"})
    with pytest.raises(EditError, match="hook"):
        p.apply_edit(c["id"], {"start": 10, "end": 40, "hook": ""})

    p.apply_edit(
        c["id"],
        {
            "start": 12.0,
            "end": 41.0,
            "hook": "Zupełnie nowy hook",
            "hook_seconds": 4,
            "framing": "full",
            "lines": [{"key": first["key"], "text": "Ręcznie poprawiona linia"}],
            "caption": {"title": "Nowy tytuł", "text": "Opis", "hashtags": ["#Nauka", "fyp"]},
        },
    )
    c = p.conn.execute("SELECT * FROM clips").fetchone()
    assert c["state"] == "selected" and c["start_ms"] == 12000 and c["hook"] == "Zupełnie nowy hook"
    assert json.loads(c["edit_json"]) == {"hook_seconds": 4.0, "framing": "full", "crop_x": 0.5}
    assert p._row(VID)["state"] == "selected"

    assert p.fast_process(VID)[-1] == "done"
    c = p.conn.execute("SELECT * FROM clips").fetchone()
    assert c["state"] == "qa_passed"
    assert c["post_text"].startswith("Nowy tytuł\n\nOpis\n\n#nauka #fyp")
    import re

    ass = (p.paths.work_dir(VID) / "render" / c["id"] / "clip.ass").read_text()
    plain = re.sub(r"\{[^}]*\}", "", ass).replace("\\h", " ").replace("\\N", " ")
    assert "Zupełnie nowy hook" in " ".join(plain.split()) or "Zupełnie" in plain
    assert "Ręcznie" in plain and "poprawiona" in plain
    render = json.loads((p.paths.work_dir(VID) / "render" / c["id"] / "render.json").read_text())
    assert render["scenes"][0]["mode"] == "blur_pad"
    # A hand edit is never translated over.
    store = p._read_subs(VID, "pl")
    assert store[first["key"]]["edited"] is True


def test_posted_clips_cannot_be_edited(env, monkeypatch, tmp_path) -> None:
    p, _ = setup(env, monkeypatch, tmp_path, [{"clips": [clip(10.4, 43.5, 90) | POLISH]}])
    p.fast_process(VID)
    p.conn.execute("UPDATE clips SET state = 'published'")
    cid = p.conn.execute("SELECT id FROM clips").fetchone()[0]
    with pytest.raises(EditError, match="already posted"):
        p.apply_edit(cid, {"start": 10, "end": 40, "hook": "x"})


def _tr(p: Pipeline):
    from clipbot.transcribe import Transcript

    return Transcript.from_json(Path(p._row(VID)["transcript_path"]).read_text())


# ---------------------------------------------------------------- pages


def test_showcase_and_editor_pages(env, monkeypatch, tmp_path) -> None:
    from fastapi.testclient import TestClient

    from clipbot.web.app import create_app

    p, _ = setup(env, monkeypatch, tmp_path, [{"clips": [clip(10.4, 43.5, 90) | POLISH]}])
    p.fast_process(VID)
    cfg, _, _ = env
    config_dir = cfg.config_dir
    (config_dir.parent / ".env").write_text("OPENROUTER_API_KEY=x\nYOUTUBE_API_KEY=AIza\n")
    app = create_app(
        config_dir,
        config_dir.parent / ".env",
        pipeline_factory=lambda c, cf, pa: Pipeline(
            c, cf, pa, providers=p._providers, router=p._router
        ),
        clip_now=False,
    )
    c = TestClient(app, base_url="http://127.0.0.1:8080")
    frag = c.get("/progress").text
    assert 'class="showcase"' in frag and "Deploy all (1)" in frag and "Go to Clips" in frag
    cid = p.conn.execute("SELECT id FROM clips").fetchone()[0]
    assert "Edit" in c.get(f"/clips?video={VID}").text

    page = c.get(f"/clips/{cid}/edit")
    assert page.status_code == 200 and 'id="editor"' in page.text
    data = c.get(f"/clips/{cid}/editor.json").json()
    assert data["clip"]["id"] == cid and data["lines"] and data["language"]
    assert data["source"]["offset"] <= data["clip"]["start"]
    assert c.get(f"/clips/{cid}/preview.mp4").headers["content-type"] == "video/mp4"
    assert c.get(f"/clips/{cid}/filmstrip.jpg").content[:2] == b"\xff\xd8"

    import re

    csrf = re.search(r'name="csrf" content="([^"]+)"', page.text).group(1)
    bad = c.post(
        f"/clips/{cid}/edit",
        json={"start": 1, "end": 2, "hook": "x"},
        headers={"X-CSRF-Token": csrf},
    )
    assert bad.status_code == 400 and "seconds long" in bad.json()["error"]
    assert (
        c.post(f"/clips/{cid}/edit", json={}, headers={"X-CSRF-Token": "nope"}).status_code == 403
    )
    ok = c.post(
        f"/clips/{cid}/edit",
        json={"start": 10.0, "end": 40.0, "hook": "Nowy", "framing": "crop", "crop_x": 0.2},
        headers={"X-CSRF-Token": csrf},
    )
    assert ok.json()["ok"] and ok.json()["redirect"].startswith(f"/clips?video={VID}")

    r = c.post(f"/videos/{VID}/deploy", data={"csrf": csrf}, follow_redirects=True)
    assert "Nothing to deploy" in r.text  # the edited clip is being made again
