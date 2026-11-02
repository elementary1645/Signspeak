# Isolated legacy Holistic CPU experiment

Run from the repository root on Linux x86_64 / Python 3.12. The existing `.venv`
remains the Tasks collector environment. This separate environment runs extraction
checks only; it contains no fitted sign classifier or public inference server.

```bash
python3.12 -m venv /tmp/signspeak-holistic-venv
/tmp/signspeak-holistic-venv/bin/python -m pip install -r experiments/holistic/requirements.lock.txt
curl --fail --location https://storage.googleapis.com/mediapipe-assets/pose.jpg -o /tmp/signspeak-pose.jpg
MPLCONFIGDIR=/tmp/signspeak-mpl /tmp/signspeak-holistic-venv/bin/python -m scripts.benchmark_holistic \
  --image /tmp/signspeak-pose.jpg --output /tmp/signspeak-holistic-benchmark.json
MPLCONFIGDIR=/tmp/signspeak-mpl HOLISTIC_TEST_IMAGE=/tmp/signspeak-pose.jpg \
  /tmp/signspeak-holistic-venv/bin/python -m unittest experiments.holistic.test_compatibility -v
/tmp/signspeak-holistic-venv/bin/python -m pip check
```

Ubuntu 24.04 may need `python3.12-venv libgl1 libglib2.0-0t64` installed by the host
administrator. No GPU, display server, local webcam device or classifier is needed.
The script checks the diagnostic image SHA256 and the exact MediaPipe/NumPy versions.
The public image is a pose fixture, not a reviewed ISL sign. No downloaded image or
model binary is committed. Package versions are pinned; this is a pip freeze lock,
not a cryptographically hashed package supply-chain lock.

The result fingerprints all packaged model/graph assets and serializes raw normalized
legacy fields via `backend.sequence.schema.HolisticAdapter` / `pack_result`. Do not
reuse the resulting contract hash as evidence that the archive used this extractor.
The 100 ms proposed capture period is not a measured timestamp in this unpaced run;
legacy graph internals simulate a 33,333 µs tick per call. See [Phase 2D](../../docs/phase2d.md)
for measured limits, the human review checklist and blockers. Main-environment pytest
skips these real tests unless `HOLISTIC_TEST_IMAGE` is explicitly supplied; run them
with the isolated interpreter as above to exercise the actual CPU graph.
