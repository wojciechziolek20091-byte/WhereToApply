"""Delete old files the bot no longer needs (settings: `retention`).

- Videos that are finished (`done`, `skipped`, `failed`) for more than `raw_days`:
  the full download in raw/, the per-clip source cuts in work/<video>/render/*/
  and the yt-dlp info.json. Transcripts and captions stay: they are small.
- Clips that are finished (`published`, `rejected`, `qa_rejected`, `skipped`,
  `failed`) for more than `render_days`: the render, its poster frame and the
  contact sheet.

Clips waiting to post are never touched, and neither is a video that still has a
clip being made or checked (the check reads the source cut) or that a worker is
busy with. Everything deleted can be made again: editing a clip fetches its
seconds of the source again.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from clipbot import db, runner
from clipbot.config import RetentionSettings
from clipbot.logging import get_logger
from clipbot.models import DataPaths

log = get_logger(__name__)

VIDEO_FINISHED = ("done", "skipped", "failed")
CLIP_FINISHED = ("published", "rejected", "qa_rejected", "skipped", "failed")
# Clips whose files must stay: waiting to post, or still being made / checked.
CLIP_KEEP = ("qa_passed", "scheduled", "awaiting_approval", "publishing")
CLIP_IN_PROGRESS = ("selected", "rendering", "rendered")
SOURCE_CUT_FILES = ("source.mp4", "source.json")


@dataclass
class CleanupResult:
    videos: list[str] = field(default_factory=list)
    clips: list[str] = field(default_factory=list)
    files: int = 0
    bytes: int = 0

    def summary(self) -> str:
        return (
            f"cleanup: {self.files} file(s), {self.bytes / 1024**2:.1f} MB "
            f"({len(self.videos)} video(s), {len(self.clips)} clip(s))"
        )


def _inside(p: Path, folder: Path) -> bool:
    try:
        return folder.resolve() in p.resolve().parents
    except OSError:
        return False


def _remove(p: Path, res: CleanupResult) -> None:
    try:
        size = p.stat().st_size
        p.unlink()
    except FileNotFoundError:
        return
    except OSError as e:
        log.warning("cleanup_unlink_failed", path=str(p), error=str(e))
        return
    res.files += 1
    res.bytes += size


def _placeholders(items: tuple[str, ...]) -> str:
    return ", ".join("?" * len(items))


def clean_videos(
    conn: sqlite3.Connection, paths: DataPaths, cutoff: datetime, res: CleanupResult
) -> None:
    busy = db.claimed_videos(conn) | runner.running()
    rows = conn.execute(
        f"SELECT id, raw_path FROM videos WHERE state IN ({_placeholders(VIDEO_FINISHED)}) "
        "AND state_changed_at < ? AND NOT EXISTS (SELECT 1 FROM clips c WHERE "
        f"c.video_id = videos.id AND c.state IN ({_placeholders(CLIP_IN_PROGRESS)}))",
        (*VIDEO_FINISHED, db.iso(cutoff), *CLIP_IN_PROGRESS),
    ).fetchall()
    for v in rows:
        vid = v["id"]
        if vid in busy:
            continue
        before = res.files
        targets = [paths.raw_video(vid)]
        if v["raw_path"] and _inside(Path(v["raw_path"]), paths.raw):
            targets.append(Path(v["raw_path"]))
        work = paths.work_dir(vid)
        targets.append(work / "info.json")
        for name in SOURCE_CUT_FILES:
            targets += sorted((work / "render").glob(f"*/{name}"))
        for p in dict.fromkeys(targets):  # unique, in order
            _remove(p, res)
        if v["raw_path"] or res.files > before:
            with db.tx(conn):
                conn.execute("UPDATE videos SET raw_path = NULL WHERE id = ?", (vid,))
            res.videos.append(vid)


def clean_clips(
    conn: sqlite3.Connection, paths: DataPaths, cutoff: datetime, res: CleanupResult
) -> None:
    rows = conn.execute(
        "SELECT id, render_path, contact_sheet_path FROM clips "
        f"WHERE state IN ({_placeholders(CLIP_FINISHED)}) AND state_changed_at < ?",
        (*CLIP_FINISHED, db.iso(cutoff)),
    ).fetchall()
    for c in rows:
        cid = c["id"]
        before = res.files
        render = paths.render(cid)
        targets = [render, render.with_suffix(".poster.jpg"), paths.contact_sheet(cid)]
        for col in ("render_path", "contact_sheet_path"):
            if c[col] and _inside(Path(c[col]), paths.renders):
                p = Path(c[col])
                targets += [p, p.with_suffix(".poster.jpg")] if col == "render_path" else [p]
        for p in dict.fromkeys(targets):
            _remove(p, res)
        if c["render_path"] or c["contact_sheet_path"] or res.files > before:
            with db.tx(conn):
                # The state check keeps a clip revived meanwhile (e.g. "Post anyway").
                conn.execute(
                    "UPDATE clips SET render_path = NULL, contact_sheet_path = NULL "
                    f"WHERE id = ? AND state IN ({_placeholders(CLIP_FINISHED)})",
                    (cid, *CLIP_FINISHED),
                )
            res.clips.append(cid)


def cleanup(
    conn: sqlite3.Connection,
    paths: DataPaths,
    retention: RetentionSettings,
    now: datetime | None = None,
) -> CleanupResult:
    now = now or db.utcnow()
    res = CleanupResult()
    clean_videos(conn, paths, now - timedelta(days=retention.raw_days), res)
    clean_clips(conn, paths, now - timedelta(days=retention.render_days), res)
    if res.files or res.videos or res.clips:
        with db.tx(conn):
            db.log_event(
                conn,
                "cleanup",
                res.summary(),
                data={"videos": res.videos, "clips": res.clips, "bytes": res.bytes},
            )
    return res
