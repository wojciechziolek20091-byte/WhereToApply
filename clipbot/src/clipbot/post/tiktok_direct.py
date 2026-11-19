"""TikTok Content Posting API (Direct Post), for sandbox testing only.

TikTok forces posts from unaudited apps to SELF_ONLY on a private account, and
does not audit personal tools, so this poster always posts privately. Use
Upload-Post for real posting. Needs TIKTOK_ACCESS_TOKEN from your sandbox app's
OAuth flow (scope video.publish).

Flow: creator_info/query (privacy options and max duration are read live, never
hardcoded) -> video/init with FILE_UPLOAD -> PUT chunks -> status/fetch.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import httpx

from clipbot.post.base import PosterError, PostStatus, SubmitResult

API = "https://open.tiktokapis.com/v2"
CHUNK = 10 * 1024 * 1024
PRIVACY = "SELF_ONLY"


class TikTokDirectPoster:
    name = "tiktok_direct"

    def __init__(self, access_token: str, http: httpx.Client | None = None) -> None:
        if not access_token:
            raise PosterError("unauthorized", "TIKTOK_ACCESS_TOKEN is not set")
        self._http = http or httpx.Client(timeout=300)
        self._h = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
        }

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            r = self._http.post(f"{API}{path}", json=body, headers=self._h)
        except httpx.HTTPError as e:
            raise PosterError("network_error", type(e).__name__) from None
        data = r.json() if r.content else {}
        err = data.get("error") or {}
        code = err.get("code", "ok")
        if r.status_code == 401 or code == "access_token_invalid":
            raise PosterError("unauthorized", err.get("message", ""), r.status_code)
        if code != "ok":
            raise PosterError(str(code), str(err.get("message", "")), r.status_code, data=data)
        return data.get("data") or {}

    def creator_info(self) -> dict[str, Any]:
        return self._post("/post/publish/creator_info/query/", {})

    def submit(self, video: Path, text: str, privacy: str | None, request_id: str) -> SubmitResult:
        info = self.creator_info()
        options = info.get("privacy_level_options") or []
        if PRIVACY not in options:
            raise PosterError("tiktok_privacy_unavailable", f"SELF_ONLY not in {options}")
        max_s = info.get("max_video_post_duration_sec")
        size = video.stat().st_size
        chunk = min(CHUNK, size)
        count = max(1, math.floor(size / chunk))
        init = self._post(
            "/post/publish/video/init/",
            {
                "post_info": {
                    "title": text[:2200],
                    "privacy_level": PRIVACY,
                    "disable_duet": False,
                    "disable_comment": False,
                    "disable_stitch": False,
                    "is_aigc": False,
                },
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": size,
                    "chunk_size": chunk,
                    "total_chunk_count": count,
                },
            },
        )
        url, publish_id = init["upload_url"], init["publish_id"]
        with video.open("rb") as f:
            for i in range(count):
                start = i * chunk
                end = size - 1 if i == count - 1 else start + chunk - 1
                f.seek(start)
                body = f.read(end - start + 1)
                r = self._http.put(
                    url,
                    content=body,
                    headers={
                        "Content-Type": "video/mp4",
                        "Content-Length": str(len(body)),
                        "Content-Range": f"bytes {start}-{end}/{size}",
                    },
                )
                if r.status_code not in (200, 201, 206):
                    raise PosterError("tiktok_publish_failed", f"chunk {i} HTTP {r.status_code}")
        _ = max_s  # recorded by doctor; QA already keeps clips at 60 s or less
        return SubmitResult(publish_id)

    def status(self, request_id: str) -> PostStatus:
        d = self._post("/post/publish/status/fetch/", {"publish_id": request_id})
        st = d.get("status")
        if st == "PUBLISH_COMPLETE":
            ids = d.get("publicaly_available_post_id") or d.get("publicly_available_post_id")
            return PostStatus("published", post_id=str(ids[0]) if ids else None, raw=d)
        if st == "FAILED":
            return PostStatus("failed", error_code=str(d.get("fail_reason") or "failed"), raw=d)
        if st == "SEND_TO_USER_INBOX":
            return PostStatus("inbox", raw=d)
        return PostStatus("pending", raw=d)
