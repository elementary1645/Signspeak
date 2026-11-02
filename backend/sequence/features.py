"""Deterministic CPU summary, shared by fitting and scoring.

No learned transforms. Preserve image-relative trajectories and hand separation.
Dense face is deliberately excluded; current review gate only allows hands-v1 signs.
This is an initial baseline, susceptible to position/signer domain shift.
"""
import numpy as np
from .schema import sequence

FEATURE_SCHEMA = 'holistic-hand-stats-v1'
FEATURE_DIM = 2 * (63 * 4 + 2)  # mean/std/delta/abs motion + presence/valid-pair rates


def summarize(value):
    x = sequence(value)
    pieces = []
    for start in (1536, 1599):
        hand = x[:, start:start+63]
        present = np.any(hand != 0, axis=1)
        valid = hand[present]
        pairs = present[1:] & present[:-1]
        zero = np.zeros(63)
        mean = valid.mean(axis=0) if len(valid) else zero
        std = valid.std(axis=0) if len(valid) else zero
        # Endpoint displacement over first/last visible observations, not zero padding.
        displacement = valid[-1] - valid[0] if len(valid) > 1 else zero
        motion = np.abs(np.diff(hand, axis=0)[pairs]).mean(axis=0) if pairs.any() else zero
        pieces.extend((mean, std, displacement, motion, [present.mean(), pairs.mean()]))
    result = np.concatenate(pieces)
    if result.shape != (FEATURE_DIM,) or not np.isfinite(result).all():
        raise ValueError('Invalid sequence summary')
    return result
