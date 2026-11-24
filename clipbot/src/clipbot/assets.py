"""Files the bot needs at runtime: bundled ones and small models fetched once."""

from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path

import httpx

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
FONTS_DIR = PACKAGE_ROOT / "assets" / "fonts"

# OpenCV YuNet face detector (MIT licence, opencv_zoo). Pinned by hash.
FACE_MODEL = "face_detection_yunet_2023mar.onnx"
FACE_MODEL_URL = (
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
FACE_MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"


class AssetError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_download_lock = threading.Lock()


def ensure_download(dest: Path, url: str, sha256: str) -> Path:
    """Download once and verify. Several clips render at the same time: one thread
    downloads while the others wait, so they never write the same file at once."""
    with _download_lock:
        return _ensure_download(dest, url, sha256)


def _ensure_download(dest: Path, url: str, sha256: str) -> Path:
    if dest.is_file() and _sha256(dest) == sha256:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(f"{dest.suffix}.{os.getpid()}.part")
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            with tmp.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    except httpx.HTTPError as e:
        tmp.unlink(missing_ok=True)
        raise AssetError(f"could not download {dest.name}: {e}") from None
    if _sha256(tmp) != sha256:
        tmp.unlink(missing_ok=True)
        raise AssetError(f"{dest.name} failed its checksum; not using it")
    os.replace(tmp, dest)
    return dest


def face_model(models_dir: Path) -> Path:
    return ensure_download(models_dir / FACE_MODEL, FACE_MODEL_URL, FACE_MODEL_SHA256)


def font_files() -> list[Path]:
    files = sorted(FONTS_DIR.glob("*.ttf"))
    if not files:
        raise AssetError(f"no fonts found in {FONTS_DIR}")
    return files
