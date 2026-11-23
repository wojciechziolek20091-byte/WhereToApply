from __future__ import annotations

import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from clipbot.config import Source
from clipbot.sources.youtube_api import VideoMeta
from clipbot.tools import ffmpeg_exe

CHANNEL = "UCabcdefghijklmnopqrstuv"
OTHER_CHANNEL = "UCzzzzzzzzzzzzzzzzzzzzzz"


def meta(vid: str = "aaaaaaaaaaa", **kw: Any) -> VideoMeta:
    base: dict[str, Any] = dict(
        id=vid,
        channel_id=CHANNEL,
        channel_title="Chan",
        title="A talk",
        published_at=datetime(2026, 11, 18, tzinfo=UTC),
        duration_sec=1200.0,
        license="youtube",
        privacy_status="public",
        live_status="none",
        upload_status="processed",
        was_live=False,
    )
    base.update(kw)
    return VideoMeta(**base)


def source(**kw: Any) -> Source:
    base: dict[str, Any] = dict(
        id="src",
        youtube_channel_id=CHANNEL,
        name="Chan",
        rights="own",
        acquire="ytdlp",
        enabled=True,
    )
    base.update(kw)
    return Source.model_validate(base)


def make_mp4(path: Path, seconds: float = 2.0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg_exe(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size=320x240:rate=25:duration={seconds}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={seconds}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
    )
    return path
