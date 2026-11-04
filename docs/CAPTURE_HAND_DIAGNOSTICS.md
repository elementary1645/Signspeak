# Capture a transient hand-validation failure

This tool preserves evidence on `/collect`. It does **not** fix hand detection or change
hand validation, handedness assignment, training features, capture timing or recordings.
The cropped-shoulder admission correction remains deferred until Failure B evidence can
be captured. Do not treat this diagnostic release as real-device acceptance.

## Capture Failure B

1. Rebuild the frontend (`npm --prefix web run build`), refresh `/collect`, start the
   camera, and find **Capture hand diagnostics** below the camera.
2. Keep both real hands outside the image. When the false facial candidate appears,
   press **Capture Failure B**. You can press it after the live state has changed: it
   searches the most recent **100** completed hand-validation observations backward.
   At 8 processed FPS this is roughly 12.5 seconds of history, not a guaranteed duration.
3. The JSON display freezes on the newest observation with `rawCount > 0` and
   `acceptedCount === 0`. Check its timestamp and confirm your actual hands were out of
   view. A genuine hand rejected by validation also matches that predicate; the button
   cannot determine physical ground truth or automatically label it a face hallucination.
4. Press **Copy JSON** and paste the frozen observation into the investigation chat.
   If clipboard access is unavailable, select the read-only JSON field and copy manually.
   Copy before refreshing or leaving `/collect`.

If no matching event remains in the buffer, the tool says so rather than capture an
unrelated observation. Leave the camera running and reproduce the event again.

## Other controls

- **Capture Diagnostics** pins the latest observation in browser memory and freezes its
  JSON display. It works for accepted, uncertain, rejected and no-candidate observations.
- **Freeze Diagnostics** pins the current/latest observation; it becomes **Resume
  Diagnostics** while frozen. Resuming returns to the live diagnostic JSON.
- **Capture Failure B** can replace a frozen snapshot with a newer matching buffered
  event without first resuming. The camera and ring buffer continue updating while frozen.
- **Copy JSON** copies only the pinned/frozen observation. It is disabled in live mode.
- Optional local console logging remains separate from the frozen JSON display.

Freeze affects only the diagnostic JSON display. The camera, overlay, status label,
validation and any active recording continue to use live observations. The Received
counter keeps increasing, so you can confirm buffering is still running. Stopping the
camera does not erase a frozen snapshot; refreshing or leaving the page does.

## What is retained

The buffer keeps deep copies of the latest 100 complete diagnostic objects. It does not
summarize away raw data: all raw candidate landmarks, handedness/confidence, both pose
wrists/visibility/distances, validation reasons, body reference evidence, source and worker
timestamps, result age and detector settings remain present. Unavailable sensor confidence
stays null; no missing sensor values are invented. A frozen snapshot remains intact even
if its original ring entry is later overwritten.

This is a browser-memory-only ring plus a pinned snapshot, not a training take. There is
no automatic server upload, IndexedDB/localStorage diagnostic save, image or video save,
or automatic diagnostic download. Explicit clipboard copying is the only export action.
Diagnostic controls never invoke Keep, Record take, or the take-save API.

## Validation

Unit tests cover exact 100-observation retention/eviction, newest matching event selection,
complete nested evidence preservation, independent frozen copies and listener isolation.
Chromium tests cover live camera/overlay updates while JSON is frozen, capture after a
brief event disappears, exact clipboard contents, clipboard-denial fallback, stopping the
camera without losing frozen evidence, and absence of diagnostic network writes.

The full detection defect remains open until actual laptop tests pass both genuine-hand
acceptance and the no-hand/false-face scenario.
