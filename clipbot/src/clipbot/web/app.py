"""The clipbot dashboard: a small web app over the same database the bot uses.

Heavy work never runs here. Pasting a link only registers the video; the running
bot downloads, transcribes, renders and posts it. Safe by default:
- it listens on 127.0.0.1 (this computer only) unless you choose otherwise, and
  refuses any other address without DASHBOARD_PASSWORD
- every form carries a per-process token and must come from the dashboard itself,
  so another website cannot press its buttons through your browser
"""

import io
import ipaddress
import os
import secrets
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import quote, urlparse

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError

from clipbot import accounts as acc
from clipbot import db
from clipbot.config import (
    CAPTION_LANGUAGES,
    MAX_CLIPS,
    PRIVACY_LEVELS,
    AppConfig,
    ConfigError,
    Settings,
    load_config,
)
from clipbot.logging import get_logger
from clipbot.models import DataPaths
from clipbot.qa import SOFT_GATES
from clipbot.tools import ffmpeg_exe
from clipbot.web import status as st

log = get_logger(__name__)

HERE = Path(__file__).parent
USERNAME = "clipbot"


class UnsafeBind(RuntimeError):
    pass


def is_loopback(host: str) -> bool:
    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check_bind(host: str, password: str | None) -> None:
    if not is_loopback(host) and not password:
        raise UnsafeBind(
            f"the dashboard would be open to your whole network on {host} without a "
            "password. Set DASHBOARD_PASSWORD in .env, or use web.host: 127.0.0.1"
        )


def create_app(
    config_dir: Path,
    env_file: Path | None = None,
    clock: Callable[[], datetime] = db.utcnow,
    pipeline_factory: Callable[..., Any] | None = None,
    clip_now: bool = True,
) -> FastAPI:
    """`pipeline_factory(conn, cfg, paths)` builds the Pipeline used to look up
    pasted links (tests pass a fake YouTube client through it). `clip_now`: start
    clipping a pasted video straight away in the background instead of waiting
    for the bot's next step."""
    # Keys typed into the setup wizard are saved here.
    env_path = env_file or (config_dir.parent / ".env")
    cfg0 = load_config(config_dir, env_file=env_path)
    pw = cfg0.secrets.dashboard_password
    password = pw.get_secret_value() if pw else None
    csrf = secrets.token_urlsafe(24)
    templates = Jinja2Templates(directory=str(HERE / "templates"))
    templates.env.globals.update(csrf=csrf, tabs=st.CLIP_TABS, privacy_levels=PRIVACY_LEVELS)
    templates.env.filters["mmss"] = lambda s: f"{int(s // 60):02d}:{s % 60:04.1f}"

    app = FastAPI(title="clipbot", docs_url=None, redoc_url=None, openapi_url=None)
    app.mount("/static", StaticFiles(directory=str(HERE / "static")), name="static")
    basic = HTTPBasic(auto_error=False)

    def config() -> AppConfig:
        """Re-read each request so settings edits show at once."""
        try:
            return load_config(config_dir, env_file=env_path)
        except ConfigError:
            return cfg0

    def auth(creds: Annotated[HTTPBasicCredentials | None, Depends(basic)]) -> None:
        if password is None:
            return
        ok = creds is not None and secrets.compare_digest(
            creds.password.encode(), password.encode()
        )
        if not ok:
            raise HTTPException(
                401, "password required", headers={"WWW-Authenticate": 'Basic realm="clipbot"'}
            )

    def same_origin(request: Request) -> None:
        origin = request.headers.get("origin") or request.headers.get("referer")
        if origin and urlparse(origin).netloc != request.headers.get("host"):
            raise HTTPException(403, "request did not come from the dashboard")

    async def check_csrf(request: Request) -> None:
        same_origin(request)
        form = await request.form()
        if not secrets.compare_digest(str(form.get("csrf", "")), csrf):
            raise HTTPException(403, "this page has expired; reload it and try again")

    @contextmanager
    def database(cfg: AppConfig) -> Iterator[Any]:
        paths = DataPaths(cfg.settings.data_dir)
        paths.ensure()
        conn = db.connect(paths.db)
        try:
            yield conn, paths
        finally:
            conn.close()

    def back(path: str, msg: str = "", error: bool = False) -> RedirectResponse:
        sep = "&" if "?" in path else "?"
        q = f"{sep}{'err' if error else 'msg'}={quote(msg)}" if msg else ""
        return RedirectResponse(f"{path}{q}", status_code=303)

    def page(request: Request, name: str, cfg: AppConfig, **ctx: Any) -> HTMLResponse:
        return templates.TemplateResponse(
            request,
            name,
            {
                "cfg": cfg,
                "s": cfg.settings,
                "now": clock(),
                "ago": st.ago,
                "msg": request.query_params.get("msg"),
                "err": request.query_params.get("err"),
                "soft_gates": frozenset() if cfg.settings.safety.strict_qa else SOFT_GATES,
                "languages": CAPTION_LANGUAGES,
                **ctx,
            },
        )

    deps = [Depends(auth)]
    post_deps = [Depends(auth), Depends(check_csrf)]

    # ------------------------------------------------------------------ pages

    @app.get("/", response_class=HTMLResponse, dependencies=deps)
    def home(request: Request) -> Any:
        cfg = config()
        if not is_configured(cfg):
            return RedirectResponse("/setup", status_code=303)
        now = clock()
        with database(cfg) as (conn, paths):
            bot = st.bot_state(conn, paths, now)
            nxt, why = st.next_post_time(conn, cfg.settings, now)
            since = db.iso(now - timedelta(hours=24))
            posted_24h = conn.execute(
                f"SELECT COUNT(*) FROM clips WHERE state IN {st.POSTED} AND submitted_at >= ?",
                (since,),
            ).fetchone()[0]
            return page(
                request,
                "home.html",
                cfg,
                bot=bot,
                next_post=nxt,
                next_why=why,
                posted_24h=posted_24h,
                clips=st.counts(conn, "clips"),
                videos=st.counts(conn, "videos"),
                events=st.recent_events(conn),
                review=st.clip_views(conn, ("awaiting_approval",), 6),
                ready=st.clip_views(conn, ("qa_passed", "scheduled"), 3),
                jobs=st.progress(conn, now),
                stages=st.STAGES,
                max_clips=MAX_CLIPS,
            )

    @app.get("/progress", response_class=HTMLResponse, dependencies=deps)
    def progress_fragment(request: Request) -> HTMLResponse:
        """The "Clipping Now" panel's contents, polled by the overview page."""
        cfg = config()
        with database(cfg) as (conn, _):
            return page(
                request, "_progress.html", cfg, jobs=st.progress(conn, clock()), stages=st.STAGES
            )

    @app.get("/clips", response_class=HTMLResponse, dependencies=deps)
    def clips(request: Request, tab: str = "ready") -> HTMLResponse:
        cfg = config()
        if tab not in st.CLIP_TABS:
            tab = "ready"
        with database(cfg) as (conn, _):
            counts = st.counts(conn, "clips")
            tab_counts = {k: sum(counts.get(s, 0) for s in v[1]) for k, v in st.CLIP_TABS.items()}
            return page(
                request,
                "clips.html",
                cfg,
                tab=tab,
                tab_counts=tab_counts,
                items=st.clip_views(conn, st.CLIP_TABS[tab][1]),
            )

    @app.get("/videos", response_class=HTMLResponse, dependencies=deps)
    def videos(request: Request) -> HTMLResponse:
        cfg = config()
        with database(cfg) as (conn, _):
            return page(request, "videos.html", cfg, items=st.video_rows(conn))

    @app.get("/settings", response_class=HTMLResponse, dependencies=deps)
    def settings_page(request: Request) -> HTMLResponse:
        cfg = config()
        return page(
            request,
            "settings.html",
            cfg,
            accounts=account_status(cfg),
            channels=cfg.sources,
            rights=acc.RIGHTS_CHOICES,
        )

    @app.get("/health", response_class=HTMLResponse, dependencies=deps)
    def health(request: Request, online: bool = False) -> HTMLResponse:
        from clipbot import doctor

        cfg = config()
        results = doctor.run_checks(cfg, DataPaths(cfg.settings.data_dir), online=online)
        return page(request, "health.html", cfg, results=results, online=online)

    @app.get("/api/status", dependencies=deps)
    def api_status() -> JSONResponse:
        cfg = config()
        now = clock()
        with database(cfg) as (conn, paths):
            bot = st.bot_state(conn, paths, now)
            return JSONResponse(
                {
                    "running": bot["running"],
                    "paused": bot["paused"],
                    "pause_reason": bot["pause_reason"],
                    "dry_run": cfg.settings.dry_run,
                    "clips": st.counts(conn, "clips"),
                    "videos": st.counts(conn, "videos"),
                }
            )

    # ------------------------------------------------------------------ media

    def clip_file(clip_id: str, column: str) -> Path:
        cfg = config()
        with database(cfg) as (conn, paths):
            row = conn.execute(f"SELECT {column} FROM clips WHERE id = ?", (clip_id,)).fetchone()
        if row is None or not row[0]:
            raise HTTPException(404)
        p = Path(row[0]).resolve()
        if paths.renders.resolve() not in p.parents or not p.is_file():
            raise HTTPException(404)
        return p

    @app.get("/clips/{clip_id}/video", dependencies=deps)
    def clip_video(clip_id: str) -> FileResponse:
        return FileResponse(clip_file(clip_id, "render_path"), media_type="video/mp4")

    @app.get("/clips/{clip_id}/poster", dependencies=deps)
    def clip_poster(clip_id: str) -> FileResponse:
        """A still frame shown before playback, made once and cached."""
        import subprocess

        video = clip_file(clip_id, "render_path")
        poster = video.with_suffix(".poster.jpg")
        if not poster.is_file():
            subprocess.run(
                [
                    ffmpeg_exe(),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    "1.0",
                    "-i",
                    str(video),
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=540:-2",
                    "-q:v",
                    "4",
                    str(poster),
                ],
                check=False,
                timeout=60,
            )
        if not poster.is_file():
            raise HTTPException(404)
        return FileResponse(
            poster, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
        )

    @app.get("/clips/{clip_id}/sheet", dependencies=deps)
    def clip_sheet(clip_id: str) -> FileResponse:
        return FileResponse(clip_file(clip_id, "contact_sheet_path"), media_type="image/jpeg")

    # ------------------------------------------------------------------ actions

    @app.post("/pause", dependencies=post_deps)
    def do_pause(
        reason: Annotated[str, Form()] = "paused from the dashboard",
        hours: Annotated[str, Form()] = "",
    ) -> RedirectResponse:
        cfg = config()
        until = clock() + timedelta(hours=float(hours)) if hours.strip() else None
        with database(cfg) as (conn, _):
            db.set_pause(conn, reason.strip() or "paused from the dashboard", until)
            db.log_event(conn, "pause", f"paused: {reason}", data={"by": "dashboard"})
        return back("/", "Paused. Nothing is processed or posted until you resume.")

    @app.post("/resume", dependencies=post_deps)
    def do_resume() -> RedirectResponse:
        cfg = config()
        with database(cfg) as (conn, paths):
            db.clear_pause(conn)
            db.log_event(conn, "resume", "resumed", data={"by": "dashboard"})
            if paths.pause_file.exists():
                return back(
                    "/",
                    f"Resumed, but the PAUSE file ({paths.pause_file}) still "
                    "keeps the bot paused. Delete it to really resume.",
                    error=True,
                )
        return back("/", "Resumed.")

    @app.post("/clip", dependencies=post_deps)
    def do_clip(
        url: Annotated[str, Form()], count: Annotated[int | None, Form()] = None
    ) -> RedirectResponse:
        from clipbot.pipeline import Pipeline
        from clipbot.sources.youtube_api import BadVideoURL, YouTubeError

        cfg = config()
        with database(cfg) as (conn, paths):
            db.sync_sources(conn, cfg.sources)
            make = pipeline_factory or Pipeline
            pipe = make(conn, cfg, paths)
            try:
                n = min(max(count, 1), MAX_CLIPS) if count else None
                reg = pipe.ingest_url(url.strip(), clip_count=n)
            except BadVideoURL:
                return back("/", "That is not a YouTube video link.", error=True)
            except (LookupError, YouTubeError) as e:
                return back("/", f"Could not look up the video: {e}", error=True)
        label = f"“{reg.title}” by {reg.channel}" if reg.title else reg.video_id
        if reg.new and reg.state == "discovered" and clip_now:
            start_clipping(cfg, reg.video_id)
        if reg.state == "skipped":
            return back("/", f"Refused {label}: {reg.reason}", error=True)
        if not reg.new:
            more = " The new number of clips will be used." if reg.count_updated else ""
            return back("/", f"Already known: {label} ({st.STATE_LABEL.get(reg.state)}).{more}")
        return back("/", f"Accepted {label}. Follow it under Clipping Now.")

    def start_clipping(cfg: AppConfig, video_id: str) -> None:
        """Run the pasted video from link to clips in a background thread, unless
        the bot is paused (then it waits for Resume like everything else)."""
        from clipbot.pipeline import Pipeline

        def run() -> None:
            paths = DataPaths(cfg.settings.data_dir)
            conn = db.connect(paths.db)
            try:
                if db.get_pause(conn).paused or paths.pause_file.exists():
                    return
                pipe = (pipeline_factory or Pipeline)(conn, cfg, paths)
                pipe.fast_process(video_id)
            except Exception as e:  # shown in the progress panel via the video's state
                log.warning("fast_clip_failed", video_id=video_id, error=str(e)[:300])
            finally:
                conn.close()

        threading.Thread(target=run, name=f"clip-{video_id}", daemon=True).start()

    def clip_action(clip_id: str, expect: set[str], to: str, reason: str) -> None:
        cfg = config()
        with database(cfg) as (conn, _), db.tx(conn):
            try:
                db.transition(
                    conn, "clips", clip_id, expect=expect, to=to, reason=reason, now=clock()
                )
            except db.StateConflict:
                raise HTTPException(
                    409, "this clip has already moved on; reload the page"
                ) from None
            db.log_event(conn, "review", reason, clip_id=clip_id, data={"by": "dashboard"})

    @app.post("/clips/{clip_id}/approve", dependencies=post_deps)
    def approve(clip_id: str, request: Request) -> RedirectResponse:
        clip_action(clip_id, {"awaiting_approval"}, "scheduled", "approved")
        return back(
            _return_to(request, "/clips?tab=review"), "Approved. It posts in the next open window."
        )

    @app.post("/clips/{clip_id}/reject", dependencies=post_deps)
    def reject(clip_id: str, request: Request) -> RedirectResponse:
        clip_action(
            clip_id, {"awaiting_approval", "qa_passed", "scheduled"}, "rejected", "removed by you"
        )
        return back(_return_to(request, "/clips"), "Removed. It will not be posted.")

    @app.post("/settings", dependencies=post_deps)
    async def save_settings(request: Request) -> RedirectResponse:
        form = await request.form()
        try:
            changed = save_settings_form(config_dir / "settings.yaml", dict(form))
        except SettingsFormError as e:
            return back("/settings", str(e), error=True)
        if not changed:
            return back("/settings", "Nothing changed.")
        return back("/settings", "Saved. The running bot picks this up within a minute.")

    # ------------------------------------------------------------------ setup

    all_steps = [
        ("ai", "AI"),
        ("youtube", "YouTube"),
        ("channels", "Channels"),
        ("tiktok", "TikTok"),
    ]

    def steps_for(cfg: AppConfig) -> list[tuple[str, str]]:
        """No AI step when this copy of clipbot came with a shared AI key."""
        if ai_source(cfg) == "shared":
            return [s for s in all_steps if s[0] != "ai"]
        return all_steps

    def youtube_client(cfg: AppConfig) -> Any:
        if pipeline_factory is not None:  # tests
            with database(cfg) as (conn, paths):
                return pipeline_factory(conn, cfg, paths).yt
        from clipbot.sources.youtube_api import YouTubeAPI

        key = cfg.secrets.youtube_api_key
        return YouTubeAPI(key.get_secret_value() if key else "")

    @app.get("/setup", response_class=HTMLResponse, dependencies=deps)
    def setup_start(request: Request) -> HTMLResponse:
        cfg = config()
        steps = steps_for(cfg)
        return page(
            request,
            "setup.html",
            cfg,
            step="welcome",
            steps=steps,
            first_step=steps[0][0],
            accounts=account_status(cfg),
        )

    @app.get("/setup/{step}", response_class=HTMLResponse, dependencies=deps)
    def setup_step(request: Request, step: str) -> HTMLResponse:
        if step not in {k for k, _ in all_steps} | {"done"}:
            raise HTTPException(404)
        cfg = config()
        steps = steps_for(cfg)
        order = [k for k, _ in steps]
        return page(
            request,
            "setup.html",
            cfg,
            step=step,
            steps=steps,
            in_steps=step in order,
            login=_login_view() if step == "tiktok" else None,
            accounts=account_status(cfg),
            channels=cfg.sources,
            rights=acc.RIGHTS_CHOICES,
            returning=request.query_params.get("from") == "settings",
        )

    def next_url(request_form: Any, current: str) -> str:
        if request_form.get("from") == "settings":
            return "/settings"
        order = [k for k, _ in steps_for(config())] + ["done"]
        if current not in order:
            return f"/setup/{order[0]}"
        return f"/setup/{order[order.index(current) + 1]}"

    @app.post("/setup/ai", dependencies=post_deps)
    async def setup_ai(request: Request) -> RedirectResponse:
        form = await request.form()
        try:
            msg = acc.check_openrouter(str(form.get("key", "")))
            acc.write_env(env_path, {"OPENROUTER_API_KEY": str(form["key"]).strip()})
        except acc.SetupError as e:
            return back("/setup/ai" + _from(form), str(e), error=True)
        return back(next_url(form, "ai"), f"AI key saved. {msg}")

    @app.post("/setup/youtube", dependencies=post_deps)
    async def setup_youtube(request: Request) -> RedirectResponse:
        form = await request.form()
        try:
            msg = acc.check_youtube(str(form.get("key", "")))
            acc.write_env(env_path, {"YOUTUBE_API_KEY": str(form["key"]).strip()})
        except acc.SetupError as e:
            return back("/setup/youtube" + _from(form), str(e), error=True)
        return back(next_url(form, "youtube"), f"YouTube key saved. {msg}")

    @app.post("/channels/add", dependencies=post_deps)
    async def channel_add(request: Request) -> RedirectResponse:
        form = await request.form()
        where = "/settings" if form.get("from") == "settings" else "/setup/channels"
        cfg = config()
        if cfg.secrets.youtube_api_key is None:
            return back("/setup/youtube", "Add your YouTube key first.", error=True)
        try:
            ref = acc.resolve_channel(str(form.get("link", "")), youtube_client(cfg))
            acc.add_channel(
                config_dir / "sources.yaml",
                ref,
                str(form.get("rights", "")),
                str(form.get("permission_ref", "")),
                str(form.get("about", "")),
            )
        except acc.SetupError as e:
            return back(where, str(e), error=True)
        return back(where, f"Added {ref.name}. New videos from it will be clipped.")

    @app.post("/channels/{source_id}/toggle", dependencies=post_deps)
    async def channel_toggle(source_id: str, request: Request) -> RedirectResponse:
        form = await request.form()
        try:
            acc.set_channel_enabled(
                config_dir / "sources.yaml", source_id, form.get("enabled") == "1"
            )
        except acc.SetupError as e:
            return back("/settings", str(e), error=True)
        return back("/settings", "Channel updated.")

    @app.post("/channels/{source_id}/remove", dependencies=post_deps)
    async def channel_remove(source_id: str, request: Request) -> RedirectResponse:
        form = await request.form()
        where = "/settings" if form.get("from") == "settings" else "/setup/channels"
        try:
            acc.remove_channel(config_dir / "sources.yaml", source_id)
        except acc.SetupError as e:
            return back(where, str(e), error=True)
        return back(where, "Channel removed.")

    @app.post("/setup/tiktok", dependencies=post_deps)
    async def setup_tiktok(request: Request) -> RedirectResponse:
        form = await request.form()
        key, profile = str(form.get("key", "")), str(form.get("profile", ""))
        try:
            msg = acc.check_uploadpost(key, profile)
            acc.write_env(
                env_path,
                {"UPLOAD_POST_API_KEY": key.strip(), "UPLOAD_POST_PROFILE": profile.strip()},
            )
            set_poster(config_dir, "uploadpost")
        except acc.SetupError as e:
            return back("/setup/tiktok" + _from(form), str(e), error=True)
        return back(next_url(form, "tiktok"), f"TikTok connected. {msg}")

    @app.post("/setup/tiktok/login", dependencies=post_deps)
    async def tiktok_login(request: Request) -> RedirectResponse:
        from clipbot.post import autotok_poster as at

        form = await request.form()
        if form.get("consent") != "on":
            return back(
                "/setup/tiktok" + _from(form),
                "Tick the box to confirm you understand the risk first.",
                error=True,
            )
        home = at.autotok_home(DataPaths(config().settings.data_dir).root)
        at.record_consent(home)
        set_poster(config_dir, "autotok")
        at.start_login(home)
        return RedirectResponse(
            "/setup/tiktok?waiting=1"
            + ("&from=settings" if form.get("from") == "settings" else ""),
            status_code=303,
        )

    @app.post("/setup/tiktok/disconnect", dependencies=post_deps)
    def tiktok_disconnect() -> RedirectResponse:
        from clipbot.post import autotok_poster as at

        at.disconnect(at.autotok_home(DataPaths(config().settings.data_dir).root))
        return back("/settings", "TikTok disconnected. Clips are made but not posted.")

    @app.post("/setup/notify", dependencies=post_deps)
    async def setup_notify(request: Request) -> RedirectResponse:
        form = await request.form()
        url = str(form.get("url", "")).strip()
        if url and not url.startswith("https://"):
            return back("/settings", "The alert address must start with https://", error=True)
        acc.write_env(env_path, {"NOTIFY_URL": url or None})
        return back("/settings", "Phone alerts saved." if url else "Phone alerts turned off.")

    @app.post("/share", dependencies=post_deps)
    async def make_share_copy(request: Request) -> RedirectResponse:
        from clipbot.assets import PACKAGE_ROOT
        from clipbot.share import app_version, build_zip, downloads_dir

        form = await request.form()
        cfg = config()
        key = cfg.secrets.openrouter_api_key
        include_key = form.get("include_ai_key") == "on"
        if include_key and (key is None or not key.get_secret_value()):
            return back("/settings", "Connect the AI first, then make the copy.", error=True)
        out = downloads_dir() / f"clipbot-{app_version(PACKAGE_ROOT)}-share.zip"
        try:
            build_zip(PACKAGE_ROOT, out, key.get_secret_value() if include_key and key else None)
        except (OSError, ValueError) as e:
            return back("/settings", f"Could not make the copy: {e}", error=True)
        return back(
            "/settings",
            f"Saved {out.name} in {out.parent}. Send that file; "
            "it contains no other keys, channels or clips.",
        )

    return app


def tiktok_label(cfg: AppConfig) -> str:
    """How clipbot posts to TikTok right now, or '' when it cannot post yet."""
    from clipbot.post.autotok_poster import autotok_home, connected, consented

    if cfg.settings.publish.poster == "autotok":
        home = autotok_home(DataPaths(cfg.settings.data_dir).root)
        return "your TikTok login" if consented(home) and connected(home) else ""
    key = cfg.secrets.upload_post_api_key
    if cfg.settings.publish.poster == "uploadpost" and key and key.get_secret_value():
        return f"Upload-Post profile {cfg.secrets.upload_post_profile}"
    return ""


def set_poster(config_dir: Path, poster: str) -> None:
    """Switch how clipbot posts, keeping settings.yaml comments."""
    from ruamel.yaml import YAML

    y = YAML()
    y.preserve_quotes = True
    path = config_dir / "settings.yaml"
    doc = y.load(path.read_text(encoding="utf-8")) or {}
    doc.setdefault("publish", {})["poster"] = poster
    buf = io.StringIO()
    y.dump(doc, buf)
    tmp = path.with_suffix(".yaml.tmp")
    tmp.write_text(buf.getvalue(), encoding="utf-8")
    os.replace(tmp, path)


def ai_source(cfg: AppConfig) -> str:
    """'own', 'shared' (came with this copy of clipbot) or '' (none)."""
    from clipbot.assets import PACKAGE_ROOT

    key = cfg.secrets.openrouter_api_key
    value = key.get_secret_value() if key else ""
    if not value:
        return ""
    shared = acc.read_env(PACKAGE_ROOT / "shared.env").get("OPENROUTER_API_KEY")
    return "shared" if shared and shared == value else "own"


def _login_view() -> dict[str, str]:
    from clipbot.post.autotok_poster import login_state

    st_ = login_state()
    return {"state": st_.state, "message": st_.message}


def _from(form: Any) -> str:
    return "?from=settings" if form.get("from") == "settings" else ""


def is_configured(cfg: AppConfig) -> bool:
    """The two keys clipbot cannot work without."""
    s = cfg.secrets
    return bool(
        s.openrouter_api_key
        and s.openrouter_api_key.get_secret_value()
        and s.youtube_api_key
        and s.youtube_api_key.get_secret_value()
    )


def account_status(cfg: AppConfig) -> dict[str, Any]:
    s = cfg.secrets

    def val(v: Any) -> str | None:
        if v is None:
            return None
        return v.get_secret_value() if hasattr(v, "get_secret_value") else str(v)

    return {
        "ai": acc.mask(val(s.openrouter_api_key)),
        "ai_source": ai_source(cfg),
        "youtube": acc.mask(val(s.youtube_api_key)),
        "tiktok": tiktok_label(cfg),
        "tiktok_method": cfg.settings.publish.poster,
        "notify": bool(val(s.notify_url)),
        "channels": sum(1 for c in cfg.sources if c.enabled),
        "ready": is_configured(cfg),
    }


def _return_to(request: Request, default: str) -> str:
    ref = request.headers.get("referer") or ""
    u = urlparse(ref)
    if u.path.startswith("/") and u.netloc == request.headers.get("host"):
        return u.path + (
            f"?{u.query}" if u.query and "msg=" not in u.query and "err=" not in u.query else ""
        )
    return default


# --------------------------------------------------------------------------- settings


class SettingsFormError(ValueError):
    pass


def _set(doc: Any, path: list[str], value: Any) -> bool:
    node = doc
    for k in path[:-1]:
        if k not in node or node[k] is None:
            node[k] = {}
        node = node[k]
    if node.get(path[-1]) == value:
        return False
    node[path[-1]] = value
    return True


def save_settings_form(path: Path, form: dict[str, Any]) -> bool:
    """Apply the dashboard's settings form to settings.yaml, keeping its comments.
    Validates the result before writing; an invalid form changes nothing."""
    from ruamel.yaml import YAML
    from ruamel.yaml.comments import CommentedSeq

    yaml = YAML()
    yaml.preserve_quotes = True
    doc = yaml.load(path.read_text(encoding="utf-8")) or {}

    def num(name: str, kind: type = int) -> Any:
        raw = str(form.get(name, "")).strip()
        try:
            return kind(raw)
        except ValueError:
            raise SettingsFormError(f"{name.replace('_', ' ')} must be a number") from None

    def flow(items: list[Any]) -> CommentedSeq:
        seq = CommentedSeq(items)
        seq.fa.set_flow_style()
        return seq

    windows = [
        w.strip() for w in str(form.get("windows", "")).replace(";", ",").split(",") if w.strip()
    ]
    tags = [
        t.strip().lstrip("#")
        for t in str(form.get("extra_hashtags", "")).replace(",", " ").split()
        if t.strip()
    ]
    changes = {
        ("dry_run",): form.get("dry_run") == "on",
        ("review_mode",): "hold" if form.get("review_mode") == "hold" else "auto",
        ("publish", "posts_per_day"): num("posts_per_day"),
        ("publish", "min_gap_minutes"): num("min_gap_minutes"),
        ("publish", "privacy"): str(form.get("privacy", "account_default")),
        ("publish", "windows"): flow(windows),
        ("post", "extra_hashtags"): flow(tags),
        ("post", "language"): str(form.get("language") or "pl"),
        ("safety", "strict_qa"): form.get("strict_qa") == "on",
        ("clips", "per_video"): num("per_video"),
        ("clips", "min_score"): num("min_score"),
        ("clips", "min_seconds"): num("min_seconds", float),
        ("clips", "max_seconds"): num("max_seconds", float),
        ("captions", "hook_seconds"): num("hook_seconds", float),
    }
    changed = False
    for keys, value in changes.items():
        changed |= _set(doc, list(keys), value)
    if not changed:
        return False

    buf = io.StringIO()
    yaml.dump(doc, buf)
    text = buf.getvalue()
    import yaml as pyyaml

    try:
        Settings.model_validate(pyyaml.safe_load(text))
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise SettingsFormError(f"{where}: {first['msg'].removeprefix('Value error, ')}") from None
    tmp = path.with_suffix(".yaml.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    return True


# --------------------------------------------------------------------------- serving


def lan_addresses() -> list[str]:
    import socket

    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 80))  # no packet is sent; picks the outgoing interface
        out.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return out


def urls_for(host: str, port: int) -> list[str]:
    if is_loopback(host):
        return [f"http://127.0.0.1:{port}"]
    if host in ("0.0.0.0", "::"):  # noqa: S104
        return [f"http://127.0.0.1:{port}"] + [f"http://{a}:{port}" for a in lan_addresses()]
    return [f"http://{host}:{port}"]


def serve_in_thread(app: FastAPI, host: str, port: int) -> Any:
    """Run the dashboard next to the bot loop (which keeps the main thread)."""
    import threading

    import uvicorn

    class _Server(uvicorn.Server):
        def install_signal_handlers(self) -> None:  # the bot loop owns the signals
            pass

    server = _Server(
        uvicorn.Config(app, host=host, port=port, log_level="warning", access_log=False)
    )
    t = threading.Thread(target=server.run, name="dashboard", daemon=True)
    t.start()
    return server
