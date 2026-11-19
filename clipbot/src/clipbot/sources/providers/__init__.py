"""Acquire providers: get the source video file onto disk."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class AcquireError(Exception):
    """Permanent for this attempt; the pipeline schedules a retry."""


class AcquireBlocked(AcquireError):
    """YouTube refused (403 / bot check). Retried at most 3 times over 24 hours,
    then an alert. Never worked around (no proxies, no cookies)."""


class NotAvailableYet(AcquireError):
    """The local file has not been dropped in the folder yet. Not counted as a
    failed attempt."""


class Provider(Protocol):
    name: str

    def acquire(self, video_id: str, url: str, dest: Path) -> Path:
        """Write the video to `dest` (an .mp4 path) and return it."""
        ...
