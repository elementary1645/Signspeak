# Dataset schema hands-v1

One UTF-8 JSON object per line, validated by `backend.app.dataset.Record` on write and
training load. No image/video bytes are stored. File defaults to
`data/processed/samples.jsonl` (ignored by Git). Override with `DATASET_PATH`.

Fields: `schema_version`, `sign_class`, `signer_id`, `session_id`, `recording_id`,
`sample_id` (UUID on collection), `timestamp_ms` (browser Unix milliseconds),
`hand_count`, `features`, `handedness_scores`, `detection_threshold`,
`input_mirrored`, `vocabulary_reference_id`. Pseudonyms allow only letters, digits,
underscores and hyphens, 1–48 characters. Recording IDs group a collection take;
use the same signer pseudonym consistently across sessions to prevent leakage.

Features are 128 finite numbers: subject Left hand's 21 xyz coordinates flattened,
then subject Right hand's 21 xyz, then two presence bits in the same order. Each hand
is translated to wrist origin and divided by wrist-to-middle-MCP (landmark 9) 3D
length. Zero-length palms and duplicate handedness are rejected. Absent hands have
63 zero padding values and a zero mask bit; these are never genuine measurements.
No-hand frames are valid preview responses, but not labelled training records.

Camera capture sends unmirrored pixels, and preview/overlay are both unmirrored.
For external callers `mirrored=true` horizontally unflips pixels *before* detection.
MediaPipe's subject handedness defines slots. Neither hand is reflected into the other.
XYZ uses normalized image coordinates, not metric world coordinates. Per-hand centering
loses absolute body position and relative hand placement; this limits suitable vocabulary.
No rotation normalization is performed, preserving meaningful finger orientation.

Detection and presence thresholds are 0.7. The Tasks result exposes handedness scores,
not a per-landmark or exported palm confidence. Returned scores must not be described
as calibrated landmark confidence. Low handedness scores, duplicate sides, wrong expected
hand counts and invalid schemas cannot be saved. Schema changes require a new version
and recollection or explicit migration; never mix feature versions in training.

The server limits accepted samples for each signer/session/class (across recording takes) to at most
5 Hz, rejecting feature RMS changes below 0.015 versus the last accepted sample.
This is a sampling heuristic, not proof of independent examples. Use varied repetitions,
lighting, camera positions and multiple signers/sessions. A single recording's adjacent
frames must never be split randomly between training and testing. Default evaluation
holds out signers; session evaluation can overestimate generalization to unseen people.

All JSONL lines are validated; duplicate sample IDs are rejected by the training loader.
Labels must still match the reviewed registry. Store registry revisions alongside local
experiments. Metrics include split groups and sample counts. Local reports contain
pseudonyms and are ignored with model artifacts.


## Phase 2 integrity and review changes

The numeric record schema remains `hands-v1`; existing normalized coordinates are not
replaced. The reviewed registry now requires explicit human inspection, official-source
confirmation, dated review and per-cue suitability decisions. Legacy `verified: true`
entries without these attestations fail closed and must be actually reviewed, not
silently migrated into approval. There were no real approved entries at this migration.

Training now also rejects recording IDs reused across labels/signers/sessions and
repeated frame timestamps within the same take. The audit warns about exact duplicate
feature vectors across all records. Deduplication memory is keyed by signer/session/class,
so restarting a take does not reset the sampling filter; server restart still does.
Use globally unique recording IDs (browser UUIDs) and never reuse one for another take.

Model bundles use a separate `bundle_version: 2` with metadata and vocabulary hashes.
A bundle-version change does not change the underlying feature schema. Phase 1 bundles
must be retrained to supply the Phase 2 compatibility and confidence contract.
