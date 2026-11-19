"""Stage orchestration. Phase 1: discover (RSS + URL), rights gate, acquire.

Each stage reads its input state, does the work, then flips state in one
transaction, so re-running a stage after a crash is safe.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from clipbot import db
from clipbot.config import AppConfig, Source
from clipbot.logging import get_logger
from clipbot.media import ProbeError, probe
from clipbot.models import DataPaths
from clipbot.sources import rss
from clipbot.sources.providers import (
    AcquireBlocked,
    AcquireError,
    NotAvailableYet,
    Provider,
)
from clipbot.sources.providers.local import LocalFolderProvider
from clipbot.sources.providers.ytdlp import YtDlpProvider
from clipbot.sources.rights import Decision, adhoc_cc_source, check_eligible, check_rights
from clipbot.sources.youtube_api import VideoMeta, YouTubeAPI, parse_video_id

log = get_logger(__name__)

# After the first failed download: retry after 1 h, 6 h, 16 h (about 24 h in all),
# then give up and alert (brief 4.2).
ACQUIRE_RETRY_DELAYS = (timedelta(hours=1), timedelta(hours=6), timedelta(hours=16))


@dataclass(frozen=True)
class Registered:
    video_id: str
    state: str
    reason: str
    new: bool
    title: str = ""
    channel: str = ""


class Pipeline:
    def __init__(
        self,
        conn: sqlite3.Connection,
        cfg: AppConfig,
        paths: DataPaths,
        youtube: YouTubeAPI | None = None,
        providers: dict[str, Provider] | None = None,
        feed_fetcher=rss.fetch_feed,
        clock=db.utcnow,
    ) -> None:
        self.conn = conn
        self.cfg = cfg
        self.paths = paths
        self._yt = youtube
        self._providers = providers or {}
        self._fetch_feed = feed_fetcher
        self.now = clock

    # ------------------------------------------------------------------ helpers

    @property
    def yt(self) -> YouTubeAPI:
        if self._yt is None:
            key = self.cfg.secrets.youtube_api_key
            self._yt = YouTubeAPI(key.get_secret_value() if key else "")
        return self._yt

    def today(self) -> date:
        return self.now().astimezone(self.cfg.settings.tz).date()

    def alert(self, kind: str, message: str, **data: object) -> None:
        """Recorded as an alert event; the notifier (phase 6) forwards these."""
        log.warning("alert", kind=kind, message=message, **data)
        db.log_event(self.conn, kind, message, level="alert", data=dict(data))

    def source_by_id(self, source_id: str) -> Source:
        try:
            return self.cfg.source(source_id)
        except KeyError:
            row = self.conn.execute(
                "SELECT config_json FROM sources WHERE id = ?", (source_id,)
            ).fetchone()
            if row is None:
                raise
            return Source.model_validate_json(row["config_json"])

    def source_for_channel(self, channel_id: str) -> Source | None:
        """A configured source for this channel; enabled ones win."""
        matches = [s for s in self.cfg.sources if s.youtube_channel_id == channel_id]
        matches.sort(key=lambda s: not s.enabled)
        return matches[0] if matches else None

    def _ensure_source_row(self, s: Source) -> None:
        self.conn.execute(
            "INSERT INTO sources(id, youtube_channel_id, name, rights, enabled, config_json, "
            "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            (
                s.id,
                s.youtube_channel_id,
                s.name,
                s.rights,
                int(s.enabled),
                s.model_dump_json(),
                db.iso(self.now()),
            ),
        )

    def backfill_cutoff(self) -> datetime:
        """Videos published before the first run (minus backfill_days) are skipped."""
        first = db.kv_get(self.conn, "first_run_at")
        if first is None:
            first = db.iso(self.now())
            with db.tx(self.conn):
                db.kv_set(self.conn, "first_run_at", first)
        days = self.cfg.settings.discovery.backfill_days
        return db.parse_iso(first) - timedelta(days=days)

    # ------------------------------------------------------------------ register

    def register(
        self,
        meta: VideoMeta,
        source: Source,
        decision: Decision,
        origin: str,
    ) -> Registered:
        existing = self.conn.execute(
            "SELECT state, state_reason FROM videos WHERE id = ?", (meta.id,)
        ).fetchone()
        if existing:
            return Registered(
                meta.id,
                existing["state"],
                existing["state_reason"] or "",
                False,
                meta.title,
                meta.channel_title,
            )
        state = "discovered" if decision.ok else "skipped"
        now = db.iso(self.now())
        with db.tx(self.conn):
            self._ensure_source_row(source)
            self.conn.execute(
                "INSERT INTO videos(id, source_id, title, channel_title, published_at, "
                "duration_sec, license, privacy_status, live_status, state, state_reason, "
                "state_changed_at, meta_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    meta.id,
                    source.id,
                    meta.title,
                    meta.channel_title,
                    db.iso(meta.published_at) if meta.published_at else None,
                    meta.duration_sec,
                    meta.license,
                    meta.privacy_status,
                    meta.live_status,
                    state,
                    decision.reason,
                    now,
                    json.dumps({"origin": origin, "channel_id": meta.channel_id}),
                    now,
                    now,
                ),
            )
            db.log_event(
                self.conn,
                "discover",
                f"{state}: {decision.reason}",
                video_id=meta.id,
                data={"origin": origin, "source": source.id},
            )
        log.info(
            "video_registered", video_id=meta.id, state=state, reason=decision.reason, origin=origin
        )
        return Registered(meta.id, state, decision.reason, True, meta.title, meta.channel_title)

    def _gate(self, meta: VideoMeta, source: Source, published_after: datetime | None) -> Decision:
        rights = check_rights(source, meta, self.today())
        if not rights:
            return rights
        elig = check_eligible(meta, self.cfg.settings.discovery, published_after)
        if not elig:
            return elig
        return rights

    # ------------------------------------------------------------------ discover

    def discover(self) -> list[Registered]:
        """One RSS pass over every enabled source."""
        cutoff = self.backfill_cutoff()
        new_ids: dict[str, Source] = {}
        for source in self.cfg.enabled_sources:
            try:
                entries = self._fetch_feed(source.youtube_channel_id)
            except rss.FeedError as e:
                db.log_event(
                    self.conn, "discover_error", str(e), level="warning", data={"source": source.id}
                )
                continue
            for e in entries:
                if e.published_at and e.published_at < cutoff:
                    continue  # skip old uploads without spending API quota
                if self.conn.execute("SELECT 1 FROM videos WHERE id = ?", (e.video_id,)).fetchone():
                    continue
                new_ids[e.video_id] = source
        if not new_ids:
            return []
        metas = self.yt.videos(new_ids)
        out = []
        for vid, source in new_ids.items():
            meta = metas.get(vid)
            if meta is None:
                continue  # private or deleted between feed and API: try next poll
            if meta.live_status in ("live", "upcoming"):
                continue  # not stored, so it is picked up once the stream ends
            out.append(self.register(meta, source, self._gate(meta, source, cutoff), "rss"))
        return out

    def ingest_url(self, url: str) -> Registered:
        """Register a video pasted by link. Raises BadVideoURL on a bad link."""
        vid = parse_video_id(url)
        row = self.conn.execute(
            "SELECT state, state_reason, title, channel_title FROM videos WHERE id = ?", (vid,)
        ).fetchone()
        if row:
            return Registered(
                vid,
                row["state"],
                row["state_reason"] or "",
                False,
                row["title"] or "",
                row["channel_title"] or "",
            )
        meta = self.yt.video(vid)
        if meta is None:
            raise LookupError(f"video {vid} not found (deleted, private or wrong link)")
        source = self.source_for_channel(meta.channel_id)
        if source is not None and source.rights is not None:
            decision = self._gate(meta, source, None)
        elif meta.is_cc_by and self.cfg.settings.rights.allow_unlisted_cc_by:
            source = adhoc_cc_source(meta)
            decision = self._gate(meta, source, None)
        else:
            source = source or adhoc_cc_source(meta).model_copy(update={"rights": None})
            decision = Decision(
                False,
                f"no rights: channel {meta.channel_title!r} is not in sources.yaml "
                f"and the video license is {meta.license!r}, not Creative Commons",
            )
        return self.register(meta, source, decision, "url")

    # ------------------------------------------------------------------ acquire

    def due_for_acquire(self) -> list[str]:
        rows = self.conn.execute(
            "SELECT id FROM videos WHERE state = 'discovered' OR "
            "(state = 'acquire_failed' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) "
            "ORDER BY created_at",
            (db.iso(self.now()),),
        ).fetchall()
        return [r["id"] for r in rows]

    def provider_for(self, source: Source) -> Provider:
        if source.acquire in self._providers:
            return self._providers[source.acquire]
        if source.acquire == "local_folder":
            assert source.local_folder is not None
            return LocalFolderProvider(source.local_folder)
        return YtDlpProvider(timeout_s=self.cfg.settings.acquire.timeout_minutes * 60)

    def acquire(self, video_id: str) -> str:
        """Download one video. Returns the new state."""
        row = self.conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
        if row is None:
            raise LookupError(video_id)
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "videos",
                video_id,
                expect={"discovered", "acquire_failed"},
                to="acquiring",
                now=self.now(),
            )
        source = self.source_by_id(row["source_id"])
        dest = self.paths.raw_video(video_id)
        url = f"https://www.youtube.com/watch?v={video_id}"
        try:
            path = (
                dest if dest.is_file() else self.provider_for(source).acquire(video_id, url, dest)
            )
            info = probe(path)
        except NotAvailableYet as e:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="acquiring",
                    to=row["state"],
                    reason=str(e),
                    now=self.now(),
                )
            return row["state"]
        except (AcquireError, ProbeError) as e:
            dest.unlink(missing_ok=True)
            return self._acquire_failed(video_id, row["attempts"], e)

        meta = json.loads(row["meta_json"] or "{}")
        meta["probe"] = info.__dict__
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "videos",
                video_id,
                expect="acquiring",
                to="acquired",
                reason=f"{info.width}x{info.height} {info.duration:.0f}s",
                now=self.now(),
                raw_path=str(path),
                meta_json=json.dumps(meta),
                attempts=0,
                next_attempt_at=None,
            )
            db.log_event(
                self.conn,
                "acquire",
                "acquired",
                video_id=video_id,
                data={"provider": source.acquire, **info.__dict__},
            )
        return "acquired"

    def _acquire_failed(self, video_id: str, attempts: int, err: Exception) -> str:
        attempts += 1
        blocked = isinstance(err, AcquireBlocked)
        if attempts <= len(ACQUIRE_RETRY_DELAYS):
            retry_at = self.now() + ACQUIRE_RETRY_DELAYS[attempts - 1]
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="acquiring",
                    to="acquire_failed",
                    reason=str(err),
                    now=self.now(),
                    attempts=attempts,
                    next_attempt_at=db.iso(retry_at),
                )
                db.log_event(
                    self.conn,
                    "acquire_failed",
                    str(err),
                    level="warning",
                    video_id=video_id,
                    data={"attempt": attempts, "blocked": blocked, "retry_at": retry_at},
                )
            return "acquire_failed"
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "videos",
                video_id,
                expect="acquiring",
                to="failed",
                reason=f"download failed {attempts} times: {err}",
                now=self.now(),
                attempts=attempts,
                next_attempt_at=None,
            )
            self.alert(
                "acquire_gave_up",
                f"Could not download {video_id} after {attempts} tries: {err}. "
                + (
                    "YouTube is blocking this host; put the file in the source's local "
                    "folder or run the bot from a home connection."
                    if blocked
                    else ""
                ),
                video_id=video_id,
            )
        return "failed"

    def acquire_due(self, limit: int = 1) -> list[tuple[str, str]]:
        """One video at a time by default: downloads compete with CPU-heavy stages."""
        done = []
        for vid in self.due_for_acquire()[:limit]:
            done.append((vid, self.acquire(vid)))
        return done
