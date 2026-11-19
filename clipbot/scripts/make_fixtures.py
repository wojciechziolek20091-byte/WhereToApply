"""Build reproducible test media from text, with an open-source TTS voice.

    uv run --with piper-tts python scripts/make_fixtures.py talk

Writes data/fixtures/talk.mp4 (about 20 minutes): tests/fixtures/talk_script.txt
read by Piper's en_US-lessac-medium voice over a plain background. Nothing here is
downloaded from YouTube, so anyone can rebuild the same file.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "fixtures"
VOICE = "en_US-lessac-medium"


def synth(script: Path, wav_path: Path, length_scale: float, pause_s: float) -> float:
    from piper import PiperVoice, SynthesisConfig
    from piper.download_voices import download_voice

    voices = OUT / "voices"
    voices.mkdir(parents=True, exist_ok=True)
    model = voices / f"{VOICE}.onnx"
    if not model.exists():
        download_voice(VOICE, voices)
    voice = PiperVoice.load(model)
    cfg = SynthesisConfig(length_scale=length_scale)
    paragraphs = [p.strip() for p in script.read_text().split("\n\n") if p.strip()]

    rate = voice.config.sample_rate
    silence = b"\x00\x00" * int(rate * pause_s)
    with wave.open(str(wav_path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        for i, para in enumerate(paragraphs):
            for chunk in voice.synthesize(para, syn_config=cfg):
                out.writeframes(chunk.audio_int16_bytes)
            out.writeframes(silence)
            print(f"  paragraph {i + 1}/{len(paragraphs)}", file=sys.stderr, end="\r")
        frames = out.getnframes()
    print(file=sys.stderr)
    return frames / rate


def to_mp4(wav_path: Path, mp4: Path, color: str = "0x1e2a3a") -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"color=c={color}:size=1280x720:rate=30",
         "-i", str(wav_path),
         "-map", "0:v", "-map", "1:a", "-shortest",
         "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", str(mp4)],
        check=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("name", choices=["talk"])
    ap.add_argument("--length-scale", type=float, default=1.4, help="above 1 speaks slower")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    wav_path = OUT / f"{args.name}.wav"
    secs = synth(ROOT / "tests" / "fixtures" / "talk_script.txt", wav_path,
                 args.length_scale, pause_s=0.8)
    print(f"speech: {secs / 60:.1f} min", file=sys.stderr)
    mp4 = OUT / f"{args.name}.mp4"
    to_mp4(wav_path, mp4)
    wav_path.unlink()
    print(mp4)


if __name__ == "__main__":
    main()
