"""Numbers for the home page: TikTok views and posting counts.

Views come from each posted clip's public TikTok page (the play count TikTok
shows to anyone), read a few clips at a time, every few hours per clip, with a
pause between requests. Every reading is kept, so "net views this month" is what
the clips gained since the month began: the latest reading minus the last one
before the 1st (zero for clips posted this month).
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from datetime import datetime, timedelta
from typing import Any

from clipbot import db
from clipbot.logging import get_logger

log = get_logger(__name__)

STALE_AFTER = timedelta(hours=3)  # read a clip's views again after this
TRACK_FOR = timedelta(days=90)  # stop reading clips posted longer ago
_ID = re.compile(r"tiktok\.com/.*?/video/(\d{8,})")
_DATA = re.compile(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', re.S)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)


def tiktok_video_id(url: str | None) -> str | None:
    m = _ID.search(url or "")
    return m.group(1) if m else None


def parse_play_count(html: str) -> int | None:
    """The play count from a TikTok video page, or None if it is not there."""
    m = _DATA.search(html)
    if m:
        try:
            data = json.loads(m.group(1))
            item = data["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"]
            return int(item["stats"]["playCount"])
        except (ValueError, KeyError, TypeError):
            pass
    m = re.search(r'"playCount":(\d+)', html)
    return int(m.group(1)) if m else None


def fetch_views(video_id: str, http: Any = None) -> int | None:
    import httpx

    client = http or httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": UA})
    try:
        r = client.get(f"https://www.tiktok.com/@_/video/{video_id}")
        r.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("views_fetch_failed", video_id=video_id, error=str(e)[:200])
        return None
    return parse_play_count(r.text)


def clip_ids(row: Any) -> list[str]:
    """TikTok video ids of one clip: one per account it was posted to."""
    ids = []
    try:
        for p in json.loads(row["post_urls"] or "[]"):
            vid = tiktok_video_id(p.get("url"))
            if vid and vid not in ids:
                ids.append(vid)
    except (ValueError, TypeError, AttributeError, IndexError, KeyError):
        pass
    first = tiktok_video_id(row["post_url"])
    if first and first not in ids:
        ids.insert(0, first)
    return ids


def clip_views_now(row: Any, fetch: Any = None) -> int | None:
    """A clip's views summed over every account, or None if none could be read."""
    counts = [(fetch or fetch_views)(v) for v in clip_ids(row)]
    known = [c for c in counts if c is not None]
    return sum(known) if known else None


def refresh_views(
    conn: sqlite3.Connection,
    now: datetime,
    limit: int = 5,
    fetch: Any = fetch_views,
    pause_s: float = 2.0,
) -> int:
    """Read the views of up to `limit` posted clips whose reading is oldest."""
    rows = conn.execute(
        "SELECT id, post_url, post_urls FROM clips WHERE state = 'published' AND post_url LIKE "
        "'%tiktok.com/%/video/%' AND published_at >= ? AND (views_at IS NULL OR views_at < ?) "
        "ORDER BY views_at IS NOT NULL, views_at LIMIT ?",
        (db.iso(now - TRACK_FOR), db.iso(now - STALE_AFTER), limit),
    ).fetchall()
    done = 0
    for i, r in enumerate(rows):
        if i:
            time.sleep(pause_s)
        views = clip_views_now(r, fetch)
        with db.tx(conn):
            conn.execute(
                "UPDATE clips SET views_at = ?"
                + (", views = ?" if views is not None else "")
                + " WHERE id = ?",
                (db.iso(now), views, r["id"]) if views is not None else (db.iso(now), r["id"]),
            )
            if views is not None:
                conn.execute(
                    "INSERT INTO clip_views(clip_id, ts, views) VALUES (?, ?, ?)",
                    (r["id"], db.iso(now), views),
                )
                done += 1
    return done


def month_start(now: datetime, tz: Any) -> datetime:
    local = now.astimezone(tz)
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def net_views(conn: sqlite3.Connection, since: datetime, until: datetime | None = None) -> int:
    """Views all clips gained between `since` and `until` (now when None)."""
    end = db.iso(until) if until else "9999"
    total = 0
    for r in conn.execute("SELECT DISTINCT clip_id FROM clip_views WHERE ts < ?", (end,)):
        last = conn.execute(
            "SELECT views FROM clip_views WHERE clip_id = ? AND ts < ? ORDER BY ts DESC LIMIT 1",
            (r["clip_id"], end),
        ).fetchone()
        before = conn.execute(
            "SELECT views FROM clip_views WHERE clip_id = ? AND ts < ? ORDER BY ts DESC LIMIT 1",
            (r["clip_id"], db.iso(since)),
        ).fetchone()
        total += max(0, last["views"] - (before["views"] if before else 0))
    return total


def home_stats(conn: sqlite3.Connection, now: datetime, tz: Any) -> dict[str, Any]:
    start = month_start(now, tz)
    prev = month_start(start - timedelta(days=1), tz)
    posted = conn.execute(
        "SELECT COUNT(*) FROM clips WHERE state = 'published' AND published_at >= ?",
        (db.iso(start),),
    ).fetchone()[0]
    posted_prev = conn.execute(
        "SELECT COUNT(*) FROM clips WHERE state = 'published' AND published_at >= ? "
        "AND published_at < ?",
        (db.iso(prev), db.iso(start)),
    ).fetchone()[0]
    tracked = conn.execute(
        "SELECT COUNT(*) FROM clips WHERE state = 'published' AND post_url LIKE "
        "'%tiktok.com/%/video/%'"
    ).fetchone()[0]
    views = net_views(conn, start)
    views_prev = net_views(conn, prev, start)
    last_read = conn.execute("SELECT MAX(views_at) FROM clips").fetchone()[0]
    return {
        "month": start.strftime("%B"),
        "views": views,
        "views_prev": views_prev,
        "posted": posted,
        "posted_prev": posted_prev,
        "per_post": round(views / posted) if posted else None,
        "tracked": tracked,
        "views_read_at": db.parse_iso(last_read) if last_read else None,
    }


def compact(n: int | None) -> str:
    """1234 -> 1 234, 12345 -> 12.3K, 1250000 -> 1.25M."""
    if n is None:
        return "-"
    if n < 10_000:
        return f"{n:,}".replace(",", "\u202f")
    if n < 1_000_000:
        return f"{n / 1000:.1f}".rstrip("0").rstrip(".") + "K"
    return f"{n / 1_000_000:.2f}".rstrip("0").rstrip(".") + "M"
