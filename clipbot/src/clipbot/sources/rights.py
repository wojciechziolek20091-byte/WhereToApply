"""Rights gate and eligibility filter (brief 2.2 and 4.1). Pure functions.

A failed gate is not an error: the video is stored as `skipped` with the reason.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, datetime

from clipbot.config import DiscoverySettings, Source
from clipbot.sources.youtube_api import VideoMeta

LICENSE_LABELS = {"own": None, "cc_by": "CC BY", "permission": "used with permission"}


@dataclass(frozen=True)
class Decision:
    ok: bool
    reason: str

    def __bool__(self) -> bool:
        return self.ok


def check_rights(source: Source, meta: VideoMeta, today: date) -> Decision:
    if source.rights is None:
        return Decision(False, "no rights tag on source")
    if meta.channel_id and meta.channel_id != source.youtube_channel_id:
        return Decision(False, f"video belongs to channel {meta.channel_id}, not the source's")
    if source.rights == "own":
        return Decision(True, "own content")
    if source.rights == "cc_by":
        if not meta.is_cc_by:
            return Decision(False, f"source is cc_by but video license is {meta.license!r}")
        return Decision(True, "Creative Commons (CC BY) verified via API")
    if source.rights == "permission":
        if not source.permission_ref:
            return Decision(False, "permission source without permission_ref")
        if source.permission_expires and source.permission_expires < today:
            return Decision(False, f"permission expired on {source.permission_expires}")
        return Decision(True, f"permission: {source.permission_ref}")
    return Decision(False, f"unknown rights tag {source.rights!r}")


def check_eligible(
    meta: VideoMeta,
    disc: DiscoverySettings,
    published_after: datetime | None = None,
) -> Decision:
    """Everything except rights: liveness, visibility, length, age."""
    if meta.live_status in ("live", "upcoming"):
        return Decision(False, f"video is {meta.live_status}")
    if meta.privacy_status != "public":
        return Decision(False, f"video is {meta.privacy_status}, not public")
    if meta.upload_status not in ("processed", "unknown"):
        return Decision(False, f"upload status {meta.upload_status}")
    if meta.duration_sec < disc.min_duration_sec:
        return Decision(False, f"too short ({meta.duration_sec:.0f}s < {disc.min_duration_sec}s)")
    if meta.duration_sec > disc.max_duration_sec:
        return Decision(False, f"too long ({meta.duration_sec:.0f}s > {disc.max_duration_sec}s)")
    if published_after and meta.published_at and meta.published_at < published_after:
        return Decision(False, "published before the backfill window")
    return Decision(True, "eligible")


def adhoc_cc_source(meta: VideoMeta) -> Source:
    """A source record for a Creative Commons video pasted by URL from a channel
    that is not in sources.yaml. Disabled, so it is never polled."""
    return Source(
        # Channel ids are case-sensitive and source ids are lower-case: hash them.
        id="cc-" + hashlib.sha1(meta.channel_id.encode()).hexdigest()[:12],  # noqa: S324
        youtube_channel_id=meta.channel_id,
        name=meta.channel_title or meta.channel_id,
        rights="cc_by",
        acquire="ytdlp",
        enabled=False,
    )
