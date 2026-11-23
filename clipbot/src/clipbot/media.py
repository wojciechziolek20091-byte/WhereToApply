"""Reading video files."""

from __future__ import annotations

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


def probe(path: Path) -> MediaInfo:
    """Read a video's streams with PyAV (bundled; no ffprobe needed)."""
    import av

    if not path.is_file():
        raise ProbeError(f"{path} does not exist")
    try:
        with av.open(str(path)) as c:
            v = next((st for st in c.streams.video), None)
            a = next((st for st in c.streams.audio), None)
            if v is None:
                raise ProbeError(f"{path.name} has no video stream")
            duration = float(c.duration) / 1_000_000 if c.duration else 0.0
            if duration <= 0 and v.duration and v.time_base:
                duration = float(v.duration * v.time_base)
            rate = v.average_rate or v.guessed_rate or v.base_rate
            info = MediaInfo(
                duration=duration,
                width=int(v.codec_context.width or 0),
                height=int(v.codec_context.height or 0),
                fps=float(rate) if rate else 0.0,
                vcodec=str(v.codec_context.name),
                acodec=str(a.codec_context.name) if a is not None else None,
                size_bytes=path.stat().st_size,
            )
    except ProbeError:
        raise
    except Exception as e:  # av.error.* and anything a damaged file throws
        raise ProbeError(f"cannot read {path.name}: {e}") from None
    if info.duration <= 0:
        raise ProbeError(f"{path.name} has no duration")
    return info
