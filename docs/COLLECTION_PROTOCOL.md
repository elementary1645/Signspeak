# Collection protocol (about 25 minutes per signer)

For each person recording takes on `/collect`, and for the teammate running the session.

## Before you start (2 min)

- **Consent.** Explain: we record hand and upper-body *landmark points* (about 75 points
  per frame), not video or photos. The data trains a hackathon prototype. Takes are kept
  in a git-ignored folder and deleted after the hackathon unless the signer agrees
  otherwise. The trained model (built from everyone's takes) is published on the public
  demo, and some model types contain numeric summaries of training movements; see
  `docs/PRIVACY.md`. The signer can stop at any time and clear their saved takes on the
  page. They tick the consent box themselves.
- **Pseudonym.** Pick one ID such as `signer07` and use it in **every** session. Never a
  real name, phone or email. The same person under two IDs would leak between training
  and testing.
- **Session.** Defaults to today's date (`s20261103`). Use a new session ID if you change
  room, lighting or camera.
- **Setup.** Sit about an arm's length or more from the camera with your head, shoulders,
  elbows and hands in frame. Use even lighting with no strong window behind you. Plain
  sleeves help. Check that the overlay shows both shoulders and that "your left" and
  "your right" match your real hands (raise one at a time).

## Choose the capture protocol

The default is **hp-v2-8fps-timed-1**, using 16 actual hand+pose frames over about
2 seconds. On the tested Windows laptop choose **CPU**, starting at **640×480**;
320×240 is available if landmark quality remains good. Measured CPU tracking of
8.8–9.2 FPS is compatible; GPU tracking at 4–5 FPS is insufficient.

Warm up for ten seconds. Check both hands, shoulders and handedness before recording.
The protocol locks requested inference FPS to 8. Actual source timestamps are preserved;
there is no padding or interpolation. A valid take needs exactly 16 frames, 7–9.5 effective
FPS, first-to-last span 1.55–2.20 seconds, and every adjacent gap 80–190 ms. Rate checks
allow 1 ms on the whole span for timestamp rounding. At nominal 8 FPS, 15 intervals span
1.875 seconds. A uniform 9 FPS take spans 1.667 seconds and passes.

Stop the camera to select the original **hp-v1-timed-1** option (15 FPS, 24-frame model
window; collector stops at 26). Do not mix its recordings with 8 FPS training data.
The summary counts only the selected protocol. Downloads retain all takes with their
original protocol tags; old takes are never automatically upgraded.

## Capture a transient validation failure first

On `/collect`, **Capture hand diagnostics** retains the latest 100 diagnostic observations
in browser memory. With both hands outside view, press **Capture Failure B** after the
facial candidate appears, then **Copy JSON**. **Freeze Diagnostics** pauses only the JSON
view; the camera and buffer keep running. See [exact capture instructions](CAPTURE_HAND_DIAGNOSTICS.md).
This diagnostic tool does not fix or change detection. Copy the evidence before refreshing.

## Verify accepted hand tracking before each session

The current policy is **hand-evidence-v3**. Confirm genuine left/right hands are accepted
below and above the shoulders, far from the torso, near the face, and crossing the body.
Missing body landmarks do not prove a hand is invalid. Dashed **yellow** candidates are
explicitly **uncertain**, preview only, and cannot be recorded. Any uncertain observation
during a take disables Keep; discard it and inspect the local candidate reason.
With both real hands outside view, require no accepted hand-colored skeleton over the
face. Expand **Local hand validation diagnostics** for wrist coordinates, pose wrist
visibility, distances, decision reasons and the old-policy comparison. Handedness score
is identity confidence, not hand-presence confidence. Optional local console logging is
available; no diagnostics are sent to the server or training dataset.

The Windows laptop passed the [actual-device acceptance steps](PHASE3_HAND_REGRESSION.md)
on 3 November 2026 (build `cbeadee`, hand-evidence-v3). Rerun them on the laptop after any
change to hand admission; no headless or synthetic test substitutes for that.

## Framing and start position (required)

- Use good framing: no framing warning on `/collect` (face in the upper half, shoulders
  in view).
- Start each take with the signing hand raised and visible, away from the face.

## Signs (about 15 min)

For each sign in the list:

1. Open the official link shown on the page and watch it. Read the notes.
2. Press **Record take**. After the 3-2-1 countdown, perform the sign once. Recording
   stops at 16 real frames (about 2 seconds) or the three-second safety deadline.
   Start with the signing hand already raised beside the shoulder, away from the face
   (not from rest), then sign. If the FPS warning appears or timing fails,
   **Keep** is disabled: discard, close other apps, improve lighting, and retry CPU or
   another resolution. Never stretch a slow/incomplete take or duplicate frames.
3. Press **Keep** if the sign was correct and the hands were visible. Otherwise press
   **Discard** and try again.
4. Do 8 takes per sign. Vary them a little: slight changes in position, speed and
   distance. Copy the official form; do not invent variants.

Left-handed signers: sign naturally with your dominant hand and tell the team (training
can add mirrored copies with `--mirror-augment`).

## NONE takes (about 6 min, 16 takes)

Choose **NONE: not a sign**. The page shows a prompt (rest, scratching your head, adjusting
glasses, random movement, half a sign, raising hands into position, casual chatting,
checking a phone). Follow it naturally until recording stops. NONE teaches the model when
**not** to output anything, so these takes matter as much as the signs.

## Finish (2 min)

- Check the **Summary** panel. It must say "Complete" (every sign and NONE at target),
  and it lists any `low_fps` takes. Kept takes are autosaved in the browser, so a
  reload does not lose them.
- Press **Download my data** and send the `.jsonl` file to the team lead (shared drive,
  USB). It contains only landmarks and the metadata listed in `docs/data_schema.md`.
- On a shared computer, press **Clear saved takes** after downloading.

## Team lead: merge and train

```bash
python -m scripts.merge_takes path/to/*.jsonl          # validates, de-duplicates, reports per signer
# Run only after gathering complete real data and human verification of every sign:
python -m backend.live.train --feature-schema hp-v2-8fps  # refuses mismatched protocols and unverified labels
# Original protocol remains available with a separate dataset/model:
# python -m backend.live.train --takes path/to/hp-v1-only.jsonl --feature-schema hp-v1
# restart the server so /translate loads backend/models/live/model.joblib
```

Aim for **at least 3 signers**, so the trainer can measure accuracy on unseen people
(leave-one-signer-out). With fewer, it trains but warns that this was not measured.

The lower-rate trainer refuses untagged legacy takes, hp-v1 takes and mixed-protocol
files; choose protocol-specific downloads/files for each training run. The merge command
preserves tags and may merge multiple protocols for archival purposes, but the trainer
will refuse that mixed file. Do not bypass vocabulary verification to start collection
or training. No recognition quality is established until real held-out signers are tested.
