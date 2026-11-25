"""The run loop (brief 4.9 and 7).

Each tick, in order:
1. safety rails: PAUSE file, disk space, QA rejection rate
2. poll clips that are being published (always, even when paused: polling never posts)
3. forward new alerts to the notifier; send the daily digest at 20:00
4. discover new uploads every `poll_minutes`
5. move one video one stage forward (CPU-heavy work runs one video at a time)
6. hold mode: send new clips for approval, expire unanswered ones after 24 h
7. publish: inside a window, under the rolling 24 h cap, after the minimum gap,
   post the highest-scoring ready clip
"""

from __future__ import annotations

import json
import shutil
import signal
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from clipbot import db, runner, stats
from clipbot.config import POSTS_PER_DAY_CEILING, AppConfig
from clipbot.logging import get_logger
from clipbot.notify import Notifier
from clipbot.pipeline import Pipeline
from clipbot.publish import Publisher
from clipbot.select.llm import LLMAuthError
from clipbot.sources.youtube_api import YouTubeAuthError

log = get_logger(__name__)

APPROVAL_EXPIRY = timedelta(hours=24)
DIGEST_HOUR = 20
QA_WINDOW_VIDEOS = 10
QA_REJECT_LIMIT = 0.80
VIEWS_EVERY = timedelta(minutes=20)
MAX_PARALLEL_VIDEOS = 2  # videos clipped at the same time by the bot
RESUME = "Run `clipbot resume` when it is fixed."
POSTED = ("publishing", "published")


@dataclass
class TickReport:
    actions: list[str]

    def add(self, s: str) -> None:
        self.actions.append(s)


class Scheduler:
    def __init__(
        self,
        pipe: Pipeline,
        publisher: Publisher,
        notifier: Notifier,
        env_file: Path | None = None,
        fixed_poster: bool = True,
    ) -> None:
        self.pipe = pipe
        self.pub = publisher
        self.notifier = notifier
        self.conn = pipe.conn
        self.paths = pipe.paths
        self.env_file = env_file or (pipe.cfg.config_dir.parent / ".env")
        # Tests hand in fake posters and notifiers; keep those on reload.
        self._fixed_poster = fixed_poster
        self._settings_mtime = self._watched()
        # True in the long-running bot: videos are clipped in background threads
        # (runner.py) so ticks keep coming. False (tests, `clipbot tick`): inline.
        self.background = False

    @property
    def cfg(self) -> AppConfig:
        return self.pipe.cfg

    def _watched(self) -> tuple[float, ...]:
        d = self.pipe.cfg.config_dir
        tt = self.paths.root / "tiktok"
        files = (
            d / "settings.yaml",
            d / "sources.yaml",
            self.env_file,
            tt / "consent.json",
            tt / "accounts" / "clipbot.json",
        )
        return tuple(p.stat().st_mtime if p.is_file() else 0.0 for p in files)

    def reload_config(self) -> bool:
        """Pick up edits from the dashboard (settings, channels, keys) without a
        restart. An invalid file is reported and the running config is kept."""
        from clipbot.config import ConfigError, load_config
        from clipbot.notify import make_notifier
        from clipbot.publish import make_poster

        m = self._watched()
        if m == self._settings_mtime:
            return False
        self._settings_mtime = m
        try:
            cfg = load_config(self.cfg.config_dir, env_file=self.env_file)
        except ConfigError as e:
            self.pipe.alert("settings_invalid", f"Your settings were not reloaded: {e}")
            return False
        if cfg.settings.data_dir != self.cfg.settings.data_dir:
            cfg = cfg.model_copy(
                update={
                    "settings": cfg.settings.model_copy(
                        update={"data_dir": self.cfg.settings.data_dir}
                    )
                }
            )
        self.pipe.cfg = cfg
        self.pub.cfg = cfg
        self.pipe._yt = None  # rebuilt with the new keys on next use
        self.pipe._router = None
        if not self._fixed_poster:
            self.pub.poster = make_poster(cfg, self.paths)
            url = cfg.secrets.notify_url
            self.notifier = make_notifier(url.get_secret_value() if url else None)
        db.sync_sources(self.conn, cfg.sources)
        log.info("config_reloaded")
        return True

    def reload_settings(self) -> bool:  # kept for callers of the old name
        return self.reload_config()

    def needs_setup(self) -> str | None:
        s = self.cfg.secrets
        missing = [
            name
            for name, v in (("AI", s.openrouter_api_key), ("YouTube", s.youtube_api_key))
            if v is None or not v.get_secret_value()
        ]
        return " and ".join(missing) if missing else None

    @property
    def now(self) -> datetime:
        return self.pipe.now()

    def local(self, t: datetime | None = None) -> datetime:
        return (t or self.now).astimezone(self.cfg.settings.tz)

    # ------------------------------------------------------------------ pause

    def paused(self) -> tuple[bool, str]:
        if self.paths.pause_file.exists():
            return True, f"PAUSE file {self.paths.pause_file}"
        p = db.get_pause(self.conn, self.now)
        return p.paused, p.reason or ""

    def pause(self, reason: str, until: datetime | None = None) -> None:
        if db.get_pause(self.conn, self.now).paused:
            return
        db.set_pause(self.conn, reason, until)
        self.pipe.alert("auto_pause", f"Paused: {reason}. {RESUME}")

    def check_rails(self, r: TickReport) -> None:
        free_gb = shutil.disk_usage(self.paths.root).free / 1024**3
        need = self.cfg.settings.safety.min_free_disk_gb
        if free_gb < need:
            self.pause(f"only {free_gb:.1f} GB disk free (need {need:g} GB)")
            r.add("paused: disk")
        rate = self.qa_reject_rate()
        if rate is not None and rate > QA_REJECT_LIMIT:
            self.pause(
                f"QA rejected {rate:.0%} of clips from the last {QA_WINDOW_VIDEOS} "
                "videos; check the renders and settings"
            )
            r.add("paused: qa rate")

    def qa_reject_rate(self) -> float | None:
        rows = self.conn.execute(
            "SELECT v.id, SUM(c.state = 'qa_rejected') AS bad, COUNT(c.id) AS total "
            "FROM videos v JOIN clips c ON c.video_id = v.id "
            "WHERE c.state NOT IN ('selected', 'rendering', 'rendered', 'failed') "
            "GROUP BY v.id ORDER BY MAX(c.updated_at) DESC LIMIT ?",
            (QA_WINDOW_VIDEOS,),
        ).fetchall()
        if len(rows) < QA_WINDOW_VIDEOS:
            return None
        total = sum(r["total"] for r in rows)
        return sum(r["bad"] for r in rows) / total if total else None

    # ------------------------------------------------------------------ alerts

    def forward_alerts(self) -> int:
        last = int(db.kv_get(self.conn, "last_alert_event", "0") or 0)
        rows = self.conn.execute(
            "SELECT id, kind, message, clip_id FROM events WHERE level = 'alert' AND id > ? "
            "ORDER BY id",
            (last,),
        ).fetchall()
        for ev in rows:
            msg = ev["message"]
            paused, _ = self.paused()
            if paused and "clipbot resume" not in msg:
                msg += f"\n\nThe bot is paused. {RESUME}"
            self.notifier.send(f"clipbot: {ev['kind']}", msg, priority="high")
            with db.tx(self.conn):
                db.kv_set(self.conn, "last_alert_event", str(ev["id"]))
        return len(rows)

    def digest_text(self) -> str:
        since = db.iso(self.now - timedelta(hours=24))
        posted = self.conn.execute(
            "SELECT title, post_url FROM clips WHERE state = 'published' AND published_at >= ?",
            (since,),
        ).fetchall()
        queued = dict(
            self.conn.execute(
                "SELECT state, COUNT(*) FROM clips WHERE state IN "
                "('qa_passed', 'awaiting_approval', 'scheduled') GROUP BY state"
            ).fetchall()
        )
        rejected = self.conn.execute(
            "SELECT state_reason FROM clips WHERE state IN ('qa_rejected', 'rejected', "
            "'failed', 'skipped') AND updated_at >= ?",
            (since,),
        ).fetchall()
        reasons = Counter((r["state_reason"] or "?").split(":")[0] for r in rejected)
        cost = self.conn.execute(
            "SELECT COALESCE(SUM(json_extract(data_json, '$.cost_usd')), 0), COUNT(*) "
            "FROM events WHERE kind = 'llm_call' AND ts >= ?",
            (since,),
        ).fetchone()
        paused, why = self.paused()
        lines = [f"Posted in the last 24 h: {len(posted)}"]
        lines += [f"  - {r['title']}: {r['post_url'] or '(link pending)'}" for r in posted]
        lines.append("Queued: " + (", ".join(f"{k} {v}" for k, v in queued.items()) or "none"))
        lines.append(
            f"Not posted in the last 24 h: {len(rejected)}"
            + (
                " (" + ", ".join(f"{k} x{v}" for k, v in reasons.most_common(4)) + ")"
                if rejected
                else ""
            )
        )
        lines.append(f"AI calls: {cost[1]}, cost ${cost[0]:.4f}")
        lines.append(
            f"Status: {'PAUSED: ' + why if paused else 'running'}"
            + (" (dry run, nothing is really posted)" if self.cfg.settings.dry_run else "")
        )
        return "\n".join(lines)

    def maybe_refresh_views(self, r: TickReport) -> None:
        """Every 20 minutes, read the TikTok view counts of a few posted clips."""
        last = db.kv_get(self.conn, "views_refreshed_at")
        if last and self.now - db.parse_iso(last) < VIEWS_EVERY:
            return
        with db.tx(self.conn):
            db.kv_set(self.conn, "views_refreshed_at", db.iso(self.now))
        n = stats.refresh_views(self.conn, self.now)
        if n:
            r.add(f"views updated for {n} clip(s)")

    def maybe_digest(self, r: TickReport) -> None:
        local = self.local()
        today = local.date().isoformat()
        if local.hour < DIGEST_HOUR or db.kv_get(self.conn, "last_digest") == today:
            return
        text = self.digest_text()
        self.notifier.send(f"clipbot daily digest {today}", text)
        with db.tx(self.conn):
            db.kv_set(self.conn, "last_digest", today)
            db.log_event(self.conn, "digest", text)
        r.add("digest sent")

    def maybe_update_ytdlp(self, r: TickReport) -> None:
        """YouTube changes break yt-dlp regularly: update the standalone copy daily."""
        from clipbot.sources.providers.ytdlp import binary_path, ensure_binary, update_binary

        today = self.local().date().isoformat()
        if db.kv_get(self.conn, "ytdlp_updated") == today:
            return
        with db.tx(self.conn):
            db.kv_set(self.conn, "ytdlp_updated", today)
        tools = self.paths.tools
        if not binary_path(tools).is_file() and not ensure_binary(tools):
            return
        version = update_binary(tools)
        db.log_event(self.conn, "ytdlp_update", f"yt-dlp {version}")
        r.add(f"yt-dlp {version}")

    # ------------------------------------------------------------------ work

    def maybe_discover(self, r: TickReport) -> None:
        last = db.kv_get(self.conn, "last_discover_at")
        every = timedelta(minutes=self.cfg.settings.discovery.poll_minutes)
        if last and self.now - db.parse_iso(last) < every:
            return
        with db.tx(self.conn):
            db.kv_set(self.conn, "last_discover_at", db.iso(self.now))
        if not self.cfg.enabled_sources:
            return
        found = self.pipe.discover()
        r.add(f"discovered {len(found)}")

    def next_video(self) -> str | None:
        """The next video to move, skipping ones a fast worker (e.g. the dashboard,
        right after a link was pasted) is busy with."""
        now = db.iso(self.now)
        skip = db.claimed_videos(self.conn) | runner.running()
        for row in self.conn.execute(
            "SELECT id FROM videos WHERE (state IN ('discovered', 'acquired', 'selected') OR "
            "(state IN ('acquire_failed', 'transcribed') AND "
            "(next_attempt_at IS NULL OR next_attempt_at <= ?))) "
            "ORDER BY CASE state WHEN 'selected' THEN 0 WHEN 'transcribed' THEN 1 "
            "WHEN 'acquired' THEN 2 ELSE 3 END, created_at",
            (now,),
        ):
            if row["id"] not in skip:
                return row["id"]
        return None

    def work_one(self, r: TickReport) -> None:
        for cid in self.pipe.revive_soft_rejections():
            r.add(f"clip {cid}: checking again")
        cid = self.pipe.localize_ready()
        if cid:
            r.add(f"clip {cid}: caption rewritten in {self.cfg.settings.post.language}")
            return
        for table, rid in db.recover_stuck(self.conn, self.now):
            r.add(f"{table} {rid}: recovered from a stuck stage")
        vid = self.next_video()
        if vid and self.background:
            if len(runner.running()) < MAX_PARALLEL_VIDEOS:
                p = self.pipe
                runner.start(
                    self.cfg,
                    vid,
                    factory=lambda conn, cfg, paths: Pipeline(
                        conn,
                        cfg,
                        paths,
                        youtube=p._yt,
                        providers=p._providers,
                        router=p._router,
                        transcriber=p._transcribe,
                    ),
                    respect_pause=False,  # this tick already checked
                )
                r.add(f"video {vid}: clipping in the background")
                return
        elif vid:
            # A video goes from link to clips in one go.
            r.add(f"video {vid}: {' > '.join(self.pipe.fast_process(vid)) or 'waiting'}")
            return
        due = self.pipe.clips_due_for_qa()  # checks that waited for a free model
        if due:
            r.add(f"clip {due[0]}: {self.pipe.qa(due[0])}")

    # ------------------------------------------------------------------ hold mode

    def route_passed(self, r: TickReport) -> None:
        if self.cfg.settings.review_mode != "hold":
            return
        for c in self.conn.execute("SELECT * FROM clips WHERE state = 'qa_passed'").fetchall():
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "clips",
                    c["id"],
                    expect="qa_passed",
                    to="awaiting_approval",
                    reason="waiting for approval",
                    now=self.now,
                )
            sheet = Path(c["contact_sheet_path"]) if c["contact_sheet_path"] else None
            self.notifier.send(
                f"clipbot: approve clip {c['id']}?",
                f"{c['post_text']}\n\nApprove: clipbot approve {c['id']}\n"
                f"Reject: clipbot reject {c['id']}\n(expires in 24 h)",
                attachment=sheet,
            )
            r.add(f"sent {c['id']} for approval")
        cutoff = db.iso(self.now - APPROVAL_EXPIRY)
        for c in self.conn.execute(
            "SELECT id FROM clips WHERE state = 'awaiting_approval' AND state_changed_at < ?",
            (cutoff,),
        ).fetchall():
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "clips",
                    c["id"],
                    expect="awaiting_approval",
                    to="skipped",
                    reason="approval expired after 24 h",
                    now=self.now,
                )
            r.add(f"expired {c['id']}")

    def approve(self, clip_id: str) -> None:
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "clips",
                clip_id,
                expect="awaiting_approval",
                to="scheduled",
                reason="approved",
                now=self.now,
            )

    def reject(self, clip_id: str) -> None:
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "clips",
                clip_id,
                expect="awaiting_approval",
                to="rejected",
                reason="rejected by reviewer",
                now=self.now,
            )

    # ------------------------------------------------------------------ publish

    def in_window(self) -> bool:
        t = self.local().time()
        return any(w.contains(t) for w in self.cfg.settings.publish.windows)

    def deployed_waiting(self) -> bool:
        """Clips sent with "Deploy all" post without waiting for a posting window
        (the daily cap and the gap between posts still apply)."""
        return bool(
            self.conn.execute(
                "SELECT 1 FROM clips WHERE state = 'scheduled' AND deploy_at IS NOT NULL"
            ).fetchone()
        )

    def can_publish(self) -> tuple[bool, str]:
        paused, why = self.paused()
        if paused:
            return False, f"paused ({why})"
        if not self.in_window() and not self.deployed_waiting():
            return False, "outside posting windows"
        if self.conn.execute("SELECT 1 FROM clips WHERE state = 'publishing'").fetchone():
            return False, "a post is in progress"
        p = self.cfg.settings.publish
        limit = min(p.posts_per_day, POSTS_PER_DAY_CEILING)
        since = db.iso(self.now - timedelta(hours=24))
        recent = self.conn.execute(
            f"SELECT submitted_at FROM clips WHERE state IN {POSTED} AND submitted_at >= ? "
            "ORDER BY submitted_at DESC",
            (since,),
        ).fetchall()
        if len(recent) >= limit:
            return False, f"{len(recent)}/{limit} posts in the last 24 h"
        last = self.conn.execute(
            f"SELECT MAX(submitted_at) FROM clips WHERE state IN {POSTED}"
        ).fetchone()[0]
        if last and self.now - db.parse_iso(last) < timedelta(minutes=p.min_gap_minutes):
            return False, f"less than {p.min_gap_minutes} min since the last post"
        return True, "ok"

    def next_clip(self) -> str | None:
        """Retries and approved clips first, then the best new clip."""
        now = db.iso(self.now)
        window = self.in_window()
        row = self.conn.execute(
            "SELECT id FROM clips WHERE state = 'scheduled' AND "
            "(next_attempt_at IS NULL OR next_attempt_at <= ?) "
            + ("" if window else "AND deploy_at IS NOT NULL ")
            + "ORDER BY deploy_at IS NULL, deploy_at, score DESC LIMIT 1",
            (now,),
        ).fetchone()
        if row:
            return row["id"]
        if self.cfg.settings.review_mode == "hold" or not window:
            return None
        row = self.conn.execute(
            "SELECT id FROM clips WHERE state = 'qa_passed' ORDER BY score DESC, created_at LIMIT 1"
        ).fetchone()
        return row["id"] if row else None

    def maybe_publish(self, r: TickReport) -> None:
        ok, _ = self.can_publish()
        if not ok:
            return
        cid = self.next_clip()
        if cid:
            r.add(f"publish {cid}: {self.pub.start(cid)}")

    def poll_publishing(self, r: TickReport) -> None:
        for c in self.conn.execute("SELECT id FROM clips WHERE state = 'publishing'"):
            r.add(f"poll {c['id']}: {self.pub.poll(c['id'])}")

    # ------------------------------------------------------------------ tick

    def tick(self) -> TickReport:
        r = TickReport([])
        if self.reload_config():
            r.add("settings reloaded")
        with db.tx(self.conn):
            db.kv_set(self.conn, "last_tick_at", db.iso(self.now))
        self.check_rails(r)
        self.poll_publishing(r)
        paused, why = self.paused()
        missing = self.needs_setup()
        if missing and not paused:
            r.add(f"waiting for setup: add the {missing} key in the dashboard")
        elif not paused:
            try:
                self.maybe_discover(r)
                self.work_one(r)
                self.route_passed(r)
                self.maybe_publish(r)
            except (YouTubeAuthError, LLMAuthError) as e:
                self.pause(f"API key refused: {e}")
                r.add("paused: auth")
        else:
            r.add(f"paused: {why}")
        self.forward_alerts()
        if not missing:
            self.maybe_refresh_views(r)
            self.maybe_digest(r)
            self.maybe_update_ytdlp(r)
        return r


def run_forever(sched: Scheduler, interval_s: float = 30.0) -> None:
    """Tick every 30 s (publish polling needs that pace) until SIGTERM/SIGINT."""
    stop = {"flag": False}

    def _stop(*_: Any) -> None:
        stop["flag"] = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    sched.background = True
    recovered = db.recover_stuck(sched.conn, after=timedelta(0))  # nothing runs yet
    if recovered:
        log.warning("recovered_stuck_rows", rows=recovered)
    log.info(
        "run_started",
        dry_run=sched.cfg.settings.dry_run,
        review_mode=sched.cfg.settings.review_mode,
    )
    while not stop["flag"]:
        started = time.monotonic()
        try:
            rep = sched.tick()
            if rep.actions:
                log.info("tick", actions=rep.actions)
        except Exception as e:  # one bad tick must not kill the bot
            log.exception("tick_failed", error=str(e))
            sched.pipe.alert("tick_failed", f"{type(e).__name__}: {e}")
        while not stop["flag"] and time.monotonic() - started < interval_s:
            time.sleep(0.5)
    log.info("run_stopped")


def report_json(rep: TickReport) -> str:
    return json.dumps(rep.actions)
