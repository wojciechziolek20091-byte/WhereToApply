"""Plain data objects shared across stages."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path


def make_clip_id(video_id: str, start_ms: int, end_ms: int) -> str:
    return hashlib.sha1(f"{video_id}:{start_ms}:{end_ms}".encode()).hexdigest()[:16]  # noqa: S324


@dataclass(frozen=True)
class DataPaths:
    """Layout of the data folder (brief sections 4.2 to 4.5, 7)."""

    root: Path

    @property
    def db(self) -> Path:
        return self.root / "clipbot.sqlite3"

    @property
    def lock(self) -> Path:
        return self.root / "clipbot.lock"

    @property
    def pause_file(self) -> Path:
        return self.root / "PAUSE"

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def work(self) -> Path:
        return self.root / "work"

    @property
    def renders(self) -> Path:
        return self.root / "renders"

    @property
    def tools(self) -> Path:
        return self.root / "tools"

    @property
    def models(self) -> Path:
        return self.root / "models"

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    def raw_video(self, video_id: str) -> Path:
        return self.raw / f"{video_id}.mp4"

    def work_dir(self, video_id: str) -> Path:
        return self.work / video_id

    def render(self, clip_id: str) -> Path:
        return self.renders / f"{clip_id}.mp4"

    def contact_sheet(self, clip_id: str) -> Path:
        return self.renders / f"{clip_id}.jpg"

    def ensure(self) -> None:
        for p in (self.root, self.raw, self.work, self.renders, self.logs):
            p.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class Word:
    w: str
    start: float
    end: float
    prob: float = 1.0


@dataclass
class CheckResult:
    name: str
    status: str  # ok | warn | fail | skip
    detail: str = ""
    data: dict[str, object] = field(default_factory=dict)
