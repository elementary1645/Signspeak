# Validated lower-rate protocol — hp-v2-8fps

## Decision

The actual Windows browser measured approximately 4–5 FPS GPU at 640×480,
8.8–9 FPS CPU at 640×480, and 9.2 FPS CPU at 320×240. The existing hp-v1
15 FPS contract cannot be met reliably on that laptop. New collection defaults to
**hp-v2-8fps-timed-1**, paired exclusively with **hp-v2-8fps** features.
Use CPU; start at 640×480 so spatial landmark quality is retained. Resolution remains
configurable; CPU and GPU delegates are still selectable.

## Exact timing contract

| Property | New protocol |
| --- | --- |
| Source frames | Exactly 16, distinct and in original order |
| Nominal FPS | 8 |
| Nominal first-to-last span | 15 × 125 ms = 1875 ms (approximately a 2-second take) |
| Effective FPS | 7–9.5, calculated as 15,000 / actual timestamp span |
| Total span | 1550–2200 ms, also subject to the FPS limits |
| Whole-span rate tolerance | 1 ms to account for rounded source timestamps |
| Every adjacent gap | 80–190 ms inclusive, with no extra gap tolerance |
| Safety deadline | 3 seconds; an incomplete take is rejected |
| Training window | All 16 observed frames; one window per take |
| Live window | Most recent 16 observed frames, checked against the same rules |
| Prediction stride | Existing default 3 source frames, ~2.67 predictions/s at 8 FPS |

**A stable 9 FPS stream passes**: 16 frames span approximately 1667 ms with gaps
111–112 ms. A measured average alone is insufficient: bursty delivery, holes or duplicate
source timestamps still fail. Timestamp validation happens on both Keep and server save;
model training also validates the tagged protocol. Actual timestamps are retained.

The browser targets 8 FPS using camera-aware deadlines, preventing 20/30 FPS camera
callbacks from rounding the inference rate down unnecessarily. A native source already
within the accepted rate ceiling can provide all its real frames. Busy inference still
has one frame pair in flight; this scheduler does not manufacture missing frames or
promise throughput beyond the hardware. The recording's measured rate is authoritative.

## Features and compatibility

Spatial frame vectors, side assignment, mirror augmentation and summary formulas remain
shared with hp-v1: 152 values per frame, 474 per summarized window. For the lower version,
there is no 15 FPS resampling, no temporal offset augmentation and no repeated-frame
padding. Missing detections remain explicit presence flags; missing camera samples are
never filled. Training and live inference call the same 16-frame window and summary code.

Motion energy remains per-step displacement rather than time-normalized velocity.
Means/std/deltas/energy now describe 16 actual observations across ~2 seconds, so the
same 474-value layout has different temporal semantics. The new schema requires its own
verified real dataset and newly trained model; old weights/metrics cannot be reused.

New **hp-live-2** manifests, embedded in the bundle and written to metrics.json, explicitly
include the feature schema, FPS, window count, capture protocol, accepted protocol list
and complete temporal contract. Loaders reject unknown schemas, inconsistent dimensions,
wrong window/FPS/protocol/limits and old hp-live-1 bundles lacking these declarations.
Existing sklearn, vocabulary fingerprint and revoked/unverified label checks remain.
The remote-download and publish paths use this same loader and therefore fail closed too.

The original **hp-v1-timed-1** option remains available in the collector and trainer.
Untagged historical data remains explicitly legacy hp-v1 data; it is not reinterpreted
as hp-v2-8fps. Mixed-protocol training files are refused before fitting, even when
`--drop-unverified` is used. Per-signer completion counts only the selected protocol;
archival downloads preserve all tags. See [collector instructions](COLLECTION_PROTOCOL.md).

Live status/hello advertises the loaded model's version, FPS, window and capture protocol.
Translate applies its required capture rate. Slow or uneven lower-rate windows report
`INSUFFICIENT_TIMING` and do not reach the classifier. Transport remains lm-v1 over the
same WebSocket/HTTP paths; no images are persisted or sent to the server. MediaPipe Hands
and Pose, handedness handling, consent and pseudonymous IDs are unchanged.

## Validation — 3 November 2026

- Full Python suite: **170 passed, 3 skipped**. Includes legacy regressions, boundary
  rates (7, 7.5, 8, 8.8, 9, 9.2, 9.5 FPS), malformed/duplicate/bursty/gapped takes,
  mixed-protocol rejection, window equality, mirrored-window equality, manifest
  incompatibility checks, synthetic trainer-manifest output, and WebSocket/HTTP parity.
- JavaScript web logic/product suites and legacy collector suite: **passed**. Added
  lower-rate acceptance/rejection, unchanged source timestamps, protocol-specific
  summary counts, and 9/20/30 FPS source scheduling regressions.
- Chromium browser regressions: **passed** against the production build, including
  real MediaPipe CPU/GPU workers, original protocol selection, locked capture rate,
  camera/worker cleanup and slow-capture rejection. A separate controlled detector test
  validates UI acceptance independently of host compute speed; its takes are discarded.
- Production build: **passed**.

Real-worker **synthetic-camera** CPU run at 640×480 on this Linux headless host:
**8.0 tracking FPS**, mean hand inference **77.5 ms**, pose **53.1 ms**, round trip
**80.3 ms**, processing **<0.1 ms**, overlay draw **0.1 ms**, total p95 **102.1 ms**
(41 diagnostic samples). A recording contained **16 frames over 1.90 seconds**, or
**7.9 effective collection FPS**, and Keep was enabled. It was discarded, never saved.
The deliberately slowed real-worker recording measured **3.5 FPS**, 10 frames over
2.60 seconds, and Keep was disabled. Software GPU remained slow (~0.4 FPS in a three-sample
run). A loaded-host run at 6–6.4 FPS was correctly rejected. These short tests establish
software behavior, not target-device throughput or sign-recognition quality; no hands
or shoulders are present in the synthetic camera pattern.

No real-data model was trained, no production artifact changed and no vocabulary was
approved. Training performed by tests uses temporary synthetic geometry/labels only.

## Remaining Windows acceptance

1. Warm up ten seconds with CPU, initially 640×480. Keep both real hands and shoulders
   visible. Confirm “your left/right” with one raised hand at a time and two-hand motion.
2. Record ten consecutive takes for the new protocol, including motion and NONE prompts.
   All ten must contain exactly 16 actual samples and pass every timing check. Review
   source timestamps/gaps from downloaded landmark JSONL, not just the FPS average.
3. Repeat at 320×240 only if needed. Check that hand shape and pose quality are adequate;
   choose the stable configuration with acceptable landmarks. A 9 FPS average with holes
   is not acceptance. GPU at 4–5 FPS should continue to fail the new protocol.
4. Check that a complete sign fits the approximately 2-second window without cutting off
   onset or ending. The valid 9 FPS case can stop after roughly 1.67 source seconds.
5. Once complete verified real data exists, train explicitly with
   `python -m backend.live.train --feature-schema hp-v2-8fps`, restart and confirm
   `/api/status` advertises 8 FPS / 16 frames / hp-v2-8fps-timed-1. Test known, NONE,
   unknown and transition cases on held-out signers. No accuracy claim is possible yet.

The protocol and collector/live feature representation are compatible and covered by
software tests. Real-device collection reliability and recognition quality still require
these human checks; the old 15 FPS requirement has not been weakened or relabeled.
