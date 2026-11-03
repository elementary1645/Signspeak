# Privacy

## Translate (anyone using the app)

- **Your video never leaves your device.** The camera image is processed in memory by
  MediaPipe running in your browser. No image or video is uploaded, saved or logged.
- **What is sent:** for each frame (about 15 per second), the positions of up to 2×21 hand
  points and 33 body points, plus the frame size and a timestamp (the lm-v1 format in
  `docs/data_schema.md`). It is sent over the same HTTPS origin (WebSocket, or HTTPS
  POST as a fallback).
- **What the server keeps:** the last ~3 seconds of points for your connection, in
  memory, to recognise the current sign. It is discarded when you disconnect (POST
  fallback streams expire after 60 s idle). Points are not written to disk or logs. The
  web server's access log records request paths and status codes only.
- **Speech:** pre-generated audio contains only the dictionary meaning (e.g. "Water").
  If no audio file exists, your browser's own speech engine speaks the meaning. Some
  browsers send that text to their vendor's online voice service.
- **Third parties:** the app is hosted on Hugging Face Spaces. The fonts, MediaPipe runtime
  and models are served from the app itself. There are no analytics or trackers. The
  Learn ISL page embeds official ISLRTC YouTube videos through `youtube-nocookie.com`
  (only for verified signs whose reference is a YouTube video). Opening that page loads
  YouTube's player.
- **Stored in your browser:** language, theme and auto-speak preferences (localStorage).

## Collect (volunteer signers)

- Takes contain only landmark points (as above) plus label, pseudonym, session ID, app
  version, timestamps and frame-rate metadata. No video, no real names.
- Kept takes are autosaved in **your browser's IndexedDB** on that device only. They leave
  the device when you press "Download my data" and hand the file to the team. "Clear
  saved takes" deletes them from the browser.
- Server-side saving is **off** by default and on the public Space. It is enabled only
  on a team machine started with `ENABLE_COLLECTION=1` (files in git-ignored `data/raw/`).
- Merged takes (`data/processed/`) are git-ignored, are never uploaded to the Space by
  `scripts/deploy_space.py`, and should be deleted after the hackathon unless each signer
  agrees otherwise.

## The trained model

The bundle (`model.joblib`) is never committed to GitHub. On Render it lives in a
**private** Hugging Face model repo (`scripts/publish_model.py` refuses a public one) and is
downloaded by the server with a read-only token. `deploy_space.py` instead uploads it to the
Space, and **a public Space's files can be downloaded by anyone**.
A trained scikit-learn model can contain numeric summaries of individual training windows
(for example an SVM's support vectors or a tree's split values): pseudonymous landmark
statistics, never images. Tell signers this when asking for consent. If anyone objects,
deploy with `--no-model` or make the Space private.

## Deleting data

Ask the team lead to remove your pseudonym's takes: delete the lines with your
`signer_id` from `data/processed/takes.jsonl`, retrain and redeploy.
