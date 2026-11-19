"""Phase 5: posters and the publish flow, with every error-table row covered."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from clipbot import db
from clipbot.post.base import Action, PosterError, PostStatus, SubmitResult, classify
from clipbot.post.dryrun import DryRunPoster
from clipbot.post.uploadpost import UploadPostPoster
from clipbot.publish import RETRY_DELAYS, Publisher
from tests.factories import meta

T0 = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------- error table


@pytest.mark.parametrize(
    ("code", "status", "action"),
    [
        ("tiktok_media_rejected", None, Action.REJECT),
        ("content_rejected", None, Action.REJECT),
        ("tiktok_publish_failed", None, Action.RETRY),
        ("http_502", 502, Action.RETRY),
        ("http_429", 429, Action.RETRY),
        ("tiktok_privacy_unavailable", 400, Action.DROP_PRIVACY),
        ("tiktok_reconnect_required", 400, Action.PAUSE),
        ("unauthorized", 401, Action.PAUSE),
        ("whatever", 401, Action.PAUSE),
        ("spam_risk_too_many_posts", None, Action.PAUSE_24H),
        ("spam_risk_too_many_pending_share", None, Action.PAUSE_24H),
        ("spam_risk_user_banned_from_posting", None, Action.PAUSE_7D),
        ("reached_active_user_cap", None, Action.WAIT_1H_ONCE),
        ("daily_cap", 429, Action.PAUSE_24H),
        ("monthly_limit", 429, Action.PAUSE),
        ("plan_required", 403, Action.PAUSE),
    ],
)
def test_classify(code: str, status: int | None, action: Action) -> None:
    assert classify(code, status) is action


# ---------------------------------------------------------------- Upload-Post HTTP


def up(handler) -> UploadPostPoster:
    http = httpx.Client(transport=httpx.MockTransport(handler), base_url="https://up.test")
    return UploadPostPoster("KEY123", "my-profile", http=http)


def test_submit_request_shape(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def h(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(
            200,
            json={
                "success": True,
                "request_id": "cb-x-1",
                "message": "Upload initiated successfully",
            },
        )

    video = tmp_path / "c.mp4"
    video.write_bytes(b"\x00" * 100)
    res = up(h).submit(video, "Hook\n\n#a", None, "cb-x-1")
    assert res == SubmitResult("cb-x-1")
    r = seen[0]
    assert r.method == "POST" and r.url.path == "/api/upload"
    assert r.headers["Authorization"] == "Apikey KEY123"
    assert r.headers["Idempotency-Key"] == "cb-x-1"
    body = r.content.decode("latin-1")
    for field, value in [
        ("user", "my-profile"),
        ("platform[]", "tiktok"),
        ("title", "Hook\n\n#a"),
        ("async_upload", "true"),
        ("request_id", "cb-x-1"),
        ("disable_inbox_fallback", "true"),
        ("post_mode", "DIRECT_POST"),
        ("is_aigc", "false"),
    ]:
        assert f'name="{field}"\r\n\r\n{value}\r\n' in body, field
    assert 'name="privacy_level"' not in body  # account default
    assert 'name="video"; filename="c.mp4"' in body


def test_submit_sends_privacy_when_set(tmp_path: Path) -> None:
    seen = []
    poster = up(lambda r: seen.append(r) or httpx.Response(200, json={"success": True}))
    v = tmp_path / "c.mp4"
    v.write_bytes(b"x")
    poster.submit(v, "t", "SELF_ONLY", "id1")
    assert 'name="privacy_level"\r\n\r\nSELF_ONLY' in seen[0].content.decode("latin-1")


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (401, {"success": False, "message": "Invalid or expired token"}, "unauthorized"),
        (
            403,
            {"success": False, "message": "TikTok uploads are not available on the Free plan"},
            "plan_required",
        ),
        (404, {"success": False, "message": "User not found"}, "profile_not_found"),
        (
            429,
            {
                "success": False,
                "message": "Post verification failed",
                "violations": [{"platform": "tiktok", "type": "hard_cap"}],
            },
            "daily_cap",
        ),
        (
            429,
            {"success": False, "message": "This upload would exceed your monthly limit."},
            "monthly_limit",
        ),
        (
            400,
            {"success": False, "error_code": "tiktok_privacy_unavailable"},
            "tiktok_privacy_unavailable",
        ),
        (500, {"success": False, "error": "boom"}, "http_500"),
        (
            200,
            {
                "success": True,
                "results": {
                    "tiktok": {
                        "success": False,
                        "error_code": "tiktok_media_rejected",
                        "error": "bad fps",
                    }
                },
            },
            "tiktok_media_rejected",
        ),
    ],
)
def test_submit_errors(tmp_path: Path, status: int, body: dict, code: str) -> None:
    v = tmp_path / "c.mp4"
    v.write_bytes(b"x")
    with pytest.raises(PosterError) as ei:
        up(lambda r: httpx.Response(status, json=body)).submit(v, "t", None, "id")
    assert ei.value.code == code


def status_body(**tt: Any) -> dict:
    return {
        "request_id": "id",
        "status": tt.pop("_top", "completed"),
        "results": [{"platform": "tiktok", **tt}],
    }


@pytest.mark.parametrize(
    ("http", "body", "state", "extra"),
    [
        (
            200,
            status_body(
                status="completed",
                success=True,
                post_url="https://www.tiktok.com/@me/video/1",
                platform_post_id="1",
            ),
            "published",
            "https://www.tiktok.com/@me/video/1",
        ),
        (200, status_body(status="completed", success=True, post_url=None), "published", None),
        (
            200,
            status_body(
                _top="failed", status="failed", success=False, error_code="spam_risk_too_many_posts"
            ),
            "failed",
            "spam_risk_too_many_posts",
        ),
        (200, status_body(_top="in_progress", status="processing"), "pending", None),
        (200, status_body(_top="in_progress", status="retryable"), "pending", None),
        (
            200,
            status_body(
                status="completed",
                success=True,
                fallback_to_inbox=True,
                post_url="Video sent to Inbox (No Public URL)",
            ),
            "inbox",
            None,
        ),
        (404, {"status": "not_found"}, "not_found", None),
    ],
)
def test_status_parsing(http: int, body: dict, state: str, extra: str | None) -> None:
    st = up(lambda r: httpx.Response(http, json=body)).status("id")
    assert st.state == state
    if state == "published":
        assert st.post_url == extra
    if state == "failed":
        assert st.error_code == extra


def test_tiktok_connection_check() -> None:
    body = {
        "success": True,
        "profiles": [
            {"username": "other", "social_accounts": {}},
            {
                "username": "my-profile",
                "social_accounts": {"tiktok": {"handle": "@me", "reauth_required": False}},
            },
        ],
    }
    ok, msg = up(lambda r: httpx.Response(200, json=body)).tiktok_connected()
    assert ok and "@me" in msg
    body["profiles"][1]["social_accounts"]["tiktok"]["reauth_required"] = True
    assert not up(lambda r: httpx.Response(200, json=body)).tiktok_connected()[0]
    body["profiles"][1]["social_accounts"]["tiktok"] = ""
    assert not up(lambda r: httpx.Response(200, json=body)).tiktok_connected()[0]


def test_dryrun_poster(tmp_path: Path) -> None:
    p = DryRunPoster(tmp_path / "dry")
    p.submit(tmp_path / "c.mp4", "caption", None, "rid")
    assert json.loads((tmp_path / "dry" / "rid.json").read_text())["caption"] == "caption"
    assert p.status("rid").state == "published" and p.status("nope").state == "not_found"


# ---------------------------------------------------------------- publish flow


class FakePoster:
    name = "fake"

    def __init__(self) -> None:
        self.submits: list[tuple[str, str | None]] = []
        self.submit_errors: list[PosterError] = []
        self.statuses: dict[str, list[PostStatus]] = {}
        self.known: set[str] = set()

    def submit(self, video: Path, text: str, privacy: str | None, request_id: str):
        self.submits.append((request_id, privacy))
        if self.submit_errors:
            raise self.submit_errors.pop(0)
        self.known.add(request_id)
        return SubmitResult(request_id)

    def status(self, request_id: str) -> PostStatus:
        if request_id not in self.known:
            return PostStatus("not_found")
        q = self.statuses.get(request_id) or [PostStatus("pending")]
        return q.pop(0) if len(q) > 1 else q[0]


class FakeYT:
    def __init__(self, m=None) -> None:
        self.m = m

    def video(self, vid: str):
        return self.m


def seed(env, *, license_: str = "youtube", source: str = "mine") -> str:
    conn = env[2]
    now = db.iso(T0)
    conn.execute(
        "INSERT INTO videos(id, source_id, title, channel_title, license, state, "
        "state_changed_at, created_at, updated_at) VALUES "
        "('aaaaaaaaaaa', ?, 'T', 'Chan', ?, 'done', ?, ?, ?)",
        (source, license_, now, now, now),
    )
    render = env[1].renders / "c1.mp4"
    render.parent.mkdir(parents=True, exist_ok=True)
    render.write_bytes(b"x")
    conn.execute(
        "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, "
        "summary, state, state_changed_at, render_path, post_text, created_at, "
        "updated_at) VALUES ('c1', 'aaaaaaaaaaa', 0, 30000, 90, 'h', 't', 's', "
        "'qa_passed', ?, ?, 'caption', ?, ?)",
        (now, str(render), now, now),
    )
    return "c1"


def publisher(env, poster, yt_meta="default", now=None):
    clock = now or [T0]
    alerts: list[tuple[str, str]] = []
    m = meta("aaaaaaaaaaa") if yt_meta == "default" else yt_meta
    pub = Publisher(
        env[2],
        env[0],
        poster,
        youtube=lambda: FakeYT(m),
        alert=lambda kind, msg, **kw: alerts.append((kind, msg)),
        clock=lambda: clock[0],
    )
    return pub, alerts, clock


def clip(env) -> Any:
    return env[2].execute("SELECT * FROM clips WHERE id='c1'").fetchone()


def test_happy_path(env) -> None:
    seed(env)
    poster = FakePoster()
    poster.statuses["cb-c1-1"] = [
        PostStatus("pending"),
        PostStatus("published", post_url="https://tt/1"),
    ]
    pub, alerts, _ = publisher(env, poster)
    assert pub.start("c1") == "publishing"
    assert clip(env)["request_id"] == "cb-c1-1"
    assert pub.poll("c1") == "publishing"
    assert pub.poll("c1") == "published"
    assert clip(env)["post_url"] == "https://tt/1" and alerts == []


def test_media_rejected_is_never_retried(env) -> None:
    seed(env)
    poster = FakePoster()
    poster.submit_errors = [PosterError("tiktok_media_rejected", "bad file")]
    pub, _, _ = publisher(env, poster)
    assert pub.start("c1") == "rejected"
    with pytest.raises(db.StateConflict):
        pub.start("c1")
    assert len(poster.submits) == 1


@pytest.mark.parametrize(
    "err",
    [
        PosterError("tiktok_publish_failed"),
        PosterError("http_503", http_status=503),
        PosterError("http_429", http_status=429),
    ],
)
def test_retry_backoff_5_15_45_then_fail(env, err: PosterError) -> None:
    seed(env)
    poster = FakePoster()
    poster.submit_errors = [err] * 4
    pub, _, clock = publisher(env, poster)
    assert pub.start("c1") == "scheduled"
    for delay in RETRY_DELAYS:
        due = db.parse_iso(clip(env)["next_attempt_at"])
        assert due == clock[0] + delay
        clock[0] = due
        result = pub.start("c1")
    assert result == "failed" and len(poster.submits) == 4
    assert [rid for rid, _ in poster.submits] == [f"cb-c1-{i}" for i in range(1, 5)]


def test_privacy_unavailable_drops_privacy_field(env) -> None:
    seed(env)
    env[2].execute("DELETE FROM kv")
    poster = FakePoster()
    poster.submit_errors = [PosterError("tiktok_privacy_unavailable", http_status=400)]
    cfg = env[0].model_copy(
        update={
            "settings": env[0].settings.model_copy(
                update={
                    "publish": env[0].settings.publish.model_copy(update={"privacy": "SELF_ONLY"})
                }
            )
        }
    )
    pub, alerts, _ = publisher((cfg, env[1], env[2]), poster)
    assert pub.start("c1") == "scheduled"
    assert pub.start("c1") == "publishing"
    assert [p for _, p in poster.submits] == ["SELF_ONLY", None]
    assert alerts[0][0] == "privacy_dropped"


@pytest.mark.parametrize(
    ("err", "hours"),
    [
        (PosterError("tiktok_reconnect_required", http_status=400), None),
        (PosterError("unauthorized", http_status=401), None),
        (PosterError("spam_risk_too_many_posts"), 24),
        (PosterError("spam_risk_user_banned_from_posting"), 24 * 7),
    ],
)
def test_pausing_errors(env, err: PosterError, hours: int | None) -> None:
    seed(env)
    poster = FakePoster()
    poster.submit_errors = [err]
    pub, alerts, _ = publisher(env, poster)
    assert pub.start("c1") == "scheduled"  # the clip is fine; it posts after resume
    p = db.get_pause(env[2], T0)
    assert p.paused and err.code in (p.reason or "")
    assert (p.until is None) if hours is None else (p.until == T0 + timedelta(hours=hours))
    assert alerts[-1][0] == "publish_paused" and "clipbot resume" in alerts[-1][1]
    assert pub.start("c1") == "scheduled"  # while paused nothing is submitted
    assert len(poster.submits) == 1


def test_active_user_cap_waits_once(env) -> None:
    seed(env)
    poster = FakePoster()
    poster.submit_errors = [PosterError("reached_active_user_cap")] * 2
    pub, alerts, clock = publisher(env, poster)
    assert pub.start("c1") == "scheduled"
    assert db.parse_iso(clip(env)["next_attempt_at"]) == T0 + timedelta(hours=1)
    clock[0] += timedelta(hours=1)
    assert pub.start("c1") == "failed"
    assert alerts[-1][0] == "publish_capped"


def test_failure_found_by_polling_is_handled_too(env) -> None:
    seed(env)
    poster = FakePoster()
    poster.statuses["cb-c1-1"] = [PostStatus("failed", error_code="tiktok_media_rejected")]
    pub, _, _ = publisher(env, poster)
    pub.start("c1")
    assert pub.poll("c1") == "rejected"


def test_inbox_fallback_is_reported(env) -> None:
    seed(env)
    poster = FakePoster()
    poster.statuses["cb-c1-1"] = [PostStatus("inbox")]
    pub, alerts, _ = publisher(env, poster)
    pub.start("c1")
    assert pub.poll("c1") == "failed" and alerts[-1][0] == "publish_inbox"


def test_breaker_pauses_after_three_failures(env) -> None:
    seed(env)
    conn = env[2]
    poster = FakePoster()
    pub, alerts, _ = publisher(env, poster)
    for _ in range(3):
        conn.execute("UPDATE clips SET state='qa_passed', attempts=0 WHERE id='c1'")
        poster.submit_errors = [PosterError("tiktok_media_rejected")]
        pub.start("c1")
    assert db.get_pause(conn, T0).paused
    assert any(k == "publish_breaker" for k, _ in alerts)


def test_success_resets_failure_count(env) -> None:
    seed(env)
    db.kv_set(env[2], "consecutive_failures", "2")
    poster = FakePoster()
    poster.statuses["cb-c1-1"] = [PostStatus("published")]
    pub, _, _ = publisher(env, poster)
    pub.start("c1")
    pub.poll("c1")
    assert db.kv_get(env[2], "consecutive_failures") == "0"


# ---------------------------------------------------------------- rights re-check


@pytest.mark.parametrize(
    ("m", "why"),
    [
        (None, "gone or private"),
        (meta("aaaaaaaaaaa", privacy_status="private"), "now private"),
    ],
)
def test_rights_recheck_blocks_publish(env, m, why: str) -> None:
    seed(env)
    poster = FakePoster()
    pub, _, _ = publisher(env, poster, yt_meta=m)
    assert pub.start("c1") == "skipped"
    assert why in clip(env)["state_reason"] and poster.submits == []


def test_cc_license_withdrawn_blocks_publish(env, config_dir: Path) -> None:
    from clipbot.sources.rights import adhoc_cc_source

    m = meta("aaaaaaaaaaa", license="youtube")
    src = adhoc_cc_source(m)
    env[2].execute(
        "INSERT INTO sources(id, youtube_channel_id, name, rights, enabled, "
        "config_json, updated_at) VALUES (?, ?, ?, 'cc_by', 0, ?, ?)",
        (src.id, src.youtube_channel_id, src.name, src.model_dump_json(), db.iso(T0)),
    )
    seed(env, source=src.id)
    pub, _, _ = publisher(env, FakePoster(), yt_meta=m)
    pub._source_by_id = lambda sid: src
    assert pub.start("c1") == "skipped"
    assert "license is 'youtube'" in clip(env)["state_reason"]


def test_local_file_needs_no_youtube_check(env) -> None:
    seed(env, license_="local_file")
    poster = FakePoster()
    pub, _, _ = publisher(env, poster, yt_meta=None)  # YouTube would say "gone"
    assert pub.start("c1") == "publishing"


# ---------------------------------------------------------------- no double post


def test_crash_before_upload_resubmits_same_id_once(env) -> None:
    """The request_id was saved, then the process died before the upload."""
    seed(env)
    conn = env[2]
    conn.execute(
        "UPDATE clips SET state='publishing', request_id='cb-c1-1', attempts=1, "
        "submitted_at=? WHERE id='c1'",
        (db.iso(T0),),
    )
    poster = FakePoster()  # never saw cb-c1-1
    poster.statuses["cb-c1-1"] = [PostStatus("published", post_url="https://tt/9")]
    pub, _, clock = publisher(env, poster)
    assert pub.poll("c1") == "publishing" and poster.submits == []  # grace period
    clock[0] += timedelta(minutes=3)
    assert pub.poll("c1") == "publishing"
    assert poster.submits == [("cb-c1-1", None)]  # same id: idempotent
    assert pub.poll("c1") == "published"
    assert len(poster.submits) == 1


def test_crash_after_upload_never_resubmits(env) -> None:
    """The upload went through, then the process died before saving anything else."""
    seed(env)
    conn = env[2]
    conn.execute(
        "UPDATE clips SET state='publishing', request_id='cb-c1-1', attempts=1, "
        "submitted_at=? WHERE id='c1'",
        (db.iso(T0),),
    )
    poster = FakePoster()
    poster.known.add("cb-c1-1")
    poster.statuses["cb-c1-1"] = [PostStatus("pending"), PostStatus("published")]
    pub, _, clock = publisher(env, poster)
    clock[0] += timedelta(minutes=5)
    assert pub.poll("c1") == "publishing"
    assert pub.poll("c1") == "published"
    assert poster.submits == []


def test_no_final_status_fails_without_resending(env) -> None:
    seed(env)
    poster = FakePoster()
    pub, alerts, clock = publisher(env, poster)
    pub.start("c1")
    clock[0] += timedelta(minutes=16)
    assert pub.poll("c1") == "failed"
    assert len(poster.submits) == 1 and alerts[-1][0] == "publish_timeout"
