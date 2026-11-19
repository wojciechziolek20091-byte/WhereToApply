"""Local speech-to-text with faster-whisper: word timestamps, VAD on.

Free and offline after the first model download. On machines without an NVIDIA
GPU a smaller model is used (`whisper.cpu_model`), because large models on CPU
are too slow to keep up.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from clipbot.config import WhisperSettings
from clipbot.logging import get_logger
from clipbot.models import Word

log = get_logger(__name__)


@dataclass
class Segment:
    start: float
    end: float
    text: str
    words: list[Word] = field(default_factory=list)


@dataclass
class Transcript:
    model: str
    language: str
    language_prob: float
    duration: float
    segments: list[Segment]
    device: str = "cpu"
    seconds_taken: float = 0.0

    @property
    def words(self) -> list[Word]:
        return [w for s in self.segments for w in s.words]

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=1)

    @classmethod
    def from_json(cls, text: str) -> Transcript:
        d = json.loads(text)
        segs = [
            Segment(s["start"], s["end"], s["text"], [Word(**w) for w in s.get("words", [])])
            for s in d.pop("segments")
        ]
        return cls(segments=segs, **d)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(self.to_json(), encoding="utf-8")
        os.replace(tmp, path)


def cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # missing CUDA libraries look like "no GPU"
        return False


def resolve_device(ws: WhisperSettings) -> tuple[str, str, str]:
    """(device, model, compute_type) for this machine."""
    device = ws.device
    if device == "auto":
        device = "cuda" if cuda_available() else "cpu"
    if device == "cuda":
        return device, ws.model, ws.gpu_compute_type
    return device, ws.cpu_model or ws.model, ws.compute_type


def transcript_path(work_dir: Path, model: str) -> Path:
    return work_dir / f"transcript.{model}.json"


def transcribe(
    media: Path,
    work_dir: Path,
    ws: WhisperSettings,
    language_hint: str | None = None,
    models_dir: Path | None = None,
) -> Transcript:
    device, model_name, compute_type = resolve_device(ws)
    out = transcript_path(work_dir, model_name)
    if out.is_file():
        log.info("transcript_cached", path=str(out))
        return Transcript.from_json(out.read_text(encoding="utf-8"))

    from faster_whisper import WhisperModel

    t0 = time.monotonic()
    model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
        download_root=str(models_dir) if models_dir else None,
        cpu_threads=ws.cpu_threads or 0,
    )
    seg_iter, info = model.transcribe(
        str(media),
        language=language_hint,
        word_timestamps=True,
        vad_filter=True,
        beam_size=ws.beam_size,
        condition_on_previous_text=False,  # fewer repetition loops on long audio
    )
    segments: list[Segment] = []
    last_log = t0
    for s in seg_iter:
        words = [
            Word(
                w=w.word.strip(),
                start=round(w.start, 3),
                end=round(w.end, 3),
                prob=round(w.probability, 3),
            )
            for w in (s.words or [])
            if w.word.strip()
        ]
        segments.append(Segment(round(s.start, 3), round(s.end, 3), s.text.strip(), words))
        if time.monotonic() - last_log > 30:
            last_log = time.monotonic()
            log.info("transcribe_progress", at_sec=round(s.end), of_sec=round(info.duration))
    tr = Transcript(
        model=model_name,
        language=info.language,
        language_prob=round(info.language_probability, 3),
        duration=round(info.duration, 3),
        segments=segments,
        device=device,
        seconds_taken=round(time.monotonic() - t0, 1),
    )
    tr.save(out)
    log.info(
        "transcribed",
        model=model_name,
        device=device,
        seconds=tr.seconds_taken,
        audio_seconds=tr.duration,
        words=len(tr.words),
    )
    return tr


def as_dict(tr: Transcript) -> dict[str, Any]:
    return asdict(tr)
