# Phase 1 validation — 2026-11-02

Environment: Linux CPU, Python 3.12.3, MediaPipe 0.10.32. Dependency versions are
captured in `requirements.lock.txt`; use `pip install -r requirements.lock.txt` to
reproduce this environment. System prerequisites: python3.12-venv, libgl1,
libglib2.0-0t64 on Ubuntu 24.04. Model checksum: see the committed manifest.

## Executed checks

- `python -m pytest backend/tests -q`: **22 passed**, one upstream Starlette warning
  about future migration from httpx to httpx2. Includes dimensions, handedness slot
  ordering, missing masks, scale/translation normalization, malformed landmarks,
  malformed/unverified records, duplicate sample IDs, deterministic disjoint groups,
  RF/SVM artifact persistence, preview without saving, disabled persistence, validated
  collection, duplicate suppression, no-hand handling and unavailable detector.
- `python -m scripts.smoke_test`: **passed** using the actual downloaded Hand Landmarker
  on CPU. Inspected installed `HandLandmarkerOptions` signature; IMAGE mode, two-hand
  limit, thresholds and explicit CPU delegate are supported. Exercised health, page,
  script and base64 JPEG → decode → MediaPipe → no-hand JSON response.
- `node --check frontend/collector.js`: **passed**.
- `git diff --check`: **passed** before commit.
- `python -m backend.training.train`: expected exit code **2**, reports dataset absent
  and training not evaluated. No production model or evaluation report generated.

Initial imports exposed missing libGL; installing the documented OS prerequisite fixed
that failure. Restricted sandbox test runs stalled in threaded API/model operations;
the passing full suite and smoke test were run with approved unrestricted execution.
The smoke test emits upstream MediaPipe feedback/projection warnings; inference completes.
Matplotlib (an indirect dependency) may warn about an unwritable user config directory;
set `MPLCONFIGDIR=/tmp/signspeak-mpl` in restricted environments.

Temporary unit fixtures use generated numeric arrays and explicitly fake test labels
with `.invalid` URLs. These test software mechanics only. Their metrics/artifacts stay
in pytest temporary directories and are never claimed as real sign evaluation.

## Manual acceptance still required

1. Open private forwarded port 8000 in a laptop browser. Verify permission grant/denial,
   live preview, overlay alignment and close-camera behavior. No physical camera was
   accessible in this execution environment.
2. Verify subject Left/Right labels using known physical hands, then two-hand and
   occlusion behavior; unit ordering/mirroring tests do not replace camera checks.
3. Review official ISLRTC videos with an ISL-competent reviewer; admit 6–8 suitable
   static signs if possible. Currently none is verified or admitted.
4. Enable persistence explicitly, consent, collect real independent signer/session
   samples, inspect metadata and deduplication, then run grouped training.
5. Evaluate held-out real signers and inspect per-class errors before considering any
   recognition demo or expanding to motion, multilingual text and speech.

The implementation foundation is tested. The complete camera-to-labelled-ISL milestone
is **pending manual camera and vocabulary verification**; no accuracy is available.
