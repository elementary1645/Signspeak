"""Synthetic geometry/timestamps only. These checks do not train a production model."""
import copy
from types import SimpleNamespace
import joblib
import numpy as np
import pytest
from backend.live import capture, features as F, features8 as F8, service, train, vocab
from backend.live.model import LiveModel
from backend.live.hand_validation import POLICY
from backend.live.protocol import validate_frames
from backend.live.takes import validate_take
from backend.tests import live_fixtures as X
from backend.tests.test_live import trained, synthetic_takes, registry  # noqa: F401

P = F8.CAPTURE_PROTOCOL


def take(fps=8, n=16):
    raw = X.take('NONE', 'synth8', kind='none')
    raw['capture_protocol'] = P
    # Reuse geometric test hands to verify side/shape math as well as timing.
    frames = X.gesture_frames('raise')[:n]
    for i, frame in enumerate(frames):
        frame['t_ms'] = round(1000 + i * 1000 / fps)
        for hand in frame['hands']:
            frame['pose'][16][:2] = hand['landmarks'][0][:2]
            frame['pose'][14][:2] = [(a + b) / 2 for a, b in zip(frame['pose'][12][:2], hand['landmarks'][0][:2])]
    raw['frames'] = frames
    return raw


@pytest.mark.parametrize('fps', [7, 7.5, 8, 8.8, 9, 9.2, 9.5])
def test_lower_rate_accepts_actual_laptop_rates(fps):
    raw = take(fps)
    timestamps = [f['t_ms'] for f in raw['frames']]
    meta, frames = validate_take(raw)
    assert meta['capture_protocol'] == P
    assert [f['t_ms'] for f in frames] == timestamps
    assert F8.latest_window(frames).shape == (16, 152)


@pytest.mark.parametrize('fps,n', [(5, 16), (6.9, 16), (10, 16), (15, 16), (8, 15), (8, 17)])
def test_lower_rate_rejects_incomplete_wrong_rate_and_count(fps, n):
    with pytest.raises(ValueError):
        validate_take(take(fps, n))


@pytest.mark.parametrize('delta', [-125, -130, -50, 75, float('nan')])
def test_lower_rate_rejects_duplicate_reordered_bursty_and_missing_frames(delta):
    raw = take()
    raw['frames'][5]['t_ms'] += delta
    with pytest.raises(ValueError):
        validate_take(raw)


def test_features_training_and_live_identical_with_jitter_and_mirror():
    raw = take()
    for i, f in enumerate(raw['frames']):
        f['t_ms'] += [0, 7, -5, 4][i % 4]
    meta, frames = validate_take(raw)
    vectors = [F.frame_vector(f) for f in frames]
    expected = np.asarray(vectors)
    assert np.array_equal(F8.take_windows(frames)[0], expected)
    assert np.array_equal(F8.latest_window(frames, vectors), expected)
    rows = train.build_windows([(meta, frames)], mirror_augment=True, feature_schema=F8.SCHEMA)
    assert rows['x'].shape == (2, 474)
    assert np.array_equal(rows['x'][0], F8.summarize(F8.latest_window(frames)))
    assert np.array_equal(rows['x'][1], F8.summarize(F8.latest_window(F.mirror(frames))))
    assert np.array_equal(expected[0], F.frame_vector(frames[0]))
    with pytest.raises(ValueError):
        F.summarize(expected)  # equal summary dimension does not make versions interchangeable
    with pytest.raises(ValueError):
        F8.summarize(np.zeros((24, 152)))


def test_no_implicit_protocol_conversion_or_mixed_training():
    lower = validate_take(take())
    legacy = copy.deepcopy(take())
    del legacy['capture_protocol']
    legacy = validate_take(legacy)
    for schema, takes in [(F.SCHEMA, [lower]), (F8.SCHEMA, [legacy]), (F8.SCHEMA, [lower, legacy])]:
        with pytest.raises(ValueError, match='incompatible'):
            train.build_windows(takes, feature_schema=schema)
    with pytest.raises(ValueError, match='Unsupported'):
        F.for_schema('hp-v3')


class RecordingModel:
    features = F8
    def __init__(self):
        self.windows = []
    def predict(self, window):
        self.windows.append(window.copy())
        return dict(label=None, confidence=0.5, margin=0.0, model_latency_ms=0, reason='none')


def session():
    model = RecordingModel()
    return service.Session(SimpleNamespace(model=model, status=lambda: {'ready': True})), model


def test_live_waits_for_all_16_source_frames_and_uses_training_representation(monkeypatch):
    monkeypatch.setattr(service, 'PREDICT_EVERY', 1)
    s, model = session()
    raw = take(9)
    for f in raw['frames'][:15]:
        assert s.push(f)['state'] == 'DETECTING'
    reply = s.push(raw['frames'][15])
    assert reply['state'] == 'UNKNOWN'
    assert len(model.windows) == 1
    expected = train.build_windows([validate_take(raw)], feature_schema=F8.SCHEMA)['x'][0]
    assert np.array_equal(F8.summarize(model.windows[0]), expected)


def test_live_refuses_slow_or_gapped_windows_and_recovers(monkeypatch):
    monkeypatch.setattr(service, 'PREDICT_EVERY', 1)
    for fps in [5, 15]:
        s, model = session()
        for f in take(fps)['frames']:
            reply = s.push(f)
        assert reply['code'] == 'INSUFFICIENT_TIMING' and not model.windows
        valid = take(8)
        for f in valid['frames']:
            f['t_ms'] += 5000
            reply = s.push(f)
        assert reply['state'] == 'UNKNOWN' and len(model.windows) == 1


@pytest.mark.parametrize('changes', [
    {'schema': 'hp-v3'}, {'schema': F8.SCHEMA}, {'capture_protocol': P},
    {'window': 16}, {'fps': 8}, {'accepted_capture_protocols': [P]},
    {'temporal': {}}, {'bundle_version': 'hp-live-1'},
])
def test_bundle_rejects_mismatched_version_protocol_or_timing(trained, tmp_path, changes):
    bundle = joblib.load(trained['model'])
    bundle.update(changes)
    path = tmp_path / 'bad.joblib'
    joblib.dump(bundle, path)
    with pytest.raises(ValueError):
        LiveModel(path, {})


def test_lower_manifest_selects_16_frame_representation(trained, tmp_path, monkeypatch):
    # A synthetic fixture classifier with 474 inputs; never a real-data model.
    from backend.app import dataset
    monkeypatch.setattr(dataset, 'VOCABULARY', trained['registry'])
    bundle = joblib.load(trained['model'])
    bundle.update(schema=F8.SCHEMA, capture_protocol=P, accepted_capture_protocols=[P],
                  temporal=capture.PROTOCOLS[P], window=16, fps=8, hand_validation=POLICY)
    path = tmp_path / 'synthetic8.joblib'
    joblib.dump(bundle, path)
    model = LiveModel(path, vocab.verified())
    assert model.features is F8
    assert model.info()['capture_protocol'] == P
    assert model.info()['fps'] == 8
    assert model.predict(F8.latest_window(validate_take(take())[1]))['reason']


def test_synthetic_lower_training_emits_explicit_manifest_and_live_model(registry, tmp_path, monkeypatch):
    import json
    from backend.app import dataset
    # The existing fixture has SYNTH_ labels and a temporary synthetic review registry.
    monkeypatch.setattr(dataset, 'VOCABULARY', registry)
    raws = synthetic_takes()
    for raw in raws:
        raw['capture_protocol'] = P
        raw['frames'] = raw['frames'][:16]
        for i, f in enumerate(raw['frames']):
            f['t_ms'] = 1000 + i * 125
            for hand in f['hands']:
                f['pose'][16][:2] = hand['landmarks'][0][:2]
                f['pose'][14][:2] = [(a + b) / 2 for a, b in zip(f['pose'][12][:2], hand['landmarks'][0][:2])]
    path = tmp_path / 'synthetic-only.jsonl'
    path.write_text('\n'.join(json.dumps(raw) for raw in raws))
    out = tmp_path / 'synthetic-only-model'
    summary, _ = train.train(path, out, candidates=('logistic_regression',), model_card=None,
                             max_latency_ms=10000, log=lambda *args: None, feature_schema=F8.SCHEMA)
    assert summary['schema'] == F8.SCHEMA
    assert summary['capture_protocol'] == P
    assert summary['accepted_capture_protocols'] == [P]
    assert summary['temporal'] == capture.PROTOCOLS[P]
    assert summary['window'] == 16 and summary['fps'] == 8
    assert json.loads((out / 'metrics.json').read_text())['bundle']['capture_protocol'] == P
    model = LiveModel(out / 'model.joblib', vocab.verified())
    assert model.features is F8
    assert model.predict(F8.latest_window(validate_take(raws[0])[1]))['reason']


def test_lower_protocol_status_ws_http_and_collection_validation(registry, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.live import api
    monkeypatch.setattr(service, 'MAX_RATE', 10000)
    monkeypatch.setattr(service, 'PREDICT_EVERY', 1)
    monkeypatch.setenv('ENABLE_COLLECTION', '1')
    monkeypatch.setattr(api, 'SERVER_TAKES', tmp_path / 'takes')
    model = RecordingModel()
    model.compatible_with = lambda admitted: True
    model.info = lambda: dict(schema=F8.SCHEMA, fps=8, window=16, capture_protocol=P, labels=[])
    raw = take(9)
    with TestClient(app) as client:
        app.state.live.model = model
        assert client.get('/api/status').json()['model']['capture_protocol'] == P
        assert client.get('/api/config').json()['capture_protocols'][P] == capture.PROTOCOLS[P]
        assert client.get('/api/config').json()['hand_validation'] == POLICY
        with client.websocket_connect('/ws/recognize') as ws:
            hello = ws.receive_json()
            assert hello['schema'] == F8.SCHEMA and hello['model']['fps'] == 8
            for f in raw['frames']:
                ws.send_json({'type': 'frame', 'frame': f})
                reply = ws.receive_json()
            assert reply['state'] == 'UNKNOWN'
        for frames in [raw['frames'][:10], raw['frames'][10:]]:
            body = client.post('/api/predict', json={'stream_id': 'lowerfpsstream', 'frames': frames}).json()
        assert body['replies'][-1]['state'] == 'UNKNOWN'
        assert len(model.windows) == 2 and np.array_equal(*model.windows)
        for fps, count in [(5, 16), (8, 15), (8, 17)]:
            assert client.post('/api/takes', json=take(fps, count)).status_code == 422
        assert not (tmp_path / 'takes').exists()
        assert client.post('/api/takes', json=raw).status_code == 200
        assert len(list((tmp_path / 'takes').glob('*.jsonl'))) == 1


def test_lower_model_requires_explicit_hand_observation_policy(trained, tmp_path):
    bundle = joblib.load(trained['model'])
    bundle.update(schema=F8.SCHEMA, capture_protocol=P, accepted_capture_protocols=[P],
                  temporal=capture.PROTOCOLS[P], window=16, fps=8)
    for bad in [None, {}, dict(POLICY, maxWristDistanceShoulders=0.9)]:
        bundle['hand_validation'] = bad
        path = tmp_path / 'missing-or-incompatible-policy.joblib'
        joblib.dump(bundle, path)
        with pytest.raises(ValueError, match='observation validation policy'):
            LiveModel(path, {})
