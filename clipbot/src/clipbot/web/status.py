"""Read-only views of the bot's state for the dashboard."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from clipbot import db
from clipbot.config import POSTS_PER_DAY_CEILING, Settings
from clipbot.models import DataPaths

POSTED = ("publishing", "published")
HEARTBEAT_STALE = timedelta(minutes=3)

# How each state is shown to a person.
CLIP_TABS: dict[str, tuple[str, tuple[str, ...]]] = {
    "ready": ("Ready to post", ("qa_passed", "scheduled", "publishing")),
    "review": ("Waiting for you", ("awaiting_approval",)),
    "posted": ("Posted", ("published",)),
    "working": ("Being made", ("selected", "rendering", "rendered")),
    "rejected": ("Not posted", ("qa_rejected", "rejected", "failed", "skipped")),
}
STATE_LABEL = {
    "discovered": "queued",
    "acquiring": "downloading",
    "acquired": "downloaded",
    "acquire_failed": "download failed, will retry",
    "transcribing": "transcribing",
    "transcribed": "transcribed",
    "selecting": "picking clips",
    "selected": "making clips",
    "done": "done",
    "skipped": "skipped",
    "failed": "failed",
    "rendering": "rendering",
    "rendered": "checking",
    "qa_passed": "ready",
    "qa_rejected": "failed checks",
    "awaiting_approval": "waiting for you",
    "scheduled": "queued to post",
    "publishing": "posting",
    "published": "posted",
    "rejected": "not posted",
}


def bot_state(conn: sqlite3.Connection, paths: DataPaths, now: datetime) -> dict[str, Any]:
    beat = db.kv_get(conn, "last_tick_at")
    alive = bool(beat) and now - db.parse_iso(beat) < HEARTBEAT_STALE
    pause = db.get_pause(conn, now)
    file_pause = paths.pause_file.exists()
    return {
        "running": alive,
        "last_tick": db.parse_iso(beat) if beat else None,
        "paused": pause.paused or file_pause,
        "pause_reason": pause.reason or ("PAUSE file in the data folder" if file_pause else ""),
        "pause_until": pause.until,
        "pause_file": file_pause,
    }


def _window_starts(s: Settings, day: datetime) -> list[datetime]:
    return [
        day.replace(hour=w.start.hour, minute=w.start.minute, second=0, microsecond=0)
        for w in s.publish.windows
    ]


def in_window(s: Settings, t: datetime) -> bool:
    lt = t.astimezone(s.tz).time()
    return any(w.contains(lt) for w in s.publish.windows)


def next_post_time(conn: sqlite3.Connection, s: Settings, now: datetime) -> tuple[datetime, str]:
    """Earliest moment the scheduler may post again, and what it is waiting for."""
    limit = min(s.publish.posts_per_day, POSTS_PER_DAY_CEILING)
    since = db.iso(now - timedelta(hours=24))
    recent = [
        db.parse_iso(r[0])
        for r in conn.execute(
            f"SELECT submitted_at FROM clips WHERE state IN {POSTED} AND submitted_at >= ? "
            "ORDER BY submitted_at",
            (since,),
        )
    ]
    t, why = now, "a posting window"
    if len(recent) >= limit:
        free_at = recent[len(recent) - limit] + timedelta(hours=24, seconds=1)
        if free_at > t:
            t, why = free_at, f"the daily limit of {limit}"
    if recent:
        gap_end = recent[-1] + timedelta(minutes=s.publish.min_gap_minutes)
        if gap_end > t:
            t, why = gap_end, f"the {s.publish.min_gap_minutes}-minute gap"
    if in_window(s, t):
        return t, why if t > now else "now"
    local = t.astimezone(s.tz)
    for day in range(0, 3):
        base = (local + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
        for st in sorted(_window_starts(s, base)):
            if st > local:
                return st, "the next posting window"
    return t, why


def counts(conn: sqlite3.Connection, table: str) -> dict[str, int]:
    return dict(conn.execute(f"SELECT state, COUNT(*) FROM {table} GROUP BY state").fetchall())


# Plain-English activity lines. Internal bookkeeping events are not shown.
_EVENT_TITLE = {
    "discover": "Video found",
    "acquire": "Downloaded",
    "acquire_failed": "Download failed",
    "transcribe": "Transcribed",
    "select": "Clips picked",
    "render": "Clip made",
    "qa": "Checks",
    "publish_submit": "Sent to TikTok",
    "published": "Posted",
    "publish_error": "Posting problem",
    "pause": "Paused",
    "resume": "Resumed",
    "review": "Reviewed",
    "digest": "Daily summary sent",
}
_HIDDEN = ("llm_call", "discover_error")


def _event_text(kind: str, message: str) -> tuple[str, str]:
    title = _EVENT_TITLE.get(kind, kind.replace("_", " ").capitalize())
    if kind in ("render", "acquire", "transcribe", "digest", "resume"):
        return title, ""
    if kind == "qa":
        passed = message.startswith("qa_passed")
        return (
            "Checks passed" if passed else "Checks failed",
            "" if passed else message.split(": ", 1)[-1],
        )
    if kind == "publish_submit":
        return ("Dry-run post" if "dryrun" in message else title), ""
    if kind == "published":
        return title, message if message.startswith("http") else ""
    if kind == "discover":
        state, _, why = message.partition(": ")
        return ("Video accepted" if state == "discovered" else "Video skipped"), why
    if kind == "pause":
        return title, message.removeprefix("paused: ")
    return title, message


def recent_events(conn: sqlite3.Connection, limit: int = 12) -> list[dict[str, Any]]:
    marks = ",".join("?" * len(_HIDDEN))
    rows = conn.execute(
        "SELECT ts, level, kind, message, video_id, clip_id FROM events "
        f"WHERE kind NOT IN ({marks}) ORDER BY id DESC LIMIT ?",
        (*_HIDDEN, limit),
    )
    out = []
    for r in rows:
        title, detail = _event_text(r["kind"], r["message"])
        out.append(dict(r) | {"ts": db.parse_iso(r["ts"]), "title": title, "detail": detail})
    return out


@dataclass
class ClipView:
    id: str
    video_id: str
    video_title: str
    state: str
    label: str
    reason: str
    score: int
    hook: str
    title: str
    caption: str
    start: float
    end: float
    has_video: bool
    has_sheet: bool
    post_url: str | None
    qa: dict[str, Any]
    updated: datetime

    @property
    def length(self) -> float:
        return self.end - self.start


def clip_views(
    conn: sqlite3.Connection, states: tuple[str, ...], limit: int = 60
) -> list[ClipView]:
    marks = ",".join("?" * len(states))
    rows = conn.execute(
        f"SELECT c.*, v.title AS video_title FROM clips c JOIN videos v ON v.id = c.video_id "
        f"WHERE c.state IN ({marks}) ORDER BY c.updated_at DESC LIMIT ?",
        (*states, limit),
    )
    out = []
    from pathlib import Path

    for r in rows:
        out.append(
            ClipView(
                id=r["id"],
                video_id=r["video_id"],
                video_title=r["video_title"] or r["video_id"],
                state=r["state"],
                label=STATE_LABEL.get(r["state"], r["state"]),
                reason=r["state_reason"] or "",
                score=r["score"],
                hook=r["hook"],
                title=r["title"],
                caption=r["post_text"] or "",
                start=r["start_ms"] / 1000,
                end=r["end_ms"] / 1000,
                has_video=bool(r["render_path"]) and Path(r["render_path"]).is_file(),
                has_sheet=bool(r["contact_sheet_path"]) and Path(r["contact_sheet_path"]).is_file(),
                post_url=r["post_url"] if (r["post_url"] or "").startswith("http") else None,
                qa=json.loads(r["qa_json"]) if r["qa_json"] else {},
                updated=db.parse_iso(r["updated_at"]),
            )
        )
    return out


def video_rows(conn: sqlite3.Connection, limit: int = 100) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT v.id, v.title, v.channel_title, v.state, v.state_reason, v.duration_sec, "
        "v.license, v.updated_at, COUNT(c.id) AS clips, SUM(c.state = 'published') AS posted "
        "FROM videos v LEFT JOIN clips c ON c.video_id = v.id GROUP BY v.id "
        "ORDER BY v.created_at DESC LIMIT ?",
        (limit,),
    )
    return [
        dict(r)
        | {
            "label": STATE_LABEL.get(r["state"], r["state"]),
            "updated": db.parse_iso(r["updated_at"]),
        }
        for r in rows
    ]


def ago(t: datetime | None, now: datetime) -> str:
    if t is None:
        return "never"
    s = (now - t).total_seconds()
    if s < 0:
        s = -s
        unit = f"{s:.0f} s" if s < 90 else f"{s / 60:.0f} min" if s < 5400 else f"{s / 3600:.1f} h"
        return f"in {unit}"
    if s < 90:
        return f"{s:.0f} s ago"
    if s < 5400:
        return f"{s / 60:.0f} min ago"
    if s < 172800:
        return f"{s / 3600:.1f} h ago"
    return f"{s / 86400:.0f} days ago"
