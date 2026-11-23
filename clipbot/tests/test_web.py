from __future__ import annotations

import base64
import re
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from clipbot import db
from clipbot.config import load_config, load_settings
from clipbot.models import DataPaths
from clipbot.pipeline import Pipeline
from clipbot.web.app import UnsafeBind, check_bind, create_app, save_settings_form
from clipbot.web.status import next_post_time
from tests.factories import OTHER_CHANNEL, meta
from tests.test_ingest import FakeYT

WARSAW = ZoneInfo("Europe/Warsaw")
NOW = datetime(2026, 11, 23, 12, 30, tzinfo=WARSAW)


def client(config_dir: Path, env_file: Path | None = None, metas=()) -> TestClient:
    yt = FakeYT(list(metas))
    app = create_app(
        config_dir,
        env_file,
        clock=lambda: NOW,
        pipeline_factory=lambda c, cfg, p: Pipeline(c, cfg, p, youtube=yt),
    )
    return TestClient(app, base_url="http://127.0.0.1:8080")


def token(c: TestClient, path: str = "/") -> str:
    html = c.get(path).text
    m = re.search(r'name="csrf" value="([^"]+)"', html)
    assert m, "no csrf token on page"
    return m.group(1)


def conn_for(config_dir: Path):
    cfg = load_config(config_dir, env_file=None)
    paths = DataPaths(cfg.settings.data_dir)
    return db.connect(paths.db), paths


def seed_clip(config_dir: Path, state: str, render: bool = True) -> str:
    conn, paths = conn_for(config_dir)
    now = db.iso(NOW)
    conn.execute(
        "INSERT OR IGNORE INTO sources(id, youtube_channel_id, name, rights, "
        "updated_at) VALUES ('mine', 'UCabcdefghijklmnopqrstuv', 'Mine', 'own', ?)",
        (now,),
    )
    conn.execute(
        "INSERT OR IGNORE INTO videos(id, source_id, title, state, state_changed_at, "
        "created_at, updated_at) VALUES ('aaaaaaaaaaa', 'mine', 'Talk', 'done', ?, ?, ?)",
        (now, now, now),
    )
    cid = f"clip_{state}"
    rp = paths.renders / f"{cid}.mp4"
    if render:
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_bytes(bytes(range(256)) * 40)
    conn.execute(
        "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, summary, state, "
        "state_changed_at, render_path, post_text, qa_json, created_at, updated_at) VALUES "
        "(?, 'aaaaaaaaaaa', 0, 30000, 88, 'Octopus has three hearts', 't', 's', ?, ?, ?, "
        '\'the caption\', \'{"spec": {"ok": true, "detail": "fine", "data": {}}}\', ?, ?)',
        (cid, state, now, str(rp), now, now),
    )
    conn.close()
    return cid


def clip_state(config_dir: Path, cid: str) -> str:
    conn, _ = conn_for(config_dir)
    return conn.execute("SELECT state FROM clips WHERE id = ?", (cid,)).fetchone()[0]


# ---------------------------------------------------------------- pages


def test_every_page_renders(config_dir: Path) -> None:
    seed_clip(config_dir, "awaiting_approval")
    seed_clip(config_dir, "qa_passed")
    c = client(config_dir)
    home = c.get("/")
    assert home.status_code == 200
    assert "Not running" in home.text and "Clip a Video" in home.text
    assert "Dry run:" in home.text and "Waiting for Your Approval" in home.text
    assert 'name="theme-color" content="#0c100e"' in home.text and "Skip to content" in home.text
    for path in ["/clips", "/videos", "/settings", "/health"] + [
        f"/clips?tab={t}" for t in ("ready", "review", "posted", "working", "rejected")
    ]:
        r = c.get(path)
        assert r.status_code == 200, path
    assert "Octopus has three hearts" in c.get("/clips?tab=ready").text
    assert c.get("/api/status").json()["dry_run"] is True


# ---------------------------------------------------------------- forms are protected


def test_post_without_token_is_refused(config_dir: Path) -> None:
    c = client(config_dir)
    assert c.post("/pause", data={}).status_code == 403
    assert c.post("/pause", data={"csrf": "wrong"}).status_code == 403


def test_post_from_another_site_is_refused(config_dir: Path) -> None:
    c = client(config_dir)
    t = token(c)
    r = c.post("/pause", data={"csrf": t}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_pause_and_resume(config_dir: Path) -> None:
    c = client(config_dir)
    r = c.post("/pause", data={"csrf": token(c), "reason": "holiday"}, follow_redirects=True)
    assert "Paused" in r.text and "holiday" in r.text
    conn, _ = conn_for(config_dir)
    assert db.get_pause(conn, NOW).paused
    r = c.post("/resume", data={"csrf": token(c)}, follow_redirects=True)
    assert "Resumed." in r.text and not db.get_pause(conn, NOW).paused


# ---------------------------------------------------------------- clip a link


def test_clip_link_accepted_refused_and_bad(config_dir: Path) -> None:
    cc = meta(
        "bbbbbbbbbbb",
        channel_id=OTHER_CHANNEL,
        channel_title="CC Chan",
        license="creativeCommon",
        title="A CC talk",
    )
    plain = meta("ccccccccccc", channel_id=OTHER_CHANNEL, channel_title="Big Creator")
    c = client(config_dir, metas=[cc, plain])
    r = c.post(
        "/clip",
        data={"csrf": token(c), "url": "https://youtu.be/bbbbbbbbbbb"},
        follow_redirects=True,
    )
    assert "Accepted" in r.text and "A CC talk" in r.text
    r = c.post(
        "/clip",
        data={"csrf": token(c), "url": "https://youtu.be/ccccccccccc"},
        follow_redirects=True,
    )
    assert "Refused" in r.text and "not Creative Commons" in r.text
    r = c.post(
        "/clip", data={"csrf": token(c), "url": "https://vimeo.com/1"}, follow_redirects=True
    )
    assert "not a YouTube video link" in r.text
    assert "A CC talk" in c.get("/videos").text


# ---------------------------------------------------------------- review


def test_approve_and_reject(config_dir: Path) -> None:
    a = seed_clip(config_dir, "awaiting_approval")
    b = seed_clip(config_dir, "qa_passed")
    c = client(config_dir)
    t = token(c)
    r = c.post(f"/clips/{a}/approve", data={"csrf": t}, follow_redirects=True)
    assert "Approved" in r.text and clip_state(config_dir, a) == "scheduled"
    assert c.post(f"/clips/{a}/approve", data={"csrf": t}).status_code == 409  # twice
    c.post(f"/clips/{b}/reject", data={"csrf": t})
    assert clip_state(config_dir, b) == "rejected"


def test_video_supports_seeking(config_dir: Path) -> None:
    cid = seed_clip(config_dir, "qa_passed")
    c = client(config_dir)
    full = c.get(f"/clips/{cid}/video")
    assert full.status_code == 200 and full.headers["content-type"] == "video/mp4"
    part = c.get(f"/clips/{cid}/video", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and len(part.content) == 100


def test_files_outside_renders_are_not_served(config_dir: Path, tmp_path: Path) -> None:
    cid = seed_clip(config_dir, "qa_passed")
    secret = tmp_path / "secret.txt"
    secret.write_text("nope")
    conn, _ = conn_for(config_dir)
    conn.execute("UPDATE clips SET render_path = ? WHERE id = ?", (str(secret), cid))
    conn.close()
    assert client(config_dir).get(f"/clips/{cid}/video").status_code == 404


# ---------------------------------------------------------------- password


def test_password_required_when_set(config_dir: Path, tmp_path: Path) -> None:
    env = tmp_path / "pw.env"
    env.write_text("DASHBOARD_PASSWORD=correct-horse\n")
    c = client(config_dir, env)
    r = c.get("/")
    assert r.status_code == 401 and "Basic" in r.headers["www-authenticate"]
    bad = base64.b64encode(b"clipbot:wrong").decode()
    assert c.get("/", headers={"Authorization": f"Basic {bad}"}).status_code == 401
    good = base64.b64encode(b"clipbot:correct-horse").decode()
    assert c.get("/", headers={"Authorization": f"Basic {good}"}).status_code == 200


def test_network_bind_needs_a_password() -> None:
    check_bind("127.0.0.1", None)
    check_bind("localhost", None)
    with pytest.raises(UnsafeBind):
        check_bind("0.0.0.0", None)  # noqa: S104
    check_bind("0.0.0.0", "pw")  # noqa: S104


# ---------------------------------------------------------------- settings

FORM = {
    "posts_per_day": "2",
    "min_gap_minutes": "90",
    "privacy": "account_default",
    "windows": "12:00-14:00, 18:00-22:00",
    "extra_hashtags": "#fyp learnontiktok",
    "per_video": "3",
    "min_score": "75",
    "min_seconds": "20",
    "max_seconds": "60",
    "hook_seconds": "3",
}


def test_settings_save_keeps_comments_and_validates(config_dir: Path) -> None:
    path = config_dir / "settings.yaml"
    path.write_text(path.read_text() + "# my own note\n")
    assert save_settings_form(path, {**FORM, "review_mode": "hold"})
    s = load_settings(path)
    assert s.publish.posts_per_day == 2 and s.publish.min_gap_minutes == 90
    assert [w.start.hour for w in s.publish.windows] == [12, 18]
    assert s.post.extra_hashtags == ["fyp", "learnontiktok"]
    assert s.review_mode == "hold" and s.dry_run is False and s.clips.min_score == 75
    assert "# my own note" in path.read_text()
    assert not save_settings_form(path, {**FORM, "review_mode": "hold"})  # no change


@pytest.mark.parametrize(
    ("patch", "msg"),
    [
        ({"posts_per_day": "9"}, "hard ceiling"),
        ({"windows": "14:00-12:00"}, "window"),
        ({"posts_per_day": "lots"}, "must be a number"),
    ],
)
def test_invalid_settings_change_nothing(config_dir: Path, patch: dict, msg: str) -> None:
    from clipbot.web.app import SettingsFormError

    path = config_dir / "settings.yaml"
    before = path.read_text()
    with pytest.raises(SettingsFormError, match=msg):
        save_settings_form(path, {**FORM, **patch})
    assert path.read_text() == before


def test_settings_page_round_trip(config_dir: Path) -> None:
    c = client(config_dir)
    r = c.post(
        "/settings",
        data={**FORM, "csrf": token(c, "/settings"), "dry_run": "on"},
        follow_redirects=True,
    )
    assert "Saved" in r.text
    r = c.post(
        "/settings",
        data={**FORM, "csrf": token(c, "/settings"), "posts_per_day": "20"},
        follow_redirects=True,
    )
    assert "hard ceiling" in r.text


def test_running_bot_picks_up_settings(env, config_dir: Path) -> None:
    import os

    from tests.test_scheduler import build

    sched, _, _, _ = build(env)
    path = config_dir / "settings.yaml"
    save_settings_form(path, {**FORM, "dry_run": "on"})
    st = path.stat()
    os.utime(path, (st.st_atime, st.st_mtime + 5))
    assert sched.tick().actions[0] == "settings reloaded"
    assert sched.cfg.settings.publish.posts_per_day == 2
    assert sched.pub.cfg.settings.publish.min_gap_minutes == 90


# ---------------------------------------------------------------- next post time


def post_at(conn, t: datetime, i: int) -> None:
    now = db.iso(t)
    conn.execute(
        "INSERT OR IGNORE INTO videos(id, source_id, state, state_changed_at, "
        "created_at, updated_at) VALUES ('v', 'mine', 'done', ?, ?, ?)",
        (now, now, now),
    )
    conn.execute(
        "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, "
        "summary, state, state_changed_at, submitted_at, created_at, updated_at) "
        "VALUES (?, 'v', 0, 1, 80, 'h', 't', 's', 'published', ?, ?, ?, ?)",
        (f"p{i}", now, now, now, now),
    )


def test_next_post_time(env) -> None:
    cfg, _, conn = env
    s = cfg.settings  # windows 12-14 and 17-21, 3 a day, 120 min gap
    t, why = next_post_time(conn, s, NOW)
    assert (t, why) == (NOW, "now")
    morning = NOW.replace(hour=8)
    t, why = next_post_time(conn, s, morning)
    assert t == NOW.replace(hour=12, minute=0) and why == "the next posting window"
    post_at(conn, NOW.replace(hour=12, minute=0), 1)
    t, _ = next_post_time(conn, s, NOW)  # gap ends 14:00, window closed: 17:00
    assert t.astimezone(WARSAW).hour == 17
    post_at(conn, NOW.replace(hour=17), 2)
    post_at(conn, NOW.replace(hour=19), 3)
    t, why = next_post_time(conn, s, NOW.replace(hour=21, minute=30))
    # 3 posts today: the first one (12:00) drops out of the 24 h count at 12:00 tomorrow
    assert t.astimezone(WARSAW) == NOW.replace(hour=12, minute=0, second=1) + timedelta(days=1)
    assert why == "the daily limit of 3"


def test_poster_frame_is_made_once(config_dir: Path) -> None:
    from tests.factories import make_mp4

    cid = seed_clip(config_dir, "qa_passed", render=False)
    _, paths = conn_for(config_dir)
    make_mp4(paths.renders / f"{cid}.mp4", seconds=2)
    c = client(config_dir)
    r = c.get(f"/clips/{cid}/poster")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert (paths.renders / f"{cid}.poster.jpg").is_file()


def test_activity_is_plain_english() -> None:
    from clipbot.web.status import _event_text

    assert _event_text("qa", "qa_passed: all gates passed") == ("Checks passed", "")
    assert _event_text("qa", "qa_rejected: visual: 3.0s black") == (
        "Checks failed", "visual: 3.0s black")
    assert _event_text("render", "rendered") == ("Clip made", "")
    assert _event_text("publish_submit", "submitted via dryrun") == ("Dry-run post", "")
    assert _event_text("discover", "skipped: too short (60s < 180s)") == (
        "Video skipped", "too short (60s < 180s)")
