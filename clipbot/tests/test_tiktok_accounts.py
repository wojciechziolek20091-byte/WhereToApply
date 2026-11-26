"""Several TikTok accounts: every clip posts to all of them, never twice to one."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from clipbot import stats
from clipbot.post import autotok_poster as at
from clipbot.post.base import PosterError
from tests.test_autotok import E
from tests.test_posters import clip, publisher, seed


def add(home: Path, name: str, label: str = "") -> None:
    (home / "accounts").mkdir(parents=True, exist_ok=True)
    (home / "accounts" / f"{name}.json").write_text("{}")
    if label:
        at.set_label(home, name, label)


class Uploads:
    """A fake TikTok: `fail` maps an account to the error it raises."""

    def __init__(self, fail: dict[str, str] | None = None) -> None:
        self.calls: list[str] = []
        self.fail = fail or {}

    def __call__(self, video: str, caption: str, vis: int, account: str) -> object:
        self.calls.append(account)
        if account in self.fail:
            raise getattr(E, self.fail[account])("boom")
        return type("R", (), {"video_id": str(7000000000000000000 + len(self.calls))})()


def test_account_names_and_labels(tmp_path: Path) -> None:
    assert at.new_account_name(tmp_path) == "clipbot"
    add(tmp_path, "clipbot")
    assert at.new_account_name(tmp_path) == "clipbot-2"
    add(tmp_path, "clipbot-2", "@second")
    add(tmp_path, "clipbot-10")
    (tmp_path / "accounts" / "other.json").write_text("{}")  # not ours: ignored
    found = at.accounts(tmp_path)
    assert [a.name for a in found] == ["clipbot", "clipbot-2", "clipbot-10"]
    assert [a.label for a in found] == ["Account 1", "@second", "Account 3"]
    at.disconnect(tmp_path, "clipbot-2")
    assert [a.name for a in at.accounts(tmp_path)] == ["clipbot", "clipbot-10"]
    assert at.new_account_name(tmp_path) == "clipbot-2"
    with pytest.raises(ValueError):
        at.start_login(tmp_path, account="../evil")


def test_one_clip_goes_to_every_account(tmp_path: Path) -> None:
    for n in ("clipbot", "clipbot-2", "clipbot-3"):
        add(tmp_path, n)
    up = Uploads()
    p = at.AutotokPoster(tmp_path, uploader=up)
    p.submit(tmp_path / "c.mp4", "t", None, "cb-c1-1")
    p.submit(tmp_path / "c.mp4", "t", None, "cb-c1-1")
    p.submit(tmp_path / "c.mp4", "t", None, "cb-c1-2")  # a later attempt: still never twice
    assert up.calls == ["clipbot", "clipbot-2", "clipbot-3"]
    st = p.status("cb-c1-1")
    assert st.state == "published" and len(st.raw["posts"]) == 3


def test_a_signed_out_account_is_skipped_and_the_rest_post(tmp_path: Path) -> None:
    add(tmp_path, "clipbot")
    add(tmp_path, "clipbot-2", "@second")
    up = Uploads({"clipbot-2": "NotLoggedInError"})
    p = at.AutotokPoster(tmp_path, uploader=up)
    p.submit(tmp_path / "c.mp4", "t", None, "cb-c1-1")  # no error: it is live on one
    assert p.status("cb-c1-1").state == "published"
    assert "log in again" in at.accounts(tmp_path)[1].problem
    p.submit(tmp_path / "c.mp4", "t", None, "cb-c2-1")
    assert up.calls == ["clipbot", "clipbot-2", "clipbot"]  # skipped until logged in again
    at.set_problem(tmp_path, "clipbot-2", "")
    up.fail = {}
    p.submit(tmp_path / "c.mp4", "t", None, "cb-c3-1")
    assert up.calls[-2:] == ["clipbot", "clipbot-2"]


def test_nothing_posted_anywhere_raises_the_usual_error(tmp_path: Path) -> None:
    add(tmp_path, "clipbot")
    add(tmp_path, "clipbot-2")
    fails = {"clipbot": "UploadError", "clipbot-2": "PublishUncertainError"}
    p = at.AutotokPoster(tmp_path, uploader=Uploads(fails))
    with pytest.raises(PosterError) as ei:
        p.submit(tmp_path / "c.mp4", "t", None, "cb-c1-1")
    assert ei.value.code == "network_error"  # maybe live: never marked rejected
    assert p.status("cb-c1-1").state == "pending"
    # The retry goes only where nothing may have gone out.
    up = Uploads()
    p = at.AutotokPoster(tmp_path, uploader=up)
    p.submit(tmp_path / "c.mp4", "t", None, "cb-c1-2")
    assert up.calls == ["clipbot"]


def test_every_account_signed_out_pauses(tmp_path: Path) -> None:
    add(tmp_path, "clipbot")
    add(tmp_path, "clipbot-2")
    for n in ("clipbot", "clipbot-2"):
        at.set_problem(tmp_path, n, "Log in again")
    p = at.AutotokPoster(tmp_path, uploader=Uploads())
    with pytest.raises(PosterError) as ei:
        p.submit(tmp_path / "c.mp4", "t", None, "cb-c1-1")
    assert ei.value.code == "tiktok_reconnect_required"


def test_published_clip_keeps_every_link_and_sums_views(env, tmp_path: Path) -> None:
    seed(env)
    home = tmp_path / "tt"
    add(home, "clipbot", "@main")
    add(home, "clipbot-2", "@second")
    pub, _, _ = publisher(env, at.AutotokPoster(home, uploader=Uploads()))
    assert pub.start("c1") == "publishing"
    assert pub.poll("c1") == "published"
    c = clip(env)
    posts = json.loads(c["post_urls"])
    assert [p["label"] for p in posts] == ["@main", "@second"]
    assert c["post_url"] == posts[0]["url"]
    views = {stats.tiktok_video_id(p["url"]): v for p, v in zip(posts, (120, 30), strict=True)}
    assert stats.clip_views_now(c, views.get) == 150

    from clipbot.web.status import clip_views

    (view,) = clip_views(env[2], ("published",))
    assert [label for label, _ in view.posts] == ["@main", "@second"]


def test_settings_add_and_remove_accounts(config_dir: Path, monkeypatch) -> None:
    from clipbot.config import load_config
    from clipbot.models import DataPaths
    from clipbot.web.app import set_poster
    from tests.test_web import client, token

    set_poster(config_dir, "autotok")
    home = at.autotok_home(DataPaths(load_config(config_dir, env_file=None).settings.data_dir).root)
    at.record_consent(home)
    add(home, "clipbot", "@main")
    started = []
    monkeypatch.setattr(at, "start_login", lambda h, **k: started.append(k) or True)
    c = client(config_dir)
    page = c.get("/settings").text
    assert "Add Account" in page and "@main" in page
    assert "Add a TikTok Account" in c.get("/setup/tiktok?from=settings&add=1").text
    csrf = token(c, "/settings")
    r = c.post("/setup/tiktok/login", data={"csrf": csrf, "add": "1", "from": "settings",
                                            "label": "@second"}, follow_redirects=True)  # fmt: skip
    assert "Tick the box" in r.text and not started
    c.post("/setup/tiktok/login", data={"csrf": csrf, "add": "1", "consent": "on",
                                        "from": "settings", "label": "@second"})  # fmt: skip
    assert started[-1] == {"account": "clipbot-2", "label": "@second"}
    # Logging an existing account in again needs no new tick.
    c.post("/setup/tiktok/login", data={"csrf": csrf, "account": "clipbot", "from": "settings"})
    assert started[-1]["account"] == "clipbot"
    add(home, "clipbot-2", "@second")
    assert "all 2 accounts" in c.get("/settings").text
    r = c.post("/setup/tiktok/disconnect", data={"csrf": csrf, "account": "clipbot-2"},
               follow_redirects=True)  # fmt: skip
    assert "keep posting to the other account" in r.text
    assert [a.name for a in at.accounts(home)] == ["clipbot"]
