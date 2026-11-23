"""Build the zip you send to users: dist/clipbot-<version>.zip

    uv run python scripts/make_dist.py

Contains only what users need (no tests, no data, no keys). Install and start
scripts keep their executable bit so they run on macOS and Linux after unzipping.
To include your AI key, use Settings, "Make a Copy to Share" in the dashboard.
"""

from __future__ import annotations

from pathlib import Path

from clipbot.share import app_files, app_version, build_zip

ROOT = Path(__file__).resolve().parents[1]


def files() -> list[Path]:
    return app_files(ROOT)


def main() -> Path:
    out = build_zip(ROOT, ROOT / "dist" / f"clipbot-{app_version(ROOT)}.zip")
    print(f"{out}  ({out.stat().st_size / 1024:.0f} KB, {len(files())} files)")
    return out


if __name__ == "__main__":
    main()
