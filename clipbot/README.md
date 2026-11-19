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

## Rights

Every enabled source in `config/sources.yaml` needs `rights: own | cc_by | permission`.
`permission` also needs `permission_ref`. clipbot refuses to start otherwise.

## Kill switch

`clipbot pause` / `clipbot resume`, or create a file named `PAUSE` in the data folder.
