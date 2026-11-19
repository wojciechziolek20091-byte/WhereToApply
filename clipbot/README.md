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

## Rights

Every enabled source in `config/sources.yaml` needs `rights: own | cc_by | permission`.
`permission` also needs `permission_ref`. clipbot refuses to start otherwise.

## Kill switch

`clipbot pause` / `clipbot resume`, or create a file named `PAUSE` in the data folder.
