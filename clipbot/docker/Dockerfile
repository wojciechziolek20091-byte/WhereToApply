# clipbot: build from the clipbot/ folder with
#   docker compose -f docker/compose.yml build
# Debian 13 (trixie) ships ffmpeg 7.1 with libass and libx264.
FROM python:3.12-slim-trixie

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "uv==0.11.32"

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY assets ./assets
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 1000 clipbot \
 && mkdir -p /data /app/config \
 && chown clipbot:clipbot /data
USER clipbot

ENV PATH=/app/.venv/bin:$PATH \
    CLIPBOT_CONFIG_DIR=/app/config \
    CLIPBOT_DATA_DIR=/data \
    CLIPBOT_ENV_FILE=/app/.env.none
VOLUME ["/data"]
ENTRYPOINT ["tini", "--", "clipbot"]
CMD ["run"]
