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

## Phase 2 validation — 2026-11-02

**Status: partially complete.** The user reports Phase 1 laptop capture and overlays
working. No actual ISL review, genuine dataset, trained ISL classifier or measured
recognition performance is available in this repository. Phase 2 laptop recognition
acceptance remains pending; no fixture result is a benchmark.

Executed on Python 3.12.3 / MediaPipe 0.10.32 using the existing locked dependencies:

- `python -m pytest backend/tests -q`: **69 passed**, one upstream Starlette/httpx
  deprecation warning. All 22 Phase 1 checks remain, with fixture metadata updated to
  satisfy the stronger human-review and globally unique recording-ID requirements.
- New Python checks cover explicit human/official-source review, exact references,
  unsuitable cue exclusion, individual review import, revoked reviews, feature/class/
  library/provenance compatibility, RF and group-calibrated SVM bundle round-trips,
  confidence/margin and malformed-score rejection, wrong hand counts, smoothing,
  stability, per-sign cooldown, camera isolation, frame gaps, no-hand/unknown/error
  resets, dataset recording integrity, quality audits, write failures and unavailable
  or incompatible models. Scaler spies verify held-out test rows never enter SVM fits;
  calibration group disjointness is checked explicitly.
- `node frontend/tests/collector.test.cjs`: **3 passed**, using only Node's built-in
  test runner and DOM/camera substitutes. Checks empty-vocabulary locking, preview,
  close-camera tracks, consent/pseudonyms, sample-goal reset, pause/resume preserving
  take identity/count, and recognition mode disabling saving. These do not replace
  physical camera or full rendered-browser acceptance.
- `node --check frontend/collector.js` and `node --check frontend/review.js`: **passed**.
- `python -m scripts.smoke_test`: **passed**, using the real official Hand Landmarker
  on CPU, real JPEG decode, health and browser asset routes, and the recognition
  API's no-hand state with no fabricated label. Upstream MediaPipe warnings persist.
- Dataset audit and `train --confirm-real-data`: expected **exit 2**, dataset absent;
  no genuine classifier, metrics or accuracy produced. The declaration flag was used
  only to check missing-file refusal, not to train generated data.
- `git diff --check`: **passed** before commit.

Threaded tests/model inference ran with approved unrestricted execution as in Phase 1;
`MPLCONFIGDIR=/tmp/signspeak-mpl` avoided the read-only home cache warning. No new runtime
framework was installed. Model hashes use the exact bytes parsed for training; model
review snapshots are checked for changes before artifact creation.

Individual sign review and next human steps are documented in `isl_vocabulary.md` and
`phase2.md`. All 12 research candidates remain UNVERIFIED; the admitted registry is
empty. Review priority does not imply gesture suitability. Unknown thresholds are
unvalidated defaults. Measured held-out real-data metrics, unknown-pose evaluation and
laptop stable recognition must precede any claim that Phase 2 is complete.
