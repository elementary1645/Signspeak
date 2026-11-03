"""hp-v1: hands + upper-body pose, temporal window features. Pure numpy.

Shared by training and live inference: the server computes every feature from raw
lm-v1 landmarks, so both paths run exactly this code. See docs/data_schema.md.

Per frame (FRAME_DIM = 152), subject LEFT slot then subject RIGHT slot:
  [0:126]    hand shape, 2 x 21 x 3 (hands-v1 math on pixel-isotropic coordinates)
  [126:134]  hand location, 2 x (wrist xy, index-tip xy) in the body frame
  [134:148]  upper body (nose, L/R shoulder, L/R elbow, L/R wrist) xy in the body frame
  [148:152]  flags: left present, right present, pose present, side-from-label fallback
Body frame: origin = shoulder midpoint, unit = shoulder width, pixel-isotropic, y down.
Missing data is zeros with a zero flag. Nothing is imputed.
"""
import numpy as np
from backend.app.features import hand_shape

SCHEMA = 'hp-v1'
FPS = 15
PERIOD_MS = 1000 / FPS
WINDOW = 24  # frames, ~1.6 s at 15 fps

POSE_NOSE, POSE_L_SHOULDER, POSE_R_SHOULDER = 0, 11, 12
POSE_L_WRIST, POSE_R_WRIST = 15, 16  # subject left / right
BODY_POINTS = (0, 11, 12, 13, 14, 15, 16)
MIN_SHOULDER_VISIBILITY = 0.5
# MediaPipe hand labels assume a mirrored (selfie) image. Our detector input is
# unmirrored, so the label names the subject's opposite hand. Only used without pose.
HANDEDNESS_LABEL_IS_MIRRORED = True
# MediaPipe Pose left/right landmark pairs, swapped by mirror().
POSE_PAIRS = ((1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16), (17, 18),
              (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32))

SHAPE = slice(0, 126)
LOCATION = slice(126, 134)
BODY = slice(134, 148)
FLAGS = slice(148, 152)
FRAME_DIM = 152
# shape mean/std/delta + location mean/std/delta/min/max + body mean/std/delta
# + location motion energy + shape motion energy + presence rates
SUMMARY_DIM = 126 * 3 + 8 * 5 + 14 * 3 + 8 + 2 + 4
assert SUMMARY_DIM == 474


def _pixels(points, frame):
    scale = np.array([frame['w'], frame['h'], frame['w']][:points.shape[1]], dtype=float)
    return points[:, :len(scale)] * scale


def body_frame(frame):
    """(origin, unit) in pixels from the shoulders, or None if pose is unusable."""
    pose = frame['pose']
    if pose is None or min(pose[POSE_L_SHOULDER, 3], pose[POSE_R_SHOULDER, 3]) < MIN_SHOULDER_VISIBILITY:
        return None
    shoulders = _pixels(pose[[POSE_L_SHOULDER, POSE_R_SHOULDER], :2], frame)
    width = np.linalg.norm(shoulders[0] - shoulders[1])
    if width < 1e-3 * frame['w']:
        return None
    return shoulders.mean(axis=0), width


def assign_sides(frame):
    """Return ([hand or None for subject left, subject right], from_label flag).

    Primary rule: nearest pose wrist (15 = subject left, 16 = subject right).
    Fallback without usable pose: the handedness label (flagged).
    """
    hands = frame['hands']
    slots = [None, None]
    if not hands:
        return slots, False
    if body_frame(frame) is not None:
        wrists = _pixels(frame['pose'][[POSE_L_WRIST, POSE_R_WRIST], :2], frame)
        hand_wrists = [_pixels(h['landmarks'][:1, :2], frame)[0] for h in hands]
        d = np.array([[np.linalg.norm(hw - pw) for pw in wrists] for hw in hand_wrists])
        if len(hands) == 1:
            slots[int(np.argmin(d[0]))] = hands[0]
        elif d[0, 0] + d[1, 1] <= d[0, 1] + d[1, 0]:
            slots = [hands[0], hands[1]]
        else:
            slots = [hands[1], hands[0]]
        return slots, False

    def label_side(hand):
        if hand['handedness'] is None:
            return None
        is_left_label = hand['handedness'] == 'Left'
        return 1 if is_left_label == HANDEDNESS_LABEL_IS_MIRRORED else 0

    sides = [label_side(h) for h in hands]
    if len(hands) == 2 and (sides[0] is None or sides[0] == sides[1]):
        # Ambiguous labels: in an unmirrored image the subject's right hand is on the image left.
        order = sorted(range(2), key=lambda i: hands[i]['landmarks'][0, 0])
        slots = [hands[order[1]], hands[order[0]]]
    else:
        for hand, side in zip(hands, sides):
            if side is None:
                side = 1 if hand['landmarks'][0, 0] < 0.5 else 0
            slots[side] = hand
    return slots, True


def frame_vector(frame):
    """One validated lm-v1 frame -> FRAME_DIM vector."""
    v = np.zeros(FRAME_DIM)
    slots, from_label = assign_sides(frame)
    reference = body_frame(frame)
    for i, hand in enumerate(slots):
        if hand is None:
            continue
        try:
            shape = hand_shape(_pixels(hand['landmarks'], frame))
        except ValueError:
            continue  # Degenerate palm: treat as missing, never guess
        v[i * 63:(i + 1) * 63] = shape.ravel()
        v[148 + i] = 1
        if reference is not None:
            origin, unit = reference
            points = _pixels(hand['landmarks'][[0, 8], :2], frame)
            v[126 + i * 4:126 + (i + 1) * 4] = ((points - origin) / unit).ravel()
    if reference is not None:
        origin, unit = reference
        points = _pixels(frame['pose'][list(BODY_POINTS), :2], frame)
        v[BODY] = ((points - origin) / unit).ravel()
        v[150] = 1
    v[151] = 1.0 if from_label else 0.0
    return v


def resample(frames, start_ms, count=WINDOW, vectors=None):
    """Nearest-frame resampling to a fixed 15 fps grid. No interpolation.

    A grid point with no raw frame within one period becomes an all-missing frame.
    `frames` are validated lm-v1 frames sorted by t_ms. `vectors`, if given, are their
    precomputed frame_vector() results (live buffer cache); the output is identical.
    """
    times = np.array([f['t_ms'] for f in frames], dtype=float)
    out = np.zeros((count, FRAME_DIM))
    if not len(times):
        return out
    cache = {}
    for k in range(count):
        target = start_ms + k * PERIOD_MS
        j = int(np.searchsorted(times, target))
        best = min((c for c in (j - 1, j) if 0 <= c < len(times)), key=lambda c: abs(times[c] - target))
        if abs(times[best] - target) <= PERIOD_MS:
            if best not in cache:
                cache[best] = vectors[best] if vectors is not None else frame_vector(frames[best])
            out[k] = cache[best]
    return out


def latest_window(frames, vectors=None):
    """Window ending at the newest frame (live inference)."""
    return resample(frames, frames[-1]['t_ms'] - (WINDOW - 1) * PERIOD_MS, vectors=vectors)


def take_windows(frames, offsets_ms=(0, 100, 200, 300, 400)):
    """Training windows from one take with small start-offset jitter. Same take = same group."""
    if not frames:
        return []
    first, last = frames[0]['t_ms'], frames[-1]['t_ms']
    span = (WINDOW - 1) * PERIOD_MS
    starts = [first + o for o in offsets_ms if first + o + span <= last + PERIOD_MS / 2]
    return [resample(frames, s) for s in (starts or [first])]


def _masked(x, mask):
    valid = x[mask]
    zero = np.zeros(x.shape[1])
    if not len(valid):
        return zero, zero, zero, zero, zero
    delta = valid[-1] - valid[0] if len(valid) > 1 else zero
    return valid.mean(axis=0), valid.std(axis=0), delta, valid.min(axis=0), valid.max(axis=0)


def _energy(x, mask):
    pairs = mask[1:] & mask[:-1]
    if not pairs.any():
        return np.zeros(x.shape[1])
    return np.abs(np.diff(x, axis=0)[pairs]).mean(axis=0)


def summarize(window, *, count=WINDOW):
    """WINDOW x FRAME_DIM -> SUMMARY_DIM fixed-length vector."""
    w = np.asarray(window, dtype=float)
    if w.shape != (count, FRAME_DIM) or not np.isfinite(w).all():
        raise ValueError(f'Expected finite window of shape {(count, FRAME_DIM)}')
    flags = w[:, FLAGS] > 0.5
    pose = flags[:, 2]
    shape_stats, loc_stats, shape_energy, loc_energy = [], [], [], []
    for i in range(2):
        hand = flags[:, i]
        shape = w[:, i * 63:(i + 1) * 63]
        mean, std, delta, _, _ = _masked(shape, hand)
        shape_stats.extend((mean, std, delta))
        pairs = hand[1:] & hand[:-1]
        shape_energy.append(np.linalg.norm(np.diff(shape, axis=0)[pairs], axis=1).mean() if pairs.any() else 0.0)
        location = w[:, 126 + i * 4:126 + (i + 1) * 4]
        loc_stats.extend(_masked(location, hand & pose))
        loc_energy.append(_energy(location, hand & pose))
    body_mean, body_std, body_delta, _, _ = _masked(w[:, BODY], pose)
    result = np.concatenate(shape_stats + loc_stats + [body_mean, body_std, body_delta]
                            + loc_energy + [np.array(shape_energy), w[:, FLAGS].mean(axis=0)])
    if result.shape != (SUMMARY_DIM,) or not np.isfinite(result).all():
        raise ValueError('Invalid hp-v1 summary')
    return result


def mirror_frame(frame):
    """Left-handed-signer augmentation: flip x, swap pose sides and hand labels."""
    def flip(points):
        out = points.copy()
        out[:, 0] = 1.0 - out[:, 0]
        return out
    pose = None
    if frame['pose'] is not None:
        pose = flip(frame['pose'])
        for a, b in POSE_PAIRS:
            pose[[a, b]] = pose[[b, a]]
    swap = {'Left': 'Right', 'Right': 'Left', None: None}
    hands = [dict(h, landmarks=flip(h['landmarks']), handedness=swap[h['handedness']]) for h in frame['hands']]
    return dict(frame, hands=hands, pose=pose)


def mirror(frames):
    return [mirror_frame(f) for f in frames]


def for_schema(schema):
    """Explicit version dispatch; an equal feature dimension never implies compatibility."""
    if schema == SCHEMA:
        import sys
        return sys.modules[__name__]
    if schema == 'hp-v2-8fps':
        from . import features8
        return features8
    raise ValueError(f'Unsupported feature schema: {schema}')
