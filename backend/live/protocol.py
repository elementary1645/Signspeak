"""lm-v1: raw browser landmarks, one message per video frame. Never pixels.

{t_ms, hands:[{landmarks:[[x,y,z]x21], handedness, score}], pose:[[x,y,z,visibility]x33] | null, w, h}

x/y are MediaPipe normalized image coordinates of the UNMIRRORED camera image.
"""
import numpy as np

FRAME_SCHEMA = 'lm-v1'
MAX_HANDS = 2
COORD_LIMIT = 4.0  # MediaPipe may extrapolate slightly outside [0,1]; reject garbage


def _array(value, shape, name):
    try:
        a = np.asarray(value, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{name}: not numeric') from exc
    if a.shape != shape or not np.isfinite(a).all():
        raise ValueError(f'{name}: expected finite array of shape {shape}')
    return a


def validate_frame(raw):
    """Return a normalized frame dict with numpy arrays, or raise ValueError."""
    if not isinstance(raw, dict):
        raise ValueError('Frame must be an object')
    extra = set(raw) - {'t_ms', 'hands', 'pose', 'w', 'h'}
    if extra:
        raise ValueError(f'Unknown frame fields: {sorted(extra)}')
    t = raw.get('t_ms')
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not np.isfinite(t) or t < 0:
        raise ValueError('t_ms must be a non-negative number')
    w, h = raw.get('w'), raw.get('h')
    if any(isinstance(v, bool) or not isinstance(v, int) or not 16 <= v <= 4096 for v in (w, h)):
        raise ValueError('w/h must be integer pixel dimensions')
    hands_raw = raw.get('hands')
    if not isinstance(hands_raw, list) or len(hands_raw) > MAX_HANDS:
        raise ValueError('hands must be a list of at most two hands')
    hands = []
    for i, hand in enumerate(hands_raw):
        if not isinstance(hand, dict) or set(hand) - {'landmarks', 'handedness', 'score'}:
            raise ValueError(f'hands[{i}]: malformed hand')
        points = _array(hand.get('landmarks'), (21, 3), f'hands[{i}].landmarks')
        if np.abs(points[:, :2]).max() > COORD_LIMIT:
            raise ValueError(f'hands[{i}]: coordinates out of range')
        label = hand.get('handedness')
        if label not in ('Left', 'Right', None):
            raise ValueError(f'hands[{i}]: handedness must be Left, Right or null')
        score = hand.get('score', 0.0)
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 1:
            raise ValueError(f'hands[{i}]: score must be within [0,1]')
        hands.append({'landmarks': points, 'handedness': label, 'score': float(score)})
    pose = raw.get('pose')
    if pose is not None:
        pose = _array(pose, (33, 4), 'pose')
        if np.abs(pose[:, :2]).max() > COORD_LIMIT or (pose[:, 3] < 0).any() or (pose[:, 3] > 1).any():
            raise ValueError('pose: coordinates or visibility out of range')
    return {'t_ms': float(t), 'hands': hands, 'pose': pose, 'w': w, 'h': h}


def validate_frames(raws):
    """Validate a sequence; timestamps must strictly increase (one camera, one clock)."""
    frames = [validate_frame(r) for r in raws]
    times = [f['t_ms'] for f in frames]
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError('Frame timestamps must strictly increase')
    return frames
