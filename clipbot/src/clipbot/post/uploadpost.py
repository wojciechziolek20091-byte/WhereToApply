"""Upload-Post poster: the production path to a public TikTok post.

Upload-Post's TikTok app is audited by TikTok; each user connects their own TikTok
account once in the Upload-Post dashboard. Verified against docs.upload-post.com
on 19 Nov 2026:
- auth header "Authorization: Apikey <key>"
- POST /api/upload (multipart): user, platform[]=tiktok, video, title,
  privacy_level, async_upload, request_id (+ Idempotency-Key header)
- GET /api/uploadposts/status?request_id=... (404 / "not_found" when unknown)
- GET /api/uploadposts/users and /api/uploadposts/tiktok/settings
Inbox fallback is switched off: a capped post must fail loudly, not land silently
in the creator's TikTok drafts.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from clipbot.post.base import PosterError, PostStatus, SubmitResult

BASE_URL = "https://api.upload-post.com"


class UploadPostPoster:
    name = "uploadpost"

    def __init__(
        self, api_key: str, profile: str, http: httpx.Client | None = None, timeout_s: float = 300
    ) -> None:
        if not api_key or not profile:
            raise PosterError(
                "unauthorized", "UPLOAD_POST_API_KEY and UPLOAD_POST_PROFILE must both be set"
            )
        self.profile = profile
        self._http = http or httpx.Client(base_url=BASE_URL, timeout=timeout_s)
        self._auth = {"Authorization": f"Apikey {api_key}"}

    # ------------------------------------------------------------------ errors

    @staticmethod
    def _error(r: httpx.Response) -> PosterError:
        try:
            body: dict[str, Any] = r.json()
        except ValueError:
            body = {}
        msg = str(body.get("message") or body.get("error") or r.text[:200])
        code = body.get("error_code")
        if not code:
            low = msg.lower()
            if r.status_code == 401:
                code = "unauthorized"
            elif r.status_code == 403 and "plan" in low:
                code = "plan_required"
            elif r.status_code == 404 and "user" in low:
                code = "profile_not_found"
            elif r.status_code == 429 and body.get("violations"):
                code = "daily_cap"
            elif r.status_code == 429 and "monthly" in low:
                code = "monthly_limit"
            else:
                code = f"http_{r.status_code}"
        retry = r.headers.get("retry-after")
        return PosterError(
            str(code), msg, r.status_code, float(retry) if retry and retry.isdigit() else None, body
        )

    # ------------------------------------------------------------------ account

    def profile_info(self) -> dict[str, Any]:
        """The configured profile and its TikTok connection. Raises PosterError."""
        try:
            r = self._http.get("/api/uploadposts/users", headers=self._auth)
        except httpx.HTTPError as e:
            raise PosterError("network_error", type(e).__name__) from None
        if r.status_code != 200:
            raise self._error(r)
        for p in r.json().get("profiles", []):
            if p.get("username") == self.profile:
                return p
        raise PosterError("profile_not_found", f"no Upload-Post profile {self.profile!r}")

    def tiktok_connected(self) -> tuple[bool, str]:
        p = self.profile_info()
        tt = (p.get("social_accounts") or {}).get("tiktok")
        if not tt:
            return False, "no TikTok account connected to this profile"
        if isinstance(tt, dict) and tt.get("reauth_required"):
            return False, "TikTok connection needs to be renewed in Upload-Post"
        name = tt.get("handle") or tt.get("display_name") if isinstance(tt, dict) else ""
        return True, f"TikTok connected{f' as {name}' if name else ''}"

    def tiktok_settings(self) -> dict[str, Any]:
        """privacy_level_options and max_video_post_duration_sec for this account,
        read live instead of hardcoded."""
        try:
            r = self._http.get(
                "/api/uploadposts/tiktok/settings",
                params={"profile": self.profile},
                headers=self._auth,
            )
        except httpx.HTTPError as e:
            raise PosterError("network_error", type(e).__name__) from None
        if r.status_code != 200:
            raise self._error(r)
        return r.json()

    # ------------------------------------------------------------------ posting

    def submit(self, video: Path, text: str, privacy: str | None, request_id: str) -> SubmitResult:
        data: dict[str, Any] = {
            "user": self.profile,
            "platform[]": "tiktok",
            "title": text,
            "async_upload": "true",
            "request_id": request_id,
            "post_mode": "DIRECT_POST",
            "disable_inbox_fallback": "true",
            "is_aigc": "false",  # real footage; set true if synthetic voice/imagery is added
        }
        if privacy:
            data["privacy_level"] = privacy
        headers = {**self._auth, "Idempotency-Key": request_id}
        try:
            with video.open("rb") as f:
                r = self._http.post(
                    "/api/upload",
                    data=data,
                    headers=headers,
                    files={"video": (video.name, f, "video/mp4")},
                )
        except httpx.TimeoutException:
            # The upload may have arrived. Never resend blindly: the caller polls
            # status for this request_id first.
            raise PosterError("network_error", "upload timed out") from None
        except httpx.HTTPError as e:
            raise PosterError("network_error", type(e).__name__) from None
        if r.status_code not in (200, 202):
            raise self._error(r)
        body = r.json()
        if body.get("success") is False:
            raise self._error(r)
        tt = (body.get("results") or {}).get("tiktok") or {}
        if isinstance(tt, dict) and tt.get("success") is False:
            raise PosterError(
                str(tt.get("error_code") or "tiktok_publish_failed"),
                str(tt.get("error") or ""),
                r.status_code,
                data=body,
            )
        return SubmitResult(str(body.get("request_id") or request_id))

    def status(self, request_id: str) -> PostStatus:
        try:
            r = self._http.get(
                "/api/uploadposts/status", params={"request_id": request_id}, headers=self._auth
            )
        except httpx.HTTPError as e:
            raise PosterError("network_error", type(e).__name__) from None
        if r.status_code == 404:
            return PostStatus("not_found", message="Upload-Post does not know this request")
        if r.status_code != 200:
            raise self._error(r)
        body = r.json()
        top = str(body.get("status", "")).lower()
        if top == "not_found":
            return PostStatus("not_found", raw=body)
        results = body.get("results") or []
        tt = next((x for x in results if str(x.get("platform")).lower() == "tiktok"), None)
        if tt is None:
            if top == "failed":
                return PostStatus(
                    "failed",
                    error_code="tiktok_publish_failed",
                    raw=body,
                    message=str(body.get("message", "")),
                )
            return PostStatus("pending", raw=body)
        st = str(tt.get("status", "")).lower()
        if tt.get("fallback_to_inbox"):
            return PostStatus("inbox", message="sent to TikTok drafts, not published", raw=body)
        if st == "completed" or (tt.get("success") is True and top == "completed"):
            url = tt.get("post_url")
            if url and not str(url).startswith("http"):
                url = None
            return PostStatus(
                "published", post_url=url, post_id=tt.get("platform_post_id"), raw=body
            )
        if st == "failed" or (top == "failed" and tt.get("success") is False):
            return PostStatus(
                "failed",
                error_code=str(tt.get("error_code") or "tiktok_publish_failed"),
                message=str(tt.get("message") or tt.get("error") or ""),
                raw=body,
            )
        return PostStatus("pending", raw=body)  # queued, processing, retryable, ...
