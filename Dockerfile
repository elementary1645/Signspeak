# SignSpeak: one image for Hugging Face Docker Spaces (port 7860, uid 1000).
# FastAPI serves the built web app, the API, the WebSocket and the self-hosted
# MediaPipe models from one origin.

# ---- 1. Build the web app ---------------------------------------------------
FROM node:24.14.1-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
COPY web/scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. Python runtime ------------------------------------------------------
FROM python:3.12.10-slim-bookworm
# libGL/glib: required by OpenCV, which the legacy Python MediaPipe detector imports.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.lock.txt /tmp/requirements.lock.txt
RUN pip install -r /tmp/requirements.lock.txt

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /home/user/app

# Models are fetched at build time and checked against the committed SHA256 manifest.
COPY --chown=user backend/models/manifest.json backend/models/manifest.json
COPY --chown=user scripts/download_model.py scripts/download_model.py
RUN python scripts/download_model.py

COPY --chown=user . .
COPY --chown=user --from=web /web/dist web/dist

EXPOSE 7860
# One worker: per-connection recognition state lives in process memory.
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
