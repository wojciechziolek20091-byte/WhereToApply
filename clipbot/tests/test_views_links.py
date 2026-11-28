"""Net views: the real TikTok post number is kept, and links can be added by hand."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import ClassVar

import pytest

from clipbot import db, stats
from clipbot.post import autotok_poster as at
from tests.test_posters import T0, clip, publisher, seed

POST = "7441234567890123456"


class Upload:
    """What autotok returns: a storage id, and TikTok's answer with the post."""

    video_id = "v0f025gc0000ct1abcdefghijklmnopq"
    response: ClassVar[dict] = {
        "status_code": 0,
        "single_post_resp_list": [{"item_id": POST, "status": 0}],
    }


def test_public_post_number_comes_from_the_publish_answer() -> None:
    assert at.public_post_id(Upload()) == POST
    nested = type("R", (), {"video_id": "v0abc", "response": {"data": {"aweme_id": POST}}})()
    assert at.public_post_id(nested) == POST
    numeric = type("R", (), {"video_id": POST, "response": {}})()
    assert at.public_post_id(numeric) == POST
    none = type("R", (), {"video_id": "v0abc", "response": {"status_code": 0}})()
    assert at.public_post_id(none) == ""


def test_posted_clip_gets_a_link_views_can_be_read_from(env, tmp_path: Path) -> None:
    seed(env)
    home = tmp_path / "tt"
    (home / "accounts").mkdir(parents=True)
    (home / "accounts" / "clipbot.json").write_text("{}")
    poster = at.AutotokPoster(home, uploader=lambda v, c, vis: Upload())
    pub, _, _ = publisher(env, poster)
    pub.start("c1")
    assert pub.poll("c1") == "published"
    assert clip(env)["post_url"] == f"https://www.tiktok.com/@_/video/{POST}"
    entry = json.loads((home / "journal" / "cb-c1-1.json").read_text())
    assert entry["upload_id"] == Upload.video_id and entry["response"]["status_code"] == 0
    n = stats.refresh_views(env[2], T0 + timedelta(hours=1), fetch={POST: 321}.get, pause_s=0)
    assert n == 1 and clip(env)["views"] == 321


def test_paste_a_link_for_clips_posted_without_one(env) -> None:
    seed(env)
    conn = env[2]
    conn.execute("UPDATE clips SET state = 'published', published_at = ?, post_url = NULL",
                 (db.iso(T0),))  # fmt: skip
    now = T0 + timedelta(hours=2)
    s = stats.home_stats(conn, now, env[0].settings.tz)
    assert s["untracked"] == 1 and s["tracked"] == 0
    with pytest.raises(ValueError, match="not a TikTok video link"):
        stats.add_link(conn, "c1", "https://youtube.com/watch?v=x", now)
    other = "7449999999999999999"
    views = {POST: 1500, other: 250}
    assert stats.add_link(conn, "c1", f"https://www.tiktok.com/@franiu78/video/{POST}?lang=pl",
                          now, fetch=views.get) == 1500  # fmt: skip
    with pytest.raises(ValueError, match="already has"):
        stats.add_link(conn, "c1", f"https://www.tiktok.com/@x/video/{POST}", now)
    # The same clip on a second account: both count.
    assert stats.add_link(conn, "c1", f"https://www.tiktok.com/@second/video/{other}",
                          now, fetch=views.get) == 1750  # fmt: skip
    s = stats.home_stats(conn, now, env[0].settings.tz)
    assert s["views"] == 1750 and s["untracked"] == 0 and s["tracked"] == 1


def test_link_form_on_a_posted_clip(config_dir: Path, monkeypatch) -> None:
    from tests.test_web import client, token

    c = client(config_dir)
    monkeypatch.setattr(stats, "fetch_views", lambda vid, http=None: 42)
    from clipbot.config import load_config
    from clipbot.models import DataPaths

    cfg = load_config(config_dir, env_file=None)
    conn = db.connect(DataPaths(cfg.settings.data_dir).db)
    db.sync_sources(conn, cfg.sources)
    seed((cfg, DataPaths(cfg.settings.data_dir), conn))
    conn.execute("UPDATE clips SET state = 'published', published_at = ?", (db.iso(T0),))
    page = c.get("/clips?tab=posted").text
    assert "Add the TikTok link to count its views" in page
    form = {
        "csrf": token(c, "/clips?tab=posted"),
        "url": f"https://www.tiktok.com/@me/video/{POST}",
    }
    r = c.post("/clips/c1/tiktok-link", data=form, follow_redirects=True)
    assert "42 views so far" in r.text
