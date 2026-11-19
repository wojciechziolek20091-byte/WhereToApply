# clipbot

Takes long YouTube videos from an allowlist of rights-cleared channels, cuts the best
moments into captioned 9:16 clips, and posts them to one TikTok account through
Upload-Post. See the build brief for the full design. The full runbook arrives in
phase 7.

## Quick start (phase 0)

```bash
uv sync
cp .env.example .env    # fill in keys
make check              # ruff + pytest
uv run clipbot doctor   # environment and config checks
uv run clipbot status
uv run clipbot pause --reason "maintenance"
uv run clipbot resume
```

Requirements: Python 3.12, uv, ffmpeg 7+ with libass and libx264, ffprobe.
Deno and yt-dlp are needed only for sources with `acquire: ytdlp`.

## AI model: free models on OpenRouter only

Clip selection and the safety check call OpenRouter. On every run clipbot reads
OpenRouter's live model list and uses only models priced at $0, trying
`llm.preferred_models` first and then any other free model. A model that is rate
limited, errors or returns bad JSON rests for `cooldown_minutes` and the next one
is tried. There is no paid fallback: a model that ever reports a non-zero cost is
banned and an alert is raised. As a second guard, give the OpenRouter key a $0
credit limit (openrouter.ai, Keys page). Free models come and go, and free
providers may log prompts.

`clipbot doctor --online` lists the usable free models and makes one test call.

## Clip a video by link

```bash
uv run clipbot clip "https://www.youtube.com/watch?v=VIDEO_ID"
uv run clipbot clip            # asks for the link
uv run clipbot clip episode.mp4 --source my-channel   # a file you have on disk
uv run clipbot process VIDEO_ID   # run whatever stage a known video is ready for
uv run clipbot discover        # check listed channels for new uploads now
```

A file on disk uses the rights tag of the source you name with `--source`
(`own` or `permission`; a `cc_by` source cannot vouch for a local file).

### What happens to a video

1. **Download** (or link the local file) into `data/raw/`.
2. **Transcribe** locally with faster-whisper, word by word. With an NVIDIA GPU
   this uses `whisper.model` (large-v3-turbo); without one, `whisper.cpu_model`
   (small). `clipbot doctor` shows which one your machine will use.
3. **Pick clips**: a free OpenRouter model reads the transcript (in 20-minute
   windows for long videos) and proposes moments. Code then snaps each one to
   sentence boundaries, pads it slightly, enforces 20-60 s, drops overlaps,
   sponsor reads and flagged money or health claims, and keeps the best 3.
   Everything sent and received is saved in `data/work/<video>/select/`.

A link is accepted when the channel is in `sources.yaml` with a rights tag, or when
YouTube reports the video as Creative Commons. Anything else is refused with the
reason. If YouTube blocks the download (bot check, common on cloud servers), the
bot retries after 1, 6 and 16 hours, then alerts. It never uses cookies or proxies
to get around this; put the file in the source's local folder instead.

## Test media

`uv run --with piper-tts python scripts/make_fixtures.py talk` builds a 19-minute
spoken test episode (`data/fixtures/talk.mp4`) from `tests/fixtures/talk_script.txt`
with an open-source voice. No YouTube download needed.

## Rights

Every enabled source in `config/sources.yaml` needs `rights: own | cc_by | permission`.
`permission` also needs `permission_ref`. clipbot refuses to start otherwise.

## Kill switch

`clipbot pause` / `clipbot resume`, or create a file named `PAUSE` in the data folder.
