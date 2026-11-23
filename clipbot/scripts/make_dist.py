"""Build the zip you send to users: dist/clipbot-<version>.zip

    uv run python scripts/make_dist.py

Contains only what users need (no tests, no data, no keys). Install and start
scripts keep their executable bit so they run on macOS and Linux after unzipping.
"""

from __future__ import annotations

import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCLUDE_DIRS = ["src", "assets", "config", "scripts", "docker"]
INCLUDE_FILES = ["pyproject.toml", "uv.lock", "README.md", "START HERE.txt", ".env.example",
                 "Install clipbot.cmd", "Start clipbot.cmd", "Install clipbot.command",
                 "Start clipbot.command"]
SKIP_PARTS = {"__pycache__", ".pytest_cache", ".ruff_cache"}
SKIP_SCRIPTS = {"make_dist.py", "make_fixtures.py", "make_icon.py"}
EXECUTABLE = {".command", ".sh"}


def files() -> list[Path]:
    out = [ROOT / f for f in INCLUDE_FILES]
    for d in INCLUDE_DIRS:
        for p in sorted((ROOT / d).rglob("*")):
            if p.is_file() and not SKIP_PARTS & set(p.parts) and p.name not in SKIP_SCRIPTS \
                    and not p.name.endswith((".pyc", ".tmp")):
                out.append(p)
    missing = [p for p in out if not p.is_file()]
    if missing:
        raise SystemExit(f"missing: {missing}")
    return out


def main() -> Path:
    version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    out = dist / f"clipbot-{version}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files():
            rel = p.relative_to(ROOT)
            info = zipfile.ZipInfo(f"clipbot/{rel.as_posix()}", date_time=(2026, 1, 1, 0, 0, 0))
            mode = 0o755 if p.suffix in EXECUTABLE else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    print(f"{out}  ({out.stat().st_size / 1024:.0f} KB, {len(files())} files)")
    return out


if __name__ == "__main__":
    main()
