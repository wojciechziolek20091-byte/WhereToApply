"""One ffmpeg pass per clip: reframe each scene, burn captions, level loudness.

Output (brief 4.5): 1080x1920, 30 fps, H.264 high, yuv420p, CRF 20, AAC 160 kbps
48 kHz, loudness -14 LUFS / -1.5 dBTP (two-pass loudnorm), +faststart. Nothing is
added to the image except the captions and the hook box: no logo, no watermark.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from clipbot.render.reframe import ScenePlan
from clipbot.tools import ffmpeg_exe


class RenderError(RuntimeError):
    pass


@dataclass(frozen=True)
class EncodeSettings:
    width: int = 1080
    height: int = 1920
    fps: int = 30
    crf: int = 20
    preset: str = "veryfast"
    loudness_lufs: float = -14.0
    true_peak: float = -1.5
    lra: float = 11.0


def _run(cmd: list[str], cwd: Path | None = None, timeout: float = 1800) -> str:
    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True, cwd=cwd, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired:
        raise RenderError(f"ffmpeg timed out after {timeout:.0f}s") from None
    if p.returncode != 0:
        tail = "\n".join(p.stderr.strip().splitlines()[-6:])
        raise RenderError(f"ffmpeg failed: {tail}")
    return p.stderr


def measure_loudness(src: Path, start: float, dur: float, s: EncodeSettings) -> dict[str, str]:
    """loudnorm pass 1 over the clip's audio only."""
    err = _run(
        [
            ffmpeg_exe(),
            "-hide_banner",
            "-nostats",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{dur:.3f}",
            "-i",
            str(src),
            "-vn",
            "-af",
            f"loudnorm=I={s.loudness_lufs}:TP={s.true_peak}:LRA={s.lra}:print_format=json",
            "-f",
            "null",
            "-",
        ]
    )
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", err, re.S)
    if not m:
        raise RenderError("could not read loudness measurement")
    return json.loads(m.group(0))


def scene_filter(i: int, sc: ScenePlan, s: EncodeSettings) -> str:
    head = f"[0:v]trim=start={sc.start:.3f}:end={sc.end:.3f},setpts=PTS-STARTPTS"
    tail = f"setsar=1,fps={s.fps},format=yuv420p[v{i}]"
    if sc.mode == "crop":
        return (
            f"{head},crop={sc.crop_w}:ih:{sc.crop_x}:0,"
            f"scale={s.width}:{s.height}:flags=bicubic,{tail}"
        )
    return (
        f"{head},split[bg{i}][fg{i}];"
        # Blur at a quarter of the size, then scale up: looks the same, ~10x cheaper.
        f"[bg{i}]scale={s.width // 4}:{s.height // 4}:force_original_aspect_ratio=increase,"
        f"crop={s.width // 4}:{s.height // 4},boxblur=6:2,eq=brightness=-0.06,"
        f"scale={s.width}:{s.height}:flags=bilinear[bgb{i}];"
        f"[fg{i}]scale={s.width}:-2:flags=bicubic[fgs{i}];"
        f"[bgb{i}][fgs{i}]overlay=(W-w)/2:(H-h)/2,{tail}"
    )


def filtergraph(
    scenes: Sequence[ScenePlan], ass_name: str, loud: dict[str, str], s: EncodeSettings
) -> str:
    parts = [scene_filter(i, sc, s) for i, sc in enumerate(scenes)]
    ins = "".join(f"[v{i}]" for i in range(len(scenes)))
    parts.append(f"{ins}concat=n={len(scenes)}:v=1:a=0[vc]")
    parts.append(f"[vc]subtitles={ass_name}:fontsdir=fonts[vout]")
    parts.append(
        f"[0:a]loudnorm=I={s.loudness_lufs}:TP={s.true_peak}:LRA={s.lra}"
        f":measured_I={loud['input_i']}:measured_TP={loud['input_tp']}"
        f":measured_LRA={loud['input_lra']}:measured_thresh={loud['input_thresh']}"
        f":offset={loud['target_offset']}:linear=true,aresample=48000[aout]"
    )
    return ";".join(parts)


def render_clip(
    src: Path,
    start: float,
    end: float,
    scenes: Sequence[ScenePlan],
    ass_text: str,
    fonts: Sequence[Path],
    out: Path,
    work: Path,
    s: EncodeSettings,
) -> Path:
    """Render one clip. `work` is a scratch folder; ffmpeg runs inside it so the
    subtitle and font paths stay relative (avoids Windows drive-letter escaping)."""
    dur = end - start
    work.mkdir(parents=True, exist_ok=True)
    (work / "clip.ass").write_text(ass_text, encoding="utf-8")
    fdir = work / "fonts"
    fdir.mkdir(exist_ok=True)
    for f in fonts:
        shutil.copy2(f, fdir / f.name)

    loud = measure_loudness(src, start, dur, s)
    tmp = out.with_suffix(".part.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            ffmpeg_exe(),
            "-hide_banner",
            "-nostats",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{dur:.3f}",
            "-i",
            str(src.resolve()),
            "-filter_complex",
            filtergraph(scenes, "clip.ass", loud, s),
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-profile:v",
            "high",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            str(s.crf),
            "-preset",
            s.preset,
            "-r",
            str(s.fps),
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-map_metadata",
            "-1",
            str(tmp.resolve()),
        ],
        cwd=work,
    )
    tmp.replace(out)
    return out


def contact_sheet(video: Path, out: Path, duration: float, frames: int = 6) -> Path:
    """Six frames in a 3x2 grid, for debugging and hold-mode previews."""
    rate = frames / max(duration, 0.1)
    _run(
        [
            ffmpeg_exe(),
            "-hide_banner",
            "-nostats",
            "-y",
            "-i",
            str(video),
            "-vf",
            f"fps={rate:.5f},scale=360:-2,tile=3x2:padding=6:color=white",
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(out),
        ]
    )
    return out
