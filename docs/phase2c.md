# Phase 2C: sequence compatibility infrastructure

Status as of 2 November 2026: **research infrastructure tested; archive compatibility and live recognition blocked**.
Read the [initial assessment](dataset-inspection/assessment.md),
[full archive audit](dataset-inspection/archive-audit.json) and
[conditional coordinate audit](dataset-inspection/layout-audit.json).
No dataset class has been approved, no real-data model has been fitted, and the existing
128-feature API, vocabulary controls and static recognizer remain unchanged.

## Provenance and the 40/41 discrepancy

The [official Mendeley V1 page](https://data.mendeley.com/datasets/y8vg69brn2/1)
was rechecked: DOI 10.17632/y8vg69brn2.1, 19 May 2022, CC BY 4.0. It describes
40 static signs and excludes dynamic signs. This is a likely source, not a verified
byte match. The public file API was inaccessible through the web tool; the prior
metadata fetch returned HTTP 403. No remote publisher checksum or file ID was recovered.
The local filenames match the title, but filenames alone establish no chain of custody.

Local ZIP observations:

- Outer SHA256 `34ced9259e493f7aff63cfdaade89eb2a5d2f7a1fc5b0dfafc6adba1397f28d2`;
  inner SHA256 `b7113209b6d72bd709ca155efce9fcf8b0888e64b2f4f41f7e3287b8b8be68c1`.
  The embedded and extracted inner hashes match; both archives passed CRC inspection.
- 41 top-level sign directories, including `i/`, and 41 complete label paths with
  30 sequences each. Only `i/me` uses an extra path level. It holds a full 900 frames.
  There are **40 ordinary one-level label paths plus `i/me`**. Excluding deeper paths
  would coincidentally reproduce the published count, but there is no evidence this
  is the publisher's reason or that this label is extraneous.
- No source label is merged, renamed or discarded. In particular `i/me`, `thanks`,
  `iloveyou`, `aboard` and `practise` retain their original spellings and semantics
  remain unverified. A word or folder name is not an ISL variant review.
- File timestamps span 13–14 May 2022, preceding publication; compression is Deflate,
  archive comment is empty. ZIP timestamps are unauthenticated and do not prove origin.
- No source code, participant groups, capture FPS, licence notice or consent documentation
  is embedded. Get a release file ID/checksum or original download record and author
  documentation explaining the extra class, layout, sequence protocol and sign variants.
  No author has been contacted by this work.

Retain contributor attribution, DOI/version, CC BY licence link and transformation
notices if this is confirmed as the licensed release. The licence listed on the source
page does not establish consent for these local bytes. The initial assessment contains
full contributor attribution and licence conditions.

## Implemented contract and adapter

`backend/sequence/schema.py` defines `holistic-1662-v1`:

| Offset | Landmarks | Fields |
|---|---:|---|
| 0–131 | 33 pose | x,y,z,visibility |
| 132–1535 | 468 face | x,y,z |
| 1536–1598 | 21 subject-left hand | x,y,z |
| 1599–1661 | 21 subject-right hand | x,y,z |

This is a contract for **our adapter**, not a declaration that the external archive
has been validated. `pack_result` serializes explicit legacy Holistic result fields;
only `None` means missing, producing a whole zero block. Malformed/missing attributes,
wrong counts, NaN/Inf and invalid pose visibility fail. No coordinates are clipped,
no hands swapped, no global normalization applied and no world coordinates substituted.

`Contract` binds schema, extractor identity, model/configuration SHA256, canonical
extractor-options JSON, unmirrored detector input, coordinate convention, subject sides,
zero-block missingness and capture period. `HolisticAdapter` accepts a caller-supplied
legacy CPU RGB processor and validates uint8 RGB input. It never downloads models.
The processor's actual identity/settings/hash must be verified by the integrator;
a dataclass declaration cannot prove the configured extractor or source provenance.
A mirrored UI preview is possible, but detector input must remain unmirrored in v1.

The locked MediaPipe 0.10.32 environment was checked at runtime: `mp.solutions` is absent
and `vision.HolisticLandmarker` is absent. Thus no real RGB-to-Holistic extraction was
validated here. The current HandLandmarker cannot supply the missing modalities.
The [current official Tasks guide](https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker)
describes 478 face landmarks, while the
[legacy Holistic documentation](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/holistic.md)
describes 468. The adapter explicitly rejects a 478-point face; silently dropping iris
points or assuming identical coordinates/tracking would hide a compatibility change.
Select a supported, separately locked CPU extractor (or a separately versioned, explicit
Tasks conversion) and validate it on paired captures before connecting a sequence API.
No dependency downgrade or replacement was made to the working hands pipeline.

`backend/sequence/archive.py` reads directly from ZIP, preserves nested labels and
sorts frame indices numerically. It rejects incomplete takes, duplicate/unsafe paths,
noncanonical numeric aliases, oversized members, object/pickle arrays and wrong shapes.
It never interprets sequence indices as people, sessions or milliseconds. Arrays remain
finite `(30,1662)` float64; no resampling/padding or inferred timing is applied.

## Coordinate evidence and uncertainty

The 1,662 decomposition matches legacy Holistic exactly. The follow-up audit compares
x/y/z separately and the candidate pose visibility channel, excluding all-zero blocks
from coordinate ranges. It counts missing-block transitions and simultaneous hand absence.
The complete numbers are in `dataset-inspection/layout-audit.json`; regenerate with:

```bash
.venv/bin/python -m scripts.inspect_holistic_layout \
  'data/raw/extracted/Dataset of Common phrases in Indian Sign Language/Dataset of Common phrases in Indian Sign Language.zip' \
  --output /tmp/signspeak-layout-audit.json
```

| Candidate block | x range | y range | z range | Whole-zero frames |
|---|---|---|---|---:|
| Pose | −0.3499–1.3951 | −0.4361–4.0843 | −3.7297–1.7780 | 0 |
| Face | 0.2510–0.8599 | −0.1319–0.8647 | −0.0904–0.1854 | 563 |
| Left hand | −0.0394–1.1389 | −0.1378–1.3030 | −0.3382–0.1748 | 18,572 |
| Right hand | −0.1138–1.1022 | 0.0019–1.2649 | −0.4626–0.2433 | 16,219 |

Candidate pose visibility spans 5.61e−8–0.9999993, with **zero** values outside [0,1]
over 1,217,700 candidate pose landmarks. Both candidate hands are absent in 6,683 frames
(18.11%); exactly one is present in 21,425 and both in 8,792. Within-sequence block
presence transitions total 131 face, 2,274 left-hand and 2,007 right-hand changes.
This is a significant missingness burden, not evidence that a signer intended no sign.

Plausible visibility in every fourth pose value, face depth values, near-zero hand wrist
z and whole zero hand blocks support the hypothesis. They do **not** prove landmark
ordering, normalized-vs-world convention, anatomical sides, mirror state, model version,
consecutive acquisition or timing. Large pose/hand coordinates outside [0,1] must not
be clipped simply to make the data look normalized. Numeric changes in every sequence
are not proof of dynamic ISL; the source's static-only description remains a blocker.

## Lightweight temporal baseline and controls

`backend/sequence/features.py` implements `holistic-hand-stats-v1`: for each hand,
63-coordinate visible-frame means, standard deviations, first-to-last-visible signed
displacement, mean absolute differences over adjacent visible pairs, presence rate and
valid-adjacent-pair rate. Output is **508 features**. Zero blocks do not distort means
or become artificial motion. Order-sensitive displacement retains a minimal temporal cue.
Raw image-relative coordinates preserve hand separation/trajectories, but also risk signer,
position and camera shortcuts. No body-relative or face-expression compatibility is claimed.
This conservative baseline uses hands only because the current approval rules exclude
signs requiring omitted cues; its new schema is distinct from hands-v1.

`backend/sequence/baseline.py` provides a 100-tree, depth-10, single-CPU-thread balanced
Random Forest with deterministic seed 42. Training and scoring call the **same** summary
function. Fitting requires all of:

1. Existing strict human-approved vocabulary entries, read from the authoritative registry,
   and an explicit one-to-one original-label → reviewed-label mapping. No automatic
   uppercase/synonym mapping. Every selected source label must be accounted for.
2. An explicit extraction contract plus source URL, dataset SHA256 and substantive
   provenance/layout/capture evidence declarations tied to the contract hash.
   These declarations are audited human documentation, not forensic verification.
3. Actual pseudonymous signer IDs and an explicitly reserved set of held-out signers,
   with every class in both partitions. Missing IDs are errors; no synthetic IDs are
   inferred from directory numbers. Identical sequence content is rejected.

The current archive cannot meet these requirements. There is no permissive training CLI,
no production model path, no fixture exemption in the fitter, and no real-data fit occurred.
Tests use temporary synthetic arrays and temporary fixture reviews only.

Artifacts bind feature version/dimension, extraction contract/hash, sklearn version,
label mapping, vocabulary fingerprint, provenance evidence and held-out signer metrics.
Only locally trusted project joblib files may be loaded; joblib is executable.
`ResearchRecognizer` rechecks reviews on every scoring call, so revocation/reference
changes invalidate it. The artifact format is intentionally incompatible with the
existing static recognizer. Scores are explicitly uncalibrated research votes:
`label: null`, `state: research_only`, `deployment_accepted: false`.
There is **no unknown-sign acceptance policy or production unlock** in this infrastructure.

A small GRU has **not** been implemented: source layout/extractor compatibility is not
validated, so the user's prerequisite is unmet. More model complexity cannot resolve
missing provenance or a mismatched webcam feature distribution.

## Buffering and future HTTPS integration

`SequenceBuffer` is one camera/one explicit take, with a fixed contract and 30 samples.
It copies inputs, checks increasing monotonic capture timestamps and uses an explicit
±50% per-frame period tolerance. A timing gap, no hands, bad frame or contract change
resets the take; it never repeats frames, interpolates gaps or emits overlapping windows.
A completed take clears the buffer. Default timing is not inferred: the caller must
supply the capture period. The chosen 20–200 ms supported period range is an infrastructure
limit, not a measured optimal signing FPS. Source timing must be resolved before training
and inference can share a contract. Camera stop/change/reconnect must discard the take.

No sequence HTTP route or browser recognition button was enabled. Design for the next
validated stage:

- Host static UI and Python API under one stable HTTPS origin; judges open a URL and
  grant camera permission. No local install or local Python execution for judges.
- Start with an explicit short “Record sign” take and progress indicator, not continuous
  sentence translation. Schedule capture against monotonic browser capture timestamps,
  independent of network response time. Existing 0.5–5 Hz polling is unsuitable as-is.
- Send bounded JPEG/RGB frames to Python for the verified extractor; reject oversized
  input. Use short-lived server-issued camera sessions, enforce per-session sequence
  numbers, backpressure, rate limits and bounded queue/session counts. Detect dropped
  frames and ask the signer to retry; do not conceal them through upsampling.
- Isolate the stateful extractor AND buffer per camera, lock access and reset together.
  Prefer a bounded worker owner per session or sticky routing; multiple API workers
  must not randomly share/split sequence state. Expire idle sessions and close processors.
- Start on CPU, collection disabled, raw frames in memory only. Provide health/readiness
  that explicitly distinguishes extractor/model readiness. Return buffering, retry,
  unavailable and unknown without fallback labels. Do not expose collection/admin review
  controls to ordinary judges. Keep reference playback visibly separate from live inference.
- Include attribution, privacy, camera-stop behavior, reviewed signing examples and a
  usable failure path for denied/unavailable cameras. Verify on desktop/mobile HTTPS.

This is a deployment design, not an assertion that the existing private lab is safe to
make public or that live sequence inference is available. No hosting resources were created.

## Mandatory acceptance before a judge-facing model

| Gate | Required evidence | Current status |
|---|---|---|
| Provenance/schema | Publisher byte link, 40/41 explanation, extraction code/protocol, timing/side/mirror validation | Blocked |
| Human ISL review | Exact authoritative variants personally reviewed, preferably with a Deaf ISL signer; permitted cues match schema | Zero approved labels |
| Webcam compatibility | Paired controlled clips from selected extractor plus real browser cameras; check values, masks, motion and side semantics | Not run |
| Unseen signer reliability | Untouched signer-disjoint real webcam test set, per-class metrics/confusions and near-duplicate audit | Missing signer metadata/data |
| Unknown rejection | Separate validation unknown/no-sign/transition/occlusion clips; calibrated or empirically tuned rejection; report false accepts/rejects on untouched test clips | Not implemented/validated |
| CPU service | End-to-end p50/p95 detection+summary+score+network latency, sustained capture/drop rate, memory and concurrent sessions on target host | Not measured |
| Public website | Stable HTTPS URL; remote judge can independently allow camera, follow examples, obtain honest outcomes and stop camera; mobile/browser checks | Not deployed |

Choose quantitative release targets and reserve validation/test people before optimizing
models or thresholds. Do not tune on final test signers. Report both dataset-domain and
webcam-domain results and confusion patterns; do not advertise fixture or closed-set archive
accuracy as judge-webcam reliability. The current no-acceptance output prevents an
unmeasured RF vote threshold from becoming a public recognition claim.

## Verification

Run the backend suite with the existing environment and browser collector tests:

```bash
MPLCONFIGDIR=/tmp/signspeak-mpl .venv/bin/python -m pytest -q
node --test frontend/tests/collector.test.cjs
```

Tests cover landmark packing/dimensions, explicit input/mirror/schema contracts, deterministic
mask-aware summaries, malformed/pickle ZIPs, `i/me` preservation, numeric ordering,
sequence resets, nonoverlap, artifact round trips, shared train/score preprocessing,
signer partition requirements, evidence/review gates and live review revocation.
Synthetic fixture fits only exercise serialization and controls; they are not ISL training
or performance evidence. Automated tests cannot establish the acceptance gates above.

Verification result: **84 backend tests passed**, including 15 sequence tests; the browser
collector test passed and `git diff --check` passed. The full backend suite required execution
outside the sandbox after the sandboxed run stalled at the existing API tests. One existing
Starlette/httpx deprecation warning remains. No real camera or model accuracy test was run.
