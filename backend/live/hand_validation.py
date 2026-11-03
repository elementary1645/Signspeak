"""hand-evidence-v3: independent hand evidence, corroborative pose, explicit uncertainty,
and a face-zone entry rule that needs per-side history.

Mirrors browser handValidation.js; no image-space/mirroring transformation is performed.
Takes, training, features and the live session all use the same sequence verdict
(assess_sequence / HandEvidenceTracker): a single frame is a sequence with no history.
"""
import itertools
import json
from pathlib import Path
import numpy as np

POLICY = json.loads((Path(__file__).resolve().parents[2] / 'web/src/lib/handValidation.json').read_text())


def _assess_frame(frame, p):
    """Per-frame evidence. 'accepted' here is provisional: every rule except face entry."""
    pose = frame['pose']
    m = p['poseCoordinateMargin']
    def within(v, lo, hi):
        return v is not None and np.isfinite(v).all() and lo <= v[0] <= hi and lo <= v[1] <= hi
    def inside(v):
        return within(v, 0, 1)
    def pose_point(v):  # cropped-but-visible pose points; the hand wrist still needs [0, 1]
        return within(v, -m, 1 + m)
    def reliable(v):
        return pose_point(v) and v[3] >= p['minPoseVisibility']
    def distance(a, b):
        return float(np.linalg.norm((a[:2] - b[:2]) * [frame['w'], frame['h']]))
    width = distance(pose[11], pose[12]) if pose is not None and pose_point(pose[11]) and pose_point(pose[12]) else 0
    scale = width if width >= p['minShoulderWidthFraction'] * frame['w'] else None
    nose = pose[0] if pose is not None else None
    face_known = bool(reliable(nose) and scale is not None)
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
        raw.append(dict(index=i, hand=hand, shape=shape_ok, inside=inside(wrist), wrists=wrists, face_known=face_known,
                        scale=scale, palm=palm,
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
        elif not face_known:
            d['reason'] = 'face-reference-unavailable'
        else:
            side = {'Right': 0, 'Left': 1}.get(hand['handedness'])
            conflict = side is not None and any(j != side and w['reliable'] and w['normalized'] is not None
                and w['normalized'] <= p['identityConflictShoulders'] for j, w in enumerate(d['wrists']))
            duplicate = side is not None and any(j != i and best[j] is None and other['hand']['handedness'] == hand['handedness']
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
    return raw


def _empty_side():
    return dict(last_outside_face_ms=None, track_start_ms=None, last_seen_ms=None, face_entered=False,
                last_wrist=None, last_scale=None, last_palm=None)


STEP_MS = 125  # one frame at 8 FPS: maxTrackStepShoulders is per 125 ms of real time


def _continuity(st, d, t, frame, p):
    """Does this candidate plausibly continue the side's previous observation? Never looser on missing data."""
    if st['last_seen_ms'] is None:
        return 'new-track'
    if st['last_scale'] is None or d['scale'] is None:
        return 'restarted-no-scale'
    wrist = d['hand']['landmarks'][0]
    moved = float(np.hypot((wrist[0] - st['last_wrist'][0]) * frame['w'], (wrist[1] - st['last_wrist'][1]) * frame['h']))
    if moved / min(st['last_scale'], d['scale']) > p['maxTrackStepShoulders'] * (t - st['last_seen_ms']) / STEP_MS:
        return 'restarted-step'
    if max(d['palm'], st['last_palm']) > p['maxPalmScaleRatio'] * min(d['palm'], st['last_palm']):
        return 'restarted-palm'
    return 'continued'


class HandEvidenceTracker:
    """Per-side face-entry state across one ordered stream of frames.

    A face-zone candidate is accepted only if the same side was accepted outside the face
    zone at most faceEntryWindowMs before it entered, and that side has been tracked
    (provisionally accepted) since then with no gap longer than maxTrackGapMs, each step moving
    at most maxTrackStepShoulders per 125 ms and changing palm size by at most maxPalmScaleRatio.
    Any break restarts the track and loses the entry.
    """
    def __init__(self, options=None):
        self.p = dict(POLICY, **(options or {}))
        self.reset()

    def reset(self):
        self.last_t_ms = None
        self.sides = [_empty_side(), _empty_side()]

    def assess(self, frame):
        p, t = self.p, frame['t_ms']
        if self.last_t_ms is not None and not t > self.last_t_ms:
            self.reset()  # camera restart or clock jump
        self.last_t_ms = t
        gaps = []
        for i, st in enumerate(self.sides):
            gap = None if st['last_seen_ms'] is None else t - st['last_seen_ms']
            if gap is not None and gap > p['maxTrackGapMs']:
                self.sides[i] = _empty_side()
            gaps.append(gap)
        raw = _assess_frame(frame, p)
        for d in raw:
            d['face_entry'] = 'not-required'
            d['track_continuity'] = None
            if d['status'] != 'accepted':
                continue
            d['track_continuity'] = _continuity(self.sides[d['side']], d, t, frame, p)
            if d['track_continuity'].startswith('restarted'):
                self.sides[d['side']] = _empty_side()
            st = self.sides[d['side']]
            if d['near']:
                if st['face_entered'] or (st['last_outside_face_ms'] is not None
                                          and t - st['last_outside_face_ms'] <= p['faceEntryWindowMs']):
                    st['face_entered'] = True
                    d['face_entry'] = 'entered'
                else:
                    d.update(face_entry='missing', tracked_side=d['side'], status='uncertain',
                             reason='face-zone-without-entry', side=None, source=None)
            elif d['face_known']:
                st['last_outside_face_ms'] = t
                st['face_entered'] = False
            if st['track_start_ms'] is None:
                st['track_start_ms'] = t
            st['last_seen_ms'] = t
            st.update(last_wrist=d['hand']['landmarks'][0][:2].copy(), last_scale=d['scale'], last_palm=d['palm'])
        tracker = [dict(st, track_age_ms=None if st['track_start_ms'] is None else t - st['track_start_ms'], gap_ms=gaps[i])
                   for i, st in enumerate(self.sides)]
        return dict(frame=dict(frame, hands=[d['hand'] for d in raw if d['status'] == 'accepted']), candidates=raw,
                    uncertain=any(d['status'] == 'uncertain' for d in raw),
                    recordable=all(d['status'] == 'accepted' for d in raw), tracker=tracker)


def assess_hands(frame, options=None):
    """One frame with no history (what the first frame of a take gets)."""
    return HandEvidenceTracker(options).assess(frame)


def assess_sequence(frames, options=None):
    """The shared sequence verdict: takes, training, features and tests all call this."""
    tracker = HandEvidenceTracker(options)
    return [tracker.assess(frame) for frame in frames]


def filter_hands(frame, options=None):
    return assess_hands(frame, options)['frame']


def assignment(assessment):
    """(slots, any-handedness-sourced) for one assessment; never re-validates without history."""
    slots = [None, None]
    for d in assessment['candidates']:
        if d['status'] == 'accepted':
            slots[d['side']] = d['hand']
    return slots, any(d['status'] == 'accepted' and d['source'] == 'handedness' for d in assessment['candidates'])


def accepted_assignment(frame):
    return assignment(assess_hands(frame))


def require_accepted_hands(frames):
    for assessment in assess_sequence(frames):
        if not assessment['recordable']:
            reasons = sorted({d['reason'] for d in assessment['candidates'] if d['status'] != 'accepted'})
            raise ValueError('Rejected hand detection: uncertain or inconsistent hand evidence; not eligible for recording'
                             f' (t_ms={assessment["frame"]["t_ms"]}: {", ".join(reasons)})')
