"""SQLite state store.

Rules from the brief, section 6:
- Each stage reads its input state, writes its files, then flips state in one
  transaction (`transition` below refuses a flip from an unexpected state).
- Rows stuck in a transient state for more than 30 minutes go back to the state
  they came from on startup. `publishing` is excluded here: the poster resolves it
  by polling the stored request_id first, so a restart never double posts.
- One process at a time, enforced with an exclusive lock file.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

# --------------------------------------------------------------------------- states

VIDEO_STATES = frozenset(
    {
        "discovered",
        "acquiring",
        "acquired",
        "transcribing",
        "transcribed",
        "selecting",
        "selected",
        "done",
        "skipped",
        "acquire_failed",
        "failed",
    }
)
CLIP_STATES = frozenset(
    {
        "selected",
        "rendering",
        "rendered",
        "qa_passed",
        "awaiting_approval",
        "scheduled",
        "publishing",
        "published",
        "qa_rejected",
        "rejected",
        "failed",
        "skipped",
    }
)
# Transient states that startup recovery may roll back. `publishing` is deliberately
# absent: see module docstring.
VIDEO_TRANSIENT = frozenset({"acquiring", "transcribing", "selecting"})
CLIP_TRANSIENT = frozenset({"rendering"})
STUCK_AFTER = timedelta(minutes=30)

Table = Literal["videos", "clips"]


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        raise ValueError("naive datetime")
    return dt.astimezone(UTC).isoformat(timespec="seconds")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)


# --------------------------------------------------------------------------- migrations

# Append only. Never edit a migration that has shipped; add a new one.
MIGRATIONS: list[str] = [
    # 1: initial schema
    """
    CREATE TABLE sources (
        id                  TEXT PRIMARY KEY,
        youtube_channel_id  TEXT NOT NULL,
        name                TEXT NOT NULL,
        rights              TEXT,
        enabled             INTEGER NOT NULL DEFAULT 1,
        config_json         TEXT NOT NULL DEFAULT '{}',
        updated_at          TEXT NOT NULL
    );

    CREATE TABLE videos (
        id                TEXT PRIMARY KEY,           -- YouTube video id
        source_id         TEXT NOT NULL REFERENCES sources(id),
        title             TEXT,
        channel_title     TEXT,
        published_at      TEXT,
        duration_sec      REAL,
        license           TEXT,                       -- youtube | creativeCommon
        privacy_status    TEXT,
        live_status       TEXT,
        state             TEXT NOT NULL,
        prev_state        TEXT,
        state_reason      TEXT,
        state_changed_at  TEXT NOT NULL,
        attempts          INTEGER NOT NULL DEFAULT 0,
        next_attempt_at   TEXT,
        raw_path          TEXT,
        transcript_path   TEXT,
        meta_json         TEXT NOT NULL DEFAULT '{}',
        cost_usd          REAL NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    );
    CREATE INDEX videos_state ON videos(state);

    CREATE TABLE clips (
        id                  TEXT PRIMARY KEY,         -- sha1(video:start_ms:end_ms)[:16]
        video_id            TEXT NOT NULL REFERENCES videos(id),
        start_ms            INTEGER NOT NULL,
        end_ms              INTEGER NOT NULL,
        score               INTEGER NOT NULL,
        hook                TEXT NOT NULL,
        title               TEXT NOT NULL,
        summary             TEXT NOT NULL,
        hashtags_json       TEXT NOT NULL DEFAULT '[]',
        risk_flags_json     TEXT NOT NULL DEFAULT '[]',
        state               TEXT NOT NULL,
        prev_state          TEXT,
        state_reason        TEXT,
        state_changed_at    TEXT NOT NULL,
        attempts            INTEGER NOT NULL DEFAULT 0,
        next_attempt_at     TEXT,
        render_path         TEXT,
        contact_sheet_path  TEXT,
        qa_json             TEXT,
        post_text           TEXT,
        poster              TEXT,
        request_id          TEXT,
        post_url            TEXT,
        submitted_at        TEXT,
        published_at        TEXT,
        cost_usd            REAL NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        CHECK (end_ms > start_ms)
    );
    CREATE INDEX clips_state ON clips(state);
    CREATE INDEX clips_video ON clips(video_id);
    CREATE INDEX clips_published ON clips(published_at);

    CREATE TABLE events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         TEXT NOT NULL,
        level      TEXT NOT NULL,
        kind       TEXT NOT NULL,
        video_id   TEXT,
        clip_id    TEXT,
        message    TEXT NOT NULL,
        data_json  TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX events_ts ON events(ts);
    CREATE INDEX events_kind ON events(kind, ts);

    CREATE TABLE kv (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    """,
]


def schema_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def migrate(conn: sqlite3.Connection) -> int:
    """Apply pending migrations. Each one runs in its own transaction together with
    the user_version bump, so a crash mid-migration leaves the old version intact."""
    current = schema_version(conn)
    if current > len(MIGRATIONS):
        raise RuntimeError(
            f"database schema v{current} is newer than this code (v{len(MIGRATIONS)})"
        )
    for version in range(current + 1, len(MIGRATIONS) + 1):
        script = MIGRATIONS[version - 1]
        # executescript() commits implicitly, so wrap the whole thing ourselves.
        conn.executescript(f"BEGIN;\n{script}\nPRAGMA user_version = {version};\nCOMMIT;")
    return schema_version(conn)


def connect(path: Path | str) -> sqlite3.Connection:
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # isolation_level=None: we manage transactions explicitly with `tx()`.
    conn = sqlite3.connect(str(path), isolation_level=None, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    if str(path) != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    migrate(conn)
    return conn


@contextmanager
def tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE ... COMMIT, rolling back on any exception."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


# --------------------------------------------------------------------------- state flips


class StateConflict(RuntimeError):
    """The row was not in the expected state. Usually another stage got there first."""


def transition(
    conn: sqlite3.Connection,
    table: Table,
    row_id: str,
    *,
    expect: str | set[str] | frozenset[str],
    to: str,
    reason: str | None = None,
    now: datetime | None = None,
    **fields: Any,
) -> None:
    """Flip `row_id` from one of `expect` to `to`, writing extra `fields` in the same
    statement. Must be called inside `tx()` when combined with other writes."""
    valid = VIDEO_STATES if table == "videos" else CLIP_STATES
    if to not in valid:
        raise ValueError(f"unknown {table} state {to!r}")
    expected = {expect} if isinstance(expect, str) else set(expect)
    now_s = iso(now or utcnow())
    cols = {
        "state": to,
        "state_reason": reason,
        "state_changed_at": now_s,
        "updated_at": now_s,
        **fields,
    }
    for c in cols:
        if not c.isidentifier():
            raise ValueError(f"bad column {c!r}")
    sets = ", ".join(f"{c} = :{c}" for c in cols)
    placeholders = ", ".join(f":_e{i}" for i in range(len(expected)))
    params = {**cols, "_id": row_id, **{f"_e{i}": s for i, s in enumerate(sorted(expected))}}
    # prev_state records where we came from, so recovery can roll back.
    sql = (
        f"UPDATE {table} SET prev_state = state, {sets} "
        f"WHERE id = :_id AND state IN ({placeholders})"
    )
    cur = conn.execute(sql, params)
    if cur.rowcount != 1:
        row = conn.execute(f"SELECT state FROM {table} WHERE id = ?", (row_id,)).fetchone()
        actual = row["state"] if row else "missing"
        raise StateConflict(f"{table}/{row_id}: expected {sorted(expected)}, found {actual}")


def recover_stuck(conn: sqlite3.Connection, now: datetime | None = None) -> list[tuple[str, str]]:
    """Roll rows stuck in transient states back to their previous state.
    Returns [(table, id)] of recovered rows."""
    now = now or utcnow()
    cutoff = iso(now - STUCK_AFTER)
    recovered: list[tuple[str, str]] = []
    with tx(conn):
        for table, states in (("videos", VIDEO_TRANSIENT), ("clips", CLIP_TRANSIENT)):
            marks = ",".join("?" * len(states))
            rows = conn.execute(
                f"SELECT id, state, prev_state FROM {table} "
                f"WHERE state IN ({marks}) AND state_changed_at < ?",
                (*sorted(states), cutoff),
            ).fetchall()
            for r in rows:
                back = r["prev_state"]
                if not back:
                    continue
                conn.execute(
                    f"UPDATE {table} SET state = ?, prev_state = ?, state_reason = ?, "
                    f"state_changed_at = ?, updated_at = ? WHERE id = ?",
                    (
                        back,
                        r["state"],
                        f"recovered from stuck {r['state']}",
                        iso(now),
                        iso(now),
                        r["id"],
                    ),
                )
                recovered.append((table, r["id"]))
    return recovered


# --------------------------------------------------------------------------- kv


def kv_get(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def kv_set(conn: sqlite3.Connection, key: str, value: str | None) -> None:
    if value is None:
        conn.execute("DELETE FROM kv WHERE key = ?", (key,))
        return
    conn.execute(
        "INSERT INTO kv(key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, iso(utcnow())),
    )


@dataclass(frozen=True)
class PauseState:
    paused: bool
    reason: str | None
    until: datetime | None


def get_pause(conn: sqlite3.Connection, now: datetime | None = None) -> PauseState:
    if kv_get(conn, "paused") != "1":
        return PauseState(False, None, None)
    until_s = kv_get(conn, "pause_until")
    until = parse_iso(until_s) if until_s else None
    if until is not None and (now or utcnow()) >= until:
        return PauseState(False, None, None)  # timed pause has lapsed
    return PauseState(True, kv_get(conn, "pause_reason"), until)


def set_pause(conn: sqlite3.Connection, reason: str, until: datetime | None = None) -> None:
    with tx(conn):
        set_pause_in_tx(conn, reason, until)


def set_pause_in_tx(conn: sqlite3.Connection, reason: str, until: datetime | None) -> None:
    """set_pause for callers already inside a transaction."""
    kv_set(conn, "paused", "1")
    kv_set(conn, "pause_reason", reason)
    kv_set(conn, "pause_until", iso(until) if until else None)


def clear_pause(conn: sqlite3.Connection) -> None:
    with tx(conn):
        kv_set(conn, "paused", None)
        kv_set(conn, "pause_reason", None)
        kv_set(conn, "pause_until", None)
        kv_set(conn, "consecutive_failures", "0")


# --------------------------------------------------------------------------- events


def log_event(
    conn: sqlite3.Connection,
    kind: str,
    message: str,
    *,
    level: str = "info",
    video_id: str | None = None,
    clip_id: str | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        "INSERT INTO events(ts, level, kind, video_id, clip_id, message, data_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            iso(utcnow()),
            level,
            kind,
            video_id,
            clip_id,
            message,
            json.dumps(data or {}, default=str, sort_keys=True),
        ),
    )


# --------------------------------------------------------------------------- sources


def sync_sources(conn: sqlite3.Connection, sources: list[Any]) -> None:
    """Mirror sources.yaml into the sources table (videos reference it)."""
    now = iso(utcnow())
    with tx(conn):
        for s in sources:
            conn.execute(
                "INSERT INTO sources(id, youtube_channel_id, name, rights, enabled, config_json, "
                "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET youtube_channel_id = excluded.youtube_channel_id, "
                "name = excluded.name, rights = excluded.rights, enabled = excluded.enabled, "
                "config_json = excluded.config_json, updated_at = excluded.updated_at",
                (
                    s.id,
                    s.youtube_channel_id,
                    s.name,
                    s.rights,
                    int(s.enabled),
                    s.model_dump_json(),
                    now,
                ),
            )
        ids = [s.id for s in sources]
        if ids:
            marks = ",".join("?" * len(ids))
            conn.execute(f"UPDATE sources SET enabled = 0 WHERE id NOT IN ({marks})", ids)


def state_counts(conn: sqlite3.Connection, table: Table) -> dict[str, int]:
    rows = conn.execute(f"SELECT state, COUNT(*) AS n FROM {table} GROUP BY state").fetchall()
    return {r["state"]: r["n"] for r in rows}


# --------------------------------------------------------------------------- process lock


class LockHeld(RuntimeError):
    pass


def _lock_fd(fd: int) -> None:
    """Exclusive, non-blocking OS lock on an open file. Raises BlockingIOError if
    another process holds it. The OS drops it when the process dies, so a crash
    never leaves a stale lock behind."""
    if sys.platform == "win32":
        import msvcrt

        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            raise BlockingIOError from None
    else:
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_fd(fd: int) -> None:
    if sys.platform == "win32":
        import msvcrt

        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_UN)


class ProcessLock:
    """One clipbot process at a time, on Linux, macOS and Windows."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._fd: int | None = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
        try:
            _lock_fd(fd)
        except BlockingIOError:
            os.close(fd)
            raise LockHeld(f"another clipbot process holds {self.path}") from None
        # Record the owner's pid after the lock byte (Windows locks byte 0).
        os.lseek(fd, 1, os.SEEK_SET)
        os.write(fd, str(os.getpid()).encode().ljust(16))
        self._fd = fd

    def release(self) -> None:
        if self._fd is not None:
            _unlock_fd(self._fd)
            os.close(self._fd)
            self._fd = None

    def __enter__(self) -> ProcessLock:
        self.acquire()
        return self

    def __exit__(self, *exc: object) -> None:
        self.release()
