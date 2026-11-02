# MediaPipe sequence dataset compatibility assessment

Inspected 2 November 2026. Decision: structurally suitable for sequence experiments,
**not compatible with the existing inference contract and not cleared for training or public recognition**.
No model was trained, no pipeline or vocabulary was changed, no dataset was extracted or duplicated,
and no merge was performed. Added only this assessment, aggregate audit JSON and a read-only inspector.

## Archive and integrity

Inner archive: `data/raw/extracted/Dataset of Common phrases in Indian Sign Language/Dataset of Common phrases in Indian Sign Language.zip`.
Size 259,952,340 bytes; uncompressed member total 495,345,600 bytes (including NPY headers).
38,172 entries: 36,900 arrays and 1,272 directories; no videos, images, extraction code,
README, licence, signer IDs, sessions, timestamps, frame rate or acquisition metadata.

Inner SHA256: `b7113209b6d72bd709ca155efce9fcf8b0888e64b2f4f41f7e3287b8b8be68c1`.
Outer SHA256: `34ced9259e493f7aff63cfdaade89eb2a5d2f7a1fc5b0dfafc6adba1397f28d2`.
Outer CRC passed; its embedded inner archive hashes identically to the extracted ZIP.
Every inner file was decompressed, CRC checked and loaded directly from ZIP with
`np.load(..., allow_pickle=False)` using the existing Python 3.12 environment / NumPy 2.5.4.
No load failures, nonfinite values, duplicate member paths, unsafe paths, missing frame
indices or all-zero full frames were found. CRC and local hashes establish byte integrity,
not authenticity or publisher identity.

## Actual statistics and values

**41 label paths, 1,230 sequences, 36,900 frames.** Each label has sequence IDs 0–29;
each sequence has frame indices 0–29. Numeric sorting is essential (ZIP listing is lexicographic).
One sequence stacks to `(30, 1662)`. All 36,900 individual arrays have shape `(1662,)`
and dtype `float64`, not image tensors. Global range: -3.7297146320343018 to
4.084334850311279. Coordinates are not all confined to [0,1]; do not clip indiscriminately.

`MP_Data/aboard/0/0.npy` begins:
`[0.5828507543, 0.4714526534, -0.7711092234, 0.9990823269,
0.6012260914, 0.4246030748, -0.7130867243, 0.9980548620]`.
Its candidate left wrist is `[0.5101387501, 0.8163053989, -1.4839200446e-07]`;
candidate right wrist is `[0.6119378209, 0.7940257192, -2.3594743936e-07]`.
These are not wrist-centered/scaled hands-v1 vectors. Full precision examples at frames
0, 15 and 29 for aboard/hello are in `archive-audit.json`.

No exact duplicate full frame vectors or full sequences were found, including across
classes. Every sequence changes numerically and no adjacent frames are exactly identical.
Mean absolute adjacent change per sequence ranges 0.00089613–0.16923387 over all features.
This can reflect motion, detector jitter, tracking or missing blocks; it does not verify
linguistically meaningful motion or independence of recordings. Near-duplicates were not evaluated.

| Label path (preserved) | Sequences | Frames/sequence | Total frames |
|---|---:|---:|---:|
| `aboard` | 30 | 30 | 900 |
| `afternoon` | 30 | 30 | 900 |
| `bad` | 30 | 30 | 900 |
| `beside` | 30 | 30 | 900 |
| `byebye` | 30 | 30 | 900 |
| `camera` | 30 | 30 | 900 |
| `car` | 30 | 30 | 900 |
| `correct` | 30 | 30 | 900 |
| `deaf` | 30 | 30 | 900 |
| `evening` | 30 | 30 | 900 |
| `food` | 30 | 30 | 900 |
| `good` | 30 | 30 | 900 |
| `hello` | 30 | 30 | 900 |
| `house` | 30 | 30 | 900 |
| `i/me` | 30 | 30 | 900 |
| `iloveyou` | 30 | 30 | 900 |
| `lunch` | 30 | 30 | 900 |
| `man` | 30 | 30 | 900 |
| `marry` | 30 | 30 | 900 |
| `middle` | 30 | 30 | 900 |
| `morning` | 30 | 30 | 900 |
| `namaste` | 30 | 30 | 900 |
| `night` | 30 | 30 | 900 |
| `no` | 30 | 30 | 900 |
| `pen` | 30 | 30 | 900 |
| `place` | 30 | 30 | 900 |
| `please` | 30 | 30 | 900 |
| `practise` | 30 | 30 | 900 |
| `prisoner` | 30 | 30 | 900 |
| `sorry` | 30 | 30 | 900 |
| `strong` | 30 | 30 | 900 |
| `sweet` | 30 | 30 | 900 |
| `teacher` | 30 | 30 | 900 |
| `thanks` | 30 | 30 | 900 |
| `time` | 30 | 30 | 900 |
| `understand` | 30 | 30 | 900 |
| `water` | 30 | 30 | 900 |
| `week` | 30 | 30 | 900 |
| `woman` | 30 | 30 | 900 |
| `yes` | 30 | 30 | 900 |
| `you` | 30 | 30 | 900 |

`i/me` is a single nested label path (`MP_Data/i/me/0/0.npy`), not two classes.
A loader assuming exactly four path components silently loses 900 frames. Preserve the
original label and require human-confirmed semantic mapping; do not silently rename it
or interpret it as an approved pronoun variant.

## Landmark interpretation: strong evidence, unconfirmed schema

The dimension exactly matches classic Holistic concatenation:
`33*4 + 468*3 + 21*3 + 21*3 = 1662` (543 landmarks; pose includes visibility).
The [official legacy Holistic documentation](https://chuoling.github.io/mediapipe/solutions/holistic.html)
describes those outputs. Observed coordinate patterns and near-zero hand wrist z support
this interpretation. Neither dimension nor numerical plausibility proves the writer's ordering.

| Candidate slice | Interpretation | Entire block zero in frames |
|---|---|---:|
| `[0:132]` | 33 pose × x,y,z,visibility | 0 |
| `[132:1536]` | 468 face × x,y,z | 563 (1.53%) |
| `[1536:1599]` | 21 left hand × x,y,z | 18,572 (50.33%) |
| `[1599:1662]` | 21 right hand × x,y,z | 16,219 (43.95%) |

Thus the arrays very likely include pose, face and both hands. Slice meanings, left/right
semantics, mirroring, exact MediaPipe version/model/options, missing detection encoding,
coordinate conventions and capture timing remain unconfirmed. Zero block counts are
conditional on this layout; a zero block is not a verified hand-presence/confidence label.
The face block does not establish reliable facial expression recognition.

## Existing pipeline comparison

| Contract | Archive | Existing SignSpeak |
|---|---|---|
| Frame representation | 1,662 float64, likely raw Holistic | 128 hands-v1 features |
| Modalities | Likely pose + face + two hands | Tasks HandLandmarker; hands only |
| Hand normalization | Wrist x/y nonzero; apparently image coordinates | Subject Left then Right; wrist-centered, divided by wrist-to-landmark-9 length |
| Missing hands | Likely zero blocks | Explicit two presence bits + zero padding |
| Confidence | No documented handedness scores | Handedness quality threshold 0.7; exact expected hand count |
| Time | 30 ordinal frames; FPS/duration unknown | Independent IMAGE calls; browser 0.5–5 Hz polling plus request delay |
| Recognition | No model supplied | Per-frame sklearn probabilities; three-frame/dwell stabilizer |
| Provenance | External, unresolved byte-to-publisher link | Bundle requires browser_collection, dataset hash, reviewed vocabulary hash |

See `backend/app/detector.py`, `features.py`, `dataset.py`, `recognition.py`,
`vocabulary.py` and `frontend/collector.js`. Stabilization is not a temporal classifier.
A 30-frame window at nominal 2 Hz takes roughly 15 seconds (and longer with request
latency), so existing sampling cannot be assumed appropriate for natural signing.
The current normalizer removes global hand location and relative hand separation;
this can destroy meaningful motion even if a temporal network is later added.

Do not truncate 1,662 to 128, append synthetic presence/confidence metadata, relabel
external data as browser_collection, or relax model/vocabulary checks. A prospective
hands-only conversion requires confirmed offsets and side semantics, validation of
nondegenerate palm scale, explicit missingness and the same preprocessing at inference.
It still loses body/face/global trajectory cues and needs real webcam domain validation.
Standalone Tasks and legacy Holistic can have different detector/tracking distributions.

## Provenance and licensing

A matching-title [Mendeley Data V1 listing](https://data.mendeley.com/datasets/y8vg69brn2/1)
was checked on 2 November 2026: published 19 May 2022, DOI `10.17632/y8vg69brn2.1`;
contributors Kaushik Sanjiv Gurav, Shreya Jadhav, Aayushi Gandhi, Yash Khatri and Shweta Tiwaskar;
institution Vishwakarma Institute of Information Technology; licence CC BY 4.0.
The description reports laptop-webcam capture at 1280×720, varied lighting/backgrounds,
40 signs and 30 images, and explicitly describes static signs with no dynamic signs.
Its description differs from the observed 41 label paths and 30×30 arrays per label.
Treat it as a likely source, not authenticated provenance for these local bytes.
The publisher metadata API returned 403; no publisher file checksum/download record was obtained.
No archive-embedded licence or consent evidence exists. Obtain the original download URL,
publisher file identifier/checksum, extraction code, label definitions and recording protocol,
and resolve the count/description mismatch with the authors before relying on it.

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits sharing and adaptation,
including commercially, subject to attribution, a licence link and disclosure of changes.
If the local archive is confirmed to be the licensed release, retain title, all contributors,
DOI/version, licence and processing-change notice in dataset/model documentation and public
credits. A title match alone does not establish that licence applies to these bytes.
The licence does not itself establish participant consent or settle privacy/publicity rights.

## Recommended architecture and evaluation (proposal only)

Sequence classification is technically appropriate for `(30,1662)` inputs, but this dataset
currently supports investigation of isolated static-sign sequences, not a claim of dynamic
ISL recognition. Temporal ordering can encode motion if the data truly contains consecutive
frames of authentic dynamic signs. Here temporal changes plus filenames cannot establish
that, particularly against the publisher's explicit static-only description. It cannot
establish continuous signing, boundaries, coarticulation, grammar or sentence translation.

After provenance, schema and human review are resolved:

1. Start with a CPU baseline on masked, body-relative hand/selected-pose geometry: temporal
   means, standard deviations, endpoint displacement and valid-frame differences with a
   regularized linear classifier. Include a static pooled baseline to measure whether
   temporal features actually help. Fit scaling/feature selection on training data only.
2. Compare one small unidirectional GRU (32–64 hidden units), dropout and a class head;
   a similarly sized LSTM is an alternative. Use reviewed informative landmarks and
   presence/visibility masks; retain body-relative trajectories and inter-hand geometry.
   Keep dense face features out unless reviewed signs require them and a confirmed
   inference schema can reproduce them. At 1,230 sequences, a large stacked LSTM over
   all 1,662 dimensions risks overfitting and identity/background shortcuts.
3. Define a new versioned sequence schema and separately reviewed temporal vocabulary;
   do not bypass static-only hands-v1 admission. Confirm or reproduce extraction with
   compatible Tasks models, then validate paired controlled browser captures against
   the source conventions (mirroring, handedness, coordinate scale, missingness, timing).
4. Split whole original sequences before any windowing or augmentation. Never randomly
   split frames. Reserve signer/session groups for validation and untouched test data;
   ordinal sequence IDs are not signer IDs. Without signer metadata, a sequence split
   cannot substantiate unseen-person performance. Audit near-duplicate and overlap leakage.
5. Measure macro-F1, per-class metrics/confusions, unknown/no-sign false acceptance,
   dropout/occlusion robustness and live end-to-end latency on CPU. Use validation data
   for model selection/calibration/rejection thresholds, never the final test set.

No performance, CPU latency, model winner or dynamic-sign accuracy is established.
A GRU is a candidate to evaluate, not a validated deployment recommendation.

## Human safeguards and public-judge blockers

Keep raw ZIPs immutable and ignored by Git, record hashes, version future conversions,
fail on malformed arrays and preserve rejected/unknown states. Do not execute external
pickle/joblib, fabricate signer/session metadata or assert human inspection. The existing
registry remains unchanged with zero approved signs. Arrange individual review with an
ISL-competent human, preferably a Deaf ISL signer, against exact authoritative sign
references. Confirm each dataset label/variant, motion, hand count and nonmanual cues;
feature-only skeleton playback can assist review but cannot recover original appearance,
confirm identity/consent or substitute for source video when ambiguous. No ASL substitution.

Public independent use remains blocked by unresolved provenance/schema, no approved
vocabulary, no trained/evaluated compatible model, missing signer grouping and unverified
dynamic content. Separately the existing lab is documented as private/single-user with
one worker, no production authentication/multiuser persistence and no final public UI.
A judge-ready release needs stable HTTPS hosting, tested camera permission/onboarding,
clear capture guidance and reviewed reference examples, a bounded session-isolated temporal
buffer with gap/dropout resets and meaningful sampling, explicit start/end or validated
segmentation, CPU/concurrency benchmarks, honest unknown/error handling, privacy/attribution
information, mobile/browser checks and a no-camera demonstration path clearly labelled as
reference playback rather than live recognition. Keep dataset collection disabled for
ordinary judges unless deliberately enabled with informed consent and suitable storage.
These are future acceptance requirements; deployment was not attempted.

## Reproduce the read-only audit

```bash
.venv/bin/python scripts/inspect_sequence_zip.py \
  'data/raw/extracted/Dataset of Common phrases in Indian Sign Language/Dataset of Common phrases in Indian Sign Language.zip' \
  --output /tmp/signspeak-archive-audit.json
```

The inspector reads all arrays directly from ZIP with pickle disabled and emits aggregate
statistics and representative values; it does not train, convert, extract or change the
archive. `archive-audit.json` additionally records the separately checked outer ZIP hash
and the embedded/extracted inner hash match. Original raw data remains Git-ignored.
