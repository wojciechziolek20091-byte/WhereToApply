"""Decide how each scene of a clip becomes 9:16 (brief 4.5).

Per scene, sample frames at 4 fps and look for faces:
- a face in at least 60 % of samples, small enough for a 9:16 crop of the full
  height, and not two people far apart -> static crop centred on the median face
- anything else (slides, screen shares, wide two-shots) -> blur_pad: the whole
  frame over a blurred, zoomed copy of itself
Smooth speaker tracking is a v2 item.
"""

from __future__ import annotations

import itertools
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from clipbot.logging import get_logger

log = get_logger(__name__)

SAMPLE_FPS = 4.0
FACE_SHARE = 0.60
DETECT_WIDTH = 640
MIN_SCENE = 1.0  # shorter scenes are merged into the previous one


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2


@dataclass(frozen=True)
class ScenePlan:
    start: float  # seconds, relative to the clip
    end: float
    mode: str  # "crop" | "blur_pad"
    crop_x: int = 0
    crop_w: int = 0
    reason: str = ""


class FaceDetector:
    def __init__(self, model_path: Path, threshold: float = 0.6) -> None:
        import cv2

        self._cv2 = cv2
        self._det = cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), threshold)

    def largest(self, frame) -> Box | None:
        cv2 = self._cv2
        h, w = frame.shape[:2]
        scale = DETECT_WIDTH / w if w > DETECT_WIDTH else 1.0
        small = cv2.resize(frame, (round(w * scale), round(h * scale))) if scale < 1 else frame
        sh, sw = small.shape[:2]
        self._det.setInputSize((sw, sh))
        _, faces = self._det.detect(small)
        if faces is None or len(faces) == 0:
            return None
        f = max(faces, key=lambda r: r[2] * r[3])
        return Box(f[0] / scale, f[1] / scale, f[2] / scale, f[3] / scale)


def detect_scenes(video: Path, start: float, end: float) -> list[tuple[float, float]]:
    """Cuts inside [start, end] as clip-relative (start, end) pairs."""
    from scenedetect import ContentDetector, detect

    try:
        raw = detect(str(video), ContentDetector(), start_time=start, end_time=end)
    except Exception as e:  # odd containers: fall back to one scene
        log.warning("scene_detect_failed", error=str(e))
        raw = []
    dur = end - start
    cuts = sorted(
        {round(s.get_seconds() - start, 3) for s, _ in raw if 0 < s.get_seconds() - start < dur}
    )
    bounds = [0.0, *cuts, dur]
    scenes: list[tuple[float, float]] = []
    for a, b in itertools.pairwise(bounds):
        if scenes and (b - a < MIN_SCENE or scenes[-1][1] - scenes[-1][0] < MIN_SCENE):
            scenes[-1] = (scenes[-1][0], b)
        else:
            scenes.append((a, b))
    return scenes or [(0.0, dur)]


def sample_faces(
    video: Path, detector: FaceDetector, start: float, end: float, fps: float = SAMPLE_FPS
) -> list[Box | None]:
    """Read the scene once, front to back, and run detection on every Nth frame.
    (Seeking for each sample re-decodes from the last keyframe and is far slower.)"""
    import cv2

    cap = cv2.VideoCapture(str(video))
    out: list[Box | None] = []
    try:
        src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        step = max(1, round(src_fps / fps))
        cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
        n_frames = int((end - start) * src_fps)
        for i in range(n_frames):
            if i % step:
                if not cap.grab():
                    break
                continue
            ok, frame = cap.read()
            if not ok:
                break
            out.append(detector.largest(frame))
    finally:
        cap.release()
    return out


def crop_width(src_w: int, src_h: int) -> int:
    w = int(src_h * 9 / 16)  # round down: never wider than 9:16
    return min(src_w, w - (w % 2))


def plan_scene(
    faces: Sequence[Box | None], src_w: int, src_h: int, start: float, end: float
) -> ScenePlan:
    """Pure decision for one scene from its face samples."""
    cw = crop_width(src_w, src_h)
    if src_w * 16 <= src_h * 9 + 1:  # already 9:16 or taller: nothing to crop
        return ScenePlan(start, end, "crop", 0, src_w, "source is already vertical")
    found = [f for f in faces if f is not None]
    share = len(found) / len(faces) if faces else 0.0
    if share < FACE_SHARE:
        return ScenePlan(start, end, "blur_pad", reason=f"face in {share:.0%} of samples")
    if statistics.median(f.w for f in found) > cw * 0.9:
        return ScenePlan(start, end, "blur_pad", reason="face too large for a 9:16 crop")
    centers = sorted(f.cx for f in found)
    q1, q3 = centers[len(centers) // 4], centers[(3 * len(centers)) // 4]
    if q3 - q1 > cw * 0.5:
        return ScenePlan(start, end, "blur_pad", reason="faces too far apart (several people)")
    cx = statistics.median(centers)
    x = int(min(max(cx - cw / 2, 0), src_w - cw))
    x -= x % 2
    return ScenePlan(start, end, "crop", x, cw, f"face in {share:.0%} of samples")


def plan_clip(
    video: Path,
    detector: FaceDetector,
    start: float,
    end: float,
    src_w: int,
    src_h: int,
) -> list[ScenePlan]:
    plans = []
    for a, b in detect_scenes(video, start, end):
        faces = sample_faces(video, detector, start + a, start + b)
        plans.append(plan_scene(faces, src_w, src_h, a, b))
    return plans
