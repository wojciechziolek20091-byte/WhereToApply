"""Poster interface and what to do about each error (brief 4.8, checked against
Upload-Post's live docs on 19 Nov 2026)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Literal, Protocol

PostState = Literal["pending", "published", "failed", "inbox", "not_found"]


@dataclass(frozen=True)
class SubmitResult:
    request_id: str


@dataclass(frozen=True)
class PostStatus:
    state: PostState
    post_url: str | None = None
    post_id: str | None = None
    error_code: str | None = None
    message: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


class Action(Enum):
    REJECT = "reject"  # this file will never be accepted: never retry it
    RETRY = "retry"  # transient: back off 5, 15, 45 minutes, then give up
    DROP_PRIVACY = "drop_privacy"  # resend without the privacy field, then alert
    PAUSE = "pause"  # fix needed by a person (key, connection, plan): pause and alert
    PAUSE_24H = "pause_24h"  # spam-risk or daily cap: stop posting for a day, alert
    PAUSE_7D = "pause_7d"  # banned from posting through the API
    WAIT_1H_ONCE = "wait_1h_once"  # TikTok's app-wide daily cap: retry once in an hour


class PosterError(Exception):
    def __init__(
        self,
        code: str,
        message: str = "",
        http_status: int | None = None,
        retry_after_s: float | None = None,
        data: dict[str, Any] | None = None,
    ):
        self.code = code
        self.http_status = http_status
        self.retry_after_s = retry_after_s
        self.data = data or {}
        super().__init__(f"{code}: {message}" if message else code)

    @property
    def action(self) -> Action:
        return classify(self.code, self.http_status)


_EXACT: dict[str, Action] = {
    "tiktok_media_rejected": Action.REJECT,
    "content_rejected": Action.REJECT,  # spam_risk / spam_risk_text verdict on this post
    "invalid_parameter": Action.REJECT,
    "commercial_disclosure_privacy_conflict": Action.REJECT,
    "tiktok_publish_failed": Action.RETRY,
    "network_error": Action.RETRY,
    "tiktok_privacy_unavailable": Action.DROP_PRIVACY,
    "tiktok_reconnect_required": Action.PAUSE,
    "reauth_required": Action.PAUSE,
    "account_reauth_required": Action.PAUSE,
    "unauthorized": Action.PAUSE,
    "plan_required": Action.PAUSE,
    "browser_missing": Action.PAUSE,
    "monthly_limit": Action.PAUSE,
    "profile_not_found": Action.PAUSE,
    "spam_risk_user_banned_from_posting": Action.PAUSE_7D,
    "account_restricted": Action.PAUSE_24H,
    "daily_cap": Action.PAUSE_24H,
    "reached_active_user_cap": Action.WAIT_1H_ONCE,
}


def classify(code: str, http_status: int | None = None) -> Action:
    if code in _EXACT:
        return _EXACT[code]
    if code.startswith("spam_risk"):
        return Action.PAUSE_24H
    if http_status == 401:
        return Action.PAUSE
    if http_status is not None and (http_status == 429 or http_status >= 500):
        return Action.RETRY
    if http_status is not None and 400 <= http_status < 500:
        return Action.REJECT
    return Action.RETRY


class Poster(Protocol):
    name: str

    def submit(self, video: Path, text: str, privacy: str | None, request_id: str) -> SubmitResult:
        """Start an upload. `request_id` is ours and doubles as the idempotency key,
        so sending the same id twice never makes two posts."""
        ...

    def status(self, request_id: str) -> PostStatus: ...
