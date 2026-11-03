# Deployment: Hugging Face Docker Space

One Docker image: FastAPI on port 7860 serves the built web app, `/api/*`, `/ws/recognize`
and the self-hosted MediaPipe models and WASM from one HTTPS origin, so the camera works
for anyone with the link. The Space builds the image remotely; you do not need Docker locally.

## First deploy (10 minutes)

1. Create a Hugging Face **write** token: https://huggingface.co/settings/tokens
2. Install the tools once:
   ```powershell
   pip install -r requirements-tools.txt
   ```
3. Deploy. `--create` makes a public Docker Space on free CPU if it does not exist yet:
   ```powershell
   $env:HF_TOKEN = "<token>"           # bash: export HF_TOKEN=<token>
   python -m scripts.deploy_space --space <user>/signspeak --create
   ```
   The script prints the Space page and the app URL (`https://<user>-signspeak.hf.space`).
   The first build takes several minutes; watch "Logs" on the Space page.

To create the Space by hand instead, use https://huggingface.co/new-space: SDK **Docker**,
blank template, **CPU basic**, Public. Then run the command above without `--create`.

`python -m scripts.deploy_space --dry-run` lists exactly what would be uploaded.

## Redeploy after each retrain

```powershell
python -m scripts.deploy_space --space <user>/signspeak
```

This uploads the git-tracked code, the Dockerfile, the **current trained bundle**
(`backend/models/live/model.joblib` + `metrics.json`) and generated audio
(`web/public/audio`). The bundle and audio are never committed to GitHub. The script
refuses to ship a bundle that does not load with the current vocabulary. Collected takes
(`data/raw`, `data/processed`) are never uploaded. `HF_TOKEN` is read from the environment
only and is never printed or written.

## What the image does

- Stage 1 (`node:24.14.1-bookworm-slim`): `npm ci` and `npm run build`. Also copies the
  MediaPipe WASM runtime out of the pinned `@mediapipe/tasks-vision` package.
- Stage 2 (`python:3.12.10-slim-bookworm`): `pip install -r requirements.lock.txt` (pinned)
  and `useradd -m -u 1000 user`. Models are downloaded at build time and checked against
  `backend/models/manifest.json`. Files are added with `COPY --chown=user` (no recursive
  chown). Runs as uid 1000 with a single uvicorn worker.
- Classifier inference runs off the event loop: WebSocket frames go through
  `anyio.to_thread`, and the sync `POST /api/predict` / `/frames` handlers run in
  FastAPI's threadpool.
- `.dockerignore` keeps out `.git`, `.venv`, `node_modules`, `experiments/`, `data/raw`,
  `data/processed` and build output. `data/metadata` (vocabulary + translations) is
  included because the server needs it.

## Before judging: wake the Space

Free CPU Spaces **sleep after a period without visitors**. The first visit after sleeping
restarts the container. **Open the URL about 10 minutes before judging**, load
`/translate` once, and check `/ready`.

## Checks after a deploy

| Check | Expect |
|---|---|
| `GET /health` | 200 `{"status":"ok", ...}` |
| `GET /ready` | 503 + `MODEL_NOT_TRAINED` before training; 200 once a bundle is deployed |
| `/translate`, `/collect` | page loads over HTTPS; camera permission prompt appears |
| `/models/hand_landmarker.task`, `/mediapipe/wasm/vision_wasm_internal.wasm` | 200 |
| Translate debug line | fps, tracker GPU/CPU, "Connected (WebSocket)" |
| If WSS is blocked (some networks) | after 5 retries the page shows "Connected (HTTP fallback)" |

## Measured numbers

| What | Where measured | Result |
|---|---|---|
| Cold start (process launch → `/health` 200) | local Windows 11 laptop, uvicorn, no Docker | 3.2 s |
| Idle memory (working set, no connections) | same | ≈235 MB |
| Cold start / memory on the Space | Hugging Face CPU basic | **not measured yet**: no deploy has run (needs `HF_TOKEN`) |
| Image build | local Docker | **not run**: the dev machine's C: drive was full (0 bytes free) |

Record the Space numbers here after the first deploy: build time from the Logs tab,
cold start (time from opening the sleeping URL to the page loading), and memory from
the Space's "Container" metrics.
