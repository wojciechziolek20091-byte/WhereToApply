"""Packaging clipbot to hand to someone else.

The zip holds the app (no tests, no downloads, no personal data). Optionally it
also holds the sharer's OpenRouter key in `shared.env`, so recipients skip the AI
setup step. Only that one key is ever copied: never YouTube or TikTok keys,
channels or settings. Recipients can still add their own AI key, which wins.
"""

from __future__ import annotations

import tomllib
import zipfile
from pathlib import Path

INCLUDE_DIRS = ("src", "assets", "config", "scripts", "docker")
INCLUDE_FILES = (
    "pyproject.toml",
    "uv.lock",
    "README.md",
    "LICENSE",
    "START HERE.txt",
    ".env.example",
    "Install clipbot.cmd",
    "Start clipbot.cmd",
    "Install clipbot.command",
    "Start clipbot.command",
)
SKIP_PARTS = {"__pycache__", ".pytest_cache", ".ruff_cache"}
SKIP_SCRIPTS = {"make_dist.py", "make_fixtures.py", "make_icon.py"}
EXECUTABLE = {".command", ".sh"}
SHARED_ENV = "shared.env"


def app_version(root: Path) -> str:
    return tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"]


def app_files(root: Path) -> list[Path]:
    out = [root / f for f in INCLUDE_FILES]
    for d in INCLUDE_DIRS:
        for p in sorted((root / d).rglob("*")):
            if (
                p.is_file()
                and not SKIP_PARTS & set(p.parts)
                and p.name not in SKIP_SCRIPTS
                and not p.name.endswith((".pyc", ".tmp", ".part"))
            ):
                out.append(p)
    missing = [p for p in out if not p.is_file()]
    if missing:
        raise FileNotFoundError(f"missing from the app folder: {missing}")
    return out


def _add(z: zipfile.ZipFile, name: str, data: bytes, mode: int = 0o644) -> None:
    info = zipfile.ZipInfo(f"clipbot/{name}", date_time=(2026, 1, 1, 0, 0, 0))
    info.external_attr = (0o100000 | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, data)


def build_zip(root: Path, out: Path, ai_key: str | None = None) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in app_files(root):
            rel = p.relative_to(root).as_posix()
            _add(z, rel, p.read_bytes(), 0o755 if p.suffix in EXECUTABLE else 0o644)
        if ai_key:
            if "\n" in ai_key or "\r" in ai_key:
                raise ValueError("bad key")
            _add(
                z,
                SHARED_ENV,
                (
                    "# AI key shared by whoever gave you clipbot. It only works with free\n"
                    "# AI models. Add your own key in Settings to stop using this one.\n"
                    f"OPENROUTER_API_KEY={ai_key}\n"
                ).encode(),
            )
    tmp.replace(out)
    return out


def downloads_dir() -> Path:
    d = Path.home() / "Downloads"
    return d if d.is_dir() else Path.home()
