"""hand-evidence-v2: independent hand evidence, corroborative pose, explicit uncertainty.

Mirrors browser handValidation.js; no image-space/mirroring transformation is performed.
"""
import itertools
import json
from pathlib import Path
import numpy as np

POLICY = json.loads((Path(__file__).resolve().parents[2] / 'web/src/lib/handValidation.json').read_text())


def assess_hands(frame, options=None):
    p = dict(POLICY, **(options or {}))
    pose = frame['pose']
    def inside(v):
        return v is not None and np.isfinite(v).all() and 0 <= v[0] <= 1 and 0 <= v[1] <= 1
    def reliable(v):
        return inside(v) and v[3] >= p['minPoseVisibility']
    def distance(a, b):
        return float(np.linalg.norm((a[:2] - b[:2]) * [frame['w'], frame['h']]))
    width = distance(pose[11], pose[12]) if pose is not None and inside(pose[11]) and inside(pose[12]) else 0
    scale = width if width >= p['minShoulderWidthFraction'] * frame['w'] else None
    nose = pose[0] if pose is not None else None
    face_known = reliable(nose) and scale is not None
    raw = []
    for i, hand in enumerate(frame['hands']):
        points = hand['landmarks']
        wrist = points[0]
        finite = points.shape == (21, 3) and np.isfinite(points).all()
        hand_scale = np.array([frame['w'], frame['h'], frame['w']])
        palm = float(np.linalg.norm((points[9] - wrist) * hand_scale)) if finite else 0
        palm_width = float(np.linalg.norm((points[5] - points[17]) * hand_scale)) if finite else 0
        a, b = (points[5] - wrist) * hand_scale, (points[17] - wrist) * hand_scale
        area = float(np.linalg.norm(np.cross(a, b)))
        shape_ok = bool(finite and palm >= p['minPalmPixels'] and palm_width >= p['minPalmPixels']
                        and area >= p['minPalmAreaRatio'] * palm * palm)
        wrists = []
        for side in range(2):
            sh, el, pw = (pose[k + side] for k in (11, 13, 15)) if pose is not None else (None, None, None)
            d = distance(wrist, pw) if pw is not None else None
            lengths = [distance(sh, el) / scale, distance(el, pw) / scale] if scale else []
            arm_ok = all(reliable(v) for v in (sh, el, pw)) and len(lengths) == 2 and all(
                p['minArmSegmentShoulders'] <= v <= p['maxArmSegmentShoulders'] for v in lengths)
            wrists.append(dict(reliable=bool(reliable(pw)), distance=d, normalized=d / scale if scale and d is not None else None,
                               supported=bool(arm_ok and d <= p['maxWristDistanceShoulders'] * scale)))
        raw.append(dict(index=i, hand=hand, shape=shape_ok, inside=inside(wrist), wrists=wrists,
                        near=bool(face_known and finite and any(distance(points[k], nose) <= p['faceRadiusShoulders'] * scale
                                  for k in (0, 5, 9, 13, 17))),
                        status='uncertain', reason='insufficient-evidence', side=None, source=None))
    choices = itertools.product((None, 0, 1), repeat=len(raw))
    best, best_key = (), (1, float('inf'))
    for sides in choices:
        chosen = [s for s in sides if s is not None]
        if len(chosen) != len(set(chosen)) or any(s is not None and not (
                raw[i]['shape'] and raw[i]['inside'] and raw[i]['wrists'][s]['supported']) for i, s in enumerate(sides)):
            continue
        key = (-len(chosen), sum(raw[i]['wrists'][s]['distance'] for i, s in enumerate(sides) if s is not None))
        if key < best_key:
            best, best_key = sides, key
    occupied = set(s for s in best if s is not None)
    for i, d in enumerate(raw):
        matched = best[i]
        hand = d['hand']
        if not d['inside'] or not d['shape']:
            d.update(status='rejected', reason='hand-wrist-outside-image' if not d['inside'] else 'invalid-hand-geometry')
        elif matched is not None:
            d.update(status='accepted', reason='pose-supported', side=matched, source='pose')
        elif not face_known or d['near']:
            d['reason'] = 'face-proximity-without-wrist-support' if d['near'] else 'face-reference-unavailable'
        else:
            side = {'Right': 0, 'Left': 1}.get(hand['handedness'])
            conflict = side is not None and any(j != side and w['reliable'] and w['normalized'] is not None
                and w['normalized'] <= p['identityConflictShoulders'] for j, w in enumerate(d['wrists']))
            duplicate = any(j != i and best[j] is None and other['hand']['handedness'] == hand['handedness']
                and other['hand']['score'] >= p['minFallbackHandednessScore'] for j, other in enumerate(raw))
            if p.get('allowHandednessFallback') is False:
                d['reason'] = 'legacy-model-needs-pose-identity'
            elif side is None or hand['score'] < p['minFallbackHandednessScore']:
                d['reason'] = 'ambiguous-handedness'
            elif conflict or duplicate or side in occupied:
                d['reason'] = 'identity-conflict'
            else:
                d.update(status='accepted', reason='hand-supported-pose-unavailable', side=side, source='handedness')
                occupied.add(side)
    return dict(frame=dict(frame, hands=[d['hand'] for d in raw if d['status'] == 'accepted']), candidates=raw,
                uncertain=any(d['status'] == 'uncertain' for d in raw), recordable=all(d['status'] == 'accepted' for d in raw))


def filter_hands(frame, options=None):
    return assess_hands(frame, options)['frame']


def accepted_assignment(frame):
    result = assess_hands(frame)
    slots = [None, None]
    for d in result['candidates']:
        if d['status'] == 'accepted':
            slots[d['side']] = d['hand']
    return slots, any(d['status'] == 'accepted' and d['source'] == 'handedness' for d in result['candidates'])


def require_accepted_hands(frames):
    for frame in frames:
        if not assess_hands(frame)['recordable']:
            raise ValueError('Rejected hand detection: uncertain or inconsistent hand evidence; not eligible for recording')
