# Phase 2D: real CPU extractor measured; training stopped at human review

2 November 2026. **Measurable progress:** legacy Holistic actually runs in an isolated,
pinned Python 3.12 environment and its real output passes the existing 1,662-feature
serializer. The working Tasks collector and its dependencies were not changed.
No real-data classifier was trained and independent webcam recognition remains unavailable.

## What ran

`experiments/holistic/requirements.lock.txt` pins the complete resolved environment:
MediaPipe 0.10.21, NumPy 1.26.4, OpenCV contrib 4.11.0.86 and transitive packages.
The Linux x86_64 wheel contains the legacy Holistic CPU graph and full pose model;
`model_complexity=1` avoids downloading the optional lite/heavy models at runtime.
The [versioned upstream implementation](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/mediapipe/python/solutions/holistic.py)
provides the legacy processor. It is legacy software, not a supported-current Tasks API.

The benchmark uses Google's public
[pose diagnostic image](https://storage.googleapis.com/mediapipe-assets/pose.jpg),
SHA256 `c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b`,
667×1000 RGB, plus blank frames and a separate flipped-input diagnostic. It repeats a
still image; it is not an ISL sample, real signing video, human sign review or webcam test.
The attempted `holistic.jpg` asset/repository URLs returned 404; this available official
image is explicitly recorded instead. No image is redistributed in Git.

`python -m scripts.benchmark_holistic` wraps a real processor in the existing
`HolisticAdapter`, exercises RGB extraction, and checks packed values against named
protobuf output. It records the hashes/sizes of 22 packaged model/graph assets and their
aggregate hash in the extraction contract. These are all packaged module assets, not a
claim that all 22 are loaded by Holistic. Exact options are recorded in the JSON report.

| Property | Observed result |
|---|---|
| Packing order | pose x,y,z,visibility → face x,y,z → left x,y,z → right x,y,z |
| Counts when detected | 33 pose, 468 face, 21 left hand, 21 right hand |
| Wire output | `(1662,)` float64; 30 frames stack to `(30,1662)`; all finite |
| Named-output packing | Exact equality with the real protobuf fields |
| Missing detection | Fresh blank-input graph returns all-zero packed frames |
| Tracking dropout | Face missing in 21/60 timed still-image frames; hands/pose present throughout |
| Side check | Named left/right hand wrists align more closely with same-side pose indices 15/16 than opposite wrists |

The face-dropout result initially failed a test that assumed face presence on every
frame. The corrected test requires an actual full detection, permits observed missing
face blocks, and still verifies counts, finiteness and packing. Missing landmarks must
remain explicit; a valid shape does not imply all required cues were detected.

Coordinates are the normalized-image outputs, not `pose_world_landmarks`. No clipping,
reordering, wrist normalization, zero interpolation, side swapping or iris truncation
occurs. The observed real-image coordinate ranges are in
[holistic-benchmark.json](dataset-inspection/holistic-benchmark.json). Face/hand z may be
negative and hand wrist z is near zero, consistent with the archive hypothesis. The
[legacy output documentation](https://chuoling.github.io/mediapipe/solutions/holistic.html)
describes image-relative x/y and local depth conventions. These checks reproduce a
plausible schema; they cannot identify the archive's original extractor/settings.

Mirroring is explicit: the v1 contract requires unmirrored detector pixels. The current
browser code draws the video directly to canvas and sends `mirrored:false`; no CSS mirror
is currently applied. The benchmark feeds original RGB unchanged; flipped pixels are
processed separately only as a diagnostic. Wrist/pose agreement does not establish
anatomical handedness on all cameras. Before collecting signs, have a human raise one
known left/right hand at a time and verify side labels with front/rear cameras and any
preview transformation. Archive mirror state remains unknown. Do not relabel its sides.

**Timing caveat:** pinned legacy `SolutionBase.process` advances graph timestamps by
33,333 µs per call to simulate 30 FPS, irrespective of actual browser capture cadence.
The benchmark runs unpaced for throughput; the contract's 100 ms field is only a
prospective capture target, not measured acquisition timing or known archive FPS.
Neither timing nor temporal smoothing compatibility is established. A 10 Hz browser
stream must be separately evaluated; do not silently repeat/drop frames to imitate 30 Hz.

## CPU measurements and external-host implications

Final stored run: Linux x86_64, AMD EPYC 7763, two visible CPUs. These are development-host
measurements, not a target-production-server benchmark.

| Measurement | Result |
|---|---:|
| Graph construction | 32.38 ms |
| Cold first frame | 225.90 ms |
| Warm per-frame extraction + serialization, 60 samples | p50 45.50 ms; p95 68.20 ms |
| Timed throughput | 60 frames / 2.921 s ≈ 20.5 frames/s |
| Process CPU time over timed interval | 4.130 s ≈ 1.41 CPU cores at saturation |
| Peak process RSS over benchmark and diagnostics | 400.36 MiB |
| All packaged model/graph files | 29,195,986 bytes (≈27.84 MiB) |

Peak RSS includes Python imports, OpenCV/MediaPipe/JAX and sequential diagnostic graph
allocations; it is not the trained classifier's memory size or a per-camera increment.
No classifier exists, so actual RF artifact size, model RSS and scoring latency are
**unmeasured**. There is no GPU delegate or GUI/webcam dependency in the benchmark;
XNNPACK CPU execution was observed. A 30×1662 float64 sequence alone is 398,880 bytes.

This can execute as a headless worker on an external Linux CPU server with the pinned
wheel and needed system libraries (`libgl1`, `libglib2.0-0t64` on Ubuntu 24.04). It must
remain a separate environment/service from the current Tasks API unless integration
is explicitly validated. For an initial external pilot, budget two vCPUs and 2 GiB RAM
for one active camera, then measure on that host; this is a starting budget, not a
capacity guarantee. Do not promise 30 FPS on this host: even warm p50 exceeds 33 ms.

The shortest public path after review/data gates is the browser → HTTPS Python API →
isolated Holistic CPU worker → the existing deterministic summary/RF scorer. HTTPS POST
is sufficient for explicit short takes; WSS is an optional transport, not a prerequisite.
Browsers need no local Python, shell commands or OpenCV. A reverse proxy can terminate
TLS for HTTPS/WSS and forward only to private Python workers. Keep timestamped takes,
backpressure and per-camera state; reset/drop a take on lost frames instead of concealing
loss. Codespaces is only the experiment host, not the final judge URL. No external
service was provisioned and no public inference endpoint was enabled in this phase.

Real camera movement, JPEG decoding, network RTT, model scoring, paced capture and
concurrency were excluded. Benchmark the entire proposed path on the external host
before claiming usable latency or increasing camera concurrency.

## Dataset provenance: further evidence, still unresolved

A successful [DataCite DOI API](https://api.datacite.org/dois/10.17632/y8vg69brn2.1)
lookup corroborates title, contributors, publication year and CC BY 4.0. It supplies no
content URL, file sizes, file checksum or class list. See the selected metadata and
response SHA256 in [source-check.json](dataset-inspection/source-check.json).
The Mendeley metadata and file APIs again returned HTTP 403. The
[official Mendeley page](https://data.mendeley.com/datasets/y8vg69brn2/1) still describes
40 static signs and excludes dynamic signs. No author was contacted.

The local archive still has 40 one-level label paths plus the complete nested `i/me`
label, each with 30×30 frames. There is no embedded class manifest explaining whether
this was an extra class, spelling convention or documentation error. Excluding `i/me`
would make the count 40 but would discard 900 real arrays without evidence. All 41 labels
remain preserved and unapproved. The prior local CRC/hash checks are not a remote release
checksum match. Obtain the original publisher file identifier/download record and source
extraction protocol or author clarification before relying on archive-trained predictions.

## Exact human review checklist — stop before training

The authoritative `data/metadata/vocabulary.json` is still `[]`. **Zero signs are approved.**
The small experiment is therefore prepared as a protocol only; no training command was
run on the archive or newly collected signs. Unit-test fixture fits are not real training.

For the shortest experiment, review **two distinct meanings** first. Suggested lookup
priorities are `hello`, `yes`, `no`; these are not claims that their variants are static,
suitable or authentic. Pick only those a human actually approves. For each chosen sign:

1. Find one exact official ISLRTC entry/video, not an index/channel URL. A human,
   preferably a Deaf ISL signer, personally watches the full sign and documents the
   variant. Compare the dataset's actual performance with this variant; label spelling
   alone is insufficient. If only features are available and the sign is ambiguous,
   mark dataset correspondence unresolved rather than approving it by inference.
2. Record all current `SignReview` fields: `label`, `verified`, `static`, `hand_count`,
   `reference_id`, exact HTTPS `reference_url`, reviewer pseudonym, `reviewed_on`,
   `human_inspected`, `official_source_confirmed`, `motion_required`,
   `facial_cues_required`, `body_cues_required`, `relative_hand_position_required`,
   `hands_v1_suitable` and notes describing what was observed.
3. With the existing conservative gate, admit only static signs whose essential cues
   survive hands-v1 normalization. Dynamic, facial/body-dependent or relative-position
   signs are excluded. Holistic's presence does not relax this vocabulary rule.
   Do not substitute ASL, approve from a word match, or assert review on a human's behalf.
4. Use the existing Human vocabulary review panel, export the actual individual decision,
   and apply it locally with `python -m scripts.review_sign <actual-review-file>
   --confirm-human-review`. Review the registry diff and restart. No sample review with
   fabricated approval is provided here.
5. For archive use, separately document an exact original-label → reviewed-label mapping,
   provenance, extraction layout, mirroring and capture protocol evidence tied to the
   contract hash. No automatic case/synonym mapping. Real signer IDs are required for
   signer-disjoint evaluation; sequence directory numbers are not signer identities.

All archive labels still require verification:
`aboard`, `afternoon`, `bad`, `beside`, `byebye`, `camera`, `car`, `correct`, `deaf`,
`evening`, `food`, `good`, `hello`, `house`, `i/me`, `iloveyou`, `lunch`, `man`, `marry`,
`middle`, `morning`, `namaste`, `night`, `no`, `pen`, `place`, `please`, `practise`,
`prisoner`, `sorry`, `strong`, `sweet`, `teacher`, `thanks`, `time`, `understand`,
`water`, `week`, `woman`, `yes`, `you`. Existing review-queue meanings outside this
archive are also unapproved; absence from this list is not approval.

After two labels pass review, use genuine consenting browser captures from the selected
extractor rather than guessing archive metadata. Predeclare capture timing and run an
asymmetric left/right-hand check. Collect balanced independent 30-frame takes, preserving
signer/session/take identities; do not split frames or adjacent windows across partitions.
For a small controlled pilot, target 4 signers × 2 reviewed labels × 10 independent takes
= 80 sequences, reserving whole people for development validation and untouched testing.
This is an experiment budget, not evidence of sufficient generalization. Keep final test
people out of model/threshold selection. Negative/no-sign/occlusion/transition examples
need separate validation and final tests. If fewer people are available, report the
limitation instead of manufacturing IDs or unseen-signer results.

Use the existing `fit_baseline`: 508 deterministic features, 100-tree depth-10 RF, seed 42,
single CPU thread. Its evidence and review checks remain intact. It emits research-only
scores and cannot serve live ISL labels. Webcam-domain validation and an empirically
validated rejection policy are prerequisites for any later live acceptance path; no
production unlock was added. The first real classifier must be measured for serialization
size, RSS delta, summary/scoring latency, macro-F1/per-class confusion and unknown false
accept/reject rates on reserved real webcam takes. Do not report archive closed-set
accuracy as a judge-webcam result.

## Verification and remaining blockers

- Existing environment: **84 tests passed**, three isolated real-extractor tests correctly
  skipped there; browser collector test passed. Existing Starlette/httpx warning remains.
- Isolated pinned environment: **3 real CPU compatibility tests passed**, run with the
  downloaded diagnostic image. Both environments pass `pip check`. Legacy protobuf and
  MediaPipe projection/feedback warnings were observed; tests and extraction completed.
- No real sign review, classifier fit, webcam-domain test, unknown rejection evaluation,
  external-host capacity benchmark or public judge acceptance test occurred.

The extractor execution blocker is removed for isolated CPU experiments. Exact archive
compatibility, provenance/40-versus-41 explanation, genuine sign approvals, real grouped
training data, timing/mirroring validation, classifier/rejection evaluation and actual
external HTTPS deployment remain blockers. Automated tests cannot clear these gates.
