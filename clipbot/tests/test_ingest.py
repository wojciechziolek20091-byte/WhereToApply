from __future__ import annotations

import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from clipbot import db
from clipbot.config import load_config
from clipbot.models import DataPaths
from clipbot.pipeline import ACQUIRE_RETRY_DELAYS, Pipeline
from clipbot.sources.providers import AcquireBlocked, AcquireError, NotAvailableYet
from clipbot.sources.providers.local import LocalFolderProvider
from clipbot.sources.providers.ytdlp import YtDlpProvider, classify
from clipbot.sources.rss import FeedEntry
from tests.factories import CHANNEL, OTHER_CHANNEL, make_mp4, meta

T0 = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


class FakeYT:
    def __init__(self, metas: list[Any]) -> None:
        self.metas = {m.id: m for m in metas}
        self.calls: list[list[str]] = []

    def videos(self, ids):
        ids = list(ids)
        self.calls.append(ids)
        return {i: self.metas[i] for i in ids if i in self.metas}

    def video(self, vid):
        return self.videos([vid]).get(vid)


class FakeProvider:
    name = "fake"

    def __init__(self, outcomes: list[Any]) -> None:
        self.outcomes = outcomes
        self.calls = 0

    def acquire(self, video_id: str, url: str, dest: Path) -> Path:
        self.calls += 1
        o = self.outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return make_mp4(dest)


@pytest.fixture
def env(config_dir: Path):
    cfg = load_config(config_dir, env_file=None)
    paths = DataPaths(cfg.settings.data_dir)
    paths.ensure()
    conn = db.connect(paths.db)
    db.sync_sources(conn, cfg.sources)
    return cfg, paths, conn


def make(env, yt=None, providers=None, feed=None, now=None) -> Pipeline:
    cfg, paths, conn = env
    clock = now or [T0]
    return Pipeline(
        conn,
        cfg,
        paths,
        youtube=yt,
        providers=providers,
        feed_fetcher=feed or (lambda c: []),
        clock=lambda: clock[0],
    )


def state(conn, vid: str) -> str:
    return conn.execute("SELECT state FROM videos WHERE id = ?", (vid,)).fetchone()[0]


# ---------------------------------------------------------------- URL ingest


def test_url_from_listed_own_channel(env) -> None:
    p = make(env, yt=FakeYT([meta("aaaaaaaaaaa")]))
    r = p.ingest_url("https://youtu.be/aaaaaaaaaaa")
    assert r.new and r.state == "discovered" and r.reason == "own content"
    again = p.ingest_url("aaaaaaaaaaa")
    assert not again.new and again.state == "discovered"


def test_url_unlisted_cc_by_is_accepted(env) -> None:
    m = meta(
        "bbbbbbbbbbb", channel_id=OTHER_CHANNEL, channel_title="CC Chan", license="creativeCommon"
    )
    p = make(env, yt=FakeYT([m]))
    r = p.ingest_url("bbbbbbbbbbb")
    assert r.state == "discovered" and "Creative Commons" in r.reason
    src = p.source_by_id(
        env[2].execute("SELECT source_id FROM videos WHERE id='bbbbbbbbbbb'").fetchone()[0]
    )
    assert src.rights == "cc_by" and src.name == "CC Chan" and not src.enabled


def test_url_unlisted_non_cc_is_refused(env) -> None:
    m = meta("ccccccccccc", channel_id=OTHER_CHANNEL, channel_title="Big Creator")
    r = make(env, yt=FakeYT([m])).ingest_url("ccccccccccc")
    assert r.state == "skipped" and "no rights" in r.reason and "Big Creator" in r.reason


def test_url_too_short_is_skipped(env) -> None:
    r = make(env, yt=FakeYT([meta("ddddddddddd", duration_sec=60.0)])).ingest_url("ddddddddddd")
    assert r.state == "skipped" and "too short" in r.reason


def test_url_unknown_video(env) -> None:
    with pytest.raises(LookupError):
        make(env, yt=FakeYT([])).ingest_url("eeeeeeeeeee")


# ---------------------------------------------------------------- RSS discover


def test_discover(env, config_dir: Path) -> None:
    feed = [
        FeedEntry("new11111111", CHANNEL, "new", T0 + timedelta(hours=1)),
        FeedEntry("old11111111", CHANNEL, "old", T0 - timedelta(days=30)),
        FeedEntry("live1111111", CHANNEL, "live", T0 + timedelta(hours=1)),
        FeedEntry("short111111", CHANNEL, "short", T0 + timedelta(hours=1)),
    ]
    yt = FakeYT(
        [
            meta("new11111111", published_at=T0 + timedelta(hours=1)),
            meta("live1111111", live_status="live", published_at=T0 + timedelta(hours=1)),
            meta("short111111", duration_sec=30.0, published_at=T0 + timedelta(hours=1)),
        ]
    )
    p = make(env, yt=yt, feed=lambda ch: feed)
    out = {r.video_id: r.state for r in p.discover()}
    assert out == {"new11111111": "discovered", "short111111": "skipped"}
    # old upload filtered before spending quota; live stream left for a later poll
    assert yt.calls == [["new11111111", "live1111111", "short111111"]]
    # a second poll registers nothing new; the live stream is checked again
    assert p.discover() == []
    assert yt.calls[-1] == ["live1111111"]


# ---------------------------------------------------------------- acquire


def _registered(env, outcomes):
    now = [T0]
    prov = FakeProvider(outcomes)
    p = make(env, yt=FakeYT([meta("vvvvvvvvvvv")]), providers={"local_folder": prov}, now=now)
    p.ingest_url("vvvvvvvvvvv")
    return p, prov, now


def test_acquire_success(env) -> None:
    p, _prov, _ = _registered(env, [None])
    assert p.acquire("vvvvvvvvvvv") == "acquired"
    row = env[2].execute("SELECT raw_path, state_reason FROM videos").fetchone()
    assert Path(row["raw_path"]).is_file() and row["state_reason"].startswith("320x240")


def test_acquire_not_available_yet_does_not_count(env) -> None:
    p, _, _ = _registered(env, [NotAvailableYet("not dropped yet")])
    assert p.acquire("vvvvvvvvvvv") == "discovered"
    assert env[2].execute("SELECT attempts FROM videos").fetchone()[0] == 0


def test_acquire_retries_three_times_over_a_day_then_alerts(env) -> None:
    p, prov, now = _registered(env, [AcquireBlocked("bot check")] * 4)
    conn = env[2]
    assert p.acquire("vvvvvvvvvvv") == "acquire_failed"
    for delay in ACQUIRE_RETRY_DELAYS:
        assert p.due_for_acquire() == []  # not due yet
        now[0] += delay
        assert p.due_for_acquire() == ["vvvvvvvvvvv"]
        result = p.acquire("vvvvvvvvvvv")
    assert result == "failed" and prov.calls == 4
    total = sum(ACQUIRE_RETRY_DELAYS, timedelta())
    assert total <= timedelta(hours=24)
    alert = conn.execute("SELECT kind, message FROM events WHERE level='alert'").fetchone()
    assert alert["kind"] == "acquire_gave_up" and "blocking this host" in alert["message"]


def test_acquire_bad_file_counts_as_failure(env, tmp_path: Path) -> None:
    class Junk:
        name = "junk"

        def acquire(self, video_id: str, url: str, dest: Path) -> Path:
            dest.write_bytes(b"not a video")
            return dest

    p = make(env, yt=FakeYT([meta("vvvvvvvvvvv")]), providers={"local_folder": Junk()})
    p.ingest_url("vvvvvvvvvvv")
    assert p.acquire("vvvvvvvvvvv") == "acquire_failed"
    assert not p.paths.raw_video("vvvvvvvvvvv").exists()


def test_acquire_is_idempotent_when_file_exists(env) -> None:
    p, prov, _ = _registered(env, [])
    make_mp4(p.paths.raw_video("vvvvvvvvvvv"))
    assert p.acquire("vvvvvvvvvvv") == "acquired" and prov.calls == 0


# ---------------------------------------------------------------- providers


def test_local_folder_provider(tmp_path: Path) -> None:
    folder = tmp_path / "incoming"
    prov = LocalFolderProvider(folder)
    with pytest.raises(NotAvailableYet):
        prov.acquire("xxxxxxxxxxx", "", tmp_path / "raw" / "xxxxxxxxxxx.mp4")
    make_mp4(folder / "xxxxxxxxxxx.mp4")
    out = prov.acquire("xxxxxxxxxxx", "", tmp_path / "raw" / "xxxxxxxxxxx.mp4")
    assert out.is_file() and (folder / "xxxxxxxxxxx.mp4").is_file()


def test_local_folder_remuxes_mkv(tmp_path: Path) -> None:
    folder = tmp_path / "incoming"
    src = make_mp4(tmp_path / "x.mp4")
    folder.mkdir()
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-c",
            "copy",
            str(folder / "yyyyyyyyyyy.mkv"),
        ],
        check=True,
    )
    out = LocalFolderProvider(folder).acquire("yyyyyyyyyyy", "", tmp_path / "r" / "y.mp4")
    assert out.suffix == ".mp4" and out.stat().st_size > 0


REAL_BOT_CHECK = (
    "ERROR: [youtube] Lx29DK56p1Q: Sign in to confirm you’re not a bot. This helps "  # noqa: RUF001
    "protect our community. Use --cookies-from-browser or --cookies for the authentication."
)


def test_ytdlp_classifies_real_bot_check() -> None:
    assert classify(REAL_BOT_CHECK) is AcquireBlocked
    assert (
        classify("ERROR: unable to download video data: HTTP Error 403: Forbidden")
        is AcquireBlocked
    )
    assert classify("ERROR: something else") is AcquireError


class Proc:
    def __init__(self, code: int, err: str = "") -> None:
        self.returncode, self.stderr, self.stdout = code, err, ""


def test_ytdlp_bot_check_is_not_retried_immediately(tmp_path: Path) -> None:
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        return Proc(1, REAL_BOT_CHECK)

    prov = YtDlpProvider(runner=run, sleep=lambda s: None)
    with pytest.raises(AcquireBlocked, match="not a bot"):
        prov.acquire("Lx29DK56p1Q", "u", tmp_path / "Lx29DK56p1Q.mp4")
    assert len(calls) == 1
    cmd = " ".join(calls[0])
    assert "bv*[height<=1080]+ba/b[height<=1080]" in cmd and "--merge-output-format mp4" in cmd
    assert "--js-runtimes deno" in cmd
    assert "cookies" not in cmd and "proxy" not in cmd


def test_ytdlp_retries_transient_errors_with_backoff(tmp_path: Path) -> None:
    sleeps: list[float] = []
    outcomes = [Proc(1, "ERROR: Connection reset"), Proc(1, "ERROR: Connection reset")]

    def run(cmd, **kw):
        if outcomes:
            return outcomes.pop(0)
        out = Path(cmd[cmd.index("--output") + 1].replace("%(ext)s", "mp4"))
        make_mp4(out)
        return Proc(0)

    prov = YtDlpProvider(runner=run, sleep=sleeps.append, backoff_s=(10, 60))
    dest = prov.acquire("zzzzzzzzzzz", "u", tmp_path / "zzzzzzzzzzz.mp4")
    assert dest.is_file() and sleeps == [10, 60]


def test_ytdlp_timeout(tmp_path: Path) -> None:
    def run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, kw["timeout"])

    prov = YtDlpProvider(runner=run, sleep=lambda s: None, timeout_s=5)
    with pytest.raises(AcquireError, match="timed out"):
        prov.acquire("zzzzzzzzzzz", "u", tmp_path / "z.mp4")
