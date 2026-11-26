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
    if not cfg.secrets.openrouter_api_key:  # a configured bot; setup gating is tested apart
        from clipbot.config import Secrets

        cfg = cfg.model_copy(
            update={
                "secrets": Secrets(
                    _env_file=None, openrouter_api_key="test", youtube_api_key="test"
                )
            }
        )
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
    for a, b in itertools.pairwise(times):  # 3. 10 min apart in a window, else 120
        same_window = a.date() == b.date() and (a.hour < 14) == (b.hour < 14)
        assert b - a >= timedelta(minutes=10 if same_window else 120)
    assert times[0] == DAY1.replace(hour=12)  # first post as soon as the window opens
    day1 = [t for t in times if t.date() == DAY1.date()]
    # 12 queued: a window takes 3 at once; the daily limit of 3 then waits a day.
    assert [t.strftime("%H:%M") for t in day1] == ["12:00", "12:10", "12:20"]
    scores = [
        r[0]
        for r in env[2].execute(
            "SELECT score FROM clips WHERE state = 'published' ORDER BY submitted_at"
        )
    ]
    assert scores == sorted(scores, reverse=True)  # best clip first
    assert len(poster.submits) == len(times)  # one submit per post, no duplicates


def test_no_daily_limit_lets_a_long_queue_post_many_a_day(env) -> None:
    from clipbot import posting

    assert [posting.per_window(n) for n in (3, 8, 15, 30, 31, 200)] == [1, 2, 3, 5, 8, 8]
    s = env[0].settings.model_copy(
        update={"publish": env[0].settings.publish.model_copy(update={"posts_per_day": None})}
    )
    t = DAY1.replace(hour=12)
    posts: list = []
    queued = 40
    while queued and t.date() == DAY1.date():
        at, _ = posting.earliest(s, t, posts, queued)
        if at is None or at.date() != DAY1.date():
            break
        posts.append(at)
        queued -= 1
        t = at
    assert len(posts) == 16  # 8 in each of the two windows, 10 minutes apart
    assert posts[1] - posts[0] == timedelta(minutes=10)


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


def test_waits_for_setup_without_keys(env) -> None:
    seed_clips(env, 2)
    cfg, paths, conn = env
    clock = [DAY1.replace(hour=12)]
    pipe = Pipeline(
        conn,
        cfg,
        paths,
        youtube=FakeYT(meta("x")),
        feed_fetcher=lambda ch: [],
        clock=lambda: clock[0],
    )
    poster = AutoPublishPoster()
    pub = Publisher(
        conn,
        cfg,
        poster,
        youtube=lambda: FakeYT(meta("aaaaaaaaaaa")),
        alert=pipe.alert,
        clock=lambda: clock[0],
    )
    rep = Scheduler(pipe, pub, FakeNotifier()).tick()
    assert any("waiting for setup: add the AI and YouTube key" in a for a in rep.actions)
    assert poster.submits == []


# ---------------------------------------------------------------- queue view


def test_queue_order_and_times_follow_the_posting_rules(env) -> None:
    from clipbot.web.status import posting_queue

    cfg, _, conn = env
    ids = seed_clips(env, 4)  # scores 70..73, all ready to post
    at8 = DAY1 + timedelta(hours=8)  # 08:00, before the 12-14 window
    q = posting_queue(conn, cfg.settings, at8)
    assert [x["id"] for x in q] == list(reversed(ids))  # best score first
    local = [x["eta"].astimezone(WARSAW).strftime("%a %H:%M") for x in q]
    # 4 queued: 2 in the first window, 10 min apart; then 1 per window; the
    # daily limit of 3 moves the 4th to the next day.
    assert local == ["Mon 12:00", "Mon 12:10", "Mon 17:00", "Tue 12:00"]
    assert q[0]["why"] == "next posting window" and "daily limit" in q[3]["why"]

    # Deploy all: those clips go first and skip the window.
    conn.execute(
        "UPDATE clips SET state = 'scheduled', deploy_at = ? WHERE id = ?", (db.iso(at8), ids[0])
    )
    q = posting_queue(conn, cfg.settings, at8)
    assert q[0]["id"] == ids[0] and q[0]["eta"] == at8 and q[0]["deployed"]
    assert q[1]["eta"].astimezone(WARSAW).strftime("%H:%M") == "12:00"


def test_queue_tab_lists_clips_in_order(env, config_dir) -> None:
    from tests.test_web import client, seed_clip

    seed_clip(config_dir, "qa_passed")
    seed_clip(config_dir, "scheduled")
    page = client(config_dir).get("/clips?tab=ready").text
    assert "2 clips queued" in page and page.count('class="q-row') == 2
    assert page.index("q-row") < page.index("Octopus")  # rows, then hooks inside
    assert "Times are estimates" in page


def test_send_now_skips_window_and_gap_but_not_the_daily_limit(env) -> None:
    from clipbot.publish import send_now

    ids = seed_clips(env, 3)
    sched, poster, _, clock = build(env)
    clock[0] = DAY1 + timedelta(hours=8)  # outside the windows
    assert sched.next_clip() is None
    assert send_now(env[2], ids[0], clock[0])
    assert sched.next_clip() == ids[0]  # first, at once
    sched.tick()
    assert len(poster.submits) == 1
    # A second one right after: no gap needed.
    assert send_now(env[2], ids[1], clock[0])
    clock[0] += timedelta(minutes=1)
    sched.tick()  # polls the first (published), then sends the second
    assert len(poster.submits) == 2


def test_turn_off_deploy_puts_clips_back(env) -> None:
    from clipbot.publish import deploy, undeploy

    ids = seed_clips(env, 2)
    sched, _, _, clock = build(env)
    clock[0] = DAY1 + timedelta(hours=8)
    assert deploy(env[2], "aaaaaaaaaaa", clock[0]) == 2
    assert sched.next_clip() is not None  # deployed: posts outside windows
    assert undeploy(env[2], clock[0], "aaaaaaaaaaa") == 2
    states = {r[0] for r in env[2].execute("SELECT state FROM clips WHERE id IN (?, ?)", ids)}
    assert states == {"qa_passed"} and sched.next_clip() is None  # waits for windows again
