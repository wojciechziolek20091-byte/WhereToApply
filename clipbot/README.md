# clipbot

Turns long videos you have the rights to into short vertical clips and posts them to
your TikTok account, with nobody in the loop:

1. **Find a video**: paste a YouTube link (`clipbot clip <url>`), give it a file, or
   let it watch your listed channels for new uploads.
2. **Transcribe** it locally, word by word (free, offline).
3. **Pick the best moments**: a free AI model reads the transcript and proposes
   20-60 second moments with a strong hook; code snaps them to whole sentences.
4. **Render** each as a 1080x1920 clip: face-centred crop (or the full frame over a
   blurred background for slides), word-by-word captions, and a hook text box.
5. **Check** each clip with eight automatic QA gates, including an AI safety review.
6. **Post** it to TikTok through Upload-Post, inside your time windows, with a
   caption that credits the original creator and adds hashtags.

It only processes content you have rights to: your own videos, Creative Commons
(CC BY) videos, or videos you have written permission for.

---

## What you need

| | Cost | Needed for |
|---|---|---|
| A computer that stays on (Windows, macOS or Linux) | | everything |
| [OpenRouter](https://openrouter.ai) account and key | free (only $0 models are used) | picking clips, safety check |
| [YouTube Data API](https://console.cloud.google.com) key | free | reading video licence and details |
| [Upload-Post](https://www.upload-post.com) paid plan, TikTok connected | about $16-24/month | posting to TikTok |
| [ntfy](https://ntfy.sh) topic or Telegram bot | free, optional | alerts on your phone |

Why Upload-Post: TikTok only lets audited apps post publicly, and it does not audit
personal tools like this one. Upload-Post's app is audited; you connect your TikTok
account to it once. Without it, clipbot still makes the clips (`dry_run: true`) and
you upload them yourself.

An NVIDIA GPU makes transcription faster but is not required: on a 4-core CPU a
19-minute video transcribes in about 4 minutes.

---

## Install

### Windows (PowerShell)

```bash
winget install Git.Git
```

```bash
winget install astral-sh.uv
```

```bash
winget install Gyan.FFmpeg
```

Open a new PowerShell window, then:

```bash
git clone <this repository's URL> clipbot-repo
```

```bash
cd clipbot-repo/clipbot
```

```bash
uv sync
```

### macOS

```bash
brew install uv ffmpeg git
```

then `git clone`, `cd .../clipbot` and `uv sync` as above.

### Linux

Install `ffmpeg` (version 7 or newer) and [uv](https://docs.astral.sh/uv/), then
`git clone`, `cd .../clipbot` and `uv sync`.

### Docker (any OS, for an always-on server)

```bash
docker compose -f docker/compose.yml up -d --build
```

Put your keys in `.env` and your settings in `config/` first (next section). The
compose file also runs the PO token helper that yt-dlp uses for YouTube.

---

## Set up

1. **Keys.** Copy `.env.example` to `.env` and fill it in:

   ```
   OPENROUTER_API_KEY=...       # give the key a $0 credit limit on openrouter.ai
   YOUTUBE_API_KEY=...
   UPLOAD_POST_API_KEY=...      # when you are ready to post
   UPLOAD_POST_PROFILE=...      # the profile name in your Upload-Post dashboard
   NOTIFY_URL=https://ntfy.sh/your-secret-topic
   ```

   `.env` is never committed and its values are masked in every log.

2. **Sources** (`config/sources.yaml`): the channels it may use. Every source needs a
   rights tag: `own`, `cc_by`, or `permission` (with `permission_ref`, e.g. "email
   from creator 2026-11-02"). clipbot refuses to start otherwise. Find a channel id:
   on the channel page, Share, Copy channel ID.

3. **Settings** (`config/settings.yaml`): time zone, posting windows, posts per day
   (max 8), clip length, caption style, your own hashtags (`post.extra_hashtags`).
   It starts with `dry_run: true`: nothing is posted until you change that.

4. **Check everything:**

   ```bash
   uv run clipbot doctor --online
   ```

   Every line should say OK, apart from warnings you understand.

---

## Use it

```bash
uv run clipbot clip "https://www.youtube.com/watch?v=VIDEO_ID"
```

Takes one video all the way to QA-checked clips and prints them. Leave the link out
and it asks for one. A link is accepted when its channel is in `sources.yaml` with a
rights tag, or when YouTube marks the video Creative Commons. Anything else is
refused with the reason.

```bash
uv run clipbot clip episode.mp4 --source my-channel
```

Same for a file on disk, under the rights of the source you name.

```bash
uv run clipbot run
```

The bot itself: every 30 seconds it polls running uploads, checks your channels
for new videos (every 30 minutes), moves one video one step forward, and posts the
best ready clip when a posting window is open. Stop it with Ctrl+C. (With Docker
or systemd it runs on its own.)

Where things are: clips in `data/renders/` (with a contact sheet `.jpg` for each),
what the AI saw and answered in `data/work/<video>/select/`, logs in `data/logs/`.
In dry run, what would have been posted is in `data/dryrun/`.

---

## Going live

1. Run a week with `dry_run: true`. Look at the clips and contact sheets, read the
   daily digest, and adjust captions or settings.
2. Connect your TikTok account in the Upload-Post dashboard, fill in the two
   `UPLOAD_POST_` lines, and run `uv run clipbot doctor --online`: it should say
   "TikTok connected" and list the privacy levels your account allows.
3. Set `dry_run: false` and `posts_per_day: 1`. Raise it slowly.
4. Want to see each clip before it goes out? Set `review_mode: hold`. Each clip is
   sent to your phone with its contact sheet; reply with `clipbot approve <id>` or
   `clipbot reject <id>`. Unanswered clips expire after 24 hours and are not posted.

A TikTok account with some normal history is safer than a brand-new one: services
like this advise a few weeks of ordinary use before connecting any posting tool.

---

## Runbook

| Task | Command |
|---|---|
| What is it doing? | `clipbot status` |
| Today's summary | `clipbot digest` (also sent daily at 20:00) |
| Stop everything now | `clipbot pause --reason "why"`, or create a file named `PAUSE` in the data folder |
| Start again | `clipbot resume` (and delete the `PAUSE` file if you made one) |
| Approve or reject a held clip | `clipbot approve <clip_id>` / `clipbot reject <clip_id>` |
| Retry a stuck video now | `clipbot process <video_id>` |
| One scheduler step, then exit | `clipbot tick` |

**It pauses itself and alerts you** after 3 publish failures in a row, on any
spam-risk, ban or reconnect error from TikTok, when an API key is refused, when QA
rejects more than 80% of clips from the last 10 videos, or with less than 5 GB of
disk left. The alert says why; fix it, then `clipbot resume`.

**Rotate a key:** edit `.env`, restart the bot (`docker compose ... restart`,
`systemctl --user restart clipbot`, or stop and start `clipbot run`), then
`clipbot doctor --online`.

**Upgrade yt-dlp** (YouTube changes break it regularly; do this weekly or when
downloads fail): `uv lock --upgrade-package yt-dlp` then `uv sync`. With Docker,
`docker compose -f docker/compose.yml build --pull` then `up -d`.

**"Sign in to confirm you're not a bot"**: YouTube blocks downloads from some
networks, especially cloud servers. clipbot retries after 1, 6 and 16 hours, then
alerts. It never uses cookies or proxies to get around this. Run it from a home
connection, or have the creator send you the files and use `acquire: local_folder`.

**"no free model gave a valid answer"**: every free OpenRouter model was busy. The
video or clip waits 30 minutes and tries again on its own.

---

## How the safety rules work

- **Rights**: checked when a video is found and again right before posting (a video
  that went private, or a Creative Commons licence that was removed, stops the post).
- **Credit**: for anything that is not your own, the caption ends with
  `Source: <channel> <link> (CC BY)`. Nothing is drawn over the video except
  captions and the hook: no logos, no watermarks.
- **QA gates**: file spec, at least 70% speech, loudness -16 to -12 LUFS, no black
  or stuck frames over 1 s, every word captioned, captions + hook + credit present,
  not a duplicate, and an AI safety review that blocks hate, harassment, sexual
  content, graphic violence, dangerous acts, medical or financial advice stated as
  fact, private people's personal data and sponsor reads. If the safety review
  cannot run, the clip waits; it is never posted unchecked.
- **Never twice**: each post has an id saved before the upload; after a crash the
  bot asks Upload-Post about that id instead of uploading again.

## What it will not do

Browser automation or unofficial TikTok endpoints, multiple accounts to dodge caps,
tricks to dodge copyright detection (mirroring, pitch or speed changes), removing
or covering anyone's watermark, adding its own watermark, auto-follow/like/comment,
or processing a source without a rights tag.

---

## Development

```bash
make check        # ruff + pytest (280 tests)
CLIPBOT_LIVE=1 uv run pytest -k live   # also calls the real free models
```

Test media is generated, not downloaded:

```bash
uv run --with piper-tts python scripts/make_fixtures.py talk
uv run --with scikit-image python scripts/make_fixtures.py talkinghead
uv run python scripts/make_fixtures.py slides
```

Fonts: Montserrat, SIL Open Font License (`assets/fonts/OFL.txt`). Face detection:
OpenCV YuNet (downloaded on first use, checksum pinned).
