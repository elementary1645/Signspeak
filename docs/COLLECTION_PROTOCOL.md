# Collection protocol (about 25 minutes per signer)

For each person recording takes on `/collect`, and for the teammate running the session.

## Before you start (2 min)

- **Consent.** Explain: we record hand and upper-body *landmark points* (about 75 points
  per frame), not video or photos. The data trains a hackathon prototype. Takes are kept
  in a git-ignored folder and deleted after the hackathon unless the signer agrees
  otherwise. The signer can stop at any time and delete their local data on the page.
  They tick the consent box themselves.
- **Pseudonym.** Pick one ID such as `signer07` and use it in **every** session. Never a
  real name, phone or email. The same person under two IDs would leak between training
  and testing.
- **Session.** Defaults to today's date (`s20261103`). Use a new session ID if you change
  room, lighting or camera.
- **Setup.** Sit about an arm's length or more from the camera with your head, shoulders,
  elbows and hands in frame. Use even lighting with no strong window behind you. Plain
  sleeves help. Check that the overlay shows both shoulders and that "your left" and
  "your right" match your real hands (raise one at a time).

## Signs (about 15 min)

For each sign in the list:

1. Open the official link shown on the page and watch it. Read the notes.
2. Press **Record take**. After the 3-2-1 countdown, perform the sign once within the
   2 seconds. Start from rest, sign, and return to rest.
3. Press **Keep** if the sign was correct and the hands were visible. Otherwise press
   **Discard** and try again.
4. Do 8 takes per sign. Vary them a little: slight changes in position, speed and
   distance. Copy the official form; do not invent variants.

Left-handed signers: sign naturally with your dominant hand and tell the team (training
can add mirrored copies with `--mirror-augment`).

## NONE takes (about 6 min, 16 takes)

Choose **NONE: not a sign**. The page shows a prompt (rest, scratching your head, adjusting
glasses, random movement, half a sign, raising hands into position, casual chatting,
checking a phone). Follow it naturally for the 2 seconds. NONE teaches the model when
**not** to output anything, so these takes matter as much as the signs.

## Finish (2 min)

- Press **Download my data** and send the `.jsonl` file to the team lead (shared drive,
  USB). It contains only landmarks and the metadata listed in `docs/data_schema.md`.
- On a shared computer, press **Delete my local data** after downloading.

## Team lead: merge and train

```bash
python -m scripts.merge_takes path/to/*.jsonl          # validates, de-duplicates, reports per signer
python -m backend.live.train                            # refuses unverified labels; prints metrics
# restart the server so /translate loads backend/models/live/model.joblib
```

Aim for **at least 3 signers**, so the trainer can measure accuracy on unseen people
(leave-one-signer-out). With fewer, it trains but warns that this was not measured.
