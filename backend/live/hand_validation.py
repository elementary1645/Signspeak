"""Explicit observation quality gate, not a feature schema or a temporal resampler.

Mirrors browser handValidation.js. Pixel-isotropic wrist distances; no face exclusion zone.
"""
import json
from pathlib import Path
import numpy as np
from . import features

POLICY = json.loads((Path(__file__).resolve().parents[2] / 'web/src/lib/handValidation.json').read_text())


def filter_hands(frame, options=None):
    p = dict(POLICY, **(options or {}))
    pose = frame['pose']
    def inside(point):
        return point is not None and np.isfinite(point).all() and 0 <= point[0] <= 1 and 0 <= point[1] <= 1
    def reliable(point):
        return inside(point) and point[3] >= p['minPoseVisibility']
    def distance(a, b):
        return float(np.linalg.norm((a[:2] - b[:2]) * [frame['w'], frame['h']]))
    width = distance(pose[11], pose[12]) if pose is not None and reliable(pose[11]) and reliable(pose[12]) else 0
    remaining = list(frame['hands'])
    for _ in range(3):
        current = dict(frame, hands=remaining)
        slots, _ = features.assign_sides(current)
        accepted = []
        for hand in remaining:
            side = next((i for i, h in enumerate(slots) if h is hand), None)
            if side is None or width < p['minShoulderWidthFraction'] * frame['w']:
                continue
            shoulder, elbow, wrist = (pose[k + side] for k in (11, 13, 15))
            if not all(reliable(point) for point in (shoulder, elbow, wrist)) or not inside(hand['landmarks'][0]):
                continue
            lengths = (distance(shoulder, elbow) / width, distance(elbow, wrist) / width)
            if any(not p['minArmSegmentShoulders'] <= length <= p['maxArmSegmentShoulders'] for length in lengths):
                continue
            if distance(hand['landmarks'][0], wrist) / width > p['maxWristDistanceShoulders']:
                continue
            accepted.append(hand)
        if len(accepted) == len(remaining):
            break
        remaining = accepted
    return dict(frame, hands=remaining)


def require_accepted_hands(frames):
    """Fail closed at dataset ingress: rejected raw landmarks must never be persisted."""
    for frame in frames:
        if len(filter_hands(frame)['hands']) != len(frame['hands']):
            raise ValueError('Rejected hand detection: hand wrist needs a visible, plausible corresponding pose arm/wrist')
