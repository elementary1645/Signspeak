"""Shared synthetic geometry; never real recordings or sign-accuracy evidence."""
import json
from pathlib import Path
import numpy as np
import pytest
from backend.live import features, features8
from backend.live.hand_validation import POLICY, filter_hands, assess_hands, accepted_assignment
from backend.live.protocol import validate_frame
from backend.live.takes import validate_take
from backend.tests.live_fixtures import take

CASES = json.loads((Path(__file__).resolve().parents[2] / 'web/tests/fixtures/hand-validation.json').read_text())


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['name'])
def test_python_browser_fixture_parity(case):
    frame = validate_frame(case['frame'])
    accepted = filter_hands(frame)
    slots, _ = accepted_assignment(accepted)
    sides = ['L' if slots[0] is h else 'R' for h in accepted['hands']]
    assert sides == case['sides']


def test_rejected_landmarks_cannot_reach_lower_features_even_through_cache():
    raw = CASES[0]['frame']
    frame = validate_frame(raw)
    assert np.any(features.frame_vector(frame)[:126])  # proves fixture would previously enter features
    assert not features8.frame_vector(frame)[:134].any()
    frames = [dict(frame, t_ms=1000 + i * 125) for i in range(16)]
    unsafe_cache = [features.frame_vector(f) for f in frames]
    assert not features8.latest_window(frames, unsafe_cache)[:, :134].any()
    raw_take = take('NONE', 'synthetic_face', kind='none')
    raw_take.update(capture_protocol=features8.CAPTURE_PROTOCOL, frames=[dict(raw, t_ms=1000 + i * 125) for i in range(16)])
    with pytest.raises(ValueError, match='Rejected hand detection'):
        validate_take(raw_take)
    raw_take['frames'] = [dict(f, hands=[]) for f in raw_take['frames']]
    assert validate_take(raw_take)  # real no-hand samples remain valid, never fabricate source frames


def test_geometry_configuration_is_explicit():
    frame = validate_frame(CASES[2]['frame'])
    frame['hands'][0]['landmarks'][0, 0] += .1
    assert len(filter_hands(frame)['hands']) == 1
    assert not filter_hands(frame, {'maxWristDistanceShoulders': .2})['hands']
    assert POLICY['policy'] == 'hand-evidence-v2'


def test_live_lower_stream_filters_before_buffer_and_frame_features(monkeypatch):
    from types import SimpleNamespace
    from backend.live.service import Session
    model = SimpleNamespace(features=features8)
    stream = Session(SimpleNamespace(model=model, status=lambda: {'ready': True}))
    # Avoid prediction so the assertion inspects ingress rather than a test classifier.
    monkeypatch.setattr('backend.live.service.PREDICT_EVERY', 3)
    reply = stream.push(CASES[0]['frame'])
    assert reply['state'] == 'UNCERTAIN_HANDS'
    assert not stream.frames and not stream.vectors


@pytest.mark.parametrize('name', ['left raised above shoulder', 'right raised above shoulder', 'both hands raised',
                                'unreliable shoulders reported regression pattern', 'raised hand with missing pose wrist confidence'])
def test_raised_hands_use_explicit_fallback_without_rewriting_pose(name):
    raw = next(c['frame'] for c in CASES if c['name'] == name)
    frame = validate_frame(raw)
    pose = frame['pose'].copy()
    result = assess_hands(frame)
    assert result['recordable']
    assert all(d['source'] == 'handedness' for d in result['candidates'])
    vector = features8.frame_vector(frame)
    assert vector[151] == 1
    assert vector[148:150].sum() == len(frame['hands'])
    assert np.array_equal(frame['pose'], pose)


@pytest.mark.parametrize('name', ['face false positive despite high handedness score', 'no pose wrists',
                                'face proximity and missing wrists are uncertain'])
def test_uncertain_is_not_absence_and_never_recordable(name):
    result = assess_hands(validate_frame(next(c['frame'] for c in CASES if c['name'] == name)))
    assert result['uncertain'] and not result['recordable']
    assert not result['frame']['hands']


def test_live_uncertainty_clears_previous_accepted_history(monkeypatch):
    from types import SimpleNamespace
    from backend.live.service import Session
    monkeypatch.setattr('backend.live.service.PREDICT_EVERY', 3)
    stream = Session(SimpleNamespace(model=SimpleNamespace(features=features8), status=lambda: {'ready': True}))
    raised = next(c['frame'] for c in CASES if c['name'] == 'right raised above shoulder')
    stream.push(raised)
    assert stream.frames and stream.vectors[-1][149] == 1 and stream.vectors[-1][151] == 1
    reply = stream.push(dict(CASES[0]['frame'], t_ms=1125))
    assert reply['state'] == 'UNCERTAIN_HANDS'
    assert not stream.frames and not stream.vectors


def test_live_and_training_fallback_slots_and_flags_are_identical(monkeypatch):
    from types import SimpleNamespace
    from backend.live.service import Session
    from backend.live.train import build_windows
    from backend.live.protocol import validate_frames
    monkeypatch.setattr('backend.live.service.PREDICT_EVERY', 15)
    raw = next(c['frame'] for c in CASES if c['name'] == 'both hands raised')
    frames = validate_frames([dict(raw, t_ms=1000 + i * 125) for i in range(16)])
    cached = [features8.frame_vector(f) for f in frames]
    direct = features8.latest_window(frames)
    assert np.array_equal(features8.latest_window(frames, cached), direct)
    meta = dict(capture_protocol=features8.CAPTURE_PROTOCOL, label='NONE', take_id='synthetic', signer_id='s', session_id='s1')
    training = build_windows([(meta, frames)], feature_schema=features8.SCHEMA)['x'][0]
    assert np.array_equal(training, features8.summarize(direct))


def test_uncertainty_never_bypasses_model_incompatibility(monkeypatch):
    from types import SimpleNamespace
    from backend.live.service import Session
    stream = Session(SimpleNamespace(model=SimpleNamespace(features=features8),
        status=lambda: dict(ready=False, code='MODEL_INCOMPATIBLE', detail='Vocabulary changed')))
    reply = stream.push(CASES[0]['frame'])
    assert reply['state'] == 'ERROR' and reply['code'] == 'MODEL_INCOMPATIBLE'
    assert reply['model_ready'] is False and reply['label'] is None


def test_model_becoming_ready_cannot_reuse_legacy_cached_identity(monkeypatch):
    from types import SimpleNamespace
    from backend.live.service import Session
    monkeypatch.setattr('backend.live.service.PREDICT_EVERY', 15)
    service = SimpleNamespace(model=None)
    stream = Session(service)
    raw = next(c['frame'] for c in CASES if c['name'] == 'left raised above shoulder')
    stream.push(raw)
    assert stream.vectors[-1][151] == 0  # legacy pose rule before any model is available
    service.model = SimpleNamespace(features=features8)
    stream.push(dict(raw, t_ms=1125))
    assert len(stream.frames) == 1 and stream.frames[0]['t_ms'] == 1125
    assert stream.vectors[-1][151] == 1  # independent-hand route; old cached flag not reused
