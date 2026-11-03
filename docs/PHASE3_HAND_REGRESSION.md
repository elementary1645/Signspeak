# Critical hand regression — candidate correction, device acceptance pending

**The Windows laptop regression is not yet confirmed fixed.** Automated fixtures and
headless tests cannot establish that the actual laptop accepts genuine hands again.
This change restores independent hand evidence, exposes uncertainty, and supplies the
measurements needed for a real-device decision. Do not resume sign collection until the
acceptance steps below pass.

## Established root cause for the supplied sample

The laptop diagnostic supplied during investigation reports:

- One raw hand candidate, zero accepted.
- MediaPipe handedness label `Left`, handedness score **0.95302**.
- Exact first rejection: **`unreliable-shoulders`**.
- Previous pose assignment: `L`; normalized wrist distance: `null`.

The mandatory body gate rejected this candidate before it could establish a wrist-distance
match. In pose-wrist-v1, `unreliable-shoulders` meant missing shoulders, either shoulder
outside the image or visibility below 0.5, or shoulder width below 3% of image width.
The provided diagnostic did not include pose shoulder coordinates/visibility, so the
specific subcondition cannot be distinguished retrospectively. It also did not include
full pose landmarks; we cannot replay the revised verdict on that exact frame.
No actual user hand landmarks were copied into test fixtures or training data. The added
shoulder-failure fixture is synthetic geometry exhibiting the same failure condition.

The regression commit also introduced mandatory visible elbows/wrists, arm-length checks,
a 0.5-shoulder-width wrist-distance bound, and changed MediaPipe detection/presence options
from the previous defaults (0.5) to 0.65. Any of these could suppress additional genuine
candidates. Raised hands can be missed by Pose, or Pose can leave an inaccurate wrist
near the torso. Neither failure proves that Hand Landmarker detected a false hand.
The supplied candidate did reach the filter, so detector thresholds were not the cause
of **that** rejection. We restore their earlier values rather than assume higher is better.

MediaPipe describes visibility as likelihood of a landmark being visible, not measured
coordinate accuracy. We therefore use wrist visibility and geometry as corroboration,
not ground truth. Handedness confidence estimates left/right identity, not hand existence.
Sources: [official Pose output documentation](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md),
[official Hand JS defaults/source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/hand_landmarker/hand_landmarker.ts).

## Coordinate and asynchronous audit

There was no new camera flip, crop or resize transform in 4e9323c. The detector receives
unmirrored canvas pixels; CSS mirrors only the preview. Hand and pose x/y both use the
same input image. Distances remain pixel-isotropic (`x * width`, `y * height`). Hand-local
z may support hand geometry (`z * width`), but is never compared with Pose z, whose origin
is different. No landmark coordinates are moved to make wrists agree.

Both workers receive bitmaps from the same immutable snapshot, with one pair in flight.
Request IDs, source timestamps and detector kinds are checked before validation. Session
cancellation, out-of-order guards, 400 ms expiry and expiry-generation checks remain.
The new diagnostics print both worker timestamps and result age. No asynchronous mismatch
was established as the cause of the supplied laptop rejection.

## Replacement observation policy: hand-evidence-v2

Configuration stays shared between JS and Python in `web/src/lib/handValidation.json`.
The feature schema stays **hp-v2-8fps**, and capture stays **hp-v2-8fps-timed-1**.
There are two admission routes, followed by explicit uncertainty handling:

1. **Pose-supported hand.** A nondegenerate, in-frame hand agrees with a visible pose
   wrist and plausible arm. One-to-one matching maximizes supported matches, then
   minimizes pixel distance. Pose supplies anatomical identity even for crossed hands
   or misleading handedness labels. The opposite shoulder need not be reliable.
2. **Independent hand, pose unavailable/inaccurate.** A plausible hand outside the
   estimated facial area can be accepted using a unique handedness label with score
   at least 0.8. No maximum distance from the body, shoulder visibility requirement,
   wrist visibility requirement, or “below shoulders” rule applies to this route.
   The existing unmirrored convention is retained: MediaPipe `Left` means subject right,
   `Right` means subject left. Image x is never used to invent identity when labels conflict.
3. **Uncertain.** Candidate identity conflicts, duplicate identity claims, an unavailable
   face reference, or face proximity without corroborating wrist/arm support do not
   prove a false hand. They produce **uncertain**, not “Hands: none”. The face caution
   checks wrist and palm MCP positions against the nose, scaled by shoulder-coordinate
   span. It is used jointly with absent independent pose support, not as a blanket face
   exclusion: genuine near-face signing with corroborating pose still passes.

Invalid or degenerate hand arrays remain excluded. The hand geometry check uses hand-local
3D palm geometry rather than assuming a wide 2D palm, so edge-on hands are not rejected
merely for projection foreshortening. It is a degeneracy check, **not proof of anatomy**.
The settings are not empirically calibrated false-positive/negative thresholds.

Key settings: detection/presence/tracking options 0.5; fallback identity score >=0.8;
pose visibility >=0.5 and wrist agreement <=0.5 shoulder widths only for corroboration;
facial caution radius 0.5 shoulder-coordinate spans; freshness limit 400 ms. Existing
arm-length ranges (0.05–2.5 shoulder widths) are supporting evidence, not global vetoes.
The original 15 FPS browser path withholds unsupported identity fallbacks rather than
send a new slot interpretation to legacy hp-v1 models.

## Explicit state and recording safety

- Accepted hands use the existing anatomical colors. Uncertain candidates use a dashed
  yellow preview, clearly labelled **uncertain / not recorded**. No current raw candidate
  says **none detected**; a stale result says **waiting for fresh tracking**. A returned
  Pose result says **detected**, not that body landmarks are necessarily accurate.
- The overlay, label and diagnostic decision are committed together. Loss clears old
  drawing; no old hand is filled into a subsequent frame or recording.
- An uncertain/invalid observation is withheld as a whole from collection and transport.
  It is **not** converted into an empty hand frame or a false NONE example. Any such
  observation during recording invalidates that take, including when enough later
  accepted frames would otherwise satisfy the timing contract. Pre-recording snapshots
  are excluded using their source timestamps.
- Live uncertainty clears buffered predictions and smoothing history. Browser transport
  sends the existing reset control, clears pending HTTP batches, and ignores pre-reset
  replies. Python independently returns `UNCERTAIN_HANDS` without classifier input for
  unsupported candidates. Vocabulary/model incompatibility still takes precedence.
- True observations with no raw candidates remain real no-detection frames with the
  original presence flags. No interpolation, padding, invented frame or duplicate
  timestamp is introduced.

Python admission repeats the shared decision. Dataset save/merge/training refuses stored
uncertain or inconsistent candidates. Live cached vectors use the same temporal module's
frame-vector function as training, including the corrected identity route. A module
change clears existing cached vectors so legacy identity flags cannot leak into a newly
ready hp-v2 model.

## Feature/capture compatibility

The 152/474 layouts, normalization formulas, temporal summary formulas, 16-source-frame
window, rate bounds, gap bounds and deadline are unchanged. The existing side-from-label
flag now correctly marks the independent-hand route even when shoulders exist but wrists
cannot be trusted. This is an explicit observation/identity policy change, not a silent
change to feature dimensions or capture timing.

The side-from-label flag can now be set while body pose is present, because usable
shoulders do not imply trustworthy pose wrists. This correctly records the identity
source; no pose coordinate is replaced with the detected hand wrist. Model-policy
compatibility checks prevent old trained weights from silently consuming this new route.

New takes use `hand_validation: hand-evidence-v2`. Older `pose-wrist-v1` provenance remains
readable, subject to current admission checks. New hp-v2 model manifests contain the full
new policy; incompatible older observation policies fail closed, so trained weights are
not silently reinterpreted. Legacy hp-v1 server math is unchanged. No vocabulary is
approved and no real-data model is trained by this work.

`/api/config` advertises the full server observation policy. Collection is disabled if
it differs from the browser policy. Translate likewise refuses a loaded hp-v2 model with
an incompatible observation policy. This catches a rebuilt UI paired with an old server;
rebuild and restart both, then refresh, rather than collect inconsistent interpretations.

## Diagnostics to capture on the actual laptop

Expand **Local hand validation diagnostics**. Every raw candidate now includes its:

- Wrist in normalized and pixel coordinates; all 21 original landmark values.
- Both pose wrists, their visibility, pixel distances and shoulder-normalized distances.
- Current status, exact reason, selected anatomical side and identity source.
- `legacyReason` and `legacySide`, for comparison with pose-wrist-v1.
- Palm geometry and face-reference/proximity signals.

The observation also includes both shoulders and nose with visibility, resolution,
source/worker timestamps, age, and active detector options. Hand-presence confidence
is explicitly unavailable (`null`); it is not fabricated from handedness confidence.
Enable **Log candidate summaries in this browser console (local only)** to log each
candidate with flattened wrist/confidence/distance/reason fields. Logging is opt-in to
avoid unnecessary main-thread overhead. Diagnostics are not uploaded or included in
recordings; no video or images are saved. Copy only the summaries needed for investigation.

## Software validation — 3 November 2026

- **Python: 209 passed, 3 skipped**, complete suite. Includes existing feature/protocol,
  training, model-loading and live API tests; new synthetic fixtures cover raised left,
  raised right, both raised, genuine near-face signing, absent candidates, nose/mouth
  hallucination patterns, missing wrists, crossing, and an edge-on hand with depth.
  Shared fixtures verify JS/Python admission and anatomical slot parity. Added tests
  verify fallback flags, training/live cache equality and cache invalidation when a
  model's temporal/identity module becomes available.
- **JavaScript web logic/product and legacy collector suites: passed.** Additional cases
  verify exact old rejection reasons, independent-hand admission, explicit uncertainty,
  stale frame expiry, and WebSocket/HTTP reset and late-reply suppression.
- **Chromium regressions: passed** against the production build. Controlled detector
  replies exercise real source camera timestamps, green/orange accepted overlays,
  uncertain face previews, clearing/recovery, raised-hand storage, uncertainty preventing
  a false NONE recording, and refusing mixed browser/server or model policies.
  One no-candidate take and one accepted-raised-hand take exist only in an isolated
  temporary test browser context; no server-save request is made and the context closes.
- **Production build: passed.** Feature/capture schema identifiers and temporal bounds
  are unchanged. No vocabulary or production model files changed.

Real MediaPipe workers were also exercised with a **synthetic camera test pattern**,
not a person. An isolated CPU run observed 8.0 tracking FPS and a 16-frame take over
1.90 seconds (7.9 effective FPS). During concurrent Python/software-GPU load another run
measured 7.3 FPS and correctly rejected an uneven take. Software-GPU results expired
rather than enter a recording. These measurements are not Windows/laptop acceptance.

A concurrent full Python run narrowly exceeded an existing 10 ms training-latency gate
(10.147 ms). The final standalone run passed all tests with the original limit unchanged;
no timing rule or performance gate was relaxed. Prior geometry coverage is retained,
with missing-pose tests now asserting independent admission or explicit uncertainty
instead of treating missing body evidence as proof of no hand.

## Exact Windows acceptance steps — still required

1. Pull this branch, rebuild, restart the app/server and hard-refresh `/collect`:

   ```powershell
   git pull --ff-only origin feat/phase3-live-recognition
   npm --prefix web ci
   npm --prefix web run build
   ```

   Restart the same Python server used previously. Stop/start the camera. Confirm the
   diagnostic policy is **hand-evidence-v2**, CPU / 640×480 / hp-v2-8fps-timed-1 / 8 FPS,
   and detector detection/presence options are both **0.5**. An old policy indicates
   a stale build/session; do not use it for the acceptance test.
2. Hold the real **right** hand below, beside, in front of, and above the shoulder for
   several seconds at each location, including far from the torso. Repeat with the
   **left**, then **both** hands. Require `accepted`, correct physical side labels,
   and ordinary anatomical-color landmarks. Record the reason and identity source.
3. Specifically reproduce the hand pose that returned `unreliable-shoulders`. Confirm
   raw candidates remain present and the new verdict is accepted. If it is uncertain
   or rejected, copy the complete diagnostic summary, especially shoulder/nose data,
   both pose wrists, visibility, distances and current/legacy reasons. **This condition
   has not been verified on the actual laptop yet.**
4. Sign near the head, forehead, nose, mouth and chest; cross hands and temporarily
   remove/reintroduce them. Verify anatomical sides, prompt clearing after loss, and
   recovery without a stuck skeleton. Yellow uncertainty must be distinguishable from
   acceptance and cannot be treated as a successful collection test.
5. Keep both actual hands out of frame for at least ten seconds while moving the head
   and face. Require no accepted hand-colored face skeleton. Any remaining face candidate
   must be uncertain/non-recordable. A genuine false accepted face candidate fails acceptance;
   copy its diagnostics rather than train around it.
6. Run ten consecutive ~2-second takes under the unchanged timing rules. Require exactly
   16 accepted source observations, 7–9.5 effective FPS with the existing span/rounding
   bounds and 80–190 ms gaps, and no uncertain episodes. Inspect downloaded landmarks
   only after hand correctness is established. No uncertain take may be kept or sent.

Until steps 2–6 pass, the real-device regression remains **open**. MediaPipe visibility
and handedness scores are not calibrated truth labels. Mutually consistent hallucinations
can still pass; face occlusion or ambiguous identity may still require the uncertain
state. Automated synthetic tests cannot measure those device/signing failure rates.
