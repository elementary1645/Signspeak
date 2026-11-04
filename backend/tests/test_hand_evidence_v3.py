"""hand-evidence-v3: pose edge margin and the face-zone entry rule.

laptop_capture_*.json are three real laptop diagnostics, stored with the signer's consent
under backend/tests/fixtures only. Their pose holds just the points the validator reads
(0 and 11-16); the other 30 pose slots are visibility-0 placeholders the validator ignores.
hand-sequences.json is synthetic (web/tests/fixtures/make-hand-sequences.mjs) and is asserted
identically by web/tests/web.test.mjs, so JS and Python give the same verdicts.
"""
import json
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pytest
from backend.live import features8
from backend.live.hand_validation import POLICY, HandEvidenceTracker, assess_hands, assess_sequence
from backend.live.protocol import validate_frame, validate_frames
from backend.live.takes import validate_take
from backend.tests.live_fixtures import take

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / 'fixtures'
SEQUENCES = json.loads((ROOT / 'web/tests/fixtures/hand-sequences.json').read_text())


def capture_frame(name):
    c = json.loads((FIXTURES / f'laptop_capture_{name}.json').read_text())
    pose = [[0.5, 0.5, 0, 0] for _ in range(33)]
    pose[0] = c['poseNose']
    pose[11], pose[12] = c['poseShoulders']
    pose[13], pose[14] = c['poseElbows']
    pose[15], pose[16] = (w['coordinates'] for w in c['raw'][0]['poseWrists'])
    return validate_frame({'t_ms': c['t_ms'], 'w': c['input']['width'], 'h': c['input']['height'], 'pose': pose,
                           'hands': [{'landmarks': r['landmarks'], 'handedness': r['handedness'], 'score': r['handednessScore']}
                                     for r in c['raw']]})


def verdict(assessment):
    if not assessment['candidates']:
        return None
    d = assessment['candidates'][0]
    return dict(status=d['status'], reason=d['reason'], side={0: 'L', 1: 'R'}.get(d['side'], '?'), faceEntry=d['face_entry'],
                continuity=d['track_continuity'])


def test_policy_v3_configuration():
    assert POLICY['policy'] == 'hand-evidence-v3'
    assert (POLICY['poseCoordinateMargin'], POLICY['faceEntryWindowMs'], POLICY['maxTrackGapMs'],
            POLICY['maxTrackStepShoulders'], POLICY['maxPalmScaleRatio']) == (0.5, 1500, 300, 0.6, 1.6)


@pytest.mark.parametrize('name', ['3_chin_hallucination', '2_face_hallucination'])
def test_real_capture_1_then_hallucination_125_ms_later_has_no_entry(name):
    real = capture_frame('1_real_hand')
    fake = dict(capture_frame(name), t_ms=real['t_ms'] + 125)
    a, b = (verdict(x) for x in assess_sequence([real, fake]))
    assert a == dict(status='accepted', reason='pose-supported', side='R', faceEntry='not-required', continuity='new-track')
    assert b == dict(status='uncertain', reason='face-zone-without-entry', side='?', faceEntry='missing', continuity='restarted-step')


def test_capture_1_real_raised_hand_with_cropped_shoulders_is_accepted_right():
    d = assess_hands(capture_frame('1_real_hand'))['candidates'][0]
    assert (d['status'], d['reason'], d['side'], d['near']) == ('accepted', 'pose-supported', 1, False)


@pytest.mark.parametrize('name', ['2_face_hallucination', '3_chin_hallucination'])
def test_face_hallucination_captures_alone_are_uncertain(name):
    result = assess_hands(capture_frame(name))
    d = result['candidates'][0]
    assert not result['recordable'] and not result['frame']['hands']
    assert (d['status'], d['reason'], d['near']) == ('uncertain', 'face-zone-without-entry', True)


@pytest.mark.parametrize('case', SEQUENCES, ids=lambda c: c['name'])
def test_sequences_match_hand_written_expectations(case):
    frames = validate_frames(case['frames'])
    assert [verdict(a) for a in assess_sequence(frames)] == case['expected']


def test_tracker_resets_on_clock_jump_and_reports_state():
    case = next(c for c in SEQUENCES if c['name'].startswith('(a) '))
    frames = validate_frames(case['frames'])
    tracker = HandEvidenceTracker()
    for f in frames:
        last = tracker.assess(f)
    right = last['tracker'][1]
    assert right['face_entered'] and right['track_age_ms'] == 1000 and right['gap_ms'] == 125
    assert right['last_outside_face_ms'] == 1625
    assert tracker.assess(dict(frames[-1], t_ms=500))['candidates'][0]['reason'] == 'face-zone-without-entry'


def take_with(frames, **meta):
    raw = take('NONE', 'synthetic_face', kind='none')
    raw.update(capture_protocol=features8.CAPTURE_PROTOCOL, frames=frames, **meta)
    return raw


def test_take_entry_must_happen_inside_the_take():
    inside = next(c for c in SEQUENCES if c['name'] == 'take: entry happens inside the take')
    meta, _ = validate_take(take_with(inside['frames'], hand_validation='hand-evidence-v3'))
    assert meta['hand_validation_current'] is True
    at_chin = next(c for c in SEQUENCES if c['name'] == 'take: starts with the hand already at the chin')
    with pytest.raises(ValueError, match='face-zone-without-entry'):
        validate_take(take_with(at_chin['frames'], hand_validation='hand-evidence-v3'))


def test_older_policy_takes_stay_readable_but_are_tagged():
    inside = next(c for c in SEQUENCES if c['name'] == 'take: entry happens inside the take')
    meta, _ = validate_take(take_with(inside['frames'], hand_validation='hand-evidence-v2'))
    assert meta['hand_validation'] == 'hand-evidence-v2' and meta['hand_validation_current'] is False


def test_features_keep_hands_the_sequence_accepted():
    inside = next(c for c in SEQUENCES if c['name'] == 'take: entry happens inside the take')
    frames = validate_frames(inside['frames'])
    window = features8.latest_window(frames)
    assert window[:, 149].all()  # subject-right slot present in every one of the 16 frames
    assert not features8.frame_vector(frames[-1])[149]  # the same frame alone has no entry


def live_session(monkeypatch):
    from backend.live.service import Session
    monkeypatch.setattr('backend.live.service.PREDICT_EVERY', 1000)
    return Session(SimpleNamespace(model=SimpleNamespace(features=features8), status=lambda: {'ready': True}))


def test_live_session_window_equals_take_window(monkeypatch):
    inside = next(c for c in SEQUENCES if c['name'] == 'take: entry happens inside the take')
    stream = live_session(monkeypatch)
    assert all(stream.push(raw) is None for raw in inside['frames'])
    live = features8.latest_window(list(stream.frames), list(stream.vectors), list(stream.assessments))
    assert np.array_equal(live, features8.latest_window(validate_frames(inside['frames'])))


def test_live_entry_history_survives_client_reset(monkeypatch):
    inside = next(c for c in SEQUENCES if c['name'] == 'take: entry happens inside the take')
    stream = live_session(monkeypatch)
    for i, raw in enumerate(inside['frames']):
        if i == 7:
            stream.reset()  # the browser sends 'reset' after uncertain frames; entry history must survive
        assert stream.push(raw) is None
    assert stream.assessments[-1]['candidates'][0]['face_entry'] == 'entered'


def test_live_session_without_entry_is_uncertain(monkeypatch):
    at_chin = next(c for c in SEQUENCES if c['name'] == 'take: starts with the hand already at the chin')
    stream = live_session(monkeypatch)
    assert stream.push(at_chin['frames'][0])['state'] == 'UNCERTAIN_HANDS'
