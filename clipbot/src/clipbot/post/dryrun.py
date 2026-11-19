"""Dry-run poster: records what would have been posted. Never touches TikTok."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from clipbot.post.base import PostStatus, SubmitResult


class DryRunPoster:
    name = "dryrun"

    def __init__(self, out_dir: Path) -> None:
        self.out_dir = out_dir

    def submit(self, video: Path, text: str, privacy: str | None, request_id: str) -> SubmitResult:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        (self.out_dir / f"{request_id}.json").write_text(
            json.dumps(
                {
                    "request_id": request_id,
                    "video": str(video),
                    "caption": text,
                    "privacy": privacy,
                    "at": datetime.now(UTC).isoformat(timespec="seconds"),
                },
                indent=1,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return SubmitResult(request_id)

    def status(self, request_id: str) -> PostStatus:
        if (self.out_dir / f"{request_id}.json").is_file():
            return PostStatus("published", post_url=f"dryrun://{request_id}")
        return PostStatus("not_found")
