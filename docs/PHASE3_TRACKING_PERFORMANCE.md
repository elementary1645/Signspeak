# Phase 3 browser tracking performance

This report describes the original 15 FPS optimization. The separately versioned
8 FPS implementation is documented in [PHASE3_LOWER_FPS_PROTOCOL.md](PHASE3_LOWER_FPS_PROTOCOL.md).

The previous loop called synchronous hand inference and then synchronous pose inference
on the UI thread. Initializing with Promise.all did not make per-frame inference parallel.
Google documents that [detectForVideo blocks its calling thread](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js).
The existing camera request was already 640×480, but the browser could negotiate another
size. A stream-only start guard allowed overlapping asynchronous starts, and stopping
during startup could leave a late camera stream alive. Slow takes were flagged but accepted.

The new loop owns one camera session, two independent classic workers, and at most one
pair of inferences in flight. Both workers receive the same unmirrored snapshot and
source timestamp. Initialization and inference errors stop the session; choosing CPU or
GPU is explicit, with no silent delegate change during a take. Worker termination releases
detectors on stop/navigation. Late camera acquisitions immediately stop their tracks.
There is no backlog, reused result, generated frame, or interpolation in the collector.

Resolution (320, 640, 1280 wide), target inference FPS (5–30), and CPU/GPU are selectable
while stopped. Camera constraints are requests; diagnostics show delivered camera size
and actual inference size. The inference canvas caps width and preserves aspect ratio,
even if the camera ignores resolution constraints. Reducing external resolution does not
change the models' internal input tensor sizes, so it may not reduce model compute much.

Frame timestamps use video-frame callback mediaTime (video.currentTime on the animation
callback fallback), mapped once to the page's performance clock. Duplicate or regressing
source times are skipped. They are never incremented artificially to satisfy VIDEO mode.
The timestamp reflects the source frame, rather than inference completion. Diagnostics
report completed-frame FPS over three seconds, means over at most 150 processed frames,
and p95 total latency. Hand/pose times measure synchronous worker inference; round-trip
latency includes snapshot creation, worker transfer and waiting. Processing includes
lm-v1 conversion and consumer callbacks. Overlay timing measures canvas drawing calls,
not browser compositing, paint, or React commit duration. React status refresh is capped
at two updates per second; every completed frame still reaches the consumer.

## Collection timing contract

New takes declare `capture_protocol: hp-v1-timed-1`. Both browser Keep and server take
validation enforce:

- At least 24 distinct source frames, with strictly increasing finite timestamps.
- 14–17 effective FPS: `(frame_count - 1) * 1000 / timestamp_span`.
- Timestamp span 1380–1850 ms, preserving the hp-v1 24-frame, 15 FPS window.
- No adjacent timestamp gap over 100 ms (1.5 nominal periods).

The collector stops at 26 actual frames, giving a small coverage margin (~1.67 seconds
between first and last at 15 FPS), or rejects after the three-second safety deadline.
Fewer than 26 can be accepted at the deadline only if all timing criteria still hold.
Capture wall duration and actual per-frame source times remain separate. Changing the
requested inference FPS does not change this contract. Existing takes remain readable;
legacy validation is unchanged, so this patch does not certify old data as correctly timed.
The raw lm-v1 and hp-v1 feature code, handedness rules, preview mirroring, vocabulary,
and recognition resampling are unchanged. Images travel only between same-origin local
browser threads, and are neither persisted nor sent to the backend.

## Reproduce validation

```bash
python scripts/download_model.py
npm --prefix web ci
npm --prefix web run build
python -m pytest -q
npm --prefix web test
node --test frontend/tests/collector.test.cjs
# One-time browser setup (requires OS runtime libraries):
cd web
npx playwright install --with-deps chromium
cd ..
LEGACY_DETECTOR=0 python -m uvicorn backend.app.main:app --port 8000
# In another terminal:
npm --prefix web run test:browser
```

The browser regression uses real MediaPipe/WASM and a **synthetic camera test pattern**.
It checks CPU/GPU workers, bounded worker ownership, track cleanup, navigation during
camera acquisition, and rejection of a real 5 FPS capture. It never keeps a synthetic take.
It is not a signing benchmark: no actual hands or body are present, and headless GPU is
software rendering. Its timings must not be reported as performance on the user's hardware.

## Validation results (3 November 2026)

- Full Python suite: 137 passed, 3 skipped. The initial run lacked libGL; installing
  Chromium runtime dependencies supplied it. API TestClient requires execution outside
  this environment's restricted sandbox.
- Existing web logic/product and legacy collector suites: passed, with additional timing,
  source-clock, resolution and worker regressions.
- Production build: passed. Real Chromium CPU/GPU worker lifecycle and slow-capture
  rejection suite: passed against the production build.

Latest 640×480 synthetic-camera run on this Linux headless host:

| Delegate | Observed completed FPS | Mean hand inference | Mean pose inference | Mean round trip | Mean processing | Mean overlay draw | Total p95 | Samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CPU | 10.9 | 79.7 ms | 58.7 ms | 82.4 ms | <0.1 ms | 0.1 ms | 104.5 ms | 49 |
| GPU (software) | 0.1 | 6072.8 ms | 7880.9 ms | 7886.4 ms | 0.1 ms | <0.1 ms | 13059.3 ms | 2 |

This is a short plumbing test including warmup, not a sustainable-rate benchmark. The GPU
row has only two samples and must not guide target-device tuning. An earlier run measured
9.0 FPS CPU and 0.4 FPS software GPU, illustrating host variability. The low-rate collection
check recorded 15 real source frames spanning 2.80 seconds, **5.0 effective FPS**, and
correctly disabled Keep. These runs do not demonstrate reliable 24-frame hp-v1 captures.

## Target hardware acceptance and slower protocols

The reported baseline was 2.8–3.4 FPS and 295–298 ms combined inference on the user's
browser. Separate baseline hand/pose times were unavailable. This environment has no
access to that camera/hardware; target-device FPS, collection FPS and reliable 24-frame
capture remain unverified. A GPU delegate label alone does not prove hardware acceleration.

On the target browser, compare CPU and GPU at 640 wide, then 320 wide, with the same
lighting and both hands plus shoulders visible. Warm up for ten seconds; measure at least
30 seconds and attempt ten takes per setting. Record displayed mean hand/pose time,
p95 total latency, tracking FPS, and every take's effective FPS and Keep verdict. Do not
claim reliable hp-v1 capture until all ten takes satisfy the contract, with stable landmark
quality and correct sides. Check 1280 only if lower-resolution landmarks lose quality.
Select the fastest stable setting from these measurements, rather than the delegate name.

If no configuration passes, stop hp-v1 training collection on that device. Establish a
separate, explicitly versioned lower-rate protocol using a conservative sustained rate
measured with both hands and pose. For example, if testing establishes stable 10 FPS,
use 16 actual samples over approximately 1.6 seconds (15 intervals = 1.5 seconds), and
update training and inference window/FPS/gap rules together under a new feature version.
Recollect and retrain that version with complete approved data; do not pad a 10 FPS take
to 24 samples or relabel it hp-v1. If only ~3 FPS is sustainable, improving hardware is
preferable for short motion signs; a longer 24-frame window would change the gesture
protocol substantially. No vocabulary approvals or production model training are part of
this patch.
