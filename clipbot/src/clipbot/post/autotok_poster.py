"""Posting through autotok (github.com/makiisthenes/TiktokAutoUploader, AGPL-3.0).

autotok posts with a logged-in TikTok web session through TikTok's own website
endpoints. It is free and needs no paid service, but it is NOT TikTok's official
API: TikTok can restrict or ban accounts that post this way. clipbot only enables
it after the user has explicitly accepted that (see `consented`).

Never twice: each upload is written to a journal before it starts. If clipbot
stops mid-upload, the journal says "started" with no result, so the post is
reported as unknown and never sent again.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from clipbot.logging import get_logger
from clipbot.post.base import PosterError, PostStatus, SubmitResult

log = get_logger(__name__)

ACCOUNT = "clipbot"
CONSENT_FILE = "consent.json"
BROWSER_FILE = "browser.txt"


def autotok_home(data_root: Path) -> Path:
    return data_root / "tiktok"


def _prepare_env(home: Path) -> None:
    """autotok reads these at call time; keep its files inside clipbot's data."""
    home.mkdir(parents=True, exist_ok=True)
    os.environ["AUTOTOK_HOME"] = str(home)
    choice = home / BROWSER_FILE
    if choice.is_file() and choice.read_text().strip():
        os.environ["AUTOTOK_BROWSER_CHANNEL"] = choice.read_text().strip()


def consented(home: Path) -> bool:
    return (home / CONSENT_FILE).is_file()


def record_consent(home: Path) -> None:
    home.mkdir(parents=True, exist_ok=True)
    (home / CONSENT_FILE).write_text(
        json.dumps(
            {
                "accepted": "TikTok may restrict or ban accounts that post through its website "
                "with automation tools such as autotok.",
                "at": datetime.now(UTC).isoformat(timespec="seconds"),
            }
        )
    )


def _store(home: Path) -> Any:
    import autotok

    return autotok.AccountStore(home / "accounts")


def connected(home: Path) -> bool:
    """A saved TikTok session exists (it may still have expired on TikTok's side)."""
    return (home / "accounts" / f"{ACCOUNT}.json").is_file()


def disconnect(home: Path) -> None:
    (home / "accounts" / f"{ACCOUNT}.json").unlink(missing_ok=True)


# --------------------------------------------------------------------------- browser


def choose_browser(home: Path, launcher: Any = None) -> str:
    """Use Edge or Chrome if installed (no download); otherwise download
    Playwright's Chromium (about 300 MB). Returns what was chosen."""
    _prepare_env(home)
    if launcher is None:

        def launcher(channel: str | None) -> None:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as pw:
                b = (
                    pw.chromium.launch(channel=channel, headless=True)
                    if channel
                    else pw.chromium.launch(headless=True)
                )
                b.close()

    for channel in ("msedge", "chrome"):
        try:
            launcher(channel)
        except Exception:  # noqa: S112  not installed: try the next one
            continue
        (home / BROWSER_FILE).write_text(channel)
        os.environ["AUTOTOK_BROWSER_CHANNEL"] = channel
        return channel
    from autotok.browsers.local import install_browser

    if install_browser() != 0:
        raise PosterError("browser_missing", "could not download a browser for TikTok")
    (home / BROWSER_FILE).write_text("")
    os.environ.pop("AUTOTOK_BROWSER_CHANNEL", None)
    return "chromium"


# --------------------------------------------------------------------------- login


@dataclass
class LoginState:
    state: str = "idle"  # idle | preparing | waiting | done | error
    message: str = ""


_login = LoginState()
_login_lock = threading.Lock()


def login_state() -> LoginState:
    return _login


def start_login(home: Path, timeout: float = 600) -> bool:
    """Open a browser window for TikTok login, in the background. False if one is
    already running."""
    with _login_lock:
        if _login.state in ("preparing", "waiting"):
            return False
        _login.state, _login.message = "preparing", "Getting a browser ready…"

    def run() -> None:
        try:
            choose_browser(home)
            _login.state = "waiting"
            _login.message = (
                "A browser window opened. Log in to TikTok there. Scanning the "
                "QR code with the TikTok app is quickest."
            )
            import autotok

            autotok.login(ACCOUNT, timeout=timeout, store=_store(home))
            _login.state, _login.message = "done", "TikTok connected."
        except Exception as e:  # shown to the user on the setup page
            log.warning("tiktok_login_failed", error=str(e))
            _login.state = "error"
            _login.message = f"TikTok login did not finish: {e}"

    threading.Thread(target=run, name="tiktok-login", daemon=True).start()
    return True


# --------------------------------------------------------------------------- poster


class AutotokPoster:
    name = "autotok"

    def __init__(self, home: Path, uploader: Any = None) -> None:
        self.home = home
        _prepare_env(home)
        self.journal = home / "journal"
        self.journal.mkdir(parents=True, exist_ok=True)
        self._upload = uploader

    def _entry(self, request_id: str) -> dict[str, Any] | None:
        p = self.journal / f"{request_id}.json"
        return json.loads(p.read_text()) if p.is_file() else None

    def _write(self, request_id: str, data: dict[str, Any]) -> None:
        p = self.journal / f"{request_id}.json"
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.replace(tmp, p)

    def submit(self, video: Path, text: str, privacy: str | None, request_id: str) -> SubmitResult:
        if self._entry(request_id) is not None:
            return SubmitResult(request_id)  # already started or done: never twice
        self._write(
            request_id, {"state": "started", "at": datetime.now(UTC).isoformat(timespec="seconds")}
        )
        visibility = 1 if privacy == "SELF_ONLY" else 0
        try:
            upload = self._upload
            if upload is None:
                import autotok

                def upload(v: str, caption: str, vis: int) -> Any:
                    return autotok.upload_video(
                        ACCOUNT, v, caption, visibility=vis, ai_label=False, store=_store(self.home)
                    )

            result = upload(str(video), text, visibility)
        except Exception as e:
            raise self._map_error(request_id, e) from None
        video_id = str(getattr(result, "video_id", "") or "")
        self._write(request_id, {"state": "done", "video_id": video_id})
        return SubmitResult(request_id)

    def _map_error(self, request_id: str, e: Exception) -> PosterError:
        name = type(e).__name__
        uncertain = name == "PublishUncertainError"
        if not uncertain:  # nothing was published: allow a later attempt
            (self.journal / f"{request_id}.json").unlink(missing_ok=True)
        code = {
            "NotLoggedInError": "tiktok_reconnect_required",
            "AccountNotFoundError": "tiktok_reconnect_required",
            "PublishError": "content_rejected",
            "ValidationError": "invalid_parameter",
            "UploadError": "tiktok_publish_failed",
            "SigningError": "tiktok_publish_failed",
            "BrowserNotInstalledError": "browser_missing",
            "PublishUncertainError": "network_error",  # outcome unknown: poll decides
        }.get(name, "tiktok_publish_failed")
        log.warning("autotok_error", error=name, message=str(e)[:300], code=code)
        return PosterError(code, f"{name}: {e}"[:400])

    def status(self, request_id: str) -> PostStatus:
        entry = self._entry(request_id)
        if entry is None:
            return PostStatus("not_found")
        if entry.get("state") == "done":
            return PostStatus("published", post_id=entry.get("video_id") or None)
        # Started but no result: clipbot stopped mid-upload or TikTok's answer was
        # lost. Stay "pending" so the publisher reports it after 15 minutes and
        # never sends it again.
        return PostStatus("pending", message="upload outcome unknown")
