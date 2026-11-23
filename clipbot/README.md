# clipbot

Turns long videos you have the rights to into short vertical clips and posts them to
your TikTok account, with nobody in the loop:

1. **Find a video**: paste a YouTube link (`clipbot clip <url>`), give it a file, or
   let it watch your listed channels for new uploads.
2. **Read it**: YouTube's own captions are the transcript (a second or two). Only
   videos without captions are downloaded in full and transcribed locally.
3. **Pick the cliffhangers**: one free AI request finds the moments where tension
   builds toward a reveal, and writes each clip's caption in your language at the
   same time; code snaps the clips to whole words.
4. **Render** each as a 1080x1920 clip: only the clip's seconds are fetched from
   YouTube, then face-centred crop (or the full frame over a blurred background),
   word-by-word captions and a hook text box. All clips are made at once. From a
   pasted link to finished clips takes about 45 seconds on a typical 4-core PC.
5. **Check** each clip with eight automatic QA gates, including an AI safety review.
6. **Post** it to TikTok through Upload-Post, inside your time windows, with a
   caption that credits the original creator and adds hashtags.

It only processes content you have rights to: your own videos, Creative Commons
(CC BY) videos, or videos you have written permission for.

> **Giving clipbot to someone?** Run `uv run python scripts/make_dist.py` and send
> them `dist/clipbot-<version>.zip`. They unzip it, double-click **Install clipbot**,
> then the **clipbot** icon on their desktop; the browser opens a setup wizard.
> `START HERE.txt` in the zip explains it in plain words. No terminal, no Python,
> no ffmpeg install (ffmpeg 9 ships inside the `imageio-ffmpeg` package).

---

## What you need

| | Cost | Needed for |
|---|---|---|
| A computer that stays on (Windows, macOS or Linux) | | everything |
| [OpenRouter](https://openrouter.ai) account and key | free (only $0 models are used) | picking clips, safety check |
| [YouTube Data API](https://console.cloud.google.com) key | free | reading video licence and details |
| Your TikTok login (through autotok) | free | posting to TikTok |
| or an [Upload-Post](https://www.upload-post.com) plan | about $16-24/month | posting through TikTok's official route instead |
| [ntfy](https://ntfy.sh) topic or Telegram bot | free, optional | alerts on your phone |

**How posting works.** By default clipbot posts with your own TikTok login through
[autotok](https://github.com/makiisthenes/TiktokAutoUploader), which uses TikTok's
website. It is free, but it is not TikTok's official API: **TikTok can limit or ban
accounts that post this way**, and the setup wizard asks you to confirm you accept
that before connecting. clipbot keeps posting gentle (at most 8 a day, 3 by default,
spaced out). For the official route, choose Upload-Post in the TikTok step instead:
TikTok only lets audited apps post, and Upload-Post's app is audited.

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
uv run clipbot start
```

Starts the bot with its dashboard and opens it in your browser (this is what the
desktop icon runs; `clipbot run` does the same without opening the browser). The
bot itself: every 30 seconds it polls running uploads, checks your channels
for new videos (every 30 minutes), moves one video one step forward, and posts the
best ready clip when a posting window is open. Stop it with Ctrl+C. (With Docker
or systemd it runs on its own.)

Where things are: clips in `data/renders/` (with a contact sheet `.jpg` for each),
what the AI saw and answered in `data/work/<video>/select/`, logs in `data/logs/`.
In dry run, what would have been posted is in `data/dryrun/`.

---

## The dashboard

`clipbot run` also opens a dashboard in your browser at **http://127.0.0.1:8080**
(`clipbot web` opens just the dashboard). From there you can:

- see whether the bot is running, and pause or resume it
- paste a YouTube link to clip, and choose how many clips to make from it (1-10)
- follow each pasted video live under **Clipping Now**: queued, downloading,
  transcribing, picking clips, making clips (2 of 3 made), checking, ready or failed
  with the reason
- watch every clip before it posts, with its caption and QA results, and approve,
  reject or remove it
- follow each video's progress and the recent activity
- change the main settings (dry run, ask before posting, posts per day, windows,
  hashtags, clip length); the running bot picks changes up within a minute
- run the health checks

**From your phone:** set a password and open the dashboard to your home network:

```
# .env
DASHBOARD_PASSWORD=choose-a-long-password
```

```yaml
# config/settings.yaml
web:
  host: 0.0.0.0
```

Restart, and `clipbot run` prints the address to open on your phone, like
`http://192.168.1.20:8080` (log in with user `clipbot` and your password). It
refuses to listen on your network without a password. Outside your home network it
is not reachable; that is deliberate.

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
| What is it doing? | the dashboard, or `clipbot status` |
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

**"Today's free AI requests are used up"**: an OpenRouter key on the free tier may
make 50 free-model requests a day, shared by everyone using that key. clipbot needs
about 2 per video (one to pick clips and write captions, one safety review for all
of its clips). It waits for the daily reset (midnight UTC) and carries on by itself.
Adding $10 of credit to the OpenRouter account raises the limit to 1000 a day;
clipbot still only uses free models.

**"no free model gave a valid answer"**: every free OpenRouter model it tried was
busy or failed. The video or clip waits 30 minutes and tries again on its own, and
the dashboard shows "The free AI models are busy" with the retry time. Many free
models "think" before answering and used to spend the whole answer budget on that,
returning nothing; clipbot now switches thinking off where a model allows it, tries
models that insist on thinking last, and skips music and image models.

---

## How the safety rules work

- **Rights**: checked when a video is found and again right before posting (a video
  that went private, or a Creative Commons licence that was removed, stops the post).
- **Credit**: for anything that is not your own, the caption ends with
  `Source: <channel> <link> (CC BY)`. Nothing is drawn over the video except
  captions and the hook: no logos, no watermarks.
- **QA gates**: four always block a clip: a playable file of the right size and
  length, captions + hook + credit present, not a duplicate of another clip, and an
  AI safety review that blocks hate, harassment, sexual content, graphic violence,
  dangerous acts, medical or financial advice stated as fact, private people's
  personal data and sponsor reads. If the safety review cannot run, the clip waits;
  it is never posted unchecked. Four technical checks (at least 70% speech,
  loudness -16 to -12 LUFS, no black or stuck frames over 1 s, every word
  captioned) only show a warning, so the clip still posts; turn on **Strict
  checks** in Settings (`safety.strict_qa: true`) to have them block too.
- **Caption language**: when a clip is finished, a free AI writes its TikTok
  caption (hook line, summary, hashtags) in Polish by default, and the credit line
  reads `Źródło: <channel> <link> (CC BY)`. Change it under Settings, Caption
  language (`post.language`: pl, en, de, es, fr, it, uk or original). The video,
  its subtitles and the on-screen hook stay in the video's own language.
- **Never twice**: each post has an id saved before the upload; after a crash the
  bot asks Upload-Post about that id instead of uploading again.

## What it will not do

Browser automation or unofficial TikTok endpoints, multiple accounts to dodge caps,
tricks to dodge copyright detection (mirroring, pitch or speed changes), removing
or covering anyone's watermark, adding its own watermark, auto-follow/like/comment,
or processing a source without a rights tag.

---

## Licence

clipbot is licensed under the GNU Affero General Public License v3.0 (`LICENSE`),
because it includes autotok, which is AGPL-3.0. If you share clipbot, share its
source too (the zip already contains it).

## Development

```bash
make check        # ruff + pytest
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
