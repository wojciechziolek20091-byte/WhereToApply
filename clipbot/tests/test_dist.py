from __future__ import annotations

import importlib.util
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_dist_zip_has_what_users_need_and_nothing_private(tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("make_dist", ROOT / "scripts" / "make_dist.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.ROOT = ROOT
    out = mod.main(tmp_path)  # never overwrite a zip already sent to users
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        mode = {n: (z.getinfo(n).external_attr >> 16) & 0o777 for n in names}
    for must in (
        "clipbot/Install clipbot.cmd",
        "clipbot/Start clipbot.cmd",
        "clipbot/Install clipbot.command",
        "clipbot/START HERE.txt",
        "clipbot/uv.lock",
        "clipbot/LICENSE",
        "clipbot/assets/clipbot.ico",
        "clipbot/src/clipbot/web/templates/setup.html",
    ):
        assert must in names, must
    assert mode["clipbot/Install clipbot.command"] == 0o755
    assert mode["clipbot/scripts/start-unix.sh"] == 0o755
    assert not any("/tests/" in n or n.endswith("/.env") or "/data/" in n for n in names)


def test_windows_scripts_are_ascii_with_crlf() -> None:
    for f in ("Install clipbot.cmd", "Start clipbot.cmd", "scripts/install-windows.ps1"):
        raw = (ROOT / f).read_bytes()
        raw.decode("ascii")
        assert b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")


def test_default_config_has_no_channels() -> None:
    from clipbot.config import load_sources

    assert load_sources(ROOT / "config" / "sources.yaml") == []


def test_lock_owner_names_the_running_process(tmp_path: Path) -> None:
    """`clipbot start` finds (and closes) an older clip mob through this pid."""
    import os
    import subprocess
    import sys
    import time

    from clipbot import db

    lock = tmp_path / "clipbot.lock"
    child = subprocess.Popen(
        [sys.executable, "-c",
         "import sys, time; from pathlib import Path; from clipbot import db; "
         "db.ProcessLock(Path(sys.argv[1])).acquire(); print('held', flush=True); "
         "time.sleep(60)", str(lock)],
        stdout=subprocess.PIPE, text=True,
    )  # fmt: skip
    try:
        assert child.stdout.readline().strip() == "held"
        assert db.lock_owner(lock) == child.pid
        with __import__("pytest").raises(db.LockHeld):
            db.ProcessLock(lock).acquire()
    finally:
        child.kill()
        child.wait()
    time.sleep(0.2)
    with db.ProcessLock(lock):  # free again once that process is gone
        assert db.lock_owner(lock) == os.getpid()
    assert db.lock_owner(tmp_path / "missing") is None
