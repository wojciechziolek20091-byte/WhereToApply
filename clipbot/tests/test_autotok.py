"""autotok poster: journal-based never-twice, error mapping, practice mode."""

from __future__ import annotations

import sys
import types
from datetime import timedelta
from pathlib import Path

import pytest

from clipbot.post import autotok_poster as at
from clipbot.post.base import PosterError
from clipbot.publish import Publisher, make_poster
from tests.test_posters import T0, FakeYT, clip, publisher, seed


class Result:
    video_id = "7311112223334445556"


def errors_module() -> types.ModuleType:
    mod = types.ModuleType("fake_autotok_errors")
    for name in (
        "NotLoggedInError",
        "AccountNotFoundError",
        "PublishError",
        "ValidationError",
        "UploadError",
        "SigningError",
        "BrowserNotInstalledError",
        "PublishUncertainError",
    ):
        setattr(mod, name, type(name, (Exception,), {}))
    return mod


E = errors_module()


def test_upload_success_and_never_twice(tmp_path: Path) -> None:
    calls = []

    def up(video: str, caption: str, vis: int) -> Result:
        calls.append((video, caption, vis))
        return Result()

    p = at.AutotokPoster(tmp_path, uploader=up)
    p.submit(tmp_path / "c.mp4", "caption #fyp", None, "cb-c1-1")
    p.submit(tmp_path / "c.mp4", "caption #fyp", None, "cb-c1-1")  # same id again
    assert calls == [(str(tmp_path / "c.mp4"), "caption #fyp", 0)]
    st = p.status("cb-c1-1")
    assert st.state == "published" and st.post_id == "7311112223334445556"
    assert p.status("unknown").state == "not_found"


def test_only_me_maps_to_private(tmp_path: Path) -> None:
    seen = []
    p = at.AutotokPoster(tmp_path, uploader=lambda v, c, vis: seen.append(vis) or Result())
    p.submit(tmp_path / "c.mp4", "t", "SELF_ONLY", "r1")
    p.submit(tmp_path / "c.mp4", "t", "PUBLIC_TO_EVERYONE", "r2")
    assert seen == [1, 0]


@pytest.mark.parametrize(
    ("exc", "code", "journal_kept"),
    [
        ("NotLoggedInError", "tiktok_reconnect_required", False),
        ("AccountNotFoundError", "tiktok_reconnect_required", False),
        ("PublishError", "content_rejected", False),
        ("ValidationError", "invalid_parameter", False),
        ("UploadError", "tiktok_publish_failed", False),
        ("SigningError", "tiktok_publish_failed", False),
        ("BrowserNotInstalledError", "browser_missing", False),
        ("PublishUncertainError", "network_error", True),
    ],
)
def test_error_mapping(tmp_path: Path, exc: str, code: str, journal_kept: bool) -> None:
    def up(v: str, c: str, vis: int) -> Result:
        raise getattr(E, exc)("boom")

    p = at.AutotokPoster(tmp_path, uploader=up)
    with pytest.raises(PosterError) as ei:
        p.submit(tmp_path / "c.mp4", "t", None, "rid")
    assert ei.value.code == code
    assert (p.status("rid").state == "pending") is journal_kept


def test_uncertain_upload_is_reported_and_never_resent(env, tmp_path: Path) -> None:
    seed(env)
    calls = []

    def up(v: str, c: str, vis: int) -> Result:
        calls.append(v)
        raise E.PublishUncertainError("connection dropped after upload")

    poster = at.AutotokPoster(tmp_path / "tt", uploader=up)
    pub, alerts, clock = publisher(env, poster)
    assert pub.start("c1") == "publishing"  # outcome unknown: keep polling
    clock[0] += timedelta(minutes=5)
    assert pub.poll("c1") == "publishing"
    clock[0] += timedelta(minutes=11)
    assert pub.poll("c1") == "failed"
    assert len(calls) == 1 and alerts[-1][0] == "publish_timeout"
    assert "check TikTok" in clip(env)["state_reason"]


def test_crash_mid_upload_never_resends(env, tmp_path: Path) -> None:
    """The journal says 'started' but clipbot died before the result came back."""
    seed(env)
    poster = at.AutotokPoster(tmp_path / "tt", uploader=lambda *a: pytest.fail("resent!"))
    poster._write("cb-c1-1", {"state": "started"})
    conn = env[2]
    from clipbot import db

    conn.execute(
        "UPDATE clips SET state='publishing', request_id='cb-c1-1', attempts=1, "
        "submitted_at=? WHERE id='c1'",
        (db.iso(T0),),
    )
    pub, _, clock = publisher(env, poster)
    clock[0] += timedelta(minutes=3)
    assert pub.poll("c1") == "publishing"  # pending, not "not found": no resubmit
    clock[0] += timedelta(minutes=13)
    assert pub.poll("c1") == "failed"


def test_practice_mode_until_consent_and_login(env) -> None:
    cfg, paths, _ = env
    cfg = cfg.model_copy(
        update={
            "settings": cfg.settings.model_copy(
                update={
                    "dry_run": False,
                    "publish": cfg.settings.publish.model_copy(update={"poster": "autotok"}),
                }
            )
        }
    )
    home = at.autotok_home(paths.root)
    assert make_poster(cfg, paths).name == "dryrun"
    at.record_consent(home)
    assert make_poster(cfg, paths).name == "dryrun"  # consent but no login
    (home / "accounts").mkdir(parents=True)
    (home / "accounts" / "clipbot.json").write_text("{}")
    assert make_poster(cfg, paths).name == "autotok"
    at.disconnect(home)
    assert make_poster(cfg, paths).name == "dryrun"


def test_browser_prefers_installed_edge_or_chrome(tmp_path: Path) -> None:
    tried = []

    def launcher(channel: str | None) -> None:
        tried.append(channel)
        if channel == "msedge":
            raise RuntimeError("not installed")

    assert at.choose_browser(tmp_path, launcher=launcher) == "chrome"
    assert tried == ["msedge", "chrome"]
    assert (tmp_path / at.BROWSER_FILE).read_text() == "chrome"


def test_login_needs_consent(config_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.test_web import client, token

    started = []
    monkeypatch.setattr(at, "start_login", lambda home, timeout=600: started.append(home))
    c = client(config_dir)
    r = c.post(
        "/setup/tiktok/login", data={"csrf": token(c, "/setup/tiktok")}, follow_redirects=True
    )
    assert "Tick the box" in r.text and not started
    r = c.post(
        "/setup/tiktok/login",
        data={"csrf": token(c, "/setup/tiktok"), "consent": "on"},
        follow_redirects=False,
    )
    assert r.status_code == 303 and started
    assert "waiting=1" in r.headers["location"]
    page = c.get("/setup/tiktok").text
    assert "TikTok can limit or ban accounts" in page and "Use Upload-Post instead" in page


_ = (sys, Publisher, FakeYT)


def test_mapped_error_names_exist_in_installed_autotok() -> None:
    import autotok

    for name in (
        "NotLoggedInError",
        "AccountNotFoundError",
        "PublishError",
        "ValidationError",
        "UploadError",
        "SigningError",
        "BrowserNotInstalledError",
        "PublishUncertainError",
    ):
        assert issubclass(getattr(autotok, name), autotok.AutotokError), name
    assert {"video_id"} <= set(autotok.UploadResult.__dataclass_fields__)
