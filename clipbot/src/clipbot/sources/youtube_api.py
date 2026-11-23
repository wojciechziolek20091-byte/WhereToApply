"""YouTube Data API v3: video metadata (license, duration, live status) and URL parsing.

The key travels in the `X-Goog-Api-Key` header, never in the URL, so it cannot
leak through logged request URLs.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import httpx

API_BASE = "https://www.googleapis.com/youtube/v3"
BATCH = 50

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_DURATION_RE = re.compile(
    r"^P(?:(?P<d>\d+)D)?(?:T(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+(?:\.\d+)?)S)?)?$"
)


class YouTubeError(Exception):
    pass


class YouTubeAuthError(YouTubeError):
    """Bad key or exhausted quota. The pipeline auto-pauses on this."""


class BadVideoURL(ValueError):
    pass


def parse_video_id(url_or_id: str) -> str:
    """Accept a bare 11-character id or any common YouTube URL form."""
    s = url_or_id.strip()
    if _ID_RE.match(s):
        return s
    if "://" not in s:
        s = "https://" + s
    u = urlparse(s)
    host = (u.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    host = host.removeprefix("music.")
    cand: str | None = None
    if host == "youtu.be":
        cand = u.path.lstrip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if u.path == "/watch":
            cand = (parse_qs(u.query).get("v") or [None])[0]
        else:
            parts = [p for p in u.path.split("/") if p]
            if len(parts) >= 2 and parts[0] in ("shorts", "live", "embed", "v"):
                cand = parts[1]
    if cand and _ID_RE.match(cand):
        return cand
    raise BadVideoURL(f"not a YouTube video link: {url_or_id!r}")


def parse_duration(iso: str | None) -> float:
    """ISO 8601 duration as YouTube returns it (PT1H2M3S, P1DT2H, P0D)."""
    if not iso:
        return 0.0
    m = _DURATION_RE.match(iso)
    if not m:
        raise ValueError(f"bad duration {iso!r}")
    d, h, mi, s = (float(m.group(k) or 0) for k in ("d", "h", "m", "s"))
    return d * 86400 + h * 3600 + mi * 60 + s


@dataclass(frozen=True)
class VideoMeta:
    id: str
    channel_id: str
    channel_title: str
    title: str
    published_at: datetime | None
    duration_sec: float
    license: str  # "youtube" | "creativeCommon"
    privacy_status: str  # public | unlisted | private
    live_status: str  # none | live | upcoming (snippet.liveBroadcastContent)
    upload_status: str  # processed | uploaded | ...
    was_live: bool  # had liveStreamingDetails (a finished stream)

    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.id}"

    @property
    def is_cc_by(self) -> bool:
        return self.license == "creativeCommon"

    @classmethod
    def from_api(cls, item: dict) -> VideoMeta:
        sn = item.get("snippet") or {}
        st = item.get("status") or {}
        cd = item.get("contentDetails") or {}
        pub = sn.get("publishedAt")
        return cls(
            id=item["id"],
            channel_id=sn.get("channelId", ""),
            channel_title=sn.get("channelTitle", ""),
            title=sn.get("title", ""),
            published_at=datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else None,
            duration_sec=parse_duration(cd.get("duration")),
            license=st.get("license", "youtube"),
            privacy_status=st.get("privacyStatus", "unknown"),
            live_status=sn.get("liveBroadcastContent", "none"),
            upload_status=st.get("uploadStatus", "unknown"),
            was_live="liveStreamingDetails" in item,
        )


class YouTubeAPI:
    def __init__(self, api_key: str, http: httpx.Client | None = None) -> None:
        if not api_key:
            raise YouTubeAuthError("YOUTUBE_API_KEY is not set")
        self._http = http or httpx.Client(base_url=API_BASE, timeout=30)
        self._headers = {"X-Goog-Api-Key": api_key}
        self.units_used = 0  # quota units spent by this client

    def _get(self, path: str, params: dict) -> dict:
        try:
            r = self._http.get(path, params=params, headers=self._headers)
        except httpx.HTTPError as e:
            raise YouTubeError(f"YouTube API unreachable: {type(e).__name__}") from None
        self.units_used += 1
        if r.status_code in (401, 403) or (
            r.status_code == 400 and _error_reason(r) in ("keyInvalid", "keyExpired")
        ):
            # Bad key, API disabled, or daily quota used up: pause and alert.
            raise YouTubeAuthError(f"YouTube API refused the request: {_error_reason(r)}")
        if r.status_code >= 400:
            raise YouTubeError(f"YouTube API HTTP {r.status_code}: {_error_reason(r)}")
        return r.json()

    def videos(self, ids: Iterable[str]) -> dict[str, VideoMeta]:
        """videos.list in batches of 50. Missing ids (deleted, private) are absent."""
        ids = list(dict.fromkeys(ids))
        out: dict[str, VideoMeta] = {}
        for i in range(0, len(ids), BATCH):
            chunk = ids[i : i + BATCH]
            data = self._get(
                "/videos",
                {
                    "part": "snippet,contentDetails,status,liveStreamingDetails",
                    "id": ",".join(chunk),
                    "maxResults": BATCH,
                },
            )
            for item in data.get("items", []):
                m = VideoMeta.from_api(item)
                out[m.id] = m
        return out

    def video(self, video_id: str) -> VideoMeta | None:
        return self.videos([video_id]).get(video_id)

    def channel(
        self, *, channel_id: str | None = None, handle: str | None = None
    ) -> tuple[str, str] | None:
        """(channel id, channel name) by id or @handle. 1 quota unit."""
        params = {"part": "snippet"}
        if channel_id:
            params["id"] = channel_id
        elif handle:
            params["forHandle"] = "@" + handle.lstrip("@")
        else:
            raise ValueError("channel_id or handle is required")
        items = self._get("/channels", params).get("items") or []
        if not items:
            return None
        return items[0]["id"], (items[0].get("snippet") or {}).get("title", "")

    def channel_id_for_handle(self, handle: str) -> str | None:
        data = self._get("/channels", {"part": "id", "forHandle": "@" + handle.lstrip("@")})
        items = data.get("items") or []
        return items[0]["id"] if items else None


def _error_reason(r: httpx.Response) -> str:
    try:
        err = r.json().get("error", {})
        errs = err.get("errors") or [{}]
        return errs[0].get("reason") or err.get("status") or err.get("message") or "unknown"
    except ValueError:
        return f"HTTP {r.status_code}"
