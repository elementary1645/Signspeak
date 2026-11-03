"""SYNTHETIC lm-v1 fixtures for software tests only.

These are generated geometric shapes, NOT Indian Sign Language data, not recordings of
people and never evidence of recognition quality. Labels use a SYNTH_ prefix.
"""
import math
import uuid
import numpy as np

W, H = 640, 480


def pose(shift_x=0.0):
    """33x4 upper-body pose: subject left shoulder on the IMAGE RIGHT (unmirrored camera)."""
    p = np.zeros((33, 4))
    p[:, 3] = 0.9
    p[:, :2] = [0.5 + shift_x, 0.5]
    p[0, :2] = [0.5 + shift_x, 0.25]          # nose
    p[11, :2] = [0.62 + shift_x, 0.45]        # subject left shoulder
    p[12, :2] = [0.38 + shift_x, 0.45]        # subject right shoulder
    p[13, :2] = [0.68 + shift_x, 0.65]
    p[14, :2] = [0.32 + shift_x, 0.65]
    p[15, :2] = [0.66 + shift_x, 0.80]        # subject left wrist
    p[16, :2] = [0.34 + shift_x, 0.80]        # subject right wrist
    return p


def hand(wrist_xy, spread=1.0, curl=0.0, rng=None):
    """21x3 hand: a wrist plus five fanned fingers. `curl` bends finger tips back."""
    rng = rng or np.random.default_rng(0)
    pts = np.zeros((21, 3))
    pts[0, :2] = wrist_xy
    for f in range(5):
        angle = math.radians(-60 + 30 * f * spread)
        for j in range(4):
            r = 0.03 * (j + 1) * (1 - curl * (j >= 2) * 0.6)
            pts[1 + f * 4 + j, 0] = wrist_xy[0] + r * math.sin(angle)
            pts[1 + f * 4 + j, 1] = wrist_xy[1] - r * math.cos(angle)
            pts[1 + f * 4 + j, 2] = -0.01 * j
    return pts + rng.normal(0, 0.001, pts.shape)


def frame(t_ms, hands=(), with_pose=True, shift_x=0.0):
    return {'t_ms': t_ms, 'w': W, 'h': H,
            'hands': [{'landmarks': h.round(5).tolist(), 'handedness': label, 'score': 0.95}
                      for h, label in hands],
            'pose': pose(shift_x).round(5).tolist() if with_pose else None}


def gesture_frames(kind, start_ms=0, duration_ms=2000, fps=15, seed=0, shift_x=0.0):
    """Synthetic motion patterns. kind: circle | raise | still | none."""
    rng = np.random.default_rng(seed)
    out = []
    n = int(duration_ms / 1000 * fps)
    for k in range(n):
        t = start_ms + k * 1000 / fps + rng.uniform(-5, 5)
        phase = k / max(n - 1, 1)
        if kind == 'none':
            out.append(frame(t, (), shift_x=shift_x))
            continue
        if kind == 'circle':
            xy = (0.36 + 0.06 * math.cos(6.28 * phase) + shift_x, 0.6 + 0.06 * math.sin(6.28 * phase))
            h = hand(xy, curl=0.0, rng=rng)
        elif kind == 'raise':
            xy = (0.36 + shift_x, 0.8 - 0.4 * phase)
            h = hand(xy, curl=0.8, rng=rng)
        else:  # still, open palm low
            xy = (0.36 + shift_x, 0.75)
            h = hand(xy, spread=0.5, rng=rng)
        # Subject right hand, appearing on the image left; MediaPipe would label it 'Left'.
        out.append(frame(t, ((h, 'Left'),), shift_x=shift_x))
    return out


def take(label, signer, session='s1', kind='circle', seed=0, shift_x=0.0, reference_url=None):
    frames = gesture_frames(kind, start_ms=1000, seed=seed, shift_x=shift_x)
    return {'schema': 'lm-take-v1', 'frame_schema': 'lm-v1', 'take_id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'synthetic/{label}/{signer}/{session}/{seed}')),
            'label': label, 'signer_id': signer, 'session_id': session,
            'reference_url': reference_url, 'none_prompt': 'rest' if label == 'NONE' else None,
            'app_version': '0.3.0', 'recorded_at': '2026-11-03T10:00:00Z', 'capture_ms': 2000,
            'consent': True, 'preview_mirrored': True, 'frames': frames}
