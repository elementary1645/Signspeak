# SignSpeak

Human Impact track · November 2–4, 2026 hackathon · Authentic Indian Sign Language (ISL).

SignSpeak recognises a small, **human-verified** set of ISL signs from a webcam and shows
their meaning in English, Kannada, Hindi or Tamil. The browser extracts hand and
upper-body landmarks with MediaPipe; only landmarks (never images) go to a Python server,
which computes features, trains CPU scikit-learn models and runs live recognition.

**Live demo:** not deployed yet. Deploying needs a Hugging Face token; see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). After the first deploy the app runs at
`https://<user>-signspeak.hf.space`. Free Spaces sleep when idle: open the URL about
10 minutes before judging.

**Status.** Product UI (Home, Translate, Learn ISL, How It Works, About & Model), speech,
collection, training and live recognition are built and tested. The browser pipeline has
been checked in headless Chrome with a fake camera. **No sign is verified yet and no
model is trained.** Until then `/translate` says "Model not trained yet" and never
guesses. See [the human steps](#what-needs-a-human).

```
browser: camera → MediaPipe Hand (2) + Pose lite, ~15 fps → lm-v1 landmarks
  /collect  → takes of 26 frames or 3 s (autosaved in IndexedDB) → "Download my data" (.jsonl) → scripts/merge_takes.py
  /translate → WebSocket /ws/recognize (or POST /api/predict)
server (Python): hp-v1 features → sklearn model → NONE/threshold rejection → smoothing → state
```

## Run it

Needs Python 3.12 and Node 20.19+ (tested: Windows 11 with Python 3.12.10 and Node 24.14;
Phase 1/2 on Linux with Python 3.12.3). CPU only. No API keys.

**Windows (PowerShell)**

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.lock.txt
python scripts/download_model.py          # hand + pose .task models, SHA256-checked
cd web; npm install; npm run build; cd ..
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

**Linux / macOS**

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.lock.txt      # Ubuntu 24.04 may need: libgl1 libglib2.0-0t64 python3.12-venv
python scripts/download_model.py
(cd web && npm install && npm run build)
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Open http://127.0.0.1:8000. Pages: `/` Home, `/translate`, `/learn`, `/how-it-works`,
`/about`, and `/collect` for volunteer signers (linked in the footer). The camera needs
`localhost` or HTTPS.
FastAPI serves the built app, API, WebSocket and models from one origin, with no
localhost assumptions (ready for one Docker image on Hugging Face Spaces, port 7860).

**Frontend dev with hot reload:** keep the backend running on :8000, then
`cd web && npm run dev` and open http://localhost:5173 (Vite proxies `/api`, `/ws`,
`/ready`, `/models`).

**Optional server-side save** of takes (otherwise nothing is written by the server):
`$env:ENABLE_COLLECTION="1"` (PowerShell) or `ENABLE_COLLECTION=1` (bash) before
starting uvicorn. Takes go to `data/raw/takes/` (git-ignored).

## The workflow

1. **Verify signs:** [docs/HOW_TO_VERIFY_A_SIGN.md](docs/HOW_TO_VERIFY_A_SIGN.md), about 10 minutes per sign.
   `python -m scripts.verify_sign HELLO --link <exact official URL>` makes the sign
   recordable; `python -m scripts.verify_sign HELLO` records the human review.
2. **Collect:** each signer follows [docs/COLLECTION_PROTOCOL.md](docs/COLLECTION_PROTOCOL.md)
   on `/collect` (about 25 minutes: 8 takes per sign plus 16 guided NONE takes) and downloads a `.jsonl`.
3. **Merge:** `python -m scripts.merge_takes <files or folders>` writes `data/processed/takes.jsonl`.
4. **Train:** `python -m backend.live.train`. It refuses unverified labels (NONE excepted),
   compares RF/ExtraTrees/LogReg/SVM by grouped macro-F1 (leave-one-signer-out with 3 or more
   signers), tunes rejection thresholds on validation folds, and writes
   `backend/models/live/{model.joblib,metrics.json}` and the [model card](docs/MODEL_CARD.md).
   Options: `--drop-unverified`, `--mirror-augment`, `--models svm_rbf,random_forest`.
5. **Voice:** `python -m scripts.generate_audio` makes mp3s for every verified sign in all
   four languages (edge-tts Indian voices, gTTS fallback; needs `pip install -r requirements-tools.txt`).
6. **Restart the server** (or redeploy). `/ready` returns 200 only when a compatible model
   is loaded; `/translate` shows live states and speaks recognised meanings.

### The evening loop (after each collection session)

```powershell
python -m scripts.merge_takes <downloaded .jsonl files or folders>
python -m backend.live.train
python -m scripts.generate_audio
cd web; npm run build; cd ..                    # local use; the Space builds its own
$env:HF_TOKEN = "<write token>"; python -m scripts.deploy_space --space <user>/signspeak
```

Live states: `INITIALIZING`, `READY`, `DETECTING`, `RECOGNIZING`, `RECOGNIZED`, `UNKNOWN`,
`NO_HAND`, `ERROR`. The reserved `NONE` class is trained but never displayed: if NONE
wins, or confidence/margin is below the tuned thresholds, the state is `UNKNOWN`.
Schemas and features: [docs/data_schema.md](docs/data_schema.md).

## Test

```bash
python -m pytest backend/tests -q        # Phase 1-3 Python tests
cd web && npm test                       # browser logic: frames, capture, reconnect, speech, UI state
node frontend/tests/collector.test.cjs   # legacy lab
python -m scripts.smoke_test             # real MediaPipe CPU model + legacy routes
```

All Phase 3 test data is **synthetic geometry** labelled `SYNTH_*`. It is never ISL data,
and its metrics say nothing about recognition quality.

## What needs a human

1. Verify signs (official link, watch, answer). AI cannot do this, and nothing is auto-approved.
2. Record takes: at least 3 consenting signers, ideally including Deaf ISL signers.
3. Native-speaker check of `data/metadata/translations.json` (kn/hi/ta were drafted by AI).
4. Real-camera checks: the overlay labels "your left"/"your right" correctly, and recognition behaves well with people who were not in training.

## Layout

- `web/`: Vite + React app (`/collect`, `/translate`), browser MediaPipe, shared landmark hook.
- `backend/live/`: Phase 3 protocol, hp-v1 features, vocabulary gate v2, takes, training, model bundle, live service, single-origin serving.
- `backend/app/`, `backend/training/`, `backend/sequence/`, `frontend/`: Phase 1/2 hands-v1 lab and Holistic experiments (kept working, not extended).
- `data/metadata/`: `vocabulary.json` (one registry; hp-v1 entries carry `"pipeline": "hp-v1"`), `translations.json`.
- `scripts/`: `download_model.py`, `verify_sign.py`, `merge_takes.py`, legacy tools.

## Phase 1/2 legacy lab

The hands-v1 still-sign lab still works at `/lab` (and at `/` when `web/dist` is not built),
with its `/frames` endpoint, `scripts.review_sign`, `backend.training.*` and the Holistic
experiments. See [docs/phase2.md](docs/phase2.md), [phase2c](docs/phase2c.md),
[phase2d](docs/phase2d.md) and [validation](docs/validation.md). The hands-v1 gate ignores
hp-v1 registry entries and vice versa.

## Limits and attribution

hp-v1 has no face landmarks, so signs that need facial grammar or mouthing are rejected
at verification. Small vocabulary, few signers: any unfamiliar movement can still be
misread. Not for medical or emergency use. No speech output yet.

Sign authority: [ISLRTC](https://islrtc.nic.in/isl-dictionary/). Dictionary videos are linked,
not copied. No external sign dataset is bundled or used.

Google [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
Hand Landmarker and [Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
lite (`@mediapipe/tasks-vision` 0.10.35, Apache-2.0). Model URLs, SHA256 and retrieval
dates are in [backend/models/manifest.json](backend/models/manifest.json). The binaries are
downloaded separately, git-ignored and self-hosted at runtime. FastAPI, scikit-learn,
React, Vite and other dependencies keep their own licenses.

**AI assistance disclosure.** OpenAI **ChatGPT/Codex** assisted with Phases 1–2.
**Claude Code (Anthropic)** assisted with Phase 3 onwards: the web app and product UI,
hp-v1 pipeline, training, live service, speech generation and player, deployment
tooling, tests and documentation. The kn/hi/ta translation drafts are AI-generated
and flagged for native-speaker review. No complete existing sign-language project was
copied. Sign verification, real data and real evaluation cannot come from an AI assistant.

Privacy details: [docs/PRIVACY.md](docs/PRIVACY.md). Speech is generated with Microsoft
Edge TTS voices (`edge-tts`) or Google Text-to-Speech (`gTTS`) from the dictionary meanings only.
