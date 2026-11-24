"""Stage orchestration. Phase 1: discover (RSS + URL), rights gate, acquire.

Each stage reads its input state, does the work, then flips state in one
transaction, so re-running a stage after a crash is safe.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from clipbot import db
from clipbot import qa as qa_mod
from clipbot.assets import AssetError, face_model, font_files
from clipbot.config import CAPTION_LANGUAGES, AppConfig, Source
from clipbot.logging import get_logger
from clipbot.media import ProbeError, probe
from clipbot.models import DataPaths, Word
from clipbot.post.localize import (
    CAPTION_SCHEMA,
    SUBTITLE_SCHEMA,
    Caption,
    caption_messages,
    parse_caption,
    parse_subtitles,
    subtitle_messages,
)
from clipbot.post.text import build_post_text, credit_word, youtube_url
from clipbot.render.captions import CaptionLayout, build_ass, clip_words, count_caption_words
from clipbot.render.encode import EncodeSettings, RenderError, contact_sheet, render_clip
from clipbot.render.reframe import FaceDetector, plan_clip
from clipbot.select.llm import (
    DailyLimitReached,
    FreeModelRouter,
    LLMAuthError,
    NoFreeModelAvailable,
)
from clipbot.select.prompt import (
    build_messages,
    clip_schema,
    parse_selection,
    transcript_lines,
    windows,
)
from clipbot.select.snap import SnapRules, fix_time_units, merge_window_candidates, plan_clips
from clipbot.sources import rss
from clipbot.sources.providers import (
    AcquireBlocked,
    AcquireError,
    NotAvailableYet,
    Provider,
)
from clipbot.sources.providers.local import LocalFolderProvider
from clipbot.sources.providers.ytdlp import AUDIO_FORMAT, YtDlpProvider
from clipbot.sources.rights import Decision, adhoc_cc_source, check_eligible, check_rights
from clipbot.sources.youtube_api import VideoMeta, YouTubeAPI, parse_video_id
from clipbot.sources.youtube_fast import captions_transcript, fetch_info, fetch_section
from clipbot.transcribe import Transcript, transcript_path
from clipbot.transcribe import transcribe as run_transcribe

log = get_logger(__name__)

# After the first failed download: retry after 1 h, 6 h, 16 h (about 24 h in all),
# then give up and alert (brief 4.2).
ACQUIRE_RETRY_DELAYS = (timedelta(hours=1), timedelta(hours=6), timedelta(hours=16))
# When every free model is busy, selection waits and tries again.
SELECT_RETRY_DELAY = timedelta(minutes=30)
HEARTBEAT_S = 20  # how often a fast worker refreshes its claim on a video

_download_locks: dict[str, threading.Lock] = {}
_download_locks_guard = threading.Lock()


def _download_lock(video_id: str) -> threading.Lock:
    with _download_locks_guard:
        return _download_locks.setdefault(video_id, threading.Lock())


@dataclass(frozen=True)
class Registered:
    video_id: str
    state: str
    reason: str
    new: bool
    title: str = ""
    channel: str = ""
    again: str = ""  # for a link seen before: more | retry | busy | refused


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
        router: FreeModelRouter | None = None,
        transcriber=run_transcribe,
    ) -> None:
        self.conn = conn
        self.cfg = cfg
        self.paths = paths
        self._yt = youtube
        self._providers = providers or {}
        self._fetch_feed = feed_fetcher
        self.now = clock
        self._router = router
        self._faces: FaceDetector | None = None
        self._transcribe = transcriber
        self._llm_error: Exception | None = None  # why the last caption call waited

    # ------------------------------------------------------------------ helpers

    @property
    def yt(self) -> YouTubeAPI:
        if self._yt is None:
            key = self.cfg.secrets.youtube_api_key
            self._yt = YouTubeAPI(key.get_secret_value() if key else "")
        return self._yt

    @property
    def router(self) -> FreeModelRouter:
        if self._router is None:
            from clipbot.select.llm import router_from_config

            self._router = router_from_config(self.cfg, on_paid_usage=self._paid_usage)
        return self._router

    def _paid_usage(self, model: str, cost: float) -> None:
        self.alert(
            "llm_paid_usage",
            f"model {model} charged ${cost:g}; it is now banned",
            model=model,
            cost_usd=cost,
        )

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
        clip_count: int | None = None,
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
                    json.dumps(
                        {"origin": origin, "channel_id": meta.channel_id}
                        | ({"clip_count": clip_count} if clip_count else {})
                    ),
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

    def ingest_url(self, url: str, clip_count: int | None = None) -> Registered:
        """Register a video pasted by link. Raises BadVideoURL on a bad link.

        `clip_count` asks for that many clips instead of `clips.per_video`. For a
        video already known it still applies while its clips are not picked yet."""
        vid = parse_video_id(url)
        row = self.conn.execute(
            "SELECT * FROM videos WHERE id = ?",
            (vid,),
        ).fetchone()
        if row:
            return self._again(vid, row, clip_count)
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
        return self.register(meta, source, decision, "url", clip_count)

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
        return YtDlpProvider(
            timeout_s=self.cfg.settings.acquire.timeout_minutes * 60, tools_dir=self.paths.tools
        )

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
        provider = self.provider_for(source)
        if self.cfg.settings.acquire.fast and isinstance(provider, YtDlpProvider):
            try:
                done = self._acquire_fast(video_id, row, provider, url)
            except AcquireBlocked as e:  # YouTube's bot check: a download would fail too
                return self._acquire_failed(video_id, row["attempts"], e)
            except AcquireError as e:  # anything else: download in full right away
                log.warning("fast_acquire_failed_downloading", video_id=video_id, error=str(e))
                done = None
            if done:
                return done
        try:
            path = dest if dest.is_file() else provider.acquire(video_id, url, dest)
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

    def _info_path(self, video_id: str) -> Path:
        return self.paths.work_dir(video_id) / "info.json"

    def _acquire_fast(
        self, video_id: str, row: sqlite3.Row, provider: YtDlpProvider, url: str
    ) -> str | None:
        """Read the video's details and YouTube's own captions instead of downloading
        the whole video and transcribing it. The clips' seconds are fetched when they
        are made. None: no usable captions, so download in full as usual."""
        info = fetch_info(provider, url)
        work = self.paths.work_dir(video_id)
        work.mkdir(parents=True, exist_ok=True)
        self._info_path(video_id).write_text(json.dumps(info), encoding="utf-8")
        tr = captions_transcript(info)
        if tr is None:
            tr = self._transcribe_audio_only(video_id, row, provider, url)
            if isinstance(tr, str):
                return tr  # failed or skipped
        tp = transcript_path(work, tr.model)
        tr.save(tp)
        meta = json.loads(row["meta_json"] or "{}")
        meta["transcript"] = {"model": tr.model, "words": len(tr.words), "language": tr.language}
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "videos",
                video_id,
                expect={"acquiring", "transcribing"},
                to="transcribed",
                reason=(
                    f"{len(tr.words)} words from YouTube captions ({tr.language})"
                    if tr.model == "youtube-captions"
                    else f"{len(tr.words)} words, {tr.language}, {tr.model} in "
                    f"{tr.seconds_taken:.0f}s (no YouTube captions)"
                ),
                now=self.now(),
                transcript_path=str(tp),
                meta_json=json.dumps(meta),
                attempts=0,
                next_attempt_at=None,
            )
            db.log_event(self.conn, "acquire", "youtube captions", video_id=video_id)
        return "transcribed"

    def _progress(self, video_id: str) -> Any:
        """A callback that records how far transcription is, for the dashboard."""
        last = [0.0]

        def report(fraction: float) -> None:
            if fraction - last[0] < 0.02 and fraction < 1:
                return
            last[0] = fraction
            conn = db.connect(self.paths.db)  # may run on another thread
            try:
                with db.tx(conn):
                    db.kv_set(conn, f"progress:{video_id}", str(round(fraction * 100)))
            finally:
                conn.close()

        return report

    def _transcribe_audio_only(
        self, video_id: str, row: sqlite3.Row, provider: YtDlpProvider, url: str
    ) -> Transcript | str:
        """No YouTube captions: fetch just the audio (a few MB) and transcribe it
        with the quick model, instead of downloading the whole video."""
        work = self.paths.work_dir(video_id)
        audio = work / "audio.m4a"
        if not audio.is_file():
            provider.acquire(video_id, url, audio, fmt=AUDIO_FORMAT)
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "videos",
                video_id,
                expect="acquiring",
                to="transcribing",
                reason="no YouTube captions: transcribing the audio",
                now=self.now(),
            )
        ws = self.cfg.settings.whisper
        if ws.fast_cpu_model:
            ws = ws.model_copy(update={"cpu_model": ws.fast_cpu_model})
        source = self.source_by_id(row["source_id"])
        try:
            tr = self._transcribe(
                audio,
                work,
                ws,
                source.language_hint,
                self.paths.models,
                progress=self._progress(video_id),
            )
        except Exception as e:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="transcribing",
                    to="failed",
                    reason=f"transcription failed: {e}"[:500],
                    now=self.now(),
                )
            return "failed"
        if not tr.words:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="transcribing",
                    to="skipped",
                    reason="no speech found",
                    now=self.now(),
                )
            return "skipped"
        return tr

    def clip_source(self, clip: sqlite3.Row, video: sqlite3.Row) -> tuple[Path, float]:
        """The file to cut this clip from, and the source time it starts at. Videos
        downloaded in full use the whole file; fast-path videos fetch just the clip's
        seconds (once), and fall back to a full download if that fails."""
        if video["raw_path"] and Path(video["raw_path"]).is_file():
            return Path(video["raw_path"]), 0.0
        work = self.paths.work_dir(video["id"]) / "render" / clip["id"]
        sec, meta = work / "source.mp4", work / "source.json"
        if sec.is_file() and meta.is_file():
            return sec, float(json.loads(meta.read_text())["offset"])
        start, end = clip["start_ms"] / 1000, clip["end_ms"] / 1000
        info_path = self._info_path(video["id"])
        source = self.source_by_id(video["source_id"])
        provider = self.provider_for(source)
        url = f"https://www.youtube.com/watch?v={video['id']}"
        for fresh in (False, True):  # stream links expire after a few hours
            try:
                if fresh or not info_path.is_file():
                    if not isinstance(provider, YtDlpProvider):
                        break
                    info_path.parent.mkdir(parents=True, exist_ok=True)
                    info_path.write_text(json.dumps(fetch_info(provider, url)), encoding="utf-8")
                info = json.loads(info_path.read_text(encoding="utf-8"))
                offset = fetch_section(info, start, end, sec)
            except AcquireError as e:
                log.warning("section_failed", clip_id=clip["id"], fresh=fresh, error=str(e)[:300])
                continue
            meta.write_text(json.dumps({"offset": offset}))
            return sec, offset
        # Last resort: the whole video, as before. Clips are made in parallel: only
        # one of them downloads, the others wait for that file.
        dest = self.paths.raw_video(video["id"])
        with _download_lock(video["id"]):
            path = dest if dest.is_file() else provider.acquire(video["id"], url, dest)
        return path, 0.0

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

    # ------------------------------------------------------------------ local files

    def ingest_file(self, path: Path, source_id: str, title: str | None = None) -> Registered:
        """Register a video file you have on disk under a configured source, whose
        rights tag applies. CC BY sources cannot be used: the license of a local
        file cannot be verified."""
        path = path.expanduser().resolve()
        try:
            source = self.cfg.source(source_id)
        except KeyError:
            raise LookupError(f"no source {source_id!r} in sources.yaml") from None
        info = probe(path)
        vid = local_video_id(path)
        meta = VideoMeta(
            id=vid,
            channel_id=source.youtube_channel_id,
            channel_title=source.name,
            title=title or path.stem.replace("_", " "),
            published_at=self.now(),
            duration_sec=info.duration,
            license="local_file",
            privacy_status="public",
            live_status="none",
            upload_status="processed",
            was_live=False,
        )
        decision = self._gate(meta, source, None)
        reg = self.register(meta, source, decision, "file")
        dest = self.paths.raw_video(vid)
        if reg.state == "discovered" and not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(path, dest)
            except OSError:
                shutil.copy2(path, dest)
        return reg

    # ------------------------------------------------------------------ transcribe

    def transcribe(self, video_id: str) -> str:
        row = self._row(video_id)
        with db.tx(self.conn):
            db.transition(
                self.conn, "videos", video_id, expect="acquired", to="transcribing", now=self.now()
            )
        source = self.source_by_id(row["source_id"])
        try:
            tr = self._transcribe(
                Path(row["raw_path"]),
                self.paths.work_dir(video_id),
                self.cfg.settings.whisper,
                source.language_hint,
                self.paths.models,
                progress=self._progress(video_id),
            )
        except Exception as e:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="transcribing",
                    to="failed",
                    reason=f"transcription failed: {e}",
                    now=self.now(),
                )
                self.alert("transcribe_failed", f"{video_id}: {e}", video_id=video_id)
            return "failed"
        if not tr.words:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="transcribing",
                    to="skipped",
                    reason="no speech found",
                    now=self.now(),
                )
            return "skipped"

        tp = transcript_path(self.paths.work_dir(video_id), tr.model)
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "videos",
                video_id,
                expect="transcribing",
                to="transcribed",
                reason=f"{len(tr.words)} words, {tr.language}, {tr.model} on {tr.device} "
                f"in {tr.seconds_taken:.0f}s",
                now=self.now(),
                transcript_path=str(tp),
            )
            db.log_event(
                self.conn,
                "transcribe",
                "transcribed",
                video_id=video_id,
                data={
                    "model": tr.model,
                    "device": tr.device,
                    "seconds": tr.seconds_taken,
                    "audio_seconds": tr.duration,
                    "words": len(tr.words),
                    "language": tr.language,
                },
            )
        return "transcribed"

    # ------------------------------------------------------------------ select

    def _again(self, vid: str, row: sqlite3.Row, clip_count: int | None) -> Registered:
        """A link that was pasted before. Never ignored:
        - finished (or failed after its transcript was made): pick more clips,
          different moments from the earlier ones;
        - failed or waiting for a retry: try again now;
        - being clipped right now: keep going (the new count applies if the clips
          are not picked yet);
        - refused for rights: refused again, with the reason."""
        meta = json.loads(row["meta_json"] or "{}")
        if clip_count:
            meta["clip_count"] = clip_count
        state, now = row["state"], self.now()
        has_transcript = bool(row["transcript_path"]) and Path(row["transcript_path"]).is_file()
        action = "busy"
        if state == "skipped":
            action = "refused"
        elif state == "done" or (state == "failed" and has_transcript):
            to, action = "transcribed", "more"
        elif state in ("failed", "acquire_failed"):
            to, action = "discovered", "retry"
        elif state == "transcribed":
            to, action = "transcribed", "retry"
        if action in ("more", "retry"):
            meta["round_since"] = db.iso(now)
            meta["round"] = int(meta.get("round", 1)) + (action == "more")
        with db.tx(self.conn):
            self.conn.execute(
                "UPDATE videos SET meta_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(meta), db.iso(now), vid),
            )
            if action in ("more", "retry"):
                db.transition(
                    self.conn,
                    "videos",
                    vid,
                    expect=state,
                    to=to,
                    reason="picking more clips" if action == "more" else "trying again",
                    now=now,
                    next_attempt_at=None,
                    attempts=0,
                )
        return Registered(
            vid,
            to if action in ("more", "retry") else state,
            row["state_reason"] or "",
            False,
            row["title"] or "",
            row["channel_title"] or "",
            again=action,
        )

    def clip_count(self, row: sqlite3.Row) -> int:
        """Clips wanted for this video: chosen when it was pasted, else the setting."""
        n = json.loads(row["meta_json"] or "{}").get("clip_count")
        return int(n) if n else self.cfg.settings.clips.per_video

    def rules(self, count: int | None = None) -> SnapRules:
        c = self.cfg.settings.clips
        return SnapRules(
            min_seconds=c.min_seconds,
            max_seconds=c.max_seconds,
            pre_roll=c.pre_roll,
            post_roll=c.post_roll,
            min_score=c.min_score,
            per_video=count or c.per_video,
            blocked_flags=frozenset(c.blocked_risk_flags),
        )

    def select(self, video_id: str) -> str:
        row = self._row(video_id)
        with db.tx(self.conn):
            db.transition(
                self.conn, "videos", video_id, expect="transcribed", to="selecting", now=self.now()
            )
        tr = Transcript.from_json(Path(row["transcript_path"]).read_text(encoding="utf-8"))
        source = self.source_by_id(row["source_id"])
        clips = self.cfg.settings.clips
        wanted = self.clip_count(row)
        # Clips from earlier rounds (a re-sent link): the new ones must differ.
        taken = [
            (r["start_ms"] / 1000, r["end_ms"] / 1000)
            for r in self.conn.execute(
                "SELECT start_ms, end_ms FROM clips WHERE video_id = ?", (video_id,)
            )
        ]
        log_dir = self.paths.work_dir(video_id) / "select"
        log_dir.mkdir(parents=True, exist_ok=True)

        wins = windows(tr.duration)
        per_window: list[list[Any]] = []
        cost = [0.0]
        lang = self.cfg.settings.post.language
        lang_name = None if lang == "original" else CAPTION_LANGUAGES[lang]

        def ask(messages: list[dict[str, str]]) -> Any:
            return self.router.complete_json(
                purpose="select",
                messages=messages,
                validate=parse_selection,
                schema=clip_schema(lang_name),
                schema_name="clips",
                max_tokens=6000,
            )

        def gather(avoid: list[tuple[float, float]], n: int, tag: str) -> list[list[Any]]:
            """Ask for `n` moments per window (all windows at once), avoiding `avoid`."""
            jobs = []
            for i, (ws, we) in enumerate(wins):
                lines = transcript_lines(tr.segments, ws, we)
                if not lines.strip():
                    continue
                messages = build_messages(
                    lines,
                    topics_hint=source.topics_hint,
                    min_s=clips.min_seconds,
                    max_s=clips.max_seconds,
                    n=n,
                    window=(ws, we) if len(wins) > 1 else None,
                    language=lang_name,
                    taken=[t for t in avoid if t[1] > ws and t[0] < we],
                )
                jobs.append((i, ws, we, messages))
            with ThreadPoolExecutor(max_workers=max(1, min(len(jobs), 4))) as ex:
                answers = list(ex.map(lambda j: ask(j[3]), jobs))
            out = []
            for (i, ws, we, messages), res in zip(jobs, answers, strict=True):
                cands, errors = res.value
                out.append(fix_time_units(cands, tr.duration))
                cost[0] += res.cost_usd
                call = {
                    "window": [ws, we],
                    "model": res.model,
                    "input_tokens": res.input_tokens,
                    "output_tokens": res.output_tokens,
                    "cost_usd": res.cost_usd,
                    "attempts": [asdict(a) for a in res.attempts],
                    "clip_errors": errors,
                    "messages": messages,
                    "response": res.raw_text,
                }
                (log_dir / f"window_{i}{tag}.json").write_text(
                    json.dumps(call, indent=1, ensure_ascii=False), encoding="utf-8"
                )
                db.log_event(
                    self.conn,
                    "llm_call",
                    f"select window {i}{tag}: {res.model}",
                    video_id=video_id,
                    data={
                        k: call[k] for k in ("model", "input_tokens", "output_tokens", "cost_usd")
                    }
                    | {"attempts": len(res.attempts), "candidates": len(cands)},
                )
            return out

        try:
            per_window = gather(taken, max(wanted * 2, 5), "")
            merged = merge_window_candidates(per_window)
            plan = plan_clips(
                video_id, merged, tr.words, tr.duration, self.rules(wanted), taken=taken
            )
            short = wanted - len(plan.kept)
            if short > 0:
                # Fewer usable moments than asked for: ask once more, for others.
                avoid = taken + [(c.start, c.end) for c in plan.kept]
                with contextlib.suppress(NoFreeModelAvailable):
                    per_window += gather(avoid, max(short * 2, 3), "_more")
                    merged = merge_window_candidates(per_window)
                    plan = plan_clips(
                        video_id, merged, tr.words, tr.duration, self.rules(wanted), taken=taken
                    )
        except NoFreeModelAvailable as e:
            retry = self._retry_at(e)
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="selecting",
                    to="transcribed",
                    reason=str(e)[:500],
                    now=self.now(),
                    next_attempt_at=db.iso(retry),
                )
            return "transcribed"
        except LLMAuthError as e:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="selecting",
                    to="transcribed",
                    reason=str(e),
                    now=self.now(),
                )
            db.set_pause(self.conn, f"OpenRouter auth error: {e}")
            self.alert(
                "llm_auth",
                f"Paused: OpenRouter refused the key ({e}). Fix "
                "OPENROUTER_API_KEY, then run `clipbot resume`.",
            )
            return "transcribed"

        if lang_name:  # captions written in the same call: no second AI call later
            for c in plan.kept:
                if c.candidate.caption:
                    head, text, tags = c.candidate.caption
                    cache = self.paths.work_dir(video_id) / "render" / c.clip_id
                    cache.mkdir(parents=True, exist_ok=True)
                    (cache / f"caption.{lang}.json").write_text(
                        json.dumps(
                            {"hook": head, "summary": text, "hashtags": list(tags)},
                            ensure_ascii=False,
                        ),
                        encoding="utf-8",
                    )
        (log_dir / "plan.json").write_text(
            json.dumps(
                {
                    "kept": [
                        {
                            "clip_id": c.clip_id,
                            "start": c.start,
                            "end": c.end,
                            **asdict(c.candidate),
                        }
                        for c in plan.kept
                    ],
                    "dropped": [{"reason": d.reason, **asdict(d.candidate)} for d in plan.dropped],
                },
                indent=1,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        now = db.iso(self.now())
        with db.tx(self.conn):
            for c in plan.kept:
                k = c.candidate
                self.conn.execute(
                    "INSERT OR IGNORE INTO clips(id, video_id, start_ms, end_ms, score, hook, "
                    "title, summary, hashtags_json, risk_flags_json, state, state_changed_at, "
                    "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'selected', "
                    "?, ?, ?)",
                    (
                        c.clip_id,
                        video_id,
                        c.start_ms,
                        c.end_ms,
                        k.score,
                        k.hook,
                        k.title,
                        k.summary,
                        json.dumps(list(k.hashtags)),
                        json.dumps(list(k.risk_flags)),
                        now,
                        now,
                        now,
                    ),
                )
            to = "selected" if plan.kept else "done"
            reason = (
                f"{len(plan.kept)} clip(s) from {len(merged)} candidate(s)"
                if plan.kept
                else f"no clip passed ({len(merged)} candidate(s))"
            )
            db.transition(
                self.conn,
                "videos",
                video_id,
                expect="selecting",
                to=to,
                reason=reason,
                now=self.now(),
                next_attempt_at=None,
                cost_usd=(row["cost_usd"] or 0) + cost[0],
            )
            db.log_event(
                self.conn,
                "select",
                reason,
                video_id=video_id,
                data={
                    "kept": [c.clip_id for c in plan.kept],
                    "dropped": [d.reason for d in plan.dropped],
                    "cost_usd": cost[0],
                },
            )
        return to

    # ------------------------------------------------------------------ process

    def _row(self, video_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
        if row is None:
            raise LookupError(f"unknown video {video_id}")
        return row

    def step(self, video_id: str) -> str | None:
        """Run the next stage for this video. None when nothing can run now."""
        row = self._row(video_id)
        st = row["state"]
        due = row["next_attempt_at"] is None or db.parse_iso(row["next_attempt_at"]) <= self.now()
        if st == "discovered" or (st == "acquire_failed" and due):
            return self.acquire(video_id)
        if st == "acquired":
            return self.transcribe(video_id)
        if st == "transcribed" and due:
            return self.select(video_id)
        if st == "selected":
            nxt = self.conn.execute(
                "SELECT id FROM clips WHERE video_id = ? AND state = 'selected' "
                "AND (next_attempt_at IS NULL OR next_attempt_at <= ?) "
                "ORDER BY score DESC LIMIT 1",
                (video_id, db.iso(self.now())),
            ).fetchone()
            if nxt is not None:
                self.render(nxt["id"])
                return "rendering"  # keep going until every clip is rendered
            due_qa = self.clips_due_for_qa(video_id)
            if due_qa:
                self.qa(due_qa[0])
                return "checking"
            if self.conn.execute(
                "SELECT 1 FROM clips WHERE video_id = ? "
                "AND state IN ('selected', 'rendering', 'rendered')",
                (video_id,),
            ).fetchone():
                return None  # clips still being made or waiting for their check
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "videos",
                    video_id,
                    expect="selected",
                    to="done",
                    reason=row["state_reason"],
                    now=self.now(),
                )
            return "done"
        return None

    def process(self, video_id: str) -> list[str]:
        """Run stages until the video stops moving. Returns the states visited."""
        seen = []
        while True:
            before = self._row(video_id)["state"]
            after = self.step(video_id)
            if after is None or after == before:
                return seen
            seen.append(after)

    def fast_process(self, video_id: str, workers: int | None = None) -> list[str]:
        """Take one video from link to checked clips in one go, without waiting
        for scheduler ticks: stages back to back, clips cut, rendered and checked
        in parallel.

        Safe to call from several places at once (dashboard thread, scheduler):
        only the worker that claims the video runs; the claim is refreshed while it
        works. Whatever goes wrong, the video is never left half-way through a
        stage: it is rolled back so the next try starts that stage again."""
        owner = f"{os.getpid()}:{threading.get_ident()}:{secrets.token_hex(4)}"
        if not db.claim_video(self.conn, video_id, owner):
            return []
        stop = threading.Event()
        beat = threading.Thread(target=self._heartbeat, args=(video_id, owner, stop), daemon=True)
        beat.start()
        try:
            return self._fast_stages(video_id, workers)
        except Exception as e:
            log.exception("fast_process_failed", video_id=video_id, error=str(e)[:300])
            self._roll_back(video_id, e)
            return ["interrupted"]
        finally:
            stop.set()
            beat.join(timeout=5)
            db.release_video(self.conn, video_id, owner)

    def _heartbeat(self, video_id: str, owner: str, stop: threading.Event) -> None:
        conn = db.connect(self.paths.db)
        try:
            while not stop.wait(HEARTBEAT_S):
                try:
                    db.refresh_claim(conn, video_id, owner)
                except sqlite3.Error as e:  # busy database: try again next beat
                    log.warning("heartbeat_failed", error=str(e))
        finally:
            conn.close()

    def _fast_stages(self, video_id: str, workers: int | None) -> list[str]:
        seen: list[str] = []
        while (st := self._row(video_id)["state"]) != "selected":
            after = self.step(video_id)
            if after is None or after == st:
                return seen
            seen.append(after)
        ids = [
            r["id"]
            for r in self.conn.execute(
                "SELECT id FROM clips WHERE video_id = ? AND state = 'selected' "
                "ORDER BY score DESC",
                (video_id,),
            )
        ]
        if ids:
            with contextlib.suppress(LLMAuthError):
                self.router  # noqa: B018  one shared router for all workers
                self.translate_subtitles(ids)  # one AI request for all clips' subtitles
            # All clips are made at once, then all are checked at once: the clips
            # exist as early as possible, and the checks' AI calls overlap.
            n = workers or max(1, min(len(ids), 4))
            with ThreadPoolExecutor(max_workers=n) as ex:
                made = list(ex.map(lambda cid: self._in_worker(cid, "render"), ids))
                seen += [r for r in made if r]
                ok = [cid for cid, r in zip(ids, made, strict=True) if r == "rendered"]
                self.review_safety(ok)  # one AI request for all clips' safety reviews
                seen += [r for r in ex.map(lambda cid: self._in_worker(cid, "qa"), ok) if r]
        seen += self.process(video_id)  # checks that had to wait, then "done"
        return seen

    def _roll_back(self, video_id: str, err: Exception) -> None:
        """Undo a half-finished stage after an unexpected error: the video goes back
        to where the stage started and is tried again in a minute (failed after 3
        such errors in a row). Clips caught mid-render go back to the queue."""
        now = self.now()
        reason = f"interrupted, trying again: {type(err).__name__}: {err}"[:500]
        with db.tx(self.conn):
            row = self.conn.execute(
                "SELECT state, prev_state, attempts FROM videos WHERE id = ?", (video_id,)
            ).fetchone()
            if row and row["state"] in db.VIDEO_TRANSIENT and row["prev_state"]:
                tries = (row["attempts"] or 0) + 1
                give_up = tries >= 3
                self.conn.execute(
                    "UPDATE videos SET state = ?, prev_state = ?, state_reason = ?, "
                    "attempts = ?, next_attempt_at = ?, state_changed_at = ?, updated_at = ? "
                    "WHERE id = ?",
                    (
                        "failed" if give_up else row["prev_state"],
                        row["state"],
                        reason.replace("trying again", "gave up") if give_up else reason,
                        tries,
                        None if give_up else db.iso(now + timedelta(minutes=1)),
                        db.iso(now),
                        db.iso(now),
                        video_id,
                    ),
                )
            self.conn.execute(
                "UPDATE clips SET state = prev_state, prev_state = state, state_reason = ?, "
                "state_changed_at = ?, updated_at = ? "
                "WHERE video_id = ? AND state = 'rendering' AND prev_state IS NOT NULL",
                (reason, db.iso(now), db.iso(now), video_id),
            )

    def _in_worker(self, clip_id: str, stage: str) -> str | None:
        """Run `render` or `qa` for one clip on its own database connection, so
        several clips can be worked on at once from threads."""
        conn = db.connect(self.paths.db)
        try:
            worker = Pipeline(
                conn,
                self.cfg,
                self.paths,
                youtube=self._yt,
                providers=self._providers,
                clock=self.now,
                router=self._router,
                transcriber=self._transcribe,
            )
            try:
                return worker.render(clip_id) if stage == "render" else worker.qa(clip_id)
            except db.StateConflict:
                return None  # another worker got there first
            except Exception as e:  # never leave a clip stuck in "rendering"
                log.exception("clip_worker_failed", clip_id=clip_id, error=str(e)[:300])
                with db.tx(conn):
                    conn.execute(
                        "UPDATE clips SET state = 'failed', prev_state = state, "
                        "state_reason = ?, updated_at = ? WHERE id = ? AND state = 'rendering'",
                        (f"{stage} failed: {type(e).__name__}: {e}"[:500], db.iso(self.now()),
                         clip_id),
                    )  # fmt: skip
                return "failed"
        finally:
            conn.close()

    # ------------------------------------------------------------------ render

    def face_detector(self) -> FaceDetector:
        if self._faces is None:
            self._faces = FaceDetector(face_model(self.paths.models))
        return self._faces

    def caption_layout(self) -> CaptionLayout:
        c, r = self.cfg.settings.captions, self.cfg.settings.render
        return CaptionLayout(
            width=r.width,
            height=r.height,
            words_per_line=c.words_per_line,
            font_size=c.font_size,
            hook_font_size=c.hook_font_size,
            bottom_margin_pct=c.bottom_margin_pct,
            right_margin_pct=c.right_margin_pct,
            hook_seconds=c.hook_seconds,
        )

    def encode_settings(self) -> EncodeSettings:
        r = self.cfg.settings.render
        return EncodeSettings(
            width=r.width,
            height=r.height,
            fps=r.fps,
            crf=r.crf,
            preset=r.preset,
            loudness_lufs=r.loudness_lufs,
        )

    def render(self, clip_id: str) -> str:
        c = self.conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
        if c is None:
            raise LookupError(f"unknown clip {clip_id}")
        v = self._row(c["video_id"])
        start, end = c["start_ms"] / 1000, c["end_ms"] / 1000
        tr = Transcript.from_json(Path(v["transcript_path"]).read_text(encoding="utf-8"))
        try:
            words = self.subtitle_words(c, tr)
        except LLMAuthError:
            words = None
        if words is None:  # subtitles must be in the chosen language: wait for the AI
            self._wait_for_model(clip_id, "subtitles waiting for a free AI model", self._llm_error)
            return "selected"
        with db.tx(self.conn):
            db.transition(
                self.conn, "clips", clip_id, expect="selected", to="rendering", now=self.now()
            )
        work = self.paths.work_dir(v["id"]) / "render" / clip_id
        out = self.paths.render(clip_id)
        sheet = self.paths.contact_sheet(clip_id)
        try:
            src, offset = self.clip_source(c, v)
            info = probe(src)
            s0, s1 = start - offset, end - offset  # times inside `src`
            scenes = plan_clip(
                src,
                self.face_detector(),
                s0,
                s1,
                info.width,
                info.height,
                scenes=self.cfg.settings.render.scene_detect,
            )
            ass = build_ass(words, end - start, c["hook"], self.caption_layout())
            render_clip(src, s0, s1, scenes, ass, font_files(), out, work, self.encode_settings())
            contact_sheet(out, sheet, end - start)
        except (RenderError, AssetError, ProbeError, AcquireError, OSError) as e:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "clips",
                    clip_id,
                    expect="rendering",
                    to="failed",
                    reason=f"render failed: {e}"[:500],
                    now=self.now(),
                )
                self.alert("render_failed", f"clip {clip_id}: {e}", clip_id=clip_id)
            return "failed"
        report = {
            "scenes": [s.__dict__ for s in scenes],
            "caption_words": count_caption_words(ass),
            "transcript_words": len(words),
            "source": f"{info.width}x{info.height}",
        }
        (work / "render.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
        shutil.rmtree(work / "fonts", ignore_errors=True)
        modes = sorted({s.mode for s in scenes})
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "clips",
                clip_id,
                expect="rendering",
                to="rendered",
                reason=f"{len(scenes)} scene(s): {', '.join(modes)}",
                now=self.now(),
                render_path=str(out),
                contact_sheet_path=str(sheet),
            )
            db.log_event(
                self.conn, "render", "rendered", video_id=v["id"], clip_id=clip_id, data=report
            )
        return "rendered"

    # ------------------------------------------------------------------ QA

    def clips_due_for_qa(self, video_id: str | None = None) -> list[str]:
        sql = (
            "SELECT id FROM clips WHERE state = 'rendered' AND "
            "(next_attempt_at IS NULL OR next_attempt_at <= ?)"
        )
        args: list[object] = [db.iso(self.now())]
        if video_id:
            sql += " AND video_id = ?"
            args.append(video_id)
        return [r["id"] for r in self.conn.execute(sql + " ORDER BY score DESC", args)]

    def caption(self, clip: sqlite3.Row, video: sqlite3.Row) -> Caption | None:
        """The caption in the chosen language. None when no free model answered
        (the caller waits and tries again). Cached next to the render."""
        lang = self.cfg.settings.post.language
        tags = json.loads(clip["hashtags_json"] or "[]")
        if lang == "original":
            return Caption(clip["hook"], clip["summary"], tuple(tags))
        cache = self.paths.work_dir(video["id"]) / "render" / clip["id"] / f"caption.{lang}.json"
        if cache.is_file():
            d = json.loads(cache.read_text(encoding="utf-8"))
            return Caption(d["hook"], d["summary"], tuple(d["hashtags"]))
        try:
            res = self.router.complete_json(
                purpose="caption",
                messages=caption_messages(clip["hook"], clip["summary"], tags, lang),
                validate=parse_caption,
                schema=CAPTION_SCHEMA,
                schema_name="caption",
                max_tokens=1500,
                min_context=0,
            )
        except NoFreeModelAvailable as e:
            log.warning("caption_waiting", clip_id=clip["id"], error=str(e)[:300])
            self._llm_error = e
            return None
        cap = res.value
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(
            json.dumps(
                {
                    "hook": cap.hook,
                    "summary": cap.summary,
                    "hashtags": list(cap.hashtags),
                    "model": res.model,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return cap

    def post_text(
        self, clip: sqlite3.Row, video: sqlite3.Row, caption: Caption | None = None
    ) -> str:
        source = self.source_by_id(video["source_id"])
        cap = caption or Caption(
            clip["hook"], clip["summary"], tuple(json.loads(clip["hashtags_json"] or "[]"))
        )
        return build_post_text(
            hook=cap.hook,
            summary=cap.summary,
            model_tags=list(cap.hashtags),
            source=source,
            channel_title=video["channel_title"] or "",
            video_url=youtube_url(video["id"], video["license"]),
            ps=self.cfg.settings.post,
        )

    def qa(self, clip_id: str) -> str:
        c = self.conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
        v = self._row(c["video_id"])
        source = self.source_by_id(v["source_id"])
        start, end = c["start_ms"] / 1000, c["end_ms"] / 1000
        work = self.paths.work_dir(v["id"]) / "render" / clip_id
        ass_path = work / "clip.ass"
        ass = ass_path.read_text(encoding="utf-8") if ass_path.is_file() else ""
        tr = Transcript.from_json(Path(v["transcript_path"]).read_text(encoding="utf-8"))
        words = clip_words(tr.words, start, end)
        try:
            cap = self.caption(c, v)
        except LLMAuthError as e:
            db.set_pause(self.conn, f"OpenRouter auth error: {e}")
            return "rendered"
        if cap is None:
            self._wait_for_model(clip_id, "caption waiting for a free AI model", self._llm_error)
            return "rendered"
        text = self.post_text(c, v, cap)
        render = Path(c["render_path"] or "")
        lim = self.cfg.settings.clips
        strict = self.cfg.settings.safety.strict_qa

        gates: dict[str, qa_mod.Gate] = {}
        info, err = qa_mod.probe_or_none(render)
        gates["spec"] = qa_mod.gate_spec(info, lim.min_seconds, lim.max_seconds, err)
        gates["speech"] = qa_mod.gate_speech(words, end - start)
        if info is not None:
            gates["loudness"] = qa_mod.gate_loudness(qa_mod.measure_lufs(render))
            black, freezes = qa_mod.measure_black_and_frozen(render)
            src, offset = self.clip_source(c, v)
            static = {
                f: qa_mod.source_static_share(src, start - offset + f[0], start - offset + f[1])
                for f in freezes
                if f[1] - f[0] > qa_mod.MAX_BLACK_OR_FROZEN
            }
            gates["visual"] = qa_mod.gate_visual(black, freezes, static)
        shown = self.subtitle_words(c, tr, translate=False) or words
        gates["caption_sync"] = qa_mod.gate_caption_sync(ass, len(shown))
        gates["transformation"] = qa_mod.gate_transformation(
            ass, source.rights, text, credit_word(self.cfg.settings.post.language)
        )
        others = [
            (r["id"], r["start_ms"] / 1000, r["end_ms"] / 1000)
            for r in self.conn.execute(
                f"SELECT id, start_ms, end_ms FROM clips WHERE video_id = ? AND id != ? "
                f"AND state IN ({','.join('?' * len(qa_mod.ACTIVE_STATES))})",
                (v["id"], clip_id, *qa_mod.ACTIVE_STATES),
            )
        ]
        gates["duplicates"] = qa_mod.gate_duplicates(clip_id, start, end, others)

        # Only spend a model call when everything that blocks has passed.
        if all(g.ok for n, g in gates.items() if qa_mod.blocking(n, strict)):
            spoken = " ".join(w.w for w in words)
            cached = self._cached_safety(c, spoken, text)
            try:
                res = cached or self.router.complete_json(
                    purpose="safety",
                    messages=qa_mod.safety_messages(spoken, text),
                    validate=qa_mod.parse_safety,
                    schema=qa_mod.SAFETY_SCHEMA,
                    schema_name="safety",
                    max_tokens=1500,
                    min_context=0,
                )
            except NoFreeModelAvailable as e:
                self._wait_for_model(clip_id, f"safety check waiting: {e}", e)
                return "rendered"
            except LLMAuthError as e:
                db.set_pause(self.conn, f"OpenRouter auth error: {e}")
                self.alert(
                    "llm_auth",
                    f"Paused: OpenRouter refused the key ({e}). Fix "
                    "OPENROUTER_API_KEY, then run `clipbot resume`.",
                )
                return "rendered"
            gates["safety"] = qa_mod.gate_safety(res.value, res.model)
            db.log_event(
                self.conn,
                "llm_call",
                f"safety: {res.model}",
                clip_id=clip_id,
                video_id=v["id"],
                data={
                    "model": res.model,
                    "input_tokens": res.input_tokens,
                    "output_tokens": res.output_tokens,
                    "cost_usd": res.cost_usd,
                    "decision": res.value.decision,
                },
            )
        else:
            gates["safety"] = qa_mod.Gate(False, "not checked: an earlier gate failed")

        result = qa_mod.QAResult(gates, strict=strict)
        to = "qa_passed" if result.passed else "qa_rejected"
        if not result.passed:
            reason = result.first_failure
        elif result.warnings:
            reason = "passed with warnings: " + "; ".join(result.warnings)
        else:
            reason = "all gates passed"
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "clips",
                clip_id,
                expect="rendered",
                to=to,
                reason=reason,
                now=self.now(),
                next_attempt_at=None,
                qa_json=json.dumps(result.to_json()),
                post_text=text,
                caption_lang=self.cfg.settings.post.language,
            )
            db.log_event(
                self.conn,
                "qa",
                f"{to}: {reason}",
                clip_id=clip_id,
                video_id=v["id"],
                level="info" if result.passed else "warning",
            )
        return to

    # ------------------------------------------------------------------ subtitles

    def _subs_language(self, tr: Transcript) -> str | None:
        """The language to translate subtitles into, or None to show them as
        spoken (caption language "original", or the video already speaks it)."""
        lang = self.cfg.settings.post.language
        if lang == "original" or (tr.language or "").split("-")[0].lower() == lang:
            return None
        return lang

    def _subs_file(self, clip: sqlite3.Row, lang: str) -> Path:
        return self.paths.work_dir(clip["video_id"]) / "render" / clip["id"] / f"subs.{lang}.json"

    @staticmethod
    def _clip_lines(tr: Transcript, start: float, end: float) -> list[list[Any]]:
        """The clip's spoken words, grouped in lines (transcript lines, at most 12
        words each), in source time."""
        lines = []
        for seg in tr.segments:
            ws = [w for w in seg.words if w.start >= start - 0.05 and w.end <= end + 0.05]
            lines += [ws[i : i + 12] for i in range(0, len(ws), 12)]
        return lines

    def translate_subtitles(self, clip_ids: list[str]) -> int:
        """Translate the subtitles of these clips in one free AI request and keep
        them next to each clip. Returns how many clips got subtitles."""
        jobs: dict[str, tuple[sqlite3.Row, list[list[Any]]]] = {}
        lang = None
        for cid in clip_ids:
            c = self.conn.execute("SELECT * FROM clips WHERE id = ?", (cid,)).fetchone()
            if c is None:
                continue
            v = self._row(c["video_id"])
            tr = Transcript.from_json(Path(v["transcript_path"]).read_text(encoding="utf-8"))
            lang = self._subs_language(tr)
            if lang is None or self._subs_file(c, lang).is_file():
                continue
            lines = self._clip_lines(tr, c["start_ms"] / 1000, c["end_ms"] / 1000)
            if lines:
                jobs[cid] = (c, lines)
        if not jobs or lang is None:
            return 0
        texts = [
            (cid, [" ".join(w.w for w in ln) for ln in lines]) for cid, (_, lines) in jobs.items()
        ]
        try:
            res = self.router.complete_json(
                purpose="subtitles",
                messages=subtitle_messages(texts, lang),
                validate=parse_subtitles({cid: len(t) for cid, t in texts}),
                schema=SUBTITLE_SCHEMA,
                schema_name="subtitles",
                max_tokens=1000 + 40 * sum(len(t) for _, t in texts),
                min_context=0,
            )
        except NoFreeModelAvailable as e:
            self._llm_error = e
            return 0
        for cid, translated in res.value.items():
            c, lines = jobs[cid]
            start = c["start_ms"] / 1000
            out = [
                {"start": ln[0].start - start, "end": ln[-1].end - start, "text": text}
                for ln, text in zip(lines, translated, strict=True)
                if text
            ]
            f = self._subs_file(c, lang)
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        return len(res.value)

    def subtitle_words(
        self, clip: sqlite3.Row, tr: Transcript, translate: bool = True
    ) -> list[Word] | None:
        """The words shown on screen, in clip time: as spoken, or translated into
        the caption language (each translated line spread over the time its
        original line was spoken). None: the translation is not available yet."""
        start, end = clip["start_ms"] / 1000, clip["end_ms"] / 1000
        lang = self._subs_language(tr)
        if lang is None:
            return clip_words(tr.words, start, end)
        f = self._subs_file(clip, lang)
        if not f.is_file() and translate:
            self.translate_subtitles([clip["id"]])
        if not f.is_file():
            return None
        out: list[Word] = []
        for ln in json.loads(f.read_text(encoding="utf-8")):
            toks = ln["text"].split()
            if not toks:
                continue
            a, b = max(ln["start"], 0.0), min(max(ln["end"], ln["start"] + 0.3), end - start)
            step = (b - a) / len(toks)
            out += [
                Word(t, round(a + i * step, 3), round(a + (i + 1) * step, 3))
                for i, t in enumerate(toks)
            ]
        return out

    def _safety_file(self, clip: sqlite3.Row) -> Path:
        return self.paths.work_dir(clip["video_id"]) / "render" / clip["id"] / "safety.json"

    @staticmethod
    def _safety_key(spoken: str, text: str) -> str:
        return hashlib.sha1(f"{spoken}\n{text}".encode()).hexdigest()  # noqa: S324

    def _cached_safety(self, clip: sqlite3.Row, spoken: str, text: str) -> Any:
        """A verdict from the batch review, if it covered exactly this text."""
        from clipbot.select.llm import LLMResult

        f = self._safety_file(clip)
        if not f.is_file():
            return None
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("key") != self._safety_key(spoken, text):
            return None
        v = qa_mod.SafetyVerdict(**d["verdict"])
        return LLMResult(v, d["model"], "", 0, 0, 0.0)

    def review_safety(self, clip_ids: list[str]) -> int:
        """Review several finished clips in one free AI request and keep the
        verdicts for their checks. Returns how many were reviewed (0 if the AI
        could not answer: each clip's check then asks on its own)."""
        items, keys, rows = [], {}, {}
        for cid in clip_ids:
            c = self.conn.execute("SELECT * FROM clips WHERE id = ?", (cid,)).fetchone()
            if c is None:
                continue
            v = self._row(c["video_id"])
            cap = self.caption(c, v)
            if cap is None:
                continue
            tr = Transcript.from_json(Path(v["transcript_path"]).read_text(encoding="utf-8"))
            spoken = " ".join(
                w.w for w in clip_words(tr.words, c["start_ms"] / 1000, c["end_ms"] / 1000)
            )
            text = self.post_text(c, v, cap)
            items.append((cid, spoken, text))
            keys[cid], rows[cid] = self._safety_key(spoken, text), c
        if len(items) < 2:
            return 0
        try:
            res = self.router.complete_json(
                purpose="safety",
                messages=qa_mod.safety_batch_messages(items),
                validate=qa_mod.parse_safety_batch([i[0] for i in items]),
                schema=qa_mod.SAFETY_BATCH_SCHEMA,
                schema_name="safety",
                max_tokens=600 + 300 * len(items),
                min_context=0,
            )
        except NoFreeModelAvailable:
            return 0
        for cid, verdict in res.value.items():
            f = self._safety_file(rows[cid])
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(
                json.dumps({"key": keys[cid], "model": res.model, "verdict": asdict(verdict)}),
                encoding="utf-8",
            )
        return len(res.value)

    def _retry_at(self, e: Exception | None = None) -> datetime:
        """When to ask the free models again: after the daily reset when the free
        tier's daily limit is used up, else in 30 minutes."""
        if isinstance(e, DailyLimitReached) and e.reset_at:
            return max(datetime.fromtimestamp(e.reset_at, UTC), self.now() + timedelta(minutes=1))
        return self.now() + SELECT_RETRY_DELAY

    def _wait_for_model(self, clip_id: str, reason: str, e: Exception | None = None) -> None:
        retry = self._retry_at(e)
        with db.tx(self.conn):
            self.conn.execute(
                "UPDATE clips SET next_attempt_at = ?, state_reason = ?, updated_at = ? "
                "WHERE id = ?",
                (db.iso(retry), reason[:500], db.iso(self.now()), clip_id),
            )

    def revive_soft_rejections(self) -> list[str]:
        """Clips held back only by technical checks go back for checking, now that
        those checks only warn. Their content still gets the safety review."""
        if self.cfg.settings.safety.strict_qa:
            return []
        revived = []
        for r in self.conn.execute(
            "SELECT id, qa_json, render_path FROM clips WHERE state = 'qa_rejected'"
        ).fetchall():
            gates = json.loads(r["qa_json"] or "{}")
            failed = [
                n
                for n, g in gates.items()
                if not g.get("ok")
                and not (n == "safety" and str(g.get("detail", "")).startswith("not checked"))
            ]
            if not failed or not all(n in qa_mod.SOFT_GATES for n in failed):
                continue
            if not r["render_path"] or not Path(r["render_path"]).is_file():
                continue
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "clips",
                    r["id"],
                    expect="qa_rejected",
                    to="rendered",
                    reason="checking again: technical checks now only warn",
                    now=self.now(),
                    next_attempt_at=None,
                )
            revived.append(r["id"])
        return revived

    def localize_ready(self) -> str | None:
        """Rewrite one waiting clip's caption in the chosen language, if it was
        written in another. Returns the clip id, or None when nothing was done."""
        lang = self.cfg.settings.post.language
        c = self.conn.execute(
            "SELECT * FROM clips WHERE state IN ('qa_passed', 'scheduled', 'awaiting_approval') "
            "AND (caption_lang IS NULL OR caption_lang != ?) "
            "AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY score DESC LIMIT 1",
            (lang, db.iso(self.now())),
        ).fetchone()
        if c is None:
            return None
        v = self._row(c["video_id"])
        cap = self.caption(c, v)
        if cap is None:
            self._wait_for_model(c["id"], "caption waiting for a free AI model", self._llm_error)
            return None
        with db.tx(self.conn):
            self.conn.execute(
                "UPDATE clips SET post_text = ?, caption_lang = ?, updated_at = ? "
                "WHERE id = ? AND state = ?",
                (self.post_text(c, v, cap), lang, db.iso(self.now()), c["id"], c["state"]),
            )
        return c["id"]


def local_video_id(path: Path) -> str:
    """Stable 11-character id for a local file, from its size and first 8 MB."""
    h = hashlib.sha1()  # noqa: S324
    h.update(str(path.stat().st_size).encode())
    with path.open("rb") as f:
        h.update(f.read(8 * 1024 * 1024))
    return "f" + h.hexdigest()[:10]
