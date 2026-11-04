# SignSpeak

SignSpeak recognises a few Indian Sign Language (ISL) signs from your webcam and shows
their meaning as text and speech in English, Kannada, Hindi or Tamil. Every sign was
checked by a person against the official ISLRTC dictionary video before the model could learn it.
It is a hackathon prototype (Human Impact track, 2–4 November 2026), not an interpreter.

**Try it:** https://signspeak-5xwo.onrender.com
Use **Chrome or Edge on a laptop or desktop. Phones are not supported yet** (see [Limitations](#limitations)).

## How to try it

The live model knows three signs: **HELLO, YES and NO**. Watch the official video for each
one on [/learn](https://signspeak-5xwo.onrender.com/learn) first, then open
[/translate](https://signspeak-5xwo.onrender.com/translate) and press **Start camera**.

Tips:
- **Cold start:** the free server sleeps when idle. The first visit can take about 50 seconds
  to wake it up, and the model loads a few seconds after that.
- Sit back so your **face is in the upper half of the frame** and your hands and shoulders are visible.
- **Start with your hand raised beside your shoulder**, make the sign, then **hold it for about 1 second**.
- Anything that isn't one of the three signs should show "Not a sign I know". It isn't perfect:
  a raised hand can still be misread as HELLO, especially for people the model hasn't seen.
- Choose a language and turn on **Speak results aloud** to hear the meaning.

## Results, honestly

- **Data:** 160 two-second takes from **2 consenting, pseudonymous signers**, recorded on `/collect`
  (signer01: 112 takes, signer02: 48). The deployed model (run #4) uses 136 of them. The 24
  THANK_YOU takes are kept but left out (see [Limitations](#limitations)). 64 of the 136 are
  "NONE" takes: rest, fidgeting, half-signs, a raised hand held still. They teach the model when not to answer.
- **Model:** an RBF-SVM (scikit-learn) on hand and upper-body landmark features. If the
  NONE class wins, or confidence or margin is too low, nothing is shown.
- **Train on one person, test on the other** (leave-one-signer-out). Algorithm and thresholds
  were chosen without the tested person. Numbers are from [docs/MODEL_CARD.md](docs/MODEL_CARD.md), run #4:

  | | Macro-F1 | Signs recognised | Non-signs shown as a sign |
  |---|---|---|---|
  | Trained on signer02, tested on signer01 | 0.756 | 45/48 | 22/48 |
  | Trained on signer01, tested on signer02 | 0.919 | 21/24 | 0/16 |
  | Both folds together | 0.803 | 66/72 | 22/64 |

  The main failure for a new person is a non-sign being accepted as a sign, mostly HELLO
  (12 of the 22).
- **Unseen-signer accuracy is not properly measured.** Two people give two data points, not
  an accuracy figure for new signers. The trainer's own numbers (open-set macro-F1 0.95)
  use new takes from the **same** two people, so they overstate how it works for someone new.
  We'd need at least 3 signers, ideally Deaf ISL signers, before claiming accuracy.

## Limitations

- **Three signs only:** HELLO, YES, NO. Single, isolated signs, not sentences or ISL grammar.
- **No facial grammar.** The tracker doesn't read faces, so signs that need facial
  expression or mouthing are excluded at verification.
- **THANK_YOU was withdrawn.** It was verified and trained, and it scored perfectly on
  recorded data (24/24 in both cross-person folds). But it kept failing in live use. It is
  the only one of our signs that ends near the face (the hand moves away from the chin). We
  didn't isolate the cause, so we removed it instead of shipping a sign that doesn't work.
- **Phones are too slow for now.** On one iPhone (Safari and the in-app browser, CPU and GPU,
  640 and 320 px input), browser tracking took about 267 ms per frame. That never reached
  the 7 FPS the 8 FPS model needs, so recognition never started. This was measured on one
  device, not on all phones. Home, Learn and Translate show a notice (not a block) on phones
  and tablets, and Translate also shows it if tracking stays below 7 FPS for about 5 seconds.
- **Translations:** the Kannada, Hindi and Tamil meanings were drafted by an AI assistant
  and are **awaiting a native-speaker check**.
- Lighting, camera angle and signing style all affect results. Not for medical, legal or
  emergency use.

## Privacy: landmarks only

Hand and body tracking (Google MediaPipe) runs **inside your browser**. Camera frames go
from the `<video>` element to a Web Worker in the same tab and are never sent over the
network. We checked this in the code: the only network calls in the app are in
[recognizerClient.js](web/src/lib/recognizerClient.js) (`/ws/recognize`, fallback
`POST /api/predict`), [Collect.jsx](web/src/pages/Collect.jsx) (`POST /api/takes`), plus `GET` requests for the
app's own files, models, audio and `/api/*` status data. None of them carries an image.

- **/translate sends**, for each tracked frame (about 8 per second), one JSON object:
  `t_ms` (timestamp), `w`/`h` (size of the tracked image in pixels), `hands` (up to 2 × 21 points as
  `[x, y, z]`, rounded, plus the tracker's left/right guess and its score), and `pose` (33 body
  points as `[x, y, z, visibility]`, or null). The server rejects frames with any other field.
  It keeps the last 3 seconds of points per connection in memory only, and doesn't log or store them.
- **/collect** keeps takes in your browser (IndexedDB) until you press **Download my data**.
  A take is the same landmark frames plus label, pseudonym, session ID, app version,
  timestamps, frame-rate metadata and a consent flag. Saving takes on the server is **off
  on the public demo**, and on any server unless it is started with `ENABLE_COLLECTION=1`.
  With it off, `/collect` sends nothing.
- **Other requests:** fonts, the MediaPipe runtime and models are served by the app itself.
  There are no analytics. `/learn` embeds the official ISLRTC YouTube videos via
  `youtube-nocookie.com`.
- **Exception, legacy lab only:** the old Phase 1/2 page at `/lab` (not linked from the app)
  uploads JPEG frames to `/frames` for server-side detection. On the public demo that endpoint
  is disabled (`LEGACY_DETECTOR=0`) and returns an error without decoding the image. The browser still sends the request.

More detail: [docs/PRIVACY.md](docs/PRIVACY.md).

## How it works

```
browser: camera → MediaPipe Hand Landmarker (2 hands) + Pose Landmarker lite, ~8 FPS → landmark points only
  /translate → WebSocket /ws/recognize (or POST /api/predict)
  /collect   → takes in IndexedDB → "Download my data" (.jsonl) → scripts/merge_takes.py
server (FastAPI): hp-v2-8fps features over 16 frames (~2 s) → scikit-learn classifier
  → NONE / confidence / margin rejection → stabiliser (3 agreeing predictions over ≥ 0.5 s) → text
speech: pre-generated mp3s (edge-tts) per sign and language, or the browser's own voice
```

The trained model lives in a private Hugging Face model repo and is downloaded when the
server starts. The server refuses a model trained for a different set of verified signs.

## Run it locally

Needs Python 3.12 and Node 20.19+. CPU only, no API keys.

```bash
python3.12 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.lock.txt
python scripts/download_model.py                            # MediaPipe .task models, SHA256-checked
(cd web && npm install && npm run build)
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000 (the camera needs `localhost` or HTTPS). Without a trained
bundle in `backend/models/live/`, `/translate` says "Model not trained yet" and never guesses.
Deployment (Render or a Hugging Face Space): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Adding a sign** takes people, not code:
1. Verify it against the official video ([docs/HOW_TO_VERIFY_A_SIGN.md](docs/HOW_TO_VERIFY_A_SIGN.md)).
2. Record takes on `/collect` ([docs/COLLECTION_PROTOCOL.md](docs/COLLECTION_PROTOCOL.md)).
3. Merge, train, voice and publish:

```bash
python -m scripts.merge_takes <downloaded .jsonl files>
python -m backend.live.train --feature-schema hp-v2-8fps --threshold-source loso --drop-unverified
python -m scripts.generate_audio            # needs requirements-tools.txt
python -m scripts.publish_model             # HF_TOKEN = write token; then restart the server
```

## Tests

```bash
python -m pytest -q                         # Python: protocols, features, vocabulary gate, training, API, deploy
cd web && npm test                          # browser logic: frames, capture, reconnect, speech, UI state
node tests/browser.mjs                      # headless Chrome with a fake camera (server running on :8000)
```

Test data is synthetic geometry labelled `SYNTH_*`. It is never ISL data and says nothing about accuracy.

## Credits and licenses

- **Sign references:** [ISLRTC](https://islrtc.nic.in/isl-dictionary/) (Indian Sign Language
  Research and Training Centre) dictionary videos. They are **linked or embedded from YouTube,
  never copied or redistributed**. No external sign dataset is used.
- **Google MediaPipe** Hand Landmarker and Pose Landmarker lite (`@mediapipe/tasks-vision`
  0.10.35, Apache-2.0). The model files are downloaded separately with checksums
  ([backend/models/manifest.json](backend/models/manifest.json)) and served by the app.
- **scikit-learn** (BSD-3-Clause), **FastAPI** (MIT), **Uvicorn** (BSD-3-Clause), **NumPy** (BSD),
  **React** and **Vite** (MIT), Atkinson Hyperlegible font (OFL-1.1).
- **Speech:** [edge-tts](https://github.com/rany2/edge-tts) (LGPL-3.0) generated the mp3s
  ahead of time with Microsoft Edge neural voices (en-IN, kn-IN, hi-IN, ta-IN). gTTS (MIT)
  is the fallback. Neither runs in the deployed app; only the generated mp3 files ship.
- Each dependency keeps its own license.

## AI tool disclosure

SignSpeak was built with AI coding assistants: **OpenAI Codex/ChatGPT** (Phases 1–2) and
**Claude Code (Anthropic)** (Phase 3 onward: web app, live recognition pipeline, training,
speech, deployment, tests and docs). The Kannada, Hindi and Tamil translations were drafted
by AI. People did what an AI can't: verifying each sign against the official video,
recording the data with consent, and judging how it works live.

## Team

TEAM_NAMES_HERE

## More

- [docs/MODEL_CARD.md](docs/MODEL_CARD.md): full evaluation, run history, thresholds
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): 2-minute demo
- [docs/data_schema.md](docs/data_schema.md): landmark and take formats
- Phase 1/2 hands-v1 lab and Holistic experiments: [docs/phase2.md](docs/phase2.md), [docs/validation.md](docs/validation.md)
