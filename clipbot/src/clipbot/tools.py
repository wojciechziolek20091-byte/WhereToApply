"""External programs. ffmpeg ships inside the imageio-ffmpeg package (version 9,
with libass and libx264 on Windows, macOS and Linux), so users install nothing.
Set CLIPBOT_FFMPEG to use a different ffmpeg."""

from __future__ import annotations

import os
from functools import cache


@cache
def ffmpeg_exe() -> str:
    override = os.environ.get("CLIPBOT_FFMPEG")
    if override:
        return override
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return "ffmpeg"  # last resort: whatever is on PATH
