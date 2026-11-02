"""Versioned shared training/inference features. Subject Left then Right slots."""
import numpy as np

SCHEMA = 'hands-v1'
DIM = 128  # 2 * 21 * xyz + 2 presence bits


def normalize(hands):
    slots = np.zeros((2, 21, 3), dtype=float)
    mask = [0, 0]
    for hand in hands:
        side = hand['side']
        if side not in ('Left', 'Right'):
            raise ValueError('Invalid handedness')
        index = ('Left', 'Right').index(side)
        points = np.asarray(hand['landmarks'], dtype=float)
        if points.shape != (21, 3) or not np.isfinite(points).all() or mask[index]:
            raise ValueError('Malformed landmarks or ambiguous duplicate handedness')
        centered = points - points[0]
        scale = np.linalg.norm(centered[9])
        if scale < 1e-6:
            raise ValueError('Degenerate palm scale')
        slots[index] = centered / scale
        mask[index] = 1
    return np.concatenate([slots.ravel(), mask]).tolist()
