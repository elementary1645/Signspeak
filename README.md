# SignSpeak Local

Human Impact track · November 2–4, 2026 hackathon · Authentic Indian Sign Language (ISL).

A CPU-compatible foundation for recognizing a small, human-verified static ISL
vocabulary. Browser camera frames go to Python MediaPipe; validated landmarks can be
collected, audited, used to train scikit-learn classifiers, and scored in live recognition.
The intended later product adds text and speech in English, Kannada, Hindi and possibly
Tamil. This implementation does not claim full ISL translation or multilingual output.

**Phase 2 is partially complete.** Recognition infrastructure is implemented, but zero
signs are human-approved, no genuine labelled dataset exists here, and no ISL classifier
or measured recognition accuracy is available. The user confirmed Phase 1 laptop camera
capture/overlays work; the changed Phase 2 interface still needs laptop acceptance.

## Installation and browser camera

Tested on Linux CPU, Python 3.12.3 and MediaPipe 0.10.32. Python 3.11 may work but has not
been tested; Python 3.14 is not the configured environment. On Ubuntu 24.04, install
`python3.12-venv libgl1 libglib2.0-0t64` if absent. No CUDA, API keys or inference cloud
service is required. Exact tested dependency versions are in `requirements.lock.txt`.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock.txt
python scripts/download_model.py
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Keep forwarded Codespaces port **8000 Private**. Open its HTTPS URL on your laptop,
allow camera permission and click Enable camera. Codespaces is remote: OpenCV
`VideoCapture(0)` does not access your laptop webcam. The browser uses `getUserMedia`,
sends sampled JPEGs to the same-origin Python API and draws returned one/two-hand
landmarks. Images are processed in memory and never permanently stored. No desktop
OpenCV window is used. The minimal browser lab uses plain JavaScript; the final
React + Vite product interface remains deferred. FastAPI is the Python backend.

`/health` separates API liveness, detector readiness, collection configuration and
classifier readiness. An absent classifier does not disable landmark preview.

## Verify authentic signs individually

Read [ISL vocabulary review](docs/isl_vocabulary.md). All 12 candidate meanings remain
UNVERIFIED. Official dictionary name matches alone cannot unlock collection.

Use the lab's **Human vocabulary review** panel to inspect and document one exact
ISLRTC reference at a time: hand count, motion, facial/body/relative-hand cues and
feature suitability. A human must personally watch and confirm each sign. Export the
individual decision and move it into the Codespace, then apply it locally:

```bash
python -m scripts.review_sign data/processed/reviews/HELLO-review.json --confirm-human-review
```

Use that command only on your actual completed human review. The filename above is
illustrative; no HELLO sign is approved by this README. Restart and reload after changes.
Target 6–8 suitable signs, fewer if needed. Dynamic signs or signs requiring cues missing
from `hands-v1` cannot be admitted. Never substitute ASL and call it ISL.

## Collect and audit genuine data

Enable persistence explicitly on the server:

```bash
ENABLE_COLLECTION=1 uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Select an admitted sign, enter voluntary signer/session pseudonyms, consent and start
a recording. Set sampling 0.5–5 Hz and a saved-sample goal (default 30). Pause/resume
keeps the same take; starting another recording creates a new take ID. The page shows
sample progress, active time, valid landmark frames, detected hand count and saved totals.
Near-identical frames and excessive sampling are suppressed across takes during a server
run. Wrong expected hand count, unreliable handedness and invalid records cannot be saved.

No raw images/videos are saved. JSONL feature data defaults to
`data/processed/samples.jsonl` (Git-ignored); override with `DATASET_PATH`. Use consistent
pseudonyms across sessions and collect balanced independent takes, multiple sessions
and multiple signers. Do not enter real names or contact details. Consent and private
access remain necessary for pseudonymous hand-movement data. Keep one server worker;
this prototype has no production authentication or multiuser storage service.

Use the page's quality button or CLI before training:

```bash
python -m backend.training.audit --data data/processed/samples.jsonl
```

The audit reports sample/class/group counts, duplicate vectors, imbalance and split
readiness. It rejects malformed records, duplicate sample/frame IDs and takes reused
across signers/sessions/classes. Structural readiness is not proof of adequate data or
correct signing. See [dataset schema](docs/data_schema.md) for feature masks and mirroring.

## Train real classifiers and evaluate

Stop collection before auditing and training. Only after human review and genuine collection:

```bash
python -m backend.training.train --confirm-real-data
# Optional RBF SVM comparison, with training-only group calibration:
python -m backend.training.train --algorithm svm --output backend/models/svm --confirm-real-data
# Weaker evaluation of within-signer session generalization:
python -m backend.training.train --group-by session --confirm-real-data
```

The flag attests real collected data; it cannot detect fabricated samples. Default
baseline: 200-tree balanced Random Forest, seed 42, 25% signer-group holdout. Every class
must appear in train and test. SVM uses group-aware inner calibration; scalers and
calibrators fit training folds only. Insufficient class/group coverage blocks training.
Reserve final test signers before model/threshold selection.

Outputs under `backend/models/baseline`: `baseline.joblib`, `labels.json`, `metadata.json`
and `metrics.json`. They include class order, schema/dimension, library version, dataset
and vocabulary hashes, actual sample/group counts, accuracy, macro-F1, per-class
precision/recall/F1 and confusion matrix. These are closed-set frame metrics, not a
measurement of unknown rejection or stable events. No production metrics have yet
been generated. Test fixtures are software checks, never evidence of ISL accuracy.

## Live recognition

After training, restart with a locally trusted compatible model:

```bash
MODEL_PATH=backend/models/baseline/baseline.joblib uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Reload the page, enable camera and select Live recognition. Saving turns off. The lab
shows the predicted label, model score, smoothed score, stable-sign events and measured
classifier/server/round-trip latency. No trained model means no predictions.

Defaults: score >= 0.80, top-two margin >= 0.15, matching hand count; then three consecutive
accepted frames and >= 0.5 s dwell for stability. No-hand/unknown/error/change or > 1.5 s
gap resets stability. Continuous holding emits once; repetition requires release/change
and a 2 s per-label cooldown. Use 2–5 Hz for live recognition. Model/vocabulary mismatch
fails closed while landmarks remain available. Never load untrusted joblib files.

Scores and rejection thresholds do **not** establish open-set reliability: unseen poses
may be confidently accepted. RF votes are uncalibrated; SVM probabilities use training
group calibration. Test unseen signs separately before claiming useful unknown rejection.
See [Phase 2 architecture and acceptance](docs/phase2.md) for the full inference contract.

## Test

```bash
python -m pytest backend/tests -q
node frontend/tests/collector.test.cjs
node --check frontend/collector.js
node --check frontend/review.js
python -m scripts.smoke_test
```

See [validation record](docs/validation.md) for executed checks, results and remaining
manual acceptance. No new runtime framework was installed for Phase 2.

## Layout, limits and attribution

- `backend/app`: FastAPI, official Tasks detector, shared features, reviewed vocabulary,
  dataset validation, model compatibility and temporal inference.
- `backend/training`: dataset audit and deterministic grouped RF/SVM training.
- `backend/models`: ignored model assets/artifacts and committed asset manifest.
- `backend/tests`, `frontend/tests`: Python regression/inference and browser-logic checks.
- `frontend`: lightweight camera collector, individual review form and recognition display.
- `data/raw`, `data/processed`, `data/metadata`: ignored raw/features, review queue/registry.
- `docs`, `scripts`: provenance, schema, architecture, human review import and model tools.

`hands-v1` loses absolute body position and relative hand placement and contains no motion
or facial grammar. It cannot recognize arbitrary dynamic signs. Missing/occluded hands
and handedness errors affect performance. No emergency/medical reliability, full ISL
translation, speech synthesis or multilingual output is claimed.

Primary sign authority: [ISLRTC](https://islrtc.nic.in/isl-dictionary/). Exact reviewed
references will be attributed in the vocabulary registry; none is approved yet. No
external sign dataset or dictionary video is bundled or claimed as project-owned.

Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
is a general-purpose palm/hand landmark bundle, **not Gesture Recognizer**. Version 1
float16 URL, SHA256 and retrieval date are in [manifest](backend/models/manifest.json).
The binary is downloaded separately and ignored by Git. MediaPipe is Apache-2.0;
consult Google's linked model card and applicable terms. FastAPI, scikit-learn, NumPy,
Pillow and other dependencies retain their respective licenses.

AI assistance disclosure: **OpenAI Codex** assisted with original project implementation,
tests and documentation during the hackathon. No complete existing sign-language project
was copied. Human sign verification and real evaluation cannot be supplied by generated
fixtures or assistant declarations.

## Phase 2C compatibility investigation

The [sequence infrastructure assessment](docs/phase2c.md) documents the 41-label ZIP,
explicit Holistic adapter contract, review-gated CPU research baseline and remaining
webcam/public-deployment gates. No archive-based model is trained or enabled.

The [Phase 2D experiment](docs/phase2d.md) runs a pinned legacy Holistic CPU extractor
in isolation and records real schema/latency checks. Human approvals remain at zero;
no dataset-trained classifier or public webcam recognition is enabled.
