# False hand detections and handedness consistency

**Historical pose-wrist-v1 report.** Real-device testing subsequently found a genuine-hand
regression. The replacement policy and pending laptop acceptance are documented in
[PHASE3_HAND_REGRESSION.md](PHASE3_HAND_REGRESSION.md); the mandatory body gate below is
no longer the current recommendation.

## Root cause and investigation

The confirmed Windows webcam observation was a hand skeleton over the nose/mouth while
both real hands were out of view. The actual raw landmarks/scores from that moment were
not supplied, so this patch does not claim to reproduce that particular model output or
measure its confidence. The code audit found three concrete acceptance/display defects:

1. `toFrame` copied every Hand Landmarker candidate into the raw frame without checking
   body geometry. Side assignment always selected the nearest pose wrist, even when far
   away, invisible, out of frame, or unsupported by a plausible arm. “Right” could therefore
   mean only “closer to the right wrist”, not a verified right-hand detection.
2. Canvas landmarks updated for every processed frame, while `lastFrame` (used by the
   status label) updated at most twice a second. These could describe different observations,
   explaining orange hand landmarks beside “Hands: none”.
3. Session cancellation and request IDs existed, but there was no result-age limit or
   overlay-expiry timer. Slow inference/stalls could leave an outdated skeleton visible.

There is no evidence of independent camera loops feeding different frames into the two
workers: a single immutable canvas snapshot creates both bitmaps, one pair is in flight,
and request IDs correlate replies. The patch additionally echoes and verifies source
capture timestamp and detector kind; stale, mismatched or stopped-session replies cannot
be published or recorded. Live video can still lead inference by its processing latency.

MediaPipe's returned handedness score is a left/right classification score, **not hand
presence confidence**. Hand detection/presence/tracking thresholds are separate options;
hand presence and palm confidence are not returned in the Tasks JS result used here.
See the [official Hand Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
and [handedness score documentation](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/hands.md).
Increasing or thresholding the handedness score cannot by itself verify a hand.

## Explicit observation policy: pose-wrist-v1

Canonical configuration is `web/src/lib/handValidation.json`, imported by browser and
Python. It is a versioned observation-quality policy, separate from the feature and
capture versions. Default checks use unmirrored, pixel-isotropic coordinates:

| Setting | Default |
| --- | --- |
| Shoulder/elbow/wrist visibility | At least 0.5 |
| Shoulder width | At least 3% of image width |
| Required points | Both shoulders; assigned side's elbow and wrist; all in image |
| Maximum hand-to-pose wrist distance | 0.5 × shoulder width |
| Upper-arm and forearm segment length | 0.05–2.5 × shoulder width each |
| Hand detection confidence option | 0.65 |
| Hand presence confidence option | 0.65 |
| Hand tracking confidence option | 0.5 |
| Maximum asynchronous observation age | 400 ms from snapshot acquisition |

The matcher retains the existing minimum-total-distance left/right assignment for two
hands and nearest-wrist assignment for one. It ignores selfie handedness labels when
valid body geometry is available. After a rejection, remaining hands are checked again
under their new assignment; the final overlay and downstream feature code cannot assign
a retained hand to a different, unsupported wrist. Crossing the body's midline does not
swap anatomical sides: pose wrists determine identity, not image-left/image-right.

There is **no nose/mouth/chest exclusion zone**, no “hands must be below shoulders” rule,
and no smoothing/interpolation. Genuine hands near the face or chest remain accepted when
their corresponding pose arm and wrist are reliable and agree geometrically. Unsupported
or missing pose wrists fail closed. Changing canonical thresholds requires rebuilding
and revalidating this policy; hp-v2 model manifests check the full configuration, avoiding
independent browser/server threshold drift. The pure validator also accepts options for
controlled tests and development experiments; shipped capture uses the canonical settings.

## One accepted observation for all consumers

The browser converts raw detector output, filters hands, then publishes that same accepted
lm-v1 frame to the collector/live transport and React view. Overlay drawing and the status
label run in the same React commit. A current frame with `hands: []` clears hand drawing
immediately at that commit. A 400 ms freshness deadline clears the view even when the
camera/inference stalls; its timer cannot clear a newer observation. The camera stops on
page hide/navigation. Dropped stale results do not create empty or duplicate source frames.

Expand **Local hand validation diagnostics** below the camera to inspect the most recent
raw handedness labels/scores, all 21 raw landmark points, rejection reasons, assigned side,
and wrist distance in shoulder units. A warning explains rejected candidates. These raw
candidate diagnostics stay in browser memory/UI; rejected landmarks are never added to
lm-v1 transport frames, IndexedDB recordings, downloads or backend telemetry. No pixels
are saved, uploaded or logged. The score is explicitly labelled handedness confidence.

Python repeats the same geometric gate at hp-v2 live ingress and before hp-v2 frame-vector
construction. Unsafe cached vectors are not used for rejected input. Dataset save/merge
and training admission reject an hp-v2 take containing unsupported raw hand candidates,
rather than silently modifying the recorded source data. Legitimate no-hand observations
still count as actual camera frames, with empty hand lists and existing presence flags;
NONE examples with hands outside the frame remain recordable.

New takes record `hand_validation: pose-wrist-v1`. Existing hp-v2 takes without this
optional provenance field remain readable only if every stored hand passes the current
gate; they are not automatically rewritten. New hp-v2 model manifests include the full
`hand_validation` policy. Older/incompatible hp-v2 bundles lacking it fail closed and must
be retrained later on complete validated, verified real data. No production model is
trained by this patch. Synthetic test classifiers use temporary test-only directories.

The lm-v1 shape, hp-v2-8fps 152/474 feature layouts, summary math, left/right assignment
math and hp-v2-8fps-timed-1 timing contract are unchanged. This is explicitly versioned
input validation, not a silent feature-schema change. Legacy hp-v1 server math/data
compatibility stays intact; the browser's accepted-only view also protects new hp-v1
captures, while legacy hp-v1 input is not retroactively certified by this patch.

## Validation and real-device acceptance

The shared synthetic fixture matrix runs through both JS and Python validators. It
covers false face detections with high handedness scores, no hands, left/right assignment,
face/chest signing, crossed hands, missing/invisible/off-screen wrists, collapsed arms,
multiple candidates sharing one wrist, mixed genuine/false detections, and ambiguous
handedness scores. Additional tests cover stale asynchronous results, expiry races,
rejected feature/cache input, dataset ingress and explicit model-policy compatibility.
The older timing and protocol suites remain in place.

Chromium uses actual MediaPipe workers with a synthetic camera to check real execution,
CPU/GPU timing, loop ownership and cleanup. Controlled detector fixtures exercise actual
camera timestamps, pixel overlays, status labels, true face/chest/crossed-hand acceptance,
face/absent-wrist rejection and late/mismatched results. One controlled NONE take is kept
only in an isolated temporary browser context; assertions check all stored frames have
empty hand lists after rejecting face candidates and that no server-save request occurs.
The entire context is closed afterward. This is test data, never a real training dataset.

Final software validation on 3 November 2026:

- Full Python suite: **189 passed, 3 skipped**.
- Web JavaScript logic/product tests and the legacy collector tests: **passed**.
- Chromium regression suite: **passed**, including stored accepted-only observations in
  the isolated test context and pixel-level overlay/status consistency checks.
- Production Vite build: **passed**; no vocabulary or production model files changed.

The latest real-worker synthetic-camera CPU run at 640×480 showed **8.0 tracking FPS**,
mean hand inference **83.4 ms**, pose **56.1 ms**, round trip **87.8 ms**, and total p95
**113.5 ms**. A take contained 16 actual samples over **1.90 s (7.9 effective FPS)**.
One cold observation expired and was dropped. Deliberately delayed processing produced
**3.3 FPS** and correctly failed collection timing. Software GPU responses took seconds,
were all stale, and emitted no accepted frames. This host test pattern contains no real
hands, so these timings do not establish false-positive rates or Windows throughput.

On the Windows laptop before collecting training signs:

1. Start CPU, 640×480, hp-v2-8fps-timed-1; warm up ten seconds.
2. Keep real hands outside view for at least ten seconds, including face/head movement.
   Check **Hands: none**, no hand-colored overlay, and rejection diagnostics if MediaPipe
   emits candidates. Pose lines and the blue nose dot can remain visible.
3. Raise each real hand separately, then both. Confirm correct anatomical side labels.
   Sign near nose, mouth, face and chest, cross arms, and move hands out of view. Ensure
   overlay and labels agree and no hand overlay persists after the observation expires.
4. Check normal signing still passes the unchanged 8 FPS timing/gap rules across ten
   consecutive takes. Recheck throughput: more conservative detector thresholds may
   trigger extra palm inference and change CPU cost.
5. Review missing-wrist/occlusion cases. Reposition/light the signer so pose can verify
   the arm; do not loosen validation just to keep an unsupported recording.

Geometry is a conservative consistency check, not proof of anatomy. If both models
hallucinate a mutually plausible wrist/arm on the face, it can still pass. Severe occlusion,
foreshortening, motion blur and merged wrists can reject genuine gestures or make identity
ambiguous. The synthetic tests establish code behavior, not real-world false-positive/
false-negative rates. Those need actual laptop testing and later held-out signer review.
