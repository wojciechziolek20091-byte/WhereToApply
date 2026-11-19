"""ffprobe helpers."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


class ProbeError(Exception):
    pass


@dataclass(frozen=True)
class MediaInfo:
    duration: float
    width: int
    height: int
    fps: float
    vcodec: str
    acodec: str | None
    size_bytes: int

    @property
    def has_audio(self) -> bool:
        return self.acodec is not None


def _fps(rate: str | None) -> float:
    if not rate or rate in ("0/0", "0"):
        return 0.0
    if "/" in rate:
        n, d = rate.split("/", 1)
        return float(n) / float(d) if float(d) else 0.0
    return float(rate)


def probe(path: Path, timeout: float = 60) -> MediaInfo:
    if not path.is_file():
        raise ProbeError(f"{path} does not exist")
    try:
        p = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise ProbeError(f"ffprobe failed: {e}") from None
    if p.returncode != 0:
        raise ProbeError(f"ffprobe rejected {path.name}: {p.stderr.strip()[:300]}")
    data = json.loads(p.stdout or "{}")
    streams = data.get("streams") or []
    v = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video"
            and not (s.get("disposition") or {}).get("attached_pic")
        ),
        None,
    )
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None:
        raise ProbeError(f"{path.name} has no video stream")
    fmt = data.get("format") or {}
    duration = float(fmt.get("duration") or v.get("duration") or 0)
    if duration <= 0:
        raise ProbeError(f"{path.name} has no duration")
    return MediaInfo(
        duration=duration,
        width=int(v.get("width") or 0),
        height=int(v.get("height") or 0),
        fps=_fps(v.get("avg_frame_rate") or v.get("r_frame_rate")),
        vcodec=str(v.get("codec_name")),
        acodec=a.get("codec_name") if a else None,
        size_bytes=int(fmt.get("size") or path.stat().st_size),
    )
