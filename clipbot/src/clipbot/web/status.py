"""Read-only views of the bot's state for the dashboard."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from clipbot import db
from clipbot.config import POSTS_PER_DAY_CEILING, Settings
from clipbot.models import DataPaths

POSTED = ("publishing", "published")
HEARTBEAT_STALE = timedelta(minutes=3)

# How each state is shown to a person.
CLIP_TABS: dict[str, tuple[str, tuple[str, ...]]] = {
    "ready": ("Queue", ("qa_passed", "scheduled", "publishing")),
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


def posting_queue(
    conn: sqlite3.Connection, s: Settings, now: datetime, paused_until: datetime | None = None
) -> list[dict[str, Any]]:
    """Every clip that will post, in the order the bot posts them, each with an
    estimated time and what it waits for, from the same rules the bot uses
    (posting.py): Send now first, then Deploy all, then approved clips, then
    (unless every post needs approval) ready clips by score; windows take more
    clips at once while the queue is long. `paused_until`: times start then."""
    from clipbot import posting

    posts = [
        db.parse_iso(r[0])
        for r in conn.execute(
            f"SELECT submitted_at FROM clips WHERE state IN {POSTED} AND submitted_at IS NOT NULL "
            "ORDER BY submitted_at"
        )
    ]
    base = "SELECT c.*, v.title AS video_title FROM clips c JOIN videos v ON v.id = c.video_id "
    rows = conn.execute(base + "WHERE c.state = 'publishing'").fetchall()
    rows += conn.execute(
        base + "WHERE c.state = 'scheduled' "
        "ORDER BY c.post_now DESC, c.deploy_at IS NULL, c.deploy_at, c.score DESC"
    ).fetchall()
    hold = s.review_mode == "hold"
    rows += conn.execute(
        base + "WHERE c.state = 'qa_passed' ORDER BY c.score DESC, c.created_at"
    ).fetchall()
    queued = sum(
        1 for r in rows if r["state"] == "scheduled" or (r["state"] == "qa_passed" and not hold)
    )
    t = max(now, paused_until) if paused_until else now
    out: list[dict[str, Any]] = []
    for r in rows:
        kind = "now" if r["post_now"] else "deployed" if r["deploy_at"] else "window"
        item: dict[str, Any] = {
            "id": r["id"],
            "video_id": r["video_id"],
            "hook": r["hook"],
            "video_title": r["video_title"] or r["video_id"],
            "length": (r["end_ms"] - r["start_ms"]) / 1000,
            "score": r["score"],
            "state": r["state"],
            "kind": kind,
            "deployed": bool(r["deploy_at"]),
            "has_video": bool(r["render_path"]) and Path(r["render_path"]).is_file(),
            "eta": None,
            "why": "",
        }
        out.append(item)
        if r["state"] == "publishing":
            item["why"] = "posting now"
            continue
        if r["state"] == "qa_passed" and hold:
            item["why"] = "waits for your approval first"
            continue
        start = t
        if r["next_attempt_at"] and db.parse_iso(r["next_attempt_at"]) > start:
            start = db.parse_iso(r["next_attempt_at"])
        x, why = posting.earliest(s, start, posts, max(queued, 1), kind)
        if paused_until and x == t:
            why = "after the pause"
        elif kind == "now" and x == t:
            why = "sent now"
        item["eta"], item["why"] = x, why
        if x is not None:
            posts.append(x)
            t = x
            queued -= 1
    return out


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
    views: int | None = None
    edited: bool = False
    deployed: bool = False
    post_now: bool = False

    @property
    def length(self) -> float:
        return self.end - self.start


def clip_views(
    conn: sqlite3.Connection,
    states: tuple[str, ...],
    limit: int = 60,
    video_id: str | None = None,
) -> list[ClipView]:
    marks = ",".join("?" * len(states))
    where = f"c.state IN ({marks})" + (" AND c.video_id = ?" if video_id else "")
    rows = conn.execute(
        f"SELECT c.*, v.title AS video_title FROM clips c JOIN videos v ON v.id = c.video_id "
        f"WHERE {where} ORDER BY c.score DESC, c.updated_at DESC LIMIT ?",
        (*states, *([video_id] if video_id else []), limit),
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
                views=r["views"],
                edited=bool(r["edit_json"]),
                deployed=bool(r["deploy_at"]),
                post_now=bool(r["post_now"]),
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


# --------------------------------------------------------------------------- progress

STAGES = ("Queued", "Getting video", "Transcribing", "Picking clips", "Making clips", "Checking")
_STAGE_OF = {
    "discovered": 0,
    "acquiring": 1,
    "acquire_failed": 1,
    "acquired": 2,
    "transcribing": 2,
    "transcribed": 3,
    "selecting": 3,
}
FINISHED = ("done", "skipped", "failed")
SHOW_FINISHED_FOR = timedelta(hours=2)
_UNRENDERED = ("selected", "rendering")
_UNCHECKED = (*_UNRENDERED, "rendered")
_GOOD = ("qa_passed", "scheduled", "publishing", "published", "awaiting_approval")


def _friendly_wait(state: str, reason: str) -> str:
    if state == "transcribed" and "used up" in reason:
        return "Today's free AI requests are used up"
    if state == "transcribed" and "no free model" in reason:
        return "The free AI models are busy"
    if state == "acquire_failed":
        return "The download did not work"
    return reason.split(" (")[0][:140] if reason else "Waiting"


def progress(conn: sqlite3.Connection, now: datetime, limit: int = 4) -> list[dict[str, Any]]:
    """Videos being clipped right now, plus ones that finished in the last two
    hours, each with its stage, clip counts and any wait or failure reason."""
    since = db.iso(now - SHOW_FINISHED_FOR)
    rows = conn.execute(
        "SELECT id, title, channel_title, state, state_reason, next_attempt_at, meta_json, "
        "state_changed_at FROM videos "
        f"WHERE state NOT IN {FINISHED} OR state_changed_at >= ? "
        "ORDER BY created_at DESC LIMIT ?",
        (since, limit),
    ).fetchall()
    out = []
    paused = db.get_pause(conn, now).paused
    for r in rows:
        meta = json.loads(r["meta_json"] or "{}")
        # A re-sent link starts a new round: count only that round's clips.
        clips = conn.execute(
            "SELECT state, COUNT(*) AS n FROM clips WHERE video_id = ? AND created_at >= ? "
            "GROUP BY state",
            (r["id"], meta.get("round_since", "")),
        ).fetchall()
        by = {c["state"]: c["n"] for c in clips}
        total = sum(by.values())
        rendered = total - sum(by.get(s, 0) for s in _UNRENDERED)
        checked = total - sum(by.get(s, 0) for s in _UNCHECKED)
        good = sum(by.get(s, 0) for s in _GOOD)
        state, reason = r["state"], r["state_reason"] or ""
        item: dict[str, Any] = {
            "id": r["id"],
            "title": r["title"] or r["id"],
            "channel": r["channel_title"] or "",
            "requested": meta.get("clip_count"),
            "round": int(meta.get("round", 1)),
            "total": total,
            "good": good,
            "outcome": None,
            "detail": "",
            "wait": "",
            "retry_at": None,
        }
        if state in FINISHED:
            item["stage"] = len(STAGES)
            if state == "done" and good:
                item["outcome"] = "ready"
                item["detail"] = f"{good} clip{'' if good == 1 else 's'} ready"
                item["clips"] = [
                    {"id": c["id"], "hook": c["hook"], "state": c["state"],
                     "length": (c["end_ms"] - c["start_ms"]) / 1000}
                    for c in conn.execute(
                        "SELECT id, hook, state, start_ms, end_ms FROM clips WHERE video_id = ? "
                        "AND created_at >= ? AND state IN ('qa_passed', 'awaiting_approval', "
                        "'scheduled', 'publishing', 'published') ORDER BY score DESC",
                        (r["id"], meta.get("round_since", "")),
                    )
                ]  # fmt: skip
                item["deployable"] = sum(
                    1 for c in item["clips"] if c["state"] in ("qa_passed", "awaiting_approval")
                )
                item["deployed"] = conn.execute(
                    "SELECT COUNT(*) FROM clips WHERE video_id = ? AND state = 'scheduled' "
                    "AND deploy_at IS NOT NULL",
                    (r["id"],),
                ).fetchone()[0]
            elif state == "done":
                item["outcome"] = "none"
                item["detail"] = (
                    f"No clip passed the checks ({total} made)"
                    if total
                    else "No new moment worth clipping was found"
                    if item["round"] > 1
                    else "The AI found no moment worth clipping"
                )
            else:
                item["outcome"] = "failed"
                item["detail"] = reason[:200] or STATE_LABEL.get(state, state)
        elif state == "selected":
            if rendered < total:
                item["stage"] = 4
                item["detail"] = f"{rendered} of {total} made"
            else:
                item["stage"] = 5
                item["detail"] = f"{checked} of {total} checked"
        else:
            item["stage"] = _STAGE_OF.get(state, 0)
            if state == "transcribing":
                pct = db.kv_get(conn, f"progress:{r['id']}")
                item["detail"] = f"{pct}% done" if pct else ""
        retry = db.parse_iso(r["next_attempt_at"]) if r["next_attempt_at"] else None
        if state not in FINISHED and retry is not None and retry > now:
            item["wait"] = _friendly_wait(state, reason)
            item["retry_at"] = retry
        elif state == "selected":
            waiting = conn.execute(
                "SELECT state_reason, MIN(next_attempt_at) AS at FROM clips WHERE video_id = ? "
                "AND state IN ('selected', 'rendered') AND next_attempt_at > ?",
                (r["id"], db.iso(now)),
            ).fetchone()
            if waiting and waiting["at"]:
                why = waiting["state_reason"] or ""
                item["wait"] = (
                    "Today's free AI requests are used up"
                    if "used up" in why
                    else "Waiting for a free AI model"
                )
                item["retry_at"] = db.parse_iso(waiting["at"])
            elif paused:
                item["wait"] = "The bot is paused. Press Resume to continue"
        elif state not in FINISHED and paused:
            item["wait"] = "The bot is paused. Press Resume to continue"
        out.append(item)
    return out
