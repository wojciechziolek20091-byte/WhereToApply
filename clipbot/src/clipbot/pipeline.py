"""Stage orchestration. Phase 1: discover (RSS + URL), rights gate, acquire.

Each stage reads its input state, does the work, then flips state in one
transaction, so re-running a stage after a crash is safe.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from clipbot import db
from clipbot import qa as qa_mod
from clipbot.assets import AssetError, face_model, font_files
from clipbot.config import AppConfig, Source
from clipbot.logging import get_logger
from clipbot.media import ProbeError, probe
from clipbot.models import DataPaths
from clipbot.post.text import build_post_text, youtube_url
from clipbot.render.captions import CaptionLayout, build_ass, clip_words, count_caption_words
from clipbot.render.encode import EncodeSettings, RenderError, contact_sheet, render_clip
from clipbot.render.reframe import FaceDetector, plan_clip
from clipbot.select.llm import FreeModelRouter, LLMAuthError, NoFreeModelAvailable
from clipbot.select.prompt import (
    CLIP_SCHEMA,
    build_messages,
    parse_selection,
    transcript_lines,
    windows,
)
from clipbot.select.snap import SnapRules, merge_window_candidates, plan_clips
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
from clipbot.transcribe import Transcript, transcript_path
from clipbot.transcribe import transcribe as run_transcribe

log = get_logger(__name__)

# After the first failed download: retry after 1 h, 6 h, 16 h (about 24 h in all),
# then give up and alert (brief 4.2).
ACQUIRE_RETRY_DELAYS = (timedelta(hours=1), timedelta(hours=6), timedelta(hours=16))
# When every free model is busy, selection waits and tries again.
SELECT_RETRY_DELAY = timedelta(minutes=30)


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

    def rules(self) -> SnapRules:
        c = self.cfg.settings.clips
        return SnapRules(
            min_seconds=c.min_seconds,
            max_seconds=c.max_seconds,
            pre_roll=c.pre_roll,
            post_roll=c.post_roll,
            min_score=c.min_score,
            per_video=c.per_video,
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
        log_dir = self.paths.work_dir(video_id) / "select"
        log_dir.mkdir(parents=True, exist_ok=True)

        wins = windows(tr.duration)
        per_window = []
        total_cost = 0.0
        try:
            for i, (ws, we) in enumerate(wins):
                lines = transcript_lines(tr.segments, ws, we)
                if not lines.strip():
                    continue
                messages = build_messages(
                    lines,
                    topics_hint=source.topics_hint,
                    min_s=clips.min_seconds,
                    max_s=clips.max_seconds,
                    n=max(clips.per_video * 2, 5),
                    window=(ws, we) if len(wins) > 1 else None,
                )
                res = self.router.complete_json(
                    purpose="select",
                    messages=messages,
                    validate=parse_selection,
                    schema=CLIP_SCHEMA,
                    schema_name="clips",
                    max_tokens=6000,
                )
                cands, errors = res.value
                per_window.append(cands)
                total_cost += res.cost_usd
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
                (log_dir / f"window_{i}.json").write_text(
                    json.dumps(call, indent=1, ensure_ascii=False), encoding="utf-8"
                )
                db.log_event(
                    self.conn,
                    "llm_call",
                    f"select window {i}: {res.model}",
                    video_id=video_id,
                    data={
                        k: call[k] for k in ("model", "input_tokens", "output_tokens", "cost_usd")
                    }
                    | {"attempts": len(res.attempts), "candidates": len(cands)},
                )
        except NoFreeModelAvailable as e:
            retry = self.now() + SELECT_RETRY_DELAY
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

        merged = merge_window_candidates(per_window)
        plan = plan_clips(video_id, merged, tr.words, tr.duration, self.rules())
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
                cost_usd=(row["cost_usd"] or 0) + total_cost,
            )
            db.log_event(
                self.conn,
                "select",
                reason,
                video_id=video_id,
                data={
                    "kept": [c.clip_id for c in plan.kept],
                    "dropped": [d.reason for d in plan.dropped],
                    "cost_usd": total_cost,
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
                "ORDER BY score DESC LIMIT 1",
                (video_id,),
            ).fetchone()
            if nxt is not None:
                self.render(nxt["id"])
                return "rendering"  # keep going until every clip is rendered
            due_qa = self.clips_due_for_qa(video_id)
            if due_qa:
                self.qa(due_qa[0])
                return "checking"
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
        with db.tx(self.conn):
            db.transition(
                self.conn, "clips", clip_id, expect="selected", to="rendering", now=self.now()
            )
        start, end = c["start_ms"] / 1000, c["end_ms"] / 1000
        src = Path(v["raw_path"])
        work = self.paths.work_dir(v["id"]) / "render" / clip_id
        out = self.paths.render(clip_id)
        sheet = self.paths.contact_sheet(clip_id)
        try:
            info = probe(src)
            scenes = plan_clip(src, self.face_detector(), start, end, info.width, info.height)
            tr = Transcript.from_json(Path(v["transcript_path"]).read_text(encoding="utf-8"))
            words = clip_words(tr.words, start, end)
            ass = build_ass(words, end - start, c["hook"], self.caption_layout())
            render_clip(
                src, start, end, scenes, ass, font_files(), out, work, self.encode_settings()
            )
            contact_sheet(out, sheet, end - start)
        except (RenderError, AssetError, ProbeError, OSError) as e:
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

    def post_text(self, clip: sqlite3.Row, video: sqlite3.Row) -> str:
        source = self.source_by_id(video["source_id"])
        return build_post_text(
            hook=clip["hook"],
            summary=clip["summary"],
            model_tags=json.loads(clip["hashtags_json"] or "[]"),
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
        text = self.post_text(c, v)
        render = Path(c["render_path"] or "")
        lim = self.cfg.settings.clips

        gates: dict[str, qa_mod.Gate] = {}
        info, err = qa_mod.probe_or_none(render)
        gates["spec"] = qa_mod.gate_spec(info, lim.min_seconds, lim.max_seconds, err)
        gates["speech"] = qa_mod.gate_speech(words, end - start)
        if info is not None:
            gates["loudness"] = qa_mod.gate_loudness(qa_mod.measure_lufs(render))
            black, freezes = qa_mod.measure_black_and_frozen(render)
            static = {
                f: qa_mod.source_static_share(Path(v["raw_path"]), start + f[0], start + f[1])
                for f in freezes
                if f[1] - f[0] > qa_mod.MAX_BLACK_OR_FROZEN
            }
            gates["visual"] = qa_mod.gate_visual(black, freezes, static)
        gates["caption_sync"] = qa_mod.gate_caption_sync(ass, len(words))
        gates["transformation"] = qa_mod.gate_transformation(ass, source.rights, text)
        others = [
            (r["id"], r["start_ms"] / 1000, r["end_ms"] / 1000)
            for r in self.conn.execute(
                f"SELECT id, start_ms, end_ms FROM clips WHERE video_id = ? AND id != ? "
                f"AND state IN ({','.join('?' * len(qa_mod.ACTIVE_STATES))})",
                (v["id"], clip_id, *qa_mod.ACTIVE_STATES),
            )
        ]
        gates["duplicates"] = qa_mod.gate_duplicates(clip_id, start, end, others)

        # Only spend a model call when everything else passed.
        if all(g.ok for g in gates.values()):
            spoken = " ".join(w.w for w in words)
            try:
                res = self.router.complete_json(
                    purpose="safety",
                    messages=qa_mod.safety_messages(spoken, text),
                    validate=qa_mod.parse_safety,
                    schema=qa_mod.SAFETY_SCHEMA,
                    schema_name="safety",
                    max_tokens=1500,
                    min_context=0,
                )
            except NoFreeModelAvailable as e:
                retry = self.now() + SELECT_RETRY_DELAY
                with db.tx(self.conn):
                    self.conn.execute(
                        "UPDATE clips SET next_attempt_at = ?, state_reason = ?, "
                        "updated_at = ? WHERE id = ?",
                        (
                            db.iso(retry),
                            f"safety check waiting: {e}"[:500],
                            db.iso(self.now()),
                            clip_id,
                        ),
                    )
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

        result = qa_mod.QAResult(gates)
        to = "qa_passed" if result.passed else "qa_rejected"
        reason = "all gates passed" if result.passed else result.first_failure
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


def local_video_id(path: Path) -> str:
    """Stable 11-character id for a local file, from its size and first 8 MB."""
    h = hashlib.sha1()  # noqa: S324
    h.update(str(path.stat().st_size).encode())
    with path.open("rb") as f:
        h.update(f.read(8 * 1024 * 1024))
    return "f" + h.hexdigest()[:10]
