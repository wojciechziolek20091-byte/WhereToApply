"""Phase 6: scheduler with a simulated clock."""

from __future__ import annotations

import itertools
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from clipbot import db
from clipbot.pipeline import Pipeline
from clipbot.post.base import PosterError, PostStatus
from clipbot.publish import Publisher
from clipbot.scheduler import Scheduler
from clipbot.sources.youtube_api import YouTubeAuthError
from tests.factories import meta
from tests.test_posters import FakePoster, FakeYT

WARSAW = ZoneInfo("Europe/Warsaw")
DAY1 = datetime(2026, 11, 23, 0, 0, tzinfo=WARSAW)  # a Monday


class FakeNotifier:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, Path | None]] = []

    def send(self, title, message, attachment=None, priority="default"):
        self.sent.append((title, message, attachment))
        return True


class AutoPublishPoster(FakePoster):
    """Every submitted post goes live on the next poll."""

    def status(self, request_id: str) -> PostStatus:
        if request_id in self.known:
            return PostStatus("published", post_url=f"https://tt/{request_id}")
        return PostStatus("not_found")


def build(env, poster=None, cfg=None, clock=None):
    cfg = cfg or env[0]
    clock = clock or [DAY1]
    pipe = Pipeline(
        env[2],
        cfg,
        env[1],
        youtube=FakeYT(meta("x")),
        feed_fetcher=lambda ch: [],
        clock=lambda: clock[0],
    )
    poster = poster or AutoPublishPoster()
    pub = Publisher(
        env[2],
        cfg,
        poster,
        youtube=lambda: FakeYT(meta("aaaaaaaaaaa")),
        alert=pipe.alert,
        clock=lambda: clock[0],
        source_by_id=pipe.source_by_id,
    )
    notifier = FakeNotifier()
    return Scheduler(pipe, pub, notifier), poster, notifier, clock


def seed_clips(env, n: int, state: str = "qa_passed") -> list[str]:
    conn = env[2]
    now = db.iso(DAY1)
    conn.execute(
        "INSERT OR IGNORE INTO videos(id, source_id, title, channel_title, license, "
        "state, state_changed_at, created_at, updated_at) VALUES "
        "('aaaaaaaaaaa', 'mine', 'T', 'Chan', 'youtube', 'done', ?, ?, ?)",
        (now, now, now),
    )
    ids = []
    for i in range(n):
        cid = f"clip{i:02d}"
        render = env[1].renders / f"{cid}.mp4"
        render.parent.mkdir(parents=True, exist_ok=True)
        render.write_bytes(b"x")
        sheet = env[1].renders / f"{cid}.jpg"
        sheet.write_bytes(b"jpg")
        conn.execute(
            "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, summary, "
            "state, state_changed_at, render_path, contact_sheet_path, post_text, created_at, "
            "updated_at) VALUES (?, 'aaaaaaaaaaa', ?, ?, ?, 'h', ?, 's', ?, ?, ?, ?, ?, ?, ?)",
            (
                cid,
                i * 60000,
                i * 60000 + 30000,
                70 + i,
                f"title {i}",
                state,
                now,
                str(render),
                str(sheet),
                f"caption {i}",
                now,
                now,
            ),
        )
        ids.append(cid)
    return ids


def run_for(sched: Scheduler, clock: list, hours: float, step_min: int = 5) -> None:
    end = clock[0] + timedelta(hours=hours)
    while clock[0] < end:
        sched.tick()
        clock[0] += timedelta(minutes=step_min)


def submit_times(env) -> list[datetime]:
    rows = (
        env[2]
        .execute(
            "SELECT submitted_at FROM clips WHERE submitted_at IS NOT NULL ORDER BY submitted_at"
        )
        .fetchall()
    )
    return [db.parse_iso(r[0]).astimezone(WARSAW) for r in rows]


# ---------------------------------------------------------------- windows, cap, gap


def test_windows_daily_cap_and_gap_over_three_days(env) -> None:
    seed_clips(env, 12)
    sched, poster, _, clock = build(env)
    run_for(sched, clock, hours=72)
    times = submit_times(env)
    assert len(times) >= 6
    for t in times:  # 1. only inside 12:00-14:00 and 17:00-21:00 local
        assert 12 <= t.hour < 14 or 17 <= t.hour < 21, t
    for i, t in enumerate(times):  # 2. never more than 3 in any rolling 24 h
        assert sum(1 for u in times[: i + 1] if t - u < timedelta(hours=24)) <= 3
    for a, b in itertools.pairwise(times):  # 3. at least 120 min apart
        assert b - a >= timedelta(minutes=120)
    assert times[0] == DAY1.replace(hour=12)  # first post as soon as the window opens
    day1 = [t for t in times if t.date() == DAY1.date()]
    assert [t.hour for t in day1] == [12, 17, 19]
    scores = [
        r[0]
        for r in env[2].execute(
            "SELECT score FROM clips WHERE state = 'published' ORDER BY submitted_at"
        )
    ]
    assert scores == sorted(scores, reverse=True)  # best clip first
    assert len(poster.submits) == len(times)  # one submit per post, no duplicates


def test_hard_ceiling_of_8_even_if_configured_higher(env) -> None:
    from clipbot.config import POSTS_PER_DAY_CEILING

    assert POSTS_PER_DAY_CEILING == 8
    with pytest.raises(ValueError):
        env[0].settings.publish.model_validate({"posts_per_day": 9, "windows": ["12:00-13:00"]})


def test_nothing_posts_outside_windows(env) -> None:
    seed_clips(env, 3)
    sched, poster, _, clock = build(env)
    clock[0] = DAY1.replace(hour=7)
    run_for(sched, clock, hours=4.9)  # 07:00 to 11:55
    assert poster.submits == []


# ---------------------------------------------------------------- restart mid-publish


def test_kill_mid_publish_and_restart_never_double_posts(env) -> None:
    seed_clips(env, 2)
    poster = FakePoster()  # posts stay "pending" until we say otherwise
    sched, _, _, clock = build(env, poster=poster)
    clock[0] = DAY1.replace(hour=12)
    sched.tick()
    assert len(poster.submits) == 1
    first = poster.submits[0][0]
    # The process dies here. A new process starts on the same database.
    del sched
    clock[0] += timedelta(minutes=40)  # well past the 30-minute stuck-row cutoff
    db.recover_stuck(env[2])
    assert (
        env[2].execute("SELECT state FROM clips WHERE request_id = ?", (first,)).fetchone()[0]
        == "publishing"
    )
    sched2, _, _, _ = build(env, poster=poster, clock=clock)
    poster.statuses[first] = [PostStatus("published", post_url="https://tt/1")]
    sched2.tick()
    assert [s for s, _ in poster.submits] == [first]  # resolved by polling, not resent
    assert env[2].execute("SELECT COUNT(*) FROM clips WHERE state='published'").fetchone()[0] == 1


def test_one_post_at_a_time(env) -> None:
    seed_clips(env, 3)
    poster = FakePoster()
    cfg = env[0].model_copy(
        update={
            "settings": env[0].settings.model_copy(
                update={
                    "publish": env[0].settings.publish.model_copy(update={"min_gap_minutes": 0})
                }
            )
        }
    )
    sched, _, _, clock = build(env, poster=poster, cfg=cfg)
    clock[0] = DAY1.replace(hour=12)
    for _ in range(5):
        sched.tick()
        clock[0] += timedelta(minutes=1)
    assert len(poster.submits) == 1  # still pending, so nothing else starts


# ---------------------------------------------------------------- breaker and pauses


def test_circuit_breaker_after_three_failures(env) -> None:
    seed_clips(env, 6)
    poster = FakePoster()
    poster.submit_errors = [PosterError("tiktok_media_rejected")] * 10
    cfg = env[0].model_copy(
        update={
            "settings": env[0].settings.model_copy(
                update={
                    "publish": env[0].settings.publish.model_copy(update={"min_gap_minutes": 0})
                }
            )
        }
    )
    sched, _, notifier, clock = build(env, poster=poster, cfg=cfg)
    clock[0] = DAY1.replace(hour=12)
    for _ in range(10):
        sched.tick()
        clock[0] += timedelta(minutes=1)
    assert len(poster.submits) == 3
    assert db.get_pause(env[2], clock[0]).paused
    breaker = [m for t, m, _ in notifier.sent if "publish_breaker" in t]
    assert breaker and "clipbot resume" in breaker[0]


def test_pause_file_stops_posting(env) -> None:
    seed_clips(env, 2)
    sched, poster, _, clock = build(env)
    clock[0] = DAY1.replace(hour=12)
    env[1].pause_file.write_text("")
    sched.tick()
    assert poster.submits == []
    env[1].pause_file.unlink()
    sched.tick()
    assert len(poster.submits) == 1


def test_auth_error_pauses_and_alerts(env) -> None:
    sched, _, notifier, clock = build(env)

    def boom() -> list:
        raise YouTubeAuthError("quotaExceeded")

    sched.pipe.discover = boom  # type: ignore[method-assign]
    assert sched.cfg.enabled_sources  # the conftest source is enabled
    sched.tick()
    assert db.get_pause(env[2], clock[0]).paused
    assert any("API key refused" in m for _, m, _ in notifier.sent)


def test_qa_rejecting_most_clips_pauses(env) -> None:
    conn = env[2]
    now = db.iso(DAY1)
    for v in range(10):
        vid = f"vid{v:08d}"
        conn.execute(
            "INSERT INTO videos(id, source_id, state, state_changed_at, created_at, "
            "updated_at) VALUES (?, 'mine', 'done', ?, ?, ?)",
            (vid, now, now, now),
        )
        for c in range(2):
            conn.execute(
                "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, "
                "summary, state, state_changed_at, created_at, updated_at) VALUES "
                "(?, ?, 0, 30000, 80, 'h', 't', 's', 'qa_rejected', ?, ?, ?)",
                (f"{vid}c{c}", vid, now, now, now),
            )
    sched, _, _, clock = build(env)
    sched.tick()
    p = db.get_pause(conn, clock[0])
    assert p.paused and "QA rejected 100%" in (p.reason or "")


def test_low_disk_pauses(env, monkeypatch: pytest.MonkeyPatch) -> None:
    import shutil
    from collections import namedtuple

    du = namedtuple("du", "total used free")
    monkeypatch.setattr(shutil, "disk_usage", lambda p: du(100, 99, 1 * 1024**3))
    sched, _, _, clock = build(env)
    sched.tick()
    assert "disk free" in (db.get_pause(env[2], clock[0]).reason or "")


# ---------------------------------------------------------------- hold mode


def hold_cfg(env):
    return env[0].model_copy(
        update={"settings": env[0].settings.model_copy(update={"review_mode": "hold"})}
    )


def test_hold_mode_sends_for_approval_and_posts_only_approved(env) -> None:
    a, b, c = seed_clips(env, 3)
    sched, poster, notifier, clock = build(env, cfg=hold_cfg(env))
    clock[0] = DAY1.replace(hour=11)
    sched.tick()
    approvals = [n for n in notifier.sent if "approve clip" in n[0]]
    assert len(approvals) == 3 and all(n[2] is not None for n in approvals)  # contact sheet
    assert "clipbot approve" in approvals[0][1]
    sched.approve(b)
    sched.reject(c)
    clock[0] = DAY1.replace(hour=12)
    sched.tick()
    assert [s for s, _ in poster.submits] == [f"cb-{b}-1"]
    clock[0] = DAY1.replace(hour=11) + timedelta(hours=24, minutes=5)
    sched.tick()
    states = dict(env[2].execute("SELECT id, state FROM clips").fetchall())
    assert states[a] == "skipped" and states[c] == "rejected"  # unanswered: expired


def test_hold_mode_never_posts_unapproved(env) -> None:
    seed_clips(env, 2)
    sched, poster, _, clock = build(env, cfg=hold_cfg(env))
    clock[0] = DAY1.replace(hour=12)
    run_for(sched, clock, hours=30)
    assert poster.submits == []


# ---------------------------------------------------------------- digest and alerts


def test_digest_once_a_day_at_20(env) -> None:
    seed_clips(env, 4)
    sched, _, notifier, clock = build(env)
    run_for(sched, clock, hours=24, step_min=10)
    digests = [n for n in notifier.sent if "daily digest" in n[0]]
    assert len(digests) == 1
    body = digests[0][1]
    assert "Posted in the last 24 h: 3" in body and "https://tt/" in body
    assert "AI calls" in body


def test_alerts_forwarded_once(env) -> None:
    sched, _, notifier, _ = build(env)
    sched.pipe.alert("test_kind", "something happened")
    sched.tick()
    sched.tick()
    assert [t for t, _, _ in notifier.sent].count("clipbot: test_kind") == 1


def test_cli_tick_runs(config_dir: Path, tmp_path: Path) -> None:
    from typer.testing import CliRunner

    from clipbot.cli import app

    env_file = str(tmp_path / "none.env")
    r = CliRunner().invoke(app, ["tick", "-c", str(config_dir), "--env-file", env_file])
    assert r.exit_code == 0, r.output
    r = CliRunner().invoke(app, ["digest", "-c", str(config_dir), "--env-file", env_file])
    assert r.exit_code == 0 and "Posted in the last 24 h: 0" in r.output
