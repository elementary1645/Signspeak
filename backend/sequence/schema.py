"""Explicit legacy Holistic wire layout, independent from hands-v1.

This defines our adapter, not an assertion about an undocumented external archive.
No flipping, reordering, iris truncation, world-coordinate conversion or imputation.
"""
from collections import deque
from dataclasses import dataclass, asdict
import hashlib
import json
import numpy as np

SCHEMA = 'holistic-1662-v1'
FRAMES = 30
DIM = 1662
BLOCKS = (('pose_landmarks', 33, 4), ('face_landmarks', 468, 3),
          ('left_hand_landmarks', 21, 3), ('right_hand_landmarks', 21, 3))


@dataclass(frozen=True)
class Contract:
    # Deliberately no defaults: callers must declare actual extraction conditions.
    extractor: str
    model_sha256: str
    options_json: str
    input_mirrored: bool
    sample_period_ms: int
    schema: str = SCHEMA
    coordinates: str = 'normalized-image-xyz;pose-visibility'
    handedness: str = 'subject-left-then-right'
    missing: str = 'whole-block-zero'

    def __post_init__(self):
        if (self.schema != SCHEMA or self.coordinates != 'normalized-image-xyz;pose-visibility'
                or self.handedness != 'subject-left-then-right' or self.missing != 'whole-block-zero'):
            raise ValueError('Unsupported extraction convention')
        if type(self.input_mirrored) is not bool or self.input_mirrored:
            raise ValueError('v1 requires unmirrored detector input; do not swap sides implicitly')
        if type(self.sample_period_ms) is not int or not 20 <= self.sample_period_ms <= 200:
            raise ValueError('Declare a capture period between 20 and 200 ms')
        if not self.extractor or len(self.model_sha256) != 64:
            raise ValueError('Extractor identity and model/configuration hash required')
        try:
            int(self.model_sha256, 16)
            options = json.loads(self.options_json)
        except (ValueError, TypeError) as exc:
            raise ValueError('Invalid hash or extractor options') from exc
        if not isinstance(options, dict):
            raise ValueError('Extractor options must be an object')
        if self.options_json != json.dumps(options, sort_keys=True, separators=(',', ':')):
            raise ValueError('Use canonical options JSON (sorted keys, compact separators)')

    @property
    def fingerprint(self):
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True).encode()).hexdigest()


def numeric(value, shape):
    raw = np.asarray(value)
    if raw.dtype.kind not in 'fiu' or raw.shape != shape:
        raise ValueError(f'Expected real numeric shape {shape}')
    a = raw.astype(np.float64)
    if not np.isfinite(a).all():
        raise ValueError('Nonfinite landmarks')
    return a


def frame(value):
    return numeric(value, (DIM,))


def sequence(value):
    return numeric(value, (FRAMES, DIM))


def pack_result(result):
    """Serialize legacy Holistic result attributes; None alone means missing.

    478-point Tasks faces are intentionally rejected rather than silently sliced.
    """
    pieces = []
    for name, count, width in BLOCKS:
        container = getattr(result, name)  # Missing attributes are errors, not no-detection.
        if container is None:
            pieces.append(np.zeros(count * width))
            continue
        points = container.landmark
        if len(points) != count:
            raise ValueError(f'{name}: expected {count} landmarks')
        fields = ('x', 'y', 'z', 'visibility')[:width]
        block = numeric([[getattr(p, key) for key in fields] for p in points], (count, width))
        if width == 4 and np.any((block[:, 3] < 0) | (block[:, 3] > 1)):
            raise ValueError('Pose visibility outside [0,1]')
        pieces.append(block.ravel())
    return frame(np.concatenate(pieces))


class HolisticAdapter:
    """Wrap an explicitly supplied legacy Holistic processor, one per stream.

    Caller owns CPU processor creation/configuration and close(); no model downloads.
    The installed Tasks HandLandmarker is NOT an acceptable processor.
    """
    def __init__(self, processor, contract):
        if not isinstance(contract, Contract):
            raise ValueError('Explicit extraction contract required')
        if not callable(getattr(processor, 'process', None)):
            raise ValueError('A legacy Holistic RGB processor is required')
        self.processor, self.contract = processor, contract

    def extract(self, rgb):
        a = np.asarray(rgb)
        if a.dtype != np.uint8 or a.ndim != 3 or a.shape[2] != 3 or a.size == 0:
            raise ValueError('Expected uint8 RGB image')
        return pack_result(self.processor.process(a))


class SequenceBuffer:
    """One camera / one explicit take. No overlapping windows or gap resampling.

    Timestamps are monotonic capture milliseconds, never server arrival time.
    Invalid input, gaps and missing hands reset the take. Restart after every 30 frames.
    """
    def __init__(self, contract):
        self.contract = contract
        self.frames = deque(maxlen=FRAMES)
        self.times = deque(maxlen=FRAMES)

    def reset(self):
        self.frames.clear()
        self.times.clear()

    def push(self, value, timestamp_ms, contract):
        try:
            if contract != self.contract or not isinstance(contract, Contract):
                raise ValueError('Extraction contract changed')
            if type(timestamp_ms) is not int or timestamp_ms < 0:
                raise ValueError('Invalid capture timestamp')
            a = frame(value)
            if not np.any(a[1536:]):
                self.reset()
                return None
            if self.times:
                delta = timestamp_ms - self.times[-1]
                if delta <= 0:
                    raise ValueError('Nonmonotonic capture timestamp')
                # +/-50% timing tolerance is explicit; no interpolation/repetition.
                if not .5 * contract.sample_period_ms <= delta <= 1.5 * contract.sample_period_ms:
                    self.reset()
            self.frames.append(a.copy())
            self.times.append(timestamp_ms)
            if len(self.frames) == FRAMES:
                output = sequence(np.stack(self.frames))
                self.reset()
                return output
            return None
        except (ValueError, TypeError):
            self.reset()
            raise
