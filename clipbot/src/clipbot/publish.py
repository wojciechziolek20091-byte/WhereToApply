"""Publishing a QA-passed clip (brief 4.8).

1. Re-check rights, and that the source video is still public.
2. Save a request_id in the database, then submit. The request_id is also the
   idempotency key, so a repeated submit can never create a second post.
3. Poll the vendor until the post is live or has definitely failed.
4. Map every error to an action: reject, retry with backoff, drop the privacy
   field, or pause the bot and alert.

Never double post: after a crash, a clip in `publishing` is resolved by polling
its stored request_id first. It is only resubmitted (with the same id) when the
vendor says it has never seen it.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path

from clipbot import db
from clipbot.config import AppConfig
from clipbot.logging import get_logger
from clipbot.models import DataPaths
from clipbot.post.base import Action, Poster, PosterError, PostStatus
from clipbot.sources.rights import Decision, check_rights
from clipbot.sources.youtube_api import YouTubeAPI, YouTubeError

log = get_logger(__name__)

RETRY_DELAYS = (timedelta(minutes=5), timedelta(minutes=15), timedelta(minutes=45))
POLL_EVERY = timedelta(seconds=30)
GIVE_UP_AFTER = timedelta(minutes=15)
NOT_FOUND_GRACE = timedelta(minutes=2)
MAX_CONSECUTIVE_FAILURES = 3


def make_poster(cfg: AppConfig, paths: DataPaths) -> Poster:
    """dry_run always wins: with it on, nothing ever reaches TikTok. Without a
    TikTok connection it also stays in practice mode."""
    from clipbot.post.dryrun import DryRunPoster

    s = cfg.settings
    if s.dry_run:
        return DryRunPoster(paths.root / "dryrun")
    if s.publish.poster == "tiktok_direct":
        from clipbot.post.tiktok_direct import TikTokDirectPoster

        tok = cfg.secrets.tiktok_access_token
        return TikTokDirectPoster(tok.get_secret_value() if tok else "")
    from clipbot.post.uploadpost import UploadPostPoster

    key = cfg.secrets.upload_post_api_key
    if key is None or not key.get_secret_value() or not cfg.secrets.upload_post_profile:
        # Practice mode stays on until TikTok is connected: never crash, never post.
        log.warning("practice_mode_no_tiktok")
        return DryRunPoster(paths.root / "dryrun")
    return UploadPostPoster(key.get_secret_value(), cfg.secrets.upload_post_profile)


class Publisher:
    def __init__(
        self,
        conn: sqlite3.Connection,
        cfg: AppConfig,
        poster: Poster,
        youtube: Callable[[], YouTubeAPI],
        alert: Callable[..., None],
        clock: Callable[[], datetime] = db.utcnow,
        source_by_id: Callable[[str], object] | None = None,
    ) -> None:
        self.conn = conn
        self.cfg = cfg
        self.poster = poster
        self._yt = youtube
        self.alert = alert
        self.now = clock
        self._source_by_id = source_by_id or cfg.source

    # ------------------------------------------------------------------ helpers

    def _clip(self, clip_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
        if row is None:
            raise LookupError(clip_id)
        return row

    def privacy(self) -> str | None:
        if db.kv_get(self.conn, "privacy_override") == "account_default":
            return None
        p = self.cfg.settings.publish.privacy
        return None if p == "account_default" else p

    def recheck_rights(self, clip: sqlite3.Row) -> Decision:
        v = self.conn.execute("SELECT * FROM videos WHERE id = ?", (clip["video_id"],)).fetchone()
        source = self._source_by_id(v["source_id"])
        today = self.now().astimezone(self.cfg.settings.tz).date()
        if v["license"] == "local_file":
            from clipbot.sources.youtube_api import VideoMeta

            meta = VideoMeta(
                v["id"],
                source.youtube_channel_id,
                "",
                "",
                None,
                0.0,
                "local_file",
                "public",
                "none",
                "processed",
                False,
            )
            return check_rights(source, meta, today)
        try:
            meta = self._yt().video(v["id"])
        except YouTubeError as e:
            return Decision(False, f"could not re-check the source: {e}")
        if meta is None:
            return Decision(False, "source video is gone or private")
        if meta.privacy_status != "public":
            return Decision(False, f"source video is now {meta.privacy_status}")
        return check_rights(source, meta, today)

    def _failure(self) -> None:
        """Count a failed publish. Always called inside a transaction."""
        n = int(db.kv_get(self.conn, "consecutive_failures", "0") or 0) + 1
        db.kv_set(self.conn, "consecutive_failures", str(n))
        if n >= MAX_CONSECUTIVE_FAILURES:
            db.set_pause_in_tx(self.conn, f"{n} publish failures in a row", None)
            self.alert(
                "publish_breaker",
                f"Paused after {n} publish failures in a row. "
                "Check the events, then run `clipbot resume`.",
            )

    # ------------------------------------------------------------------ start

    def start(self, clip_id: str) -> str:
        """Submit one clip. Returns the clip's new state."""
        c = self._clip(clip_id)
        if c["state"] not in ("qa_passed", "scheduled"):
            raise db.StateConflict(f"clip {clip_id} is {c['state']}")
        if db.get_pause(self.conn, self.now()).paused:
            return c["state"]
        rights = self.recheck_rights(c)
        if not rights:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "clips",
                    clip_id,
                    expect=c["state"],
                    to="skipped",
                    reason=f"rights re-check failed: {rights.reason}",
                    now=self.now(),
                )
            self.alert(
                "rights_recheck", f"clip {clip_id} skipped: {rights.reason}", clip_id=clip_id
            )
            return "skipped"
        attempt = (c["attempts"] or 0) + 1
        request_id = f"cb-{clip_id}-{attempt}"
        with db.tx(self.conn):  # stored before the upload: see module docstring
            db.transition(
                self.conn,
                "clips",
                clip_id,
                expect=c["state"],
                to="publishing",
                now=self.now(),
                request_id=request_id,
                poster=self.poster.name,
                submitted_at=db.iso(self.now()),
                attempts=attempt,
                next_attempt_at=None,
            )
        return self._submit(clip_id, request_id)

    def _submit(self, clip_id: str, request_id: str) -> str:
        c = self._clip(clip_id)
        try:
            res = self.poster.submit(
                Path(c["render_path"]), c["post_text"], self.privacy(), request_id
            )
        except PosterError as e:
            if e.code == "network_error":
                return "publishing"  # unknown outcome: the next poll decides
            return self.handle_error(clip_id, e)
        if res.request_id != request_id:
            with db.tx(self.conn):
                self.conn.execute(
                    "UPDATE clips SET request_id = ? WHERE id = ?", (res.request_id, clip_id)
                )
        db.log_event(
            self.conn,
            "publish_submit",
            f"submitted via {self.poster.name}",
            clip_id=clip_id,
            data={"request_id": res.request_id},
        )
        return "publishing"

    # ------------------------------------------------------------------ poll

    def poll(self, clip_id: str) -> str:
        c = self._clip(clip_id)
        if c["state"] != "publishing":
            return c["state"]
        try:
            st = self.poster.status(c["request_id"])
        except PosterError as e:
            if e.action == Action.PAUSE:
                return self.handle_error(clip_id, e)
            return "publishing"  # transient: try again next poll
        age = self.now() - db.parse_iso(c["submitted_at"])
        if st.state == "published":
            return self._published(clip_id, st)
        if st.state == "failed":
            return self.handle_error(
                clip_id, PosterError(st.error_code or "tiktok_publish_failed", st.message)
            )
        if st.state == "inbox":
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "clips",
                    clip_id,
                    expect="publishing",
                    to="failed",
                    reason="sent to TikTok drafts instead of posted",
                    now=self.now(),
                )
                self._failure()
            self.alert(
                "publish_inbox",
                f"clip {clip_id} landed in your TikTok drafts "
                "(inbox). Open the TikTok app to publish or delete it.",
                clip_id=clip_id,
            )
            return "failed"
        if st.state == "not_found":
            if age < NOT_FOUND_GRACE:
                return "publishing"
            key = f"resubmitted:{c['request_id']}"
            if db.kv_get(self.conn, key) is None:
                # Never received (e.g. crash before the upload). Same id, so the
                # vendor's idempotency check makes this safe.
                with db.tx(self.conn):
                    db.kv_set(self.conn, key, db.iso(self.now()))
                log.warning("publish_resubmit", clip_id=clip_id, request_id=c["request_id"])
                return self._submit(clip_id, c["request_id"])
        if age > GIVE_UP_AFTER:
            with db.tx(self.conn):
                db.transition(
                    self.conn,
                    "clips",
                    clip_id,
                    expect="publishing",
                    to="failed",
                    reason=f"no final status after {GIVE_UP_AFTER} "
                    f"({st.state}); check TikTok before reposting",
                    now=self.now(),
                )
                self._failure()
            self.alert(
                "publish_timeout",
                f"clip {clip_id}: no final status after 15 "
                "minutes. Check your TikTok profile; it was not resent.",
                clip_id=clip_id,
            )
            return "failed"
        return "publishing"

    def _published(self, clip_id: str, st: PostStatus) -> str:
        with db.tx(self.conn):
            db.transition(
                self.conn,
                "clips",
                clip_id,
                expect="publishing",
                to="published",
                reason="published",
                now=self.now(),
                post_url=st.post_url,
                published_at=db.iso(self.now()),
            )
            db.kv_set(self.conn, "consecutive_failures", "0")
            db.log_event(
                self.conn,
                "published",
                st.post_url or "published",
                clip_id=clip_id,
                data={"post_id": st.post_id},
            )
        return "published"

    # ------------------------------------------------------------------ errors

    def handle_error(self, clip_id: str, e: PosterError) -> str:
        c = self._clip(clip_id)
        action = e.action
        now = self.now()
        log.warning("publish_error", clip_id=clip_id, code=e.code, action=action.value)

        def back_to_scheduled(at: datetime | None, reason: str) -> None:
            db.transition(
                self.conn,
                "clips",
                clip_id,
                expect="publishing",
                to="scheduled",
                reason=reason,
                now=now,
                next_attempt_at=db.iso(at) if at else None,
            )

        with db.tx(self.conn):
            db.log_event(
                self.conn,
                "publish_error",
                str(e),
                level="warning",
                clip_id=clip_id,
                data={"code": e.code, "action": action.value},
            )
            if action == Action.REJECT:
                db.transition(
                    self.conn,
                    "clips",
                    clip_id,
                    expect="publishing",
                    to="rejected",
                    reason=f"TikTok rejected it: {e}",
                    now=now,
                )
                self._failure()
                result = "rejected"
            elif action == Action.RETRY:
                done = c["attempts"] or 1
                if done <= len(RETRY_DELAYS):
                    back_to_scheduled(now + RETRY_DELAYS[done - 1], f"retrying after {e}")
                    result = "scheduled"
                else:
                    db.transition(
                        self.conn,
                        "clips",
                        clip_id,
                        expect="publishing",
                        to="failed",
                        reason=f"gave up after {done} tries: {e}",
                        now=now,
                    )
                    self._failure()
                    result = "failed"
            elif action == Action.DROP_PRIVACY:
                db.kv_set(self.conn, "privacy_override", "account_default")
                # The retry is a new attempt with a new id: nothing was posted.
                back_to_scheduled(None, "privacy level unavailable; using account default")
                result = "scheduled"
            elif action == Action.WAIT_1H_ONCE:
                key = f"waited_cap:{clip_id}"
                if db.kv_get(self.conn, key):
                    db.transition(
                        self.conn,
                        "clips",
                        clip_id,
                        expect="publishing",
                        to="failed",
                        reason=f"still capped after waiting: {e}",
                        now=now,
                    )
                    self._failure()
                    result = "failed"
                else:
                    db.kv_set(self.conn, key, db.iso(now))
                    back_to_scheduled(now + timedelta(hours=1), f"waiting an hour: {e}")
                    result = "scheduled"
            else:  # pauses: the clip itself is fine and posts after resume
                hours = {Action.PAUSE_24H: 24, Action.PAUSE_7D: 24 * 7}.get(action)
                until = now + timedelta(hours=hours) if hours else None
                back_to_scheduled(None, f"paused: {e}")
                db.set_pause_in_tx(self.conn, f"{e.code}: {e}", until)
                result = "scheduled"

        if action == Action.DROP_PRIVACY:
            self.alert(
                "privacy_dropped",
                f"Your TikTok account does not allow the privacy "
                f"level {self.cfg.settings.publish.privacy}; posting with the "
                "account's default instead.",
                clip_id=clip_id,
            )
        elif action in (Action.PAUSE, Action.PAUSE_24H, Action.PAUSE_7D):
            how = {
                Action.PAUSE: "until you fix it",
                Action.PAUSE_24H: "for 24 hours",
                Action.PAUSE_7D: "for 7 days",
            }[action]
            self.alert(
                "publish_paused",
                f"Posting paused {how}: {e}. After fixing, run `clipbot resume`.",
                clip_id=clip_id,
                code=e.code,
            )
        elif action == Action.WAIT_1H_ONCE and result == "failed":
            self.alert(
                "publish_capped",
                f"clip {clip_id}: TikTok's daily app cap is still reached after an hour.",
                clip_id=clip_id,
            )
        return result
