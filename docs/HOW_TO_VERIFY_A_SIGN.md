# How to verify one sign (about 10 minutes)

Nothing in SignSpeak is auto-approved. A model can only be trained on a sign after a
person has watched the **official ISLRTC video** for it and answered a few questions.
If you know ISL (ideally you are a Deaf ISL signer, or have one with you), you can do this.

Verified: HELLO, YES, NO. Candidates waiting: THANK_YOU (revoked 4 November 2026: it
failed live, see docs/MODEL_CARD.md), WATER, FOOD, HELP, SORRY, PLEASE (`verified: false`
in `data/metadata/vocabulary.json`).

## 1. Find the exact official video (3 min)

1. Open the candidate's `lookup_url` from `vocabulary.json` (the ISLRTC dictionary list
   page for that letter), or search the [ISLRTC dictionary](https://islrtc.nic.in/isl-dictionary/)
   and its official YouTube channel.
2. Open the entry for **this exact meaning** and copy the URL of that one entry or video.
   A list page, search page or channel page is rejected; it must be one sign.
3. Never use ASL, BSL or a random tutorial. If no official entry exists, skip the sign.

## 2. Save the link (1 min): this unlocks collection

```bash
python -m scripts.verify_sign HELLO --link "https://<exact official entry or video>" --reference-id "<title or id shown on the page>"
```

The sign now appears on `/collect`, with the link, so signers can copy the official form.
The trainer still refuses to use it until step 3 is done.

## 3. Watch and answer (5 min)

Watch the video at least twice, then run:

```bash
python -m scripts.verify_sign HELLO
```

You will be asked to type `WATCHED`, then answer:

| Question | Notes |
|---|---|
| Is the link an official ISLRTC entry for this meaning? | Answering no stops here. |
| Two hands? | |
| Movement? | Allowed: hp-v1 sees motion. |
| Depends on where the hands are relative to each other? | Allowed. |
| Touches or points to a body location? | Allowed (shoulders/elbows/nose are tracked, but not exact face points). |
| Facial expression or mouthing **required**? | **Yes means it cannot be admitted**: hp-v1 has no face landmarks. |
| Your pseudonym | No real names. |
| How to sign it, in your words | Signers read this on /collect, so be concrete: "Right flat hand at forehead, moves outward." |

Then restart the server. To undo an approval: `python -m scripts.verify_sign HELLO --revoke`,
then retrain. If the official reference changes, revoke it, recollect and retrain.

## Translations

`data/metadata/translations.json` holds the meaning shown for each sign in English,
Kannada, Hindi and Tamil. The text was drafted by an AI assistant and is marked
`needs_native_check: true`. A native speaker should correct it and set the flag to `false`.

## What this does not do

The script records what you saw. It cannot check that you actually watched the video
or that the sign is correct. That is why the person doing the review matters.
