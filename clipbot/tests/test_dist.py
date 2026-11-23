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
    out = mod.main()
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
