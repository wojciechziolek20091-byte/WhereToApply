from __future__ import annotations

import multiprocessing
from datetime import timedelta
from pathlib import Path

import pytest

from clipbot import db


def _conn(tmp_path: Path):
    return db.connect(tmp_path / "t.sqlite3")


def _add_source(conn) -> None:
    conn.execute(
        "INSERT INTO sources(id, youtube_channel_id, name, rights, updated_at) "
        "VALUES ('s', 'UCabcdefghijklmnopqrstuv', 'S', 'own', ?)",
        (db.iso(db.utcnow()),),
    )


def _add_video(conn, vid: str = "v1", state: str = "discovered", at=None) -> None:
    now = db.iso(at or db.utcnow())
    conn.execute(
        "INSERT INTO videos(id, source_id, state, state_changed_at, created_at, updated_at) "
        "VALUES (?, 's', ?, ?, ?, ?)",
        (vid, state, now, now, now),
    )


def test_migrate_is_idempotent(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    assert db.schema_version(conn) == len(db.MIGRATIONS)
    assert db.migrate(conn) == len(db.MIGRATIONS)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"sources", "videos", "clips", "events", "kv"} <= tables
    conn.close()
    conn = _conn(tmp_path)  # reopen: no error, same version
    assert db.schema_version(conn) == len(db.MIGRATIONS)


def test_refuses_newer_schema(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    conn.execute(f"PRAGMA user_version = {len(db.MIGRATIONS) + 1}")
    conn.close()
    with pytest.raises(RuntimeError, match="newer than this code"):
        _conn(tmp_path)


def test_transition_and_conflict(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    _add_source(conn)
    _add_video(conn)
    with db.tx(conn):
        db.transition(conn, "videos", "v1", expect="discovered", to="acquiring")
    row = conn.execute("SELECT state, prev_state FROM videos").fetchone()
    assert (row["state"], row["prev_state"]) == ("acquiring", "discovered")

    with pytest.raises(db.StateConflict, match="found acquiring"):
        db.transition(conn, "videos", "v1", expect="discovered", to="acquiring")
    with pytest.raises(ValueError, match="unknown videos state"):
        db.transition(conn, "videos", "v1", expect="acquiring", to="bogus")


def test_transition_rolls_back_with_tx(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    _add_source(conn)
    _add_video(conn)
    with pytest.raises(RuntimeError), db.tx(conn):
        db.transition(conn, "videos", "v1", expect="discovered", to="acquiring")
        raise RuntimeError("crash after the flip")
    assert conn.execute("SELECT state FROM videos").fetchone()[0] == "discovered"


def test_recover_stuck(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    _add_source(conn)
    old = db.utcnow() - timedelta(hours=1)
    _add_video(conn, "stuck")
    _add_video(conn, "fresh")
    with db.tx(conn):
        db.transition(conn, "videos", "stuck", expect="discovered", to="acquiring", now=old)
        db.transition(conn, "videos", "fresh", expect="discovered", to="acquiring")
    recovered = db.recover_stuck(conn)
    assert recovered == [("videos", "stuck")]
    states = dict(conn.execute("SELECT id, state FROM videos").fetchall())
    assert states == {"stuck": "discovered", "fresh": "acquiring"}


def test_recover_leaves_publishing_alone(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    _add_source(conn)
    _add_video(conn)
    old = db.iso(db.utcnow() - timedelta(hours=2))
    conn.execute(
        "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, summary, state, "
        "prev_state, state_changed_at, created_at, updated_at) "
        "VALUES ('c1', 'v1', 0, 30000, 80, 'h', 't', 's', 'publishing', 'scheduled', ?, ?, ?)",
        (old, old, old),
    )
    assert db.recover_stuck(conn) == []
    assert conn.execute("SELECT state FROM clips").fetchone()[0] == "publishing"


def test_kv_and_pause(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    assert db.get_pause(conn).paused is False
    db.set_pause(conn, "spam_risk", until=db.utcnow() + timedelta(hours=24))
    p = db.get_pause(conn)
    assert p.paused and p.reason == "spam_risk" and p.until is not None
    # timed pause lapses on its own
    assert db.get_pause(conn, now=db.utcnow() + timedelta(hours=25)).paused is False
    db.clear_pause(conn)
    assert db.get_pause(conn).paused is False
    assert db.kv_get(conn, "consecutive_failures") == "0"


def test_events(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    db.log_event(conn, "llm_call", "select", data={"tokens": 10})
    row = conn.execute("SELECT kind, data_json FROM events").fetchone()
    assert row["kind"] == "llm_call" and '"tokens": 10' in row["data_json"]


def _try_lock(path: str, q) -> None:
    try:
        db.ProcessLock(Path(path)).acquire()
        q.put("acquired")
    except db.LockHeld:
        q.put("held")


def test_process_lock(tmp_path: Path) -> None:
    lock_path = tmp_path / "clipbot.lock"
    ctx = multiprocessing.get_context("spawn")
    with db.ProcessLock(lock_path):
        q = ctx.Queue()
        p = ctx.Process(target=_try_lock, args=(str(lock_path), q))
        p.start()
        p.join(30)
        assert q.get(timeout=5) == "held"
    # released: a second process can take it
    q = ctx.Queue()
    p = ctx.Process(target=_try_lock, args=(str(lock_path), q))
    p.start()
    p.join(30)
    assert q.get(timeout=5) == "acquired"


def test_many_connections_upgrade_an_old_database_at_once(tmp_path: Path) -> None:
    """After an update, the dashboard, scheduler and workers all open the database
    at once; the schema upgrade must run exactly once and none of them may fail
    (this used to show "Internal Server Error")."""
    import sqlite3
    import threading

    path = tmp_path / "old.sqlite3"
    old = sqlite3.connect(path, isolation_level=None)
    old.executescript(db.MIGRATIONS[0])
    old.execute("PRAGMA user_version = 1")
    old.close()
    go = threading.Barrier(8)
    errors: list[str] = []

    def open_it() -> None:
        go.wait()
        try:
            db.connect(path).close()
        except Exception as e:  # pragma: no cover - the failure being tested
            errors.append(repr(e))

    threads = [threading.Thread(target=open_it) for _ in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert errors == []
    conn = db.connect(path)
    assert db.schema_version(conn) == len(db.MIGRATIONS)
    assert "post_now" in [r[1] for r in conn.execute("PRAGMA table_info(clips)")]
