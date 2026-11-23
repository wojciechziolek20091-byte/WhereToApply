"""Build reproducible test media from text, with an open-source TTS voice.

    uv run --with piper-tts python scripts/make_fixtures.py talk
    uv run --with scikit-image python scripts/make_fixtures.py talkinghead
    uv run python scripts/make_fixtures.py slides

talk: data/fixtures/talk.mp4 (about 19 minutes), tests/fixtures/talk_script.txt read
by Piper's en_US-lessac-medium voice over a plain background.
talkinghead: 3.5 minutes of that audio over a face (NASA's public-domain astronaut
portrait from scikit-image), placed off-centre and drifting, to test face crops.
slides: 3.5 minutes of that audio over three text slides, to test blur_pad.
Nothing here is downloaded from YouTube, so anyone can rebuild the same files.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import wave
from pathlib import Path
from clipbot.tools import ffmpeg_exe

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
        [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"color=c={color}:size=1280x720:rate=30",
         "-i", str(wav_path),
         "-map", "0:v", "-map", "1:a", "-shortest",
         "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", str(mp4)],
        check=True,
    )


def talkinghead() -> Path:
    from skimage import data
    from PIL import Image

    face = OUT / "astronaut.png"
    Image.fromarray(data.astronaut()).resize((820, 820)).save(face)
    out = OUT / "talkinghead.mp4"
    subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "color=c=0x2b3440:size=1920x1080:rate=30",
         "-loop", "1", "-i", str(face),
         "-ss", "120", "-t", "210", "-i", str(OUT / "talk.mp4"),
         "-filter_complex",
         "[0:v][1:v]overlay=x='1000+60*sin(t/4)':y='130+12*sin(t/3)':shortest=1[v]",
         "-map", "[v]", "-map", "2:a", "-t", "210",
         "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", str(out)],
        check=True,
    )
    return out


def slides() -> Path:
    from PIL import Image, ImageDraw, ImageFont

    font_dir = ROOT / "assets" / "fonts"
    big = ImageFont.truetype(str(font_dir / "Montserrat-ExtraBold.ttf"), 92)
    small = ImageFont.truetype(str(font_dir / "Montserrat-Bold.ttf"), 52)
    texts = [
        ("Why honey never spoils", ["Very little water", "Acidic", "Built-in peroxide"]),
        ("Bananas are berries", ["One flower, one ovary", "Seeds inside", "Strawberries: no"]),
        ("Compound interest", ["$100 a month", "7% a year", "40 years"]),
    ]
    paths = []
    for i, (title, bullets) in enumerate(texts):
        img = Image.new("RGB", (1920, 1080), (248, 246, 240))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, 1920, 180], fill=(30, 42, 58))
        d.text((110, 45), title, font=big, fill=(255, 255, 255))
        for j, b in enumerate(bullets):
            d.text((150, 320 + j * 150), f"\u2022  {b}", font=small, fill=(30, 42, 58))
        p = OUT / f"slide{i}.png"
        img.save(p)
        paths.append(p)
    lst = OUT / "slides.txt"
    lst.write_text("".join(f"file '{p.name}'\nduration 70\n" for p in paths)
                   + f"file '{paths[-1].name}'\n")
    out = OUT / "slides.mp4"
    subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "concat", "-safe", "0", "-i", str(lst),
         "-ss", "330", "-t", "210", "-i", str(OUT / "talk.mp4"),
         "-map", "0:v", "-map", "1:a", "-t", "210", "-r", "30",
         "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", str(out)],
        check=True,
    )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("name", choices=["talk", "talkinghead", "slides"])
    ap.add_argument("--length-scale", type=float, default=1.4, help="above 1 speaks slower")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.name != "talk":
        if not (OUT / "talk.mp4").exists():
            sys.exit("build the talk fixture first: it provides the audio")
        print(talkinghead() if args.name == "talkinghead" else slides())
        return
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
