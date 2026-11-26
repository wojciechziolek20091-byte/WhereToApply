from __future__ import annotations

import base64
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import ClassVar
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


class ChannelYT(FakeYT):
    """FakeYT plus channel lookups."""

    channels: ClassVar[dict[str, str]] = {
        "UCabcdefghijklmnopqrstuv": "Mine",
        "UCzzzzzzzzzzzzzzzzzzzzzz": "Science Hour",
    }
    handles: ClassVar[dict[str, str]] = {"sciencehour": "UCzzzzzzzzzzzzzzzzzzzzzz"}

    def channel(self, *, channel_id=None, handle=None):
        cid = channel_id or self.handles.get((handle or "").lower())
        return (cid, self.channels[cid]) if cid in self.channels else None


def client(
    config_dir: Path,
    env_file: Path | None = None,
    metas=(),
    configured: bool = True,
) -> TestClient:
    if configured and env_file is None:
        env_file = config_dir.parent / ".env"
        if not env_file.exists():
            env_file.write_text("OPENROUTER_API_KEY=sk-or-v1-test\nYOUTUBE_API_KEY=AIzaTest\n")
    yt = ChannelYT(list(metas))
    app = create_app(
        config_dir,
        env_file,
        clock=lambda: NOW,
        pipeline_factory=lambda c, cfg, p: Pipeline(c, cfg, p, youtube=yt),
        clip_now=False,
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
    assert "not running" in home.text and ", Franiu</h1>" in home.text
    assert "- clip mob</title>" in home.text and 'class="name">clip mob<' in home.text
    assert "Net views in" in home.text and "Clips posted in" in home.text
    assert 'href="/upload"' in home.text and "Upload clips" in home.text
    assert "Practice mode:" in home.text and "Waiting for your approval" in home.text
    up = c.get("/upload")
    assert up.status_code == 200 and "Clip Video" in up.text
    assert 'name="theme-color" content="#0c100e"' in home.text and "Skip to content" in home.text
    for path in ["/clips", "/videos", "/settings", "/health", "/clips?video=aaaaaaaaaaa"] + [
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
    env.write_text("DASHBOARD_PASSWORD=correct-horse\nOPENROUTER_API_KEY=k1\nYOUTUBE_API_KEY=k2\n")
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
    assert s.post.language == "pl" and s.safety.strict_qa is False
    assert not save_settings_form(path, {**FORM, "review_mode": "hold"})  # no change
    assert save_settings_form(
        path, {**FORM, "review_mode": "hold", "language": "en", "strict_qa": "on"}
    )
    s = load_settings(path)
    assert s.post.language == "en" and s.safety.strict_qa is True


@pytest.mark.parametrize(
    ("patch", "msg"),
    [
        ({"posts_per_day": "9"}, "hard ceiling"),
        ({"windows": "14:00-12:00"}, "window"),
        ({"posts_per_day": "lots"}, "must be a number"),
        ({"language": "klingon"}, "caption language"),
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
        "Checks failed",
        "visual: 3.0s black",
    )
    assert _event_text("render", "rendered") == ("Clip made", "")
    assert _event_text("publish_submit", "submitted via dryrun") == ("Dry-run post", "")
    assert _event_text("discover", "skipped: too short (60s < 180s)") == (
        "Video skipped",
        "too short (60s < 180s)",
    )


# ---------------------------------------------------------------- setup wizard


def test_unconfigured_bot_goes_to_setup(config_dir: Path) -> None:
    c = client(config_dir, configured=False)
    r = c.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/setup"
    page = c.get("/setup").text
    assert "Welcome to clip mob" in page and "Start Setup" in page
    for step in ("ai", "youtube", "channels", "tiktok", "done"):
        assert c.get(f"/setup/{step}").status_code == 200, step
    assert c.get("/setup/nonsense").status_code == 404


def test_setup_saves_checked_keys(config_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from clipbot import accounts

    monkeypatch.setattr(accounts, "check_openrouter", lambda k: "Key works.")
    monkeypatch.setattr(accounts, "check_youtube", lambda k: "Key works.")
    c = client(config_dir, configured=False)
    env = config_dir.parent / ".env"
    r = c.post(
        "/setup/ai",
        data={"csrf": token(c, "/setup/ai"), "key": " sk-or-v1-abc "},
        follow_redirects=False,
    )
    assert r.headers["location"].startswith("/setup/youtube")
    c.post("/setup/youtube", data={"csrf": token(c, "/setup/ai"), "key": "AIzaXYZ"})
    text = env.read_text()
    assert "OPENROUTER_API_KEY=sk-or-v1-abc" in text and "YOUTUBE_API_KEY=AIzaXYZ" in text
    assert c.get("/", follow_redirects=False).status_code == 200  # set up now


def test_setup_rejects_bad_key_with_the_fix(
    config_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from clipbot import accounts

    def bad(k: str) -> str:
        raise accounts.SetupError("OpenRouter did not accept this key. Copy it again.")

    monkeypatch.setattr(accounts, "check_openrouter", bad)
    c = client(config_dir, configured=False)
    r = c.post(
        "/setup/ai", data={"csrf": token(c, "/setup/ai"), "key": "nope"}, follow_redirects=True
    )
    assert "did not accept this key" in r.text
    assert not (config_dir.parent / ".env").exists()


def test_add_pause_and_remove_channel(config_dir: Path) -> None:
    c = client(config_dir)
    t = token(c, "/settings")
    r = c.post(
        "/channels/add",
        data={
            "csrf": t,
            "link": "https://www.youtube.com/@ScienceHour",
            "rights": "cc_by",
            "from": "settings",
        },
        follow_redirects=True,
    )
    assert "Added Science Hour" in r.text
    cfg = load_config(config_dir, env_file=None)
    added = next(s for s in cfg.sources if s.name == "Science Hour")
    assert added.rights == "cc_by" and added.enabled and added.acquire == "ytdlp"
    r = c.post(
        "/channels/add",
        data={
            "csrf": t,
            "link": "https://youtube.com/@sciencehour",
            "rights": "own",
            "from": "settings",
        },
        follow_redirects=True,
    )
    assert "already in your channels" in r.text
    c.post(f"/channels/{added.id}/toggle", data={"csrf": t, "enabled": "0"})
    assert not load_config(config_dir, env_file=None).source(added.id).enabled
    c.post(f"/channels/{added.id}/remove", data={"csrf": t, "from": "settings"})
    assert all(s.id != added.id for s in load_config(config_dir, env_file=None).sources)


def test_permission_needs_proof(config_dir: Path) -> None:
    c = client(config_dir)
    r = c.post(
        "/channels/add",
        data={
            "csrf": token(c),
            "rights": "permission",
            "link": "https://www.youtube.com/@ScienceHour",
        },
        follow_redirects=True,
    )
    assert "Describe the permission you have" in r.text
    r = c.post(
        "/channels/add",
        data={
            "csrf": token(c),
            "rights": "permission",
            "permission_ref": "email 2 Nov",
            "link": "https://www.youtube.com/channel/UCzzzzzzzzzzzzzzzzzzzzzz",
        },
        follow_redirects=True,
    )
    assert "Added Science Hour" in r.text


def test_settings_shows_accounts_and_channels(config_dir: Path) -> None:
    page = client(config_dir).get("/settings").text
    assert "Accounts" in page and "Channels" in page and "Practice mode" in page
    assert "Not connected: clips are made but not posted" in page


# ---------------------------------------------------------------- progress


def test_clip_count_and_live_progress(config_dir: Path) -> None:
    cc = meta(
        "bbbbbbbbbbb",
        channel_id=OTHER_CHANNEL,
        channel_title="CC Chan",
        license="creativeCommon",
        title="A CC talk",
    )
    c = client(config_dir, metas=[cc])
    home = c.get("/upload").text
    assert 'id="count"' in home and 'value="3" selected' in home
    assert 'id="progress" hidden' in home  # nothing being clipped yet
    r = c.post(
        "/clip",
        data={"csrf": token(c), "url": "https://youtu.be/bbbbbbbbbbb", "count": "5"},
        follow_redirects=True,
    )
    assert "Clipping Now" in r.text and 'id="progress" hidden' not in r.text
    conn, _ = conn_for(config_dir)
    meta_json = conn.execute("SELECT meta_json FROM videos WHERE id='bbbbbbbbbbb'").fetchone()[0]
    assert '"clip_count": 5' in meta_json
    frag = c.get("/progress").text
    assert "A CC talk" in frag and 'aria-current="step">Queued' in frag
    assert "Aiming for 5 clips" in frag
    # Pasting it again while it is queued keeps it going (new number applies).
    r = c.post(
        "/clip",
        data={"csrf": token(c), "url": "https://youtu.be/bbbbbbbbbbb", "count": "2"},
        follow_redirects=True,
    )
    assert "being clipped right now" in r.text
    # Out-of-range numbers are clamped.
    c.post(
        "/clip",
        data={"csrf": token(c), "url": "https://youtu.be/bbbbbbbbbbb", "count": "99"},
    )
    meta_json = conn.execute("SELECT meta_json FROM videos WHERE id='bbbbbbbbbbb'").fetchone()[0]
    assert '"clip_count": 10' in meta_json


def test_progress_stages_waits_and_outcomes(config_dir: Path) -> None:
    from clipbot.web.status import progress

    conn, _ = conn_for(config_dir)
    now = db.iso(NOW)
    conn.execute(
        "INSERT INTO sources(id, youtube_channel_id, name, rights, updated_at) "
        "VALUES ('mine', 'UCabcdefghijklmnopqrstuv', 'Mine', 'own', ?)",
        (now,),
    )
    later = db.iso(NOW + timedelta(minutes=30))
    old = db.iso(NOW - timedelta(hours=5))
    rows = [
        ("v_busy00001", "transcribed", "select: no free model gave a valid answer (x)", later, now),
        ("v_making001", "selected", "2 clip(s)", None, now),
        ("v_ready0001", "done", "", None, now),
        ("v_failed001", "failed", "download refused", None, now),
        ("v_oldone001", "done", "", None, old),
    ]
    for i, (vid, state, reason, nxt, changed) in enumerate(rows):
        conn.execute(
            "INSERT INTO videos(id, source_id, title, state, state_reason, next_attempt_at, "
            "state_changed_at, created_at, updated_at) VALUES (?, 'mine', ?, ?, ?, ?, ?, ?, ?)",
            (vid, vid, state, reason, nxt, changed, db.iso(NOW + timedelta(seconds=i)), now),
        )
    for cid, vid, st in [
        ("c1", "v_making001", "qa_passed"),
        ("c2", "v_making001", "rendering"),
        ("c3", "v_ready0001", "qa_passed"),
        ("c4", "v_ready0001", "qa_rejected"),
    ]:
        conn.execute(
            "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, summary, "
            "state, state_changed_at, created_at, updated_at) "
            "VALUES (?, ?, 0, 1000, 80, 'h', 't', 's', ?, ?, ?, ?)",
            (cid, vid, st, now, now, now),
        )
    jobs = {j["id"]: j for j in progress(conn, NOW, limit=10)}
    assert "v_oldone001" not in jobs  # finished long ago
    busy = jobs["v_busy00001"]
    assert busy["stage"] == 3 and busy["wait"] == "The free AI models are busy"
    making = jobs["v_making001"]
    assert making["stage"] == 4 and making["detail"] == "1 of 2 made"
    assert jobs["v_ready0001"]["outcome"] == "ready"
    assert jobs["v_ready0001"]["detail"] == "1 clip ready"
    assert jobs["v_failed001"]["outcome"] == "failed"


def test_post_anyway_from_not_posted(config_dir: Path) -> None:
    rejected = seed_clip(config_dir, "rejected")
    failed_checks = seed_clip(config_dir, "qa_rejected")
    ready = seed_clip(config_dir, "qa_passed")
    no_file = seed_clip(config_dir, "skipped", render=False)
    c = client(config_dir)
    page = c.get("/clips?tab=rejected").text
    assert page.count("Post Anyway") == 2  # the clip without a video file has none
    for cid in (rejected, failed_checks):
        r = c.post(f"/clips/{cid}/post-anyway", data={"csrf": token(c)}, follow_redirects=True)
        assert "Queued. It posts as a practice post" in r.text
        assert clip_state(config_dir, cid) == "scheduled"
    r = c.post(f"/clips/{no_file}/post-anyway", data={"csrf": token(c)}, follow_redirects=True)
    assert "video file is gone" in r.text and clip_state(config_dir, no_file) == "skipped"
    # Only clips that were not posted: a ready clip is not moved.
    assert c.post(f"/clips/{ready}/post-anyway", data={"csrf": token(c)}).status_code == 409
