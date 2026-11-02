# ISL vocabulary review — 2026-11-02

**Human-approved training signs: zero.** No sign has been visually confirmed by a
human in this project. All candidates remain UNVERIFIED and collection-locked.

Primary authority: [ISLRTC official dictionary landing page](https://islrtc.nic.in/isl-dictionary/),
which links to the [government dictionary](https://divyangjan.depwd.gov.in/islrtc/index.php),
[official video channel](https://www.youtube.com/channel/UC3AcGIlqVI4nJWCwHgHFXtg)
and [government dataset catalog](https://data.gov.in/catalog/indian-sign-language-dictionary).
References are attributed, not copied or redistributed. No ASL substitutions are allowed.

## Research findings and review queue

Phase 2 searches found candidate names in indexed official alphabetical lists, including
Hello/Help, Thank You (multiple variants), Food, Sorry/Stop (multiple variants) and Doctor.
Direct access to the dictionary pages still timed out. Exact entry/video URLs were not
resolved, and neither a word match nor an index URL verifies a sign. No motion,
hand-count or nonmanual-cue property can be concluded from those text lists.

The links below are **lookup sources**, not approved exact references. All exact sign
reference IDs/URLs and gesture properties remain unresolved in
`data/metadata/review_candidates.json`. Priority 1 means review first, not predicted
recognition suitability. Target 6–8 suitable signs after review; use fewer if needed.

| Candidate | Meaning | Priority | Official lookup source | Exact reference | Hands | Motion required | Facial/body/relative-hand cues | hands-v1 suitability |
|---|---|---|---|---|---|---|---|---|
| HELLO | Greeting | 1 | [H list](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=H) | UNVERIFIED | Unknown | Unknown | Unknown | Pending human review |
| THANK_YOU | Gratitude | 1 | [T list](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=T) | UNVERIFIED | Unknown | Unknown | Unknown | Pending human review |
| YES | Affirmation | 1 | [Y lookup](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=Y) | UNVERIFIED; exact entry not resolved | Unknown | Unknown | Unknown | Pending human review |
| NO | Negation | 1 | [N lookup](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=N) | UNVERIFIED; exact entry not resolved | Unknown | Unknown | Unknown | Pending human review |
| HELP | Assistance | 1 | [H list](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=H) | UNVERIFIED | Unknown | Unknown | Unknown | Pending human review |
| WATER | Water | 1 | [W lookup](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=W) | UNVERIFIED; exact entry not resolved | Unknown | Unknown | Unknown | Pending human review |
| FOOD | Food | 1 | [F list](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=F) | UNVERIFIED | Unknown | Unknown | Unknown | Pending human review |
| STOP | Stop an action | 1 | [S list](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=S) | UNVERIFIED | Unknown | Unknown | Unknown | Pending human review |
| PLEASE | Polite request | 2 | [P lookup](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=P) | UNVERIFIED; exact entry not resolved | Unknown | Unknown | Unknown | Pending human review |
| SORRY | Apology | 2 | [S list](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=S) | UNVERIFIED | Unknown | Unknown | Unknown | Pending human review |
| DOCTOR | Medical professional | 2 | [D list](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=D) | UNVERIFIED | Unknown | Unknown | Unknown | Pending human review |
| EMERGENCY | Urgent situation | 2 | [E lookup](https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=E) | UNVERIFIED; exact entry not resolved | Unknown | Unknown | Unknown | Pending human review |

## Human review, one sign at a time

1. Open the browser lab's **Human vocabulary review** panel and choose a candidate.
2. Find the exact ISLRTC entry/video, confirm official provenance and watch the entire
   sign. If the dictionary is unavailable, use the official channel/Sign Learn app to
   locate it; record a shareable exact reference URL. An index/channel URL is rejected.
3. Prefer review with a Deaf ISL signer or another ISL-competent reviewer. Choose the
   specific variant; do not merge variants under one label without justification.
4. Record one/two hands, static versus motion-dependent, required facial/body/relative
   hand cues, and whether `hands-v1` can encode the distinction. Document what you
   observed and why the sign is or is not suitable. Do not guess unanswered properties.
5. Approve only truly static signs whose essential cues survive per-hand wrist-centering.
   Otherwise export an **excluded** decision. Never treat a still frame of a dynamic
   sign as recognition of the full sign.
6. Check the personal inspection and official-source declarations, then export this
   single review JSON. Move that file from laptop Downloads into the Codespace using
   VS Code Explorer (for example under ignored `data/processed/reviews/`). Apply it:

   ```bash
   python -m scripts.review_sign data/processed/reviews/HELLO-review.json --confirm-human-review
   ```

   This command records your decision; it cannot inspect a sign for you. Do not run it
   against a template or ask an assistant to assert human inspection on your behalf.
7. Review the resulting registry diff, restart the server and reload the page. Only
   admitted labels appear in the collection selector. Repeat individually for each sign.

`data/metadata/vocabulary.json` contains reviewed decisions. Approved entries require
all fields of `backend.app.vocabulary.SignReview`: label, verified, static, hand_count,
reference_id, reference_url, reviewer, reviewed_on, human_inspected,
official_source_confirmed, motion_required, facial_cues_required, body_cues_required,
relative_hand_position_required, hands_v1_suitable and notes. The form generates this
structure; no preapproved example is supplied. Rejected decisions remain in the registry
for attribution but never become training labels.

Changing an approved reference requires explicit revocation in the registry first.
Previously collected records must still match approved class/reference/hand count;
a changed model vocabulary hash requires retraining. Do not reuse an old reference ID
for a different sign variant. The registry is a trusted local artifact, not an identity
or authenticity service.
