# ISL vocabulary review — 2026-11-02

Primary reference: [ISLRTC official dictionary landing page](https://islrtc.nic.in/isl-dictionary/).
It links to the [government dictionary](https://divyangjan.depwd.gov.in/islrtc/index.php),
[official video channel](https://www.youtube.com/channel/UC3AcGIlqVI4nJWCwHgHFXtg),
and [government dataset catalog](https://data.gov.in/catalog/indian-sign-language-dictionary).
The landing page was verified. The dictionary endpoint timed out and the linked video
channel could not be retrieved during this implementation. No individual sign video
was visually verified. A landing-page link is not evidence for a gesture definition.

| Candidate | Intended meaning | Verified entry link | Hands | Static/dynamic | Facial/body cues | Complexity | First prototype |
|---|---|---|---|---|---|---|---|
| HELLO | Greeting | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| THANK_YOU | Gratitude | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| YES | Affirmation | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| NO | Negation | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| HELP | Assistance | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| WATER | Water | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| FOOD | Food | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| PLEASE | Polite request | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| SORRY | Apology | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| STOP | Stop an action | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| DOCTOR | Medical professional | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |
| EMERGENCY | Urgent situation | UNVERIFIED | Unknown | Unknown | Unknown | Not assessable | Excluded pending review |

## Admission procedure

Review each exact ISLRTC entry video with an ISL-competent reviewer, preferably a Deaf
ISL signer. Record the entry/video URL, reference identifier, reviewer pseudonym,
review date, hand count, movement and nonmanual cues in this table and the registry.
Do not infer ISL gestures from ASL material, English meanings or model predictions.
Aim for 6–8 confirmed static signs without essential facial/body context. If fewer
qualify, use fewer; never freeze one frame of a dynamic sign and claim full recognition.
Dynamic or body-relative signs require temporal/pose features and are excluded from v1.

`data/metadata/vocabulary.json` is deliberately empty. Reviewed entries follow this format
(the example is a template, not an admitted sign):

```json
{
  "label": "REVIEWED_LABEL",
  "verified": true,
  "static": true,
  "hand_count": 1,
  "reference_id": "exact-official-entry-id",
  "reference_url": "https://official-entry-url",
  "reviewer": "reviewer-pseudonym",
  "reviewed_on": "YYYY-MM-DD",
  "nonmanual_cues": "review findings"
}
```

Do not mark entries verified until the review actually happens. Restart collection after
registry changes. Current supported training signs: **zero**.
