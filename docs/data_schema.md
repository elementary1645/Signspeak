# Dataset schema hands-v1

One UTF-8 JSON object per line, validated by `backend.app.dataset.Record` on write and
training load. No image/video bytes are stored. File defaults to
`data/processed/samples.jsonl` (ignored by Git). Override with `DATASET_PATH`.

Fields: `schema_version`, `sign_class`, `signer_id`, `session_id`, `recording_id`,
`sample_id` (UUID on collection), `timestamp_ms` (browser Unix milliseconds),
`hand_count`, `features`, `handedness_scores`, `detection_threshold`,
`input_mirrored`, `vocabulary_reference_id`. Pseudonyms allow only letters, digits,
underscores and hyphens, 1–48 characters. Recording IDs group a collection take;
use the same signer pseudonym consistently across sessions to prevent leakage.

Features are 128 finite numbers: subject Left hand's 21 xyz coordinates flattened,
then subject Right hand's 21 xyz, then two presence bits in the same order. Each hand
is translated to wrist origin and divided by wrist-to-middle-MCP (landmark 9) 3D
length. Zero-length palms and duplicate handedness are rejected. Absent hands have
63 zero padding values and a zero mask bit; these are never genuine measurements.
No-hand frames are valid preview responses, but not labelled training records.

Camera capture sends unmirrored pixels, and preview/overlay are both unmirrored.
For external callers `mirrored=true` horizontally unflips pixels *before* detection.
MediaPipe's subject handedness defines slots. Neither hand is reflected into the other.
XYZ uses normalized image coordinates, not metric world coordinates. Per-hand centering
loses absolute body position and relative hand placement; this limits suitable vocabulary.
No rotation normalization is performed, preserving meaningful finger orientation.

Detection and presence thresholds are 0.7. The Tasks result exposes handedness scores,
not a per-landmark or exported palm confidence. Returned scores must not be described
as calibrated landmark confidence. Low handedness scores, duplicate sides, wrong expected
hand counts and invalid schemas cannot be saved. Schema changes require a new version
and recollection or explicit migration; never mix feature versions in training.

The server limits accepted samples for each signer/session/class (across recording takes) to at most
5 Hz, rejecting feature RMS changes below 0.015 versus the last accepted sample.
This is a sampling heuristic, not proof of independent examples. Use varied repetitions,
lighting, camera positions and multiple signers/sessions. A single recording's adjacent
frames must never be split randomly between training and testing. Default evaluation
holds out signers; session evaluation can overestimate generalization to unseen people.

All JSONL lines are validated; duplicate sample IDs are rejected by the training loader.
Labels must still match the reviewed registry. Store registry revisions alongside local
experiments. Metrics include split groups and sample counts. Local reports contain
pseudonyms and are ignored with model artifacts.


## Phase 2 integrity and review changes

The numeric record schema remains `hands-v1`; existing normalized coordinates are not
replaced. The reviewed registry now requires explicit human inspection, official-source
confirmation, dated review and per-cue suitability decisions. Legacy `verified: true`
entries without these attestations fail closed and must be actually reviewed, not
silently migrated into approval. There were no real approved entries at this migration.

Training now also rejects recording IDs reused across labels/signers/sessions and
repeated frame timestamps within the same take. The audit warns about exact duplicate
feature vectors across all records. Deduplication memory is keyed by signer/session/class,
so restarting a take does not reset the sampling filter; server restart still does.
Use globally unique recording IDs (browser UUIDs) and never reuse one for another take.

Model bundles use a separate `bundle_version: 2` with metadata and vocabulary hashes.
A bundle-version change does not change the underlying feature schema. Phase 1 bundles
must be retrained to supply the Phase 2 compatibility and confidence contract.

---

# Phase 3: lm-v1 frames, lm-take-v1 takes and hp-v1 features

`hands-v1` above still serves the legacy `/frames` lab. New work builds on the schemas
below. Code: [protocol.py](../backend/live/protocol.py), [features.py](../backend/live/features.py),
[takes.py](../backend/live/takes.py).

## lm-v1 (browser → server, one message per video frame)

```json
{"t_ms": 12345.0, "w": 640, "h": 480,
 "hands": [{"landmarks": [[x, y, z], ... 21], "handedness": "Left", "score": 0.97}],
 "pose": [[x, y, z, visibility], ... 33] }
```

- Extracted in the browser by `@mediapipe/tasks-vision` 0.10.35: HandLandmarker
  (numHands 2) and PoseLandmarker lite, VIDEO mode, throttled to ~15 fps, CPU delegate.
  Models are self-hosted from `/models/*.task` (SHA256 in `backend/models/manifest.json`).
- **The detector always receives unmirrored frames.** The on-screen preview and overlay
  are mirrored with CSS only. x/y are MediaPipe normalized image coordinates of the
  unmirrored image; `pose` is `null` when no person is detected.
- `t_ms` is the browser's `performance.now()` clock (monotonic within one page load).
- No pixels are ever sent. Values are rounded to 5 decimals.

## lm-take-v1 (one JSON object per line in a downloaded `.jsonl`)

`schema`, `frame_schema` (`lm-v1`), `take_id` (UUID), `label` (vocabulary label or
`NONE`), `signer_id`, `session_id` (pseudonyms, `[A-Za-z0-9_-]{1,48}`), `reference_url`
(the official link the signer copied; `null` for NONE), `none_prompt` (NONE only),
`app_version`, `recorded_at` (ISO UTC), `capture_ms` (2000), `consent` (must be `true`),
`preview_mirrored`, `frames` (lm-v1 list, strictly increasing `t_ms`).
`scripts/merge_takes.py` validates and merges takes into `data/processed/takes.jsonl`.

## hp-v1 features (server only; training and inference share the code)

**Side assignment.** Each detected hand goes to the subject-left or subject-right slot by
the nearest pose wrist (pose 15 = subject left, 16 = subject right, minimum total
distance for two hands). Only when pose is unusable (missing, or shoulders with
visibility < 0.5) does it fall back to the handedness label, and that frame's
`side_from_label` flag is set. MediaPipe's label assumes a mirrored selfie image, so on
our unmirrored input the label `Left` means the subject's right hand
(`HANDEDNESS_LABEL_IS_MIRRORED`). Two identically-labelled hands are split by image x.

**Per frame (152 values).** Coordinates are first made pixel-isotropic (x·w, y·h, z·w)
so camera aspect ratio does not distort shapes.

| Slice | Content |
|---|---|
| 0:126 | hand shape, subject left then right, 21×3 each, wrist-centred and divided by the wrist→middle-MCP length (the hands-v1 math) |
| 126:134 | hand location: wrist xy and index-tip xy per hand, in the body frame |
| 134:148 | nose, shoulders, elbows, wrists (pose 0, 11–16) xy in the body frame |
| 148:152 | flags: left hand present, right hand present, pose present, side-from-label |

Body frame: origin at the shoulder midpoint, unit = shoulder width, y down. Missing hands
or pose are zeros with a zero flag, never imputed. A degenerate palm counts as missing.

**Resampling and windows.** Frames are resampled by timestamp to a fixed 15 fps grid
using the nearest raw frame within one period (≈67 ms); grid points with no frame are
all-missing. No interpolation. A window is 24 frames (≈1.6 s). Training takes 2.0 s
takes and cuts windows at start offsets 0/100/200/300/400 ms (all windows from a take
share its group). Live inference uses the window ending at the newest frame.

**Window summary (474 values, asserted).** Over frames where the relevant part is
present: hand shape mean/std/first-to-last delta (378), hand location
mean/std/delta/min/max (40), body points mean/std/delta (42), location motion energy
(mean |Δ| between consecutive valid frames, 8), shape motion energy per hand (2), and
presence rates of the four flags (4).

**mirror().** Flips x (x → 1 − x), swaps pose left/right landmark pairs and swaps hand
labels. Optional left-handed-signer augmentation; mirrored windows keep their take's group.

**Limitations.** No face landmarks: signs whose meaning depends on facial expression or
mouthing cannot be represented. Shoulder-relative coordinates assume the upper body is
visible. Depth (z) is MediaPipe's relative estimate, not metric.
