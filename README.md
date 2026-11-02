# SignSpeak Local

Human Impact track · November 2–4, 2026 hackathon · Phase 1 AI foundation.

An accessibility-focused prototype foundation for a limited vocabulary of authentic
Indian Sign Language (ISL). The intended later product converts recognized meanings
to text and speech in English, Kannada, Hindi and possibly Tamil. This phase provides
browser camera → Python MediaPipe landmarks → reviewed labelled features → scikit-learn
training. It does not yet recognize signs or translate ISL.

## Run locally or in Codespaces

Exact tested dependency versions are in `requirements.lock.txt`.

Tested with Python 3.12 on CPU; Python 3.14 is not the configured environment. Python
3.11 may also work but has not been tested. On Ubuntu, install `python3.12-venv` if
venv reports missing ensurepip. MediaPipe’s OpenCV dependency also needs Linux
shared libraries; on Ubuntu 24.04 install `libgl1 libglib2.0-0t64` if absent.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/download_model.py
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

In Codespaces, keep forwarded port **8000 Private**, then open its HTTPS browser URL.
Allow camera permission on your laptop. Codespaces is remote: `VideoCapture(0)` cannot
access that laptop camera. The browser uses `getUserMedia`, sends bounded JPEG frames
to the same-origin server and draws returned hand landmarks. Localhost also supports
camera access. No desktop OpenCV GUI, CUDA, API keys or external inference service is
required. Browser JavaScript is a minimal collection tool; the full React + Vite UI
is deferred. `/health` reports detector readiness separately from API liveness.

## Collect a dataset

1. Review exact ISLRTC sign videos as described in [vocabulary review](docs/isl_vocabulary.md).
   The registry is currently empty: all 12 candidates are UNVERIFIED, and collection
   is locked. Landmark preview works without a vocabulary.
2. Admit only reviewed static signs to `data/metadata/vocabulary.json`. Target 6–8 if
   references and feature suitability support them. No ASL substitutions.
3. Start the server with explicit persistence enabled:

   ```bash
   ENABLE_COLLECTION=1 uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
   ```

4. Open the page, enable camera, select a verified sign, enter voluntary signer/session
   pseudonyms, check consent and start collection. Set sampling between 0.5 and 5 Hz.
   Start/stop defines recording takes. Watch detection messages and saved count.
5. Stop collection or close the camera. The server saves only validated features and
   metadata, never raw camera frames. Near-identical samples are suppressed. Collect
   several independent repetitions and sessions across multiple consenting signers.

Landmarks still leave the browser for your private Codespace during preview. No image
is permanently saved. Pseudonyms and hand movement data remain potentially sensitive;
obtain consent, limit access and delete local JSONL files when no longer needed. Raw
videos, processed datasets, secrets and trained models are Git-ignored. Do not use
real names/contact details. The prototype has no production authentication or multiuser
storage layer; keep it private and run a single server worker.

See [schema and normalization](docs/data_schema.md) for masks, mirroring, confidence
semantics, metadata and leakage precautions.

## Train and evaluate

```bash
python -m backend.training.train --data data/processed/samples.jsonl
# Optional comparison; scaling fits only on training groups:
python -m backend.training.train --algorithm svm --group-by signer
# Within-signer session generalization (weaker than unseen-signer evaluation):
python -m backend.training.train --group-by session
python -m pytest backend/tests -q
python -m scripts.smoke_test
```

Default baseline: 200-tree RandomForestClassifier, seed 42, 25% group holdout by signer.
A fixed split must have every class in both partitions or training refuses evaluation.
The optional RBF SVM uses a StandardScaler pipeline. Reports contain actual accuracy,
macro-F1, per-class precision/recall/F1, confusion matrix, label order, group membership
and sample counts. Outputs: `baseline.joblib`, `labels.json`, `metrics.json` under
`backend/models/baseline`. Load joblib files only from trusted sources.

**No labelled dataset has been collected; no ISL classifier has been evaluated and
no accuracy is claimed.** Unit-test fixtures exercise software behavior only and are
not ISL data or evidence of recognition quality. See [validation](docs/validation.md).

## Structure

- `backend/app`: FastAPI, image decoding, Tasks detector, shared features, record validation.
- `backend/training`: deterministic grouped evaluation and model persistence.
- `backend/models`: ignored assets/artifacts; committed official asset manifest.
- `backend/tests`: automated feature, dataset, split, persistence and API checks.
- `frontend`: lightweight browser collector; future React app deferred.
- `data/raw`, `data/processed`, `data/metadata`: ignored captures/features and reviewed registry.
- `docs`, `scripts`: review/schema notes and checksum-verified model downloader.

## Limits and attribution

Static per-hand landmarks do not encode motion, facial grammar, torso position or
relative hand placement. Missing/occluded hands and incorrect handedness affect quality.
A closed-set classifier can confidently misclassify unknown signs; no open-set rejection
or real-time recognition is implemented. No text-to-speech, multilingual output or
medical/emergency reliability is claimed. Real laptop camera testing and Deaf/ISL expert
review remain necessary before the immediate milestone can be accepted.

The primary vocabulary authority is [ISLRTC](https://islrtc.nic.in/isl-dictionary/).
Dictionary content is referenced, not copied or redistributed; no rights to its videos
or datasets are asserted. No external sign dataset is bundled.

Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
uses a general-purpose palm/hand landmark bundle, **not Gesture Recognizer**. The version
1 float16 model URL, SHA256 and retrieval date are in
[manifest](backend/models/manifest.json); download separately, do not commit the binary.
The installed Tasks API is checked by the CPU smoke test. MediaPipe is Apache-2.0;
consult Google's linked model card for model details and applicable terms. FastAPI,
scikit-learn, NumPy, Pillow and other dependencies retain their respective licenses.

AI assistance disclosure: **OpenAI Codex** assisted with project-specific implementation,
tests and documentation during the hackathon. This repository is an original foundation,
not a copied complete sign-language application.
