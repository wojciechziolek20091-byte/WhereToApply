"""Background clipping: one thread per video, from link to checked clips.

Used by the dashboard (right after a link is pasted) and by the scheduler (new
channel videos, retries), so neither waits on the other and the scheduler keeps
ticking (posting, polling) while videos are being clipped. A video already being
clipped in this process is not started twice; across processes the database
claim in `Pipeline.fast_process` does the same.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from clipbot import db
from clipbot.logging import get_logger
from clipbot.models import DataPaths

log = get_logger(__name__)

_running: set[str] = set()
_lock = threading.Lock()


def running() -> set[str]:
    with _lock:
        return set(_running)


def start(
    cfg: Any,
    video_id: str,
    factory: Callable[..., Any] | None = None,
    respect_pause: bool = True,
) -> threading.Thread | None:
    """Clip `video_id` in a background thread. None if it is already running here,
    or (with `respect_pause`) the bot is paused: it then waits for Resume."""
    with _lock:
        if video_id in _running:
            return None
        _running.add(video_id)

    def run() -> None:
        from clipbot.pipeline import Pipeline

        paths = DataPaths(cfg.settings.data_dir)
        conn = db.connect(paths.db)
        try:
            if respect_pause and (db.get_pause(conn).paused or paths.pause_file.exists()):
                return
            pipe = (factory or Pipeline)(conn, cfg, paths)
            log.info("clipping_started", video_id=video_id)
            seen = pipe.fast_process(video_id)
            log.info("clipping_finished", video_id=video_id, stages=seen)
        except Exception as e:  # fast_process rolls back; this is a last resort
            log.exception("clipping_failed", video_id=video_id, error=str(e)[:300])
        finally:
            conn.close()
            with _lock:
                _running.discard(video_id)

    t = threading.Thread(target=run, name=f"clip-{video_id}", daemon=True)
    t.start()
    return t
