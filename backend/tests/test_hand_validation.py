"""Shared synthetic geometry; never real recordings or sign-accuracy evidence."""
import json
from pathlib import Path
import numpy as np
import pytest
from backend.live import features, features8
from backend.live.hand_validation import POLICY, filter_hands
from backend.live.protocol import validate_frame
from backend.live.takes import validate_take
from backend.tests.live_fixtures import take

CASES = json.loads((Path(__file__).resolve().parents[2] / 'web/tests/fixtures/hand-validation.json').read_text())


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['name'])
def test_python_browser_fixture_parity(case):
    frame = validate_frame(case['frame'])
    accepted = filter_hands(frame)
    slots, _ = features.assign_sides(accepted)
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
    assert POLICY['policy'] == 'pose-wrist-v1'


def test_live_lower_stream_filters_before_buffer_and_frame_features(monkeypatch):
    from types import SimpleNamespace
    from backend.live.service import Session
    model = SimpleNamespace(features=features8)
    stream = Session(SimpleNamespace(model=model))
    # Avoid prediction so the assertion inspects ingress rather than a test classifier.
    monkeypatch.setattr('backend.live.service.PREDICT_EVERY', 3)
    stream.push(CASES[0]['frame'])
    assert stream.frames[-1]['hands'] == []
    assert not stream.vectors[-1][:134].any()
