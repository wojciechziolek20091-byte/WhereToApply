"""Posting through autotok (github.com/makiisthenes/TiktokAutoUploader, AGPL-3.0).

autotok posts with a logged-in TikTok web session through TikTok's own website
endpoints. It is free and needs no paid service, but it is NOT TikTok's official
API: TikTok can restrict or ban accounts that post this way. clipbot only enables
it after the user has explicitly accepted that (see `consented`).

Several accounts: every connected account gets every clip. The first one
("clipbot") is the one connected first; more can be added from Settings. An
account that needs logging in again is skipped (and shown in Settings) while
the others keep posting.

Never twice: each upload is written to a journal before it starts, one journal
per account. If clipbot
stops mid-upload, the journal says "started" with no result, so the post is
reported as unknown and never sent again.
"""

from __future__ import annotations

import inspect
import json
import os
import re
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


ACCOUNTS_FILE = "accounts.json"  # labels and problems, by account name
_NAME_RE = re.compile(r"^clipbot(-[0-9]{1,3})?$")


@dataclass(frozen=True)
class TikTokAccount:
    name: str  # autotok's account name: "clipbot", "clipbot-2", ...
    label: str  # what the user called it, e.g. "@franiu78"
    problem: str = ""  # set when it needs logging in again


def _meta(home: Path) -> dict[str, dict[str, str]]:
    p = home / ACCOUNTS_FILE
    try:
        data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_meta(home: Path, data: dict[str, dict[str, str]]) -> None:
    home.mkdir(parents=True, exist_ok=True)
    p = home / ACCOUNTS_FILE
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def _order(name: str) -> int:
    return 1 if name == ACCOUNT else int(name.rsplit("-", 1)[1])


def accounts(home: Path) -> list[TikTokAccount]:
    """Every connected TikTok account, in the order they were added."""
    folder = home / "accounts"
    names = (
        sorted((f.stem for f in folder.glob("*.json") if _NAME_RE.match(f.stem)), key=_order)
        if folder.is_dir()
        else []
    )
    meta = _meta(home)
    out = []
    for i, n in enumerate(names, 1):
        m = meta.get(n, {})
        out.append(TikTokAccount(n, m.get("label") or f"Account {i}", m.get("problem", "")))
    return out


def new_account_name(home: Path) -> str:
    """The autotok name for one more account."""
    taken = {a.name for a in accounts(home)}
    if ACCOUNT not in taken:
        return ACCOUNT
    n = 2
    while f"{ACCOUNT}-{n}" in taken:
        n += 1
    return f"{ACCOUNT}-{n}"


def valid_account_name(name: str) -> bool:
    return bool(_NAME_RE.match(name))


def set_label(home: Path, name: str, label: str) -> None:
    meta = _meta(home)
    label = " ".join(label.split())[:60]
    entry = meta.setdefault(name, {})
    if label:
        entry["label"] = label
    else:
        entry.pop("label", None)
    _save_meta(home, meta)


def set_problem(home: Path, name: str, problem: str) -> None:
    meta = _meta(home)
    entry = meta.setdefault(name, {})
    if problem:
        entry["problem"] = problem[:200]
    else:
        entry.pop("problem", None)
    _save_meta(home, meta)


def connected(home: Path) -> bool:
    """At least one saved TikTok session exists (it may still have expired on
    TikTok's side)."""
    return bool(accounts(home))


def disconnect(home: Path, name: str | None = None) -> None:
    """Remove one account, or every account when `name` is None."""
    names = [name] if name else [a.name for a in accounts(home)]
    meta = _meta(home)
    for n in names:
        if not valid_account_name(n):
            continue
        (home / "accounts" / f"{n}.json").unlink(missing_ok=True)
        meta.pop(n, None)
    _save_meta(home, meta)


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
    account: str = ""  # which account is being logged in


_login = LoginState()
_login_lock = threading.Lock()


def login_state() -> LoginState:
    return _login


def start_login(home: Path, timeout: float = 600, account: str = ACCOUNT, label: str = "") -> bool:
    """Open a browser window for TikTok login, in the background. `account`: an
    existing account to log in again, or a new name (see `new_account_name`) to
    add one. False if a login is already running."""
    if not valid_account_name(account):
        raise ValueError(f"bad account name {account!r}")
    with _login_lock:
        if _login.state in ("preparing", "waiting"):
            return False
        _login.state, _login.message = "preparing", "Getting a browser ready…"
        _login.account = account

    def run() -> None:
        try:
            choose_browser(home)
            _login.state = "waiting"
            _login.message = (
                "A browser window opened. Log in to TikTok there. Scanning the "
                "QR code with the TikTok app is quickest."
            )
            import autotok

            autotok.login(account, timeout=timeout, store=_store(home))
            if label:
                set_label(home, account, label)
            set_problem(home, account, "")
            n = len(accounts(home))
            _login.state = "done"
            _login.message = (
                "TikTok connected."
                if n == 1
                else f"TikTok connected. Clips now post to all {n} accounts."
            )
        except Exception as e:  # shown to the user on the setup page
            log.warning("tiktok_login_failed", error=str(e))
            _login.state = "error"
            _login.message = f"TikTok login did not finish: {e}"

    threading.Thread(target=run, name="tiktok-login", daemon=True).start()
    return True


# --------------------------------------------------------------------------- poster


_POST_ID_KEYS = ("item_id", "itemId", "aweme_id", "awemeId", "post_id", "postId")


def public_post_id(result: Any) -> str:
    """The public TikTok post number (the one in tiktok.com/@user/video/<number>)
    from what the upload returned, or "" if TikTok did not say.

    autotok's `video_id` is TikTok's storage id for the uploaded file, not the
    post: views can only be read with the post number, which TikTok puts
    somewhere in the publish response."""

    def walk(node: Any, depth: int = 0) -> str:
        if depth > 6:
            return ""
        if isinstance(node, dict):
            for k in _POST_ID_KEYS:
                v = str(node.get(k) or "")
                if v.isdigit() and 15 <= len(v) <= 21:
                    return v
            for v in node.values():
                found = walk(v, depth + 1)
                if found:
                    return found
        elif isinstance(node, list):
            for v in node[:20]:
                found = walk(v, depth + 1)
                if found:
                    return found
        return ""

    direct = str(getattr(result, "video_id", "") or "")
    if direct.isdigit() and 15 <= len(direct) <= 21:
        return direct
    return walk(getattr(result, "response", None) or {})


def clip_key(request_id: str) -> str:
    """The part of a request id that names the clip: "cb-<clip>-<attempt>" gives
    "cb-<clip>-", so a retry (a new attempt) still sees what earlier attempts
    posted."""
    head, _, tail = request_id.rpartition("-")
    return head + "-" if head and tail.isdigit() else request_id


class AutotokPoster:
    """Posts each clip to every connected account."""

    name = "autotok"

    def __init__(self, home: Path, uploader: Any = None) -> None:
        self.home = home
        _prepare_env(home)
        self.journal = home / "journal"  # the first account's (kept from before)
        self.journal.mkdir(parents=True, exist_ok=True)
        self._upload = uploader

    # ----------------------------------------------------------- journal

    def _dir(self, account: str) -> Path:
        return self.journal if account == ACCOUNT else self.journal / account

    def _entry(self, request_id: str, account: str = ACCOUNT) -> dict[str, Any] | None:
        p = self._dir(account) / f"{request_id}.json"
        try:
            return json.loads(p.read_text()) if p.is_file() else None
        except ValueError:
            return {"state": "started"}  # half-written: treat as maybe posted

    def _write(self, request_id: str, data: dict[str, Any], account: str = ACCOUNT) -> None:
        d = self._dir(account)
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{request_id}.json"
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.replace(tmp, p)

    def _clip_entries(self, request_id: str, account: str) -> list[dict[str, Any]]:
        """Journal entries of this clip on one account, from any attempt."""
        d = self._dir(account)
        if not d.is_dir():
            return []
        key = clip_key(request_id)
        out = []
        for f in d.glob("*.json"):
            if f.stem == request_id or (key != request_id and f.stem.startswith(key)):
                e = self._entry(f.stem, account)
                if e:
                    out.append(e)
        return out

    def _accounts(self) -> list[TikTokAccount]:
        found = accounts(self.home)
        # Tests (and an upgrade mid-post) may have journals but no saved account.
        return found or [TikTokAccount(ACCOUNT, "Account 1")]

    # ----------------------------------------------------------- posting

    def _send(self, account: str, video: Path, text: str, visibility: int) -> Any:
        upload = self._upload
        if upload is None:
            import autotok

            return autotok.upload_video(
                account, str(video), text, visibility=visibility, ai_label=False,
                store=_store(self.home),
            )  # fmt: skip
        try:
            takes_account = "account" in inspect.signature(upload).parameters
        except (TypeError, ValueError):
            takes_account = False
        if takes_account:
            return upload(str(video), text, visibility, account=account)
        return upload(str(video), text, visibility)

    def submit(self, video: Path, text: str, privacy: str | None, request_id: str) -> SubmitResult:
        visibility = 1 if privacy == "SELF_ONLY" else 0
        all_accounts = self._accounts()
        several = len(all_accounts) > 1
        errors: list[tuple[TikTokAccount, PosterError]] = []
        for acct in all_accounts:
            if any(e.get("state") in ("started", "done") for e in
                   self._clip_entries(request_id, acct.name)):  # fmt: skip
                continue  # already posted (or maybe posted) there: never twice
            if several and acct.problem:
                continue  # needs logging in again: skip it, post to the others
            self._write(
                request_id,
                {"state": "started", "at": datetime.now(UTC).isoformat(timespec="seconds")},
                acct.name,
            )
            try:
                result = self._send(acct.name, video, text, visibility)
            except Exception as e:
                err = self._map_error(request_id, e, acct.name)
                errors.append((acct, err))
                if several and err.code == "tiktok_reconnect_required":
                    set_problem(self.home, acct.name, "Signed out of TikTok: log in again")
                continue
            entry: dict[str, Any] = {
                "state": "done",
                "video_id": public_post_id(result),  # "" when TikTok did not say
                "upload_id": str(getattr(result, "video_id", "") or ""),
            }
            raw = getattr(result, "response", None)
            if isinstance(raw, dict):  # kept to find the post number if it moves
                text = json.dumps(raw)[:20000]
                entry["response"] = json.loads(text) if len(text) < 20000 else text
            self._write(request_id, entry, acct.name)
            if not entry["video_id"]:
                log.warning("autotok_no_post_id", account=acct.name, keys=sorted(raw or {})[:20])
            if acct.problem:
                set_problem(self.home, acct.name, "")
        posted = [
            a for a in all_accounts
            if any(e.get("state") == "done" for e in self._clip_entries(request_id, a.name))
        ]  # fmt: skip
        if not posted:
            # Nothing went out anywhere: the usual error handling applies. An
            # unknown outcome wins, so a clip that may be live is never marked
            # rejected and sent again.
            maybe = [x for _, x in errors if x.code == "network_error"]
            if maybe or errors:
                raise (maybe or [x for _, x in errors])[0]
            if several and all(a.problem for a in all_accounts):
                raise PosterError(
                    "tiktok_reconnect_required", "every TikTok account needs logging in again"
                )
        for acct, err in errors:  # posted elsewhere: note it and move on
            if self._entry(request_id, acct.name) is None:
                self._write(request_id, {"state": "failed", "error": str(err)[:300]}, acct.name)
            log.warning("autotok_account_failed", account=acct.name, code=err.code)
        return SubmitResult(request_id)

    def _map_error(self, request_id: str, e: Exception, account: str = ACCOUNT) -> PosterError:
        name = type(e).__name__
        uncertain = name == "PublishUncertainError"
        if not uncertain:  # nothing was published: allow a later attempt
            (self._dir(account) / f"{request_id}.json").unlink(missing_ok=True)
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
        log.warning("autotok_error", error=name, message=str(e)[:300], code=code, account=account)
        return PosterError(code, f"{name}: {e}"[:400])

    def status(self, request_id: str) -> PostStatus:
        posts: list[dict[str, str]] = []
        pending = False
        for acct in self._accounts():
            # Any attempt of this clip counts: a retry only goes to the accounts
            # the earlier attempts missed.
            done = [e for e in self._clip_entries(request_id, acct.name)
                    if e.get("state") == "done"]  # fmt: skip
            if done:
                vid = done[0].get("video_id") or ""
                posts.append({"account": acct.name, "label": acct.label, "video_id": vid})
            elif (self._entry(request_id, acct.name) or {}).get("state") == "started":
                pending = True
        if posts:
            first = next((p["video_id"] for p in posts if p["video_id"]), None)
            return PostStatus("published", post_id=first, raw={"posts": posts})
        if pending:
            # Started but no result: clipbot stopped mid-upload or TikTok's answer
            # was lost. Stay "pending" so the publisher reports it after 15
            # minutes and never sends it again.
            return PostStatus("pending", message="upload outcome unknown")
        return PostStatus("not_found")
