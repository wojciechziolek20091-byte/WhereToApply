"""Creator-supplied files: `{video_id}.mp4` (or .mov/.mkv/.webm) in a folder."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from clipbot.sources.providers import NotAvailableYet

EXTENSIONS = (".mp4", ".mov", ".mkv", ".webm")


class LocalFolderProvider:
    name = "local_folder"

    def __init__(self, folder: Path) -> None:
        self.folder = folder

    def find(self, video_id: str) -> Path | None:
        for ext in EXTENSIONS:
            p = self.folder / f"{video_id}{ext}"
            if p.is_file():
                return p
        return None

    def acquire(self, video_id: str, url: str, dest: Path) -> Path:
        src = self.find(video_id)
        if src is None:
            raise NotAvailableYet(f"{video_id}.mp4 not found in {self.folder}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".part")
        if src.suffix == ".mp4":
            try:
                os.link(src, tmp)  # same filesystem: instant, no extra space
            except OSError:
                shutil.copy2(src, tmp)
            tmp.replace(dest)
            return dest
        # Other containers are remuxed to mp4 without re-encoding.
        from clipbot.sources.providers.ytdlp import remux_to_mp4

        remux_to_mp4(src, dest)
        return dest
