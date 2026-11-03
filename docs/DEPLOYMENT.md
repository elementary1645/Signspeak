# Deployment

Both paths use the same `Dockerfile`: FastAPI serves the built web app, `/api/*`,
`/ws/recognize`, the MediaPipe models and WASM from one HTTPS origin. Pick one:

| | Render (free) | Hugging Face Space |
|---|---|---|
| Builds from | this GitHub branch (`render.yaml`) | files uploaded by `scripts/deploy_space.py` |
| Trained bundle + audio | downloaded at startup from a **private HF model repo** (`scripts/publish_model.py`) | uploaded with the code |
| Resources | 512 MB RAM, 0.1 CPU; sleeps after 15 min idle | 16 GB RAM, 2 vCPU (CPU basic); sleeps when idle |
| Before judging | open the URL **a minute before** (spin-up) | open the URL ~10 minutes before |

The trained bundle, `metrics.json` and generated audio are **never committed to GitHub**.

## Render (free)

### One-time setup (about 10 minutes)

1. **Private model repo + tokens** on https://huggingface.co/settings/tokens:
   - a **Write** token, for you, to publish models;
   - a **Read** token (fine-grained, read access to `Chinmay1881/signspeak-model`), for Render.
2. **Publish a model**, after training (see the evening loop). This creates the repo as private:
   ```powershell
   pip install -r requirements-tools.txt
   $env:HF_TOKEN = "<write token>"
   python -m scripts.publish_model                       # default repo Chinmay1881/signspeak-model
   ```
   You can deploy before any model exists. The app then shows "Model not trained yet".
3. **Create the service:** https://dashboard.render.com → **New** → **Blueprint** →
   connect GitHub and pick **elementary1645/Signspeak** → branch
   **`feat/phase3-live-recognition`** → Render finds `render.yaml` and shows one web service,
   `signspeak` (Docker, Free).
4. Render asks for the secret env var **`HF_TOKEN`**: paste the **Read** token. The other
   variables come from `render.yaml`:
   | Variable | Value | Why |
   |---|---|---|
   | `MODEL_REPO` | `Chinmay1881/signspeak-model` | where the bundle is downloaded from (change it in the dashboard if your repo differs) |
   | `HF_TOKEN` | Read token (secret) | private repo access; never committed |
   | `LEGACY_DETECTOR` | `0` | skips the Phase 1/2 lab's Python MediaPipe (≈125 MB instead of ≈250 MB idle) |
   | `PREDICT_EVERY` | `3` | prediction stride at 15 fps; raise it to 5–6 only if latency climbs |
5. **Apply.** The first build takes several minutes. When **Live**, open
   `https://signspeak-<suffix>.onrender.com` (shown on the service page).

`healthCheckPath` is `/health`, which answers immediately. The model download runs in the
background (`/ready` shows `MODEL_LOADING`, then 200 or the honest `MODEL_NOT_TRAINED`).
The downloaded bundle is checked against the current vocabulary before it is installed.
A bundle trained on an older vocabulary is refused, and the app stays "not trained" until
you retrain and republish. `autoDeploy` rebuilds on every push to the branch.

### The evening loop

```powershell
python -m scripts.merge_takes <downloaded .jsonl files or folders>
python -m backend.live.train                 # --max-latency-ms 10 (default) keeps 0.1 CPU in mind
python -m scripts.generate_audio
$env:HF_TOKEN = "<write token>"; python -m scripts.publish_model
```

Then in the Render dashboard: **Manual Deploy → Restart service**. A restart is enough:
the model and audio are downloaded at startup, so no rebuild is needed. Use **Deploy
latest commit** only after code changes that you have pushed.

### Open the URL a minute before judging

Free services spin down after 15 minutes without traffic. The first request after that
starts the container again (Render shows a loading page). Open `/translate` about
**a minute before** judging, wait for the camera and the "Live connection" line, and check
`/ready`.

### CPU budget and `--max-latency-ms`

`python -m backend.live.train` times one live prediction per candidate model (feature
summary + `predict_proba`, single-threaded, median of 30). It excludes models slower than
`--max-latency-ms` (default 10 ms) before picking the best macro-F1. The measurements go
into `metrics.json` (`metrics.latency`), the model card and the About page. They are
measured on the training machine, not on Render.

Live serving computes each frame's hp-v1 vector once on arrival (same function, cached),
so a prediction only assembles and summarises the window. `PREDICT_EVERY` (env, 1–15,
default 3) sets how many frames pass between predictions.

## Hugging Face Space (alternative)

```powershell
$env:HF_TOKEN = "<write token>"
python -m scripts.deploy_space --space <user>/signspeak --create     # first time
python -m scripts.deploy_space --space <user>/signspeak              # after each retrain
```

This uploads the git-tracked code, the Dockerfile, the current trained bundle (refused if
it does not load with the current vocabulary) and audio. It never uploads `data/raw` or
`data/processed`. `--dry-run` lists the files. A public Space's files are downloadable,
including the bundle; see `docs/PRIVACY.md`. The Space ignores `render.yaml` and
`MODEL_REPO`; with no `PORT` set, the container listens on 7860 (`app_port`).

## Checks after any deploy

| Check | Expect |
|---|---|
| `GET /health` | 200 at once, even while the model downloads |
| `GET /ready` | 503 `MODEL_LOADING` → 200, or 503 `MODEL_NOT_TRAINED` with the reason |
| `/`, `/translate`, `/learn`, `/how-it-works`, `/about`, `/collect` | 200 over HTTPS; camera prompt on Translate/Collect |
| `/models/*.task`, `/mediapipe/wasm/vision_wasm_internal.wasm` | 200 |
| Translate debug line | fps, tracker GPU/CPU, "Live connection" (or "Live (HTTP fallback)" if WSS is blocked) |

## Measured numbers

Local measurements, 3 November 2026, Windows 11 laptop with Docker Desktop. `--cpus 0.1
--memory 512m` imitates Render free's quota but is **not** Render hardware. Live
latencies used **synthetic** test bundles (`SYNTH_*` labels), not an ISL model.

| What | Setup | Result |
|---|---|---|
| Image build (clean cache) | `docker build` | 328 s, 1.51 GB image |
| Cold start (container start → `/health` 200) | 0.1 CPU, 512 MB, `LEGACY_DETECTOR=0` | 17.1 s |
| Idle memory | same | ≈95 MiB of 512 MiB (≈103–107 MiB with a bundle loaded) |
| Cold start / idle memory | 2 CPU, legacy lab on (HF-like) | 2.4 s / ≈183 MiB |
| Live WebSocket, 15 fps for 20 s, stride 3 | 0.1 CPU; logistic regression / SVM / random forest | 100/100 replies each; p50 6 / 6 / 12 ms, p95 8 / 9 / 14 ms (RF max 73 ms) |
| Per-window cost on the training machine | `metrics.latency`, synthetic bundles | LR 1.4 ms, SVM 1.8 ms, RF 6.8 ms |
| Native (no Docker) idle memory | Windows, legacy on / off | ≈248 MB / ≈125 MB |
| On Render / HF itself | | **not measured yet**: needs the first real deploy (tokens) |

After the first Render deploy, record the build time, the spin-up time after sleep, and
memory from the service's **Metrics** tab here.
