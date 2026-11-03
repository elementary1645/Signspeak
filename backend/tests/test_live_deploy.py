"""Deployment-path checks: startup model download (MODEL_REPO), latency filter, stride env,
legacy detector switch, publish_model. Fixtures are SYNTHETIC (SYNTH_ labels)."""
import json
import shutil
import threading
import pytest
from fastapi.testclient import TestClient
from backend.app import dataset, main
from backend.live import features as F, remote, service
from backend.live import train as T
from backend.live.protocol import validate_frames
from backend.tests import live_fixtures as X
from backend.tests.test_live import (SIGNS, URL, entry, registry, synthetic_takes, trained,  # noqa: F401 (fixtures)
                                     write_registry, write_takes)


def fake_repo(trained, tmp_path, audio=True):
    """A local folder laid out like the private model repo."""
    repo = tmp_path / 'repo'
    repo.mkdir()
    shutil.copyfile(trained['model'], repo / 'model.joblib')
    shutil.copyfile(trained['model'].parent / 'metrics.json', repo / 'metrics.json')
    if audio:
        (repo / 'audio/SYNTH_CIRCLE').mkdir(parents=True)
        (repo / 'audio/manifest.json').write_text('{"version": 1, "entries": {}}')
        (repo / 'audio/SYNTH_CIRCLE/en.mp3').write_bytes(b'ID3' * 300)
    return repo


@pytest.fixture
def deploy_env(trained, tmp_path, monkeypatch):
    monkeypatch.setattr(dataset, 'VOCABULARY', trained['registry'])
    monkeypatch.setenv('LIVE_MODEL_PATH', str(tmp_path / 'installed/model.joblib'))
    monkeypatch.setattr(remote, 'AUDIO_DEST', tmp_path / 'served-audio')
    monkeypatch.setattr(service, 'MAX_RATE', 10_000)
    calls = []

    def use(repo_dir, gate=None, error=None):
        def fake_download(**kwargs):
            calls.append(kwargs)
            if gate:
                gate.wait(5)
            if error:
                raise error
            shutil.copytree(repo_dir, kwargs['local_dir'], dirs_exist_ok=True)
            return kwargs['local_dir']
        monkeypatch.setattr(remote, 'snapshot_download', fake_download)
    return {'tmp': tmp_path, 'use': use, 'calls': calls}


def test_startup_without_model_repo_is_honestly_untrained(deploy_env, monkeypatch):
    monkeypatch.delenv('MODEL_REPO', raising=False)
    with TestClient(main.app) as client:
        assert main.app.state.model_fetch is None
        assert client.get('/health').status_code == 200
        ready = client.get('/ready')
        assert ready.status_code == 503 and ready.json()['code'] == 'MODEL_NOT_TRAINED'
    assert deploy_env['calls'] == []


def test_startup_downloads_verifies_and_loads_without_blocking_health(deploy_env, trained, monkeypatch):
    gate = threading.Event()
    deploy_env['use'](fake_repo(trained, deploy_env['tmp']), gate=gate)
    monkeypatch.setenv('MODEL_REPO', 'someone/signspeak-model')
    monkeypatch.setenv('HF_TOKEN', 'hf_test_read_only')
    with TestClient(main.app) as client:
        assert client.get('/health').status_code == 200          # answered while the download is blocked
        assert client.get('/ready').json()['code'] == 'MODEL_LOADING'
        gate.set()
        main.app.state.model_fetch.join(10)
        assert client.get('/ready').status_code == 200
        assert client.get('/api/model').json()['trained'] is True
        assert client.get('/api/status').json()['model']['labels'] == list(SIGNS)
    call = deploy_env['calls'][0]
    assert call['repo_id'] == 'someone/signspeak-model' and call['repo_type'] == 'model' and call['token'] == 'hf_test_read_only'
    assert (deploy_env['tmp'] / 'installed/metrics.json').is_file()
    assert (deploy_env['tmp'] / 'served-audio/SYNTH_CIRCLE/en.mp3').is_file()


def test_incompatible_remote_bundle_is_not_installed(deploy_env, trained, monkeypatch):
    deploy_env['use'](fake_repo(trained, deploy_env['tmp'], audio=False))
    changed = json.loads(trained['registry'].read_text())
    changed[0]['notes'] = 'edited after training'  # vocabulary moved on since the bundle was trained
    registry_now = deploy_env['tmp'] / 'vocab-now.json'
    registry_now.write_text(json.dumps(changed))
    monkeypatch.setattr(dataset, 'VOCABULARY', registry_now)
    monkeypatch.setenv('MODEL_REPO', 'someone/signspeak-model')
    with TestClient(main.app) as client:
        main.app.state.model_fetch.join(10)
        body = client.get('/ready').json()
        assert body['code'] == 'MODEL_NOT_TRAINED' and 'could not use the published model' in body['detail']
        assert client.get('/api/model').json()['trained'] is False
    assert not (deploy_env['tmp'] / 'installed/model.joblib').exists()


def test_download_failure_keeps_not_trained(deploy_env, monkeypatch):
    deploy_env['use'](None, error=OSError('network unreachable'))
    monkeypatch.setenv('MODEL_REPO', 'someone/signspeak-model')
    with TestClient(main.app) as client:
        main.app.state.model_fetch.join(10)
        body = client.get('/ready').json()
        assert body['code'] == 'MODEL_NOT_TRAINED' and 'OSError' in body['detail']


def test_latency_filter_excludes_slow_models_and_records_latency(registry, tmp_path, monkeypatch):
    path = write_takes(tmp_path / 'takes.jsonl', synthetic_takes(per=2))
    fake_ms = {'random_forest': 25.0, 'logistic_regression': 0.5}
    monkeypatch.setattr(T, 'measure_latency', lambda name, model, x, repeats=30: fake_ms[name])
    monkeypatch.setattr(T, 'feature_latency', lambda frames, repeats=30: 1.0)
    bundle, metrics = T.train(path, tmp_path / 'm', candidates=('random_forest', 'logistic_regression'),
                              model_card=None, log=lambda *_: None, max_latency_ms=10)
    assert bundle['algorithm'] == 'logistic_regression'
    lat = metrics['latency']
    assert lat['ms_per_window'] == {'random_forest': 26.0, 'logistic_regression': 1.5}
    assert lat['excluded_for_latency'] == ['random_forest'] and lat['max_latency_ms'] == 10
    saved = json.loads((tmp_path / 'm/metrics.json').read_text())
    assert saved['metrics']['latency'] == lat
    with pytest.raises(T.TrainingError, match='max-latency-ms'):
        T.train(path, tmp_path / 'm2', candidates=('random_forest',), model_card=None, log=lambda *_: None, max_latency_ms=10)


def test_real_latency_measurement_is_positive(registry, tmp_path):
    path = write_takes(tmp_path / 'takes.jsonl', synthetic_takes(per=2))
    _, metrics = T.train(path, tmp_path / 'm', candidates=('logistic_regression',), model_card=None,
                         log=lambda *_: None, max_latency_ms=1000)
    ms = metrics['latency']['ms_per_window']['logistic_regression']
    assert 0 < ms < 1000 and metrics['latency']['feature_ms'] > 0


def test_predict_every_env(monkeypatch):
    for value, expected in (('3', 3), ('6', 6), ('0', 1), ('99', 15), ('abc', 3)):
        monkeypatch.setenv('PREDICT_EVERY', value)
        assert service.predict_every() == expected
    monkeypatch.delenv('PREDICT_EVERY')
    assert service.predict_every() == 3


def test_cached_frame_vectors_give_identical_windows():
    frames = validate_frames(X.gesture_frames('circle', start_ms=100, duration_ms=3000))
    vectors = [F.frame_vector(f) for f in frames]
    assert (F.latest_window(frames, vectors) == F.latest_window(frames)).all()


def test_legacy_detector_can_be_disabled(deploy_env, monkeypatch):
    monkeypatch.delenv('MODEL_REPO', raising=False)
    monkeypatch.setenv('LEGACY_DETECTOR', '0')
    monkeypatch.setattr(main, 'Detector', lambda: pytest.fail('legacy detector must not start'))
    with TestClient(main.app) as client:
        health = client.get('/health').json()
        assert health['detector_ready'] is False and 'LEGACY_DETECTOR=0' in health['detail']
        assert client.post('/frames', json={'image': '', 'timestamp_ms': 0}).status_code == 503


def test_publish_model_dry_run_and_guards(trained, monkeypatch, tmp_path, capsys):
    from scripts import publish_model
    monkeypatch.setattr(dataset, 'VOCABULARY', trained['registry'])
    monkeypatch.setenv('LIVE_MODEL_PATH', str(tmp_path / 'none/model.joblib'))
    with pytest.raises(SystemExit, match='No trained bundle'):
        publish_model.stage()
    monkeypatch.setenv('LIVE_MODEL_PATH', str(trained['model']))
    staging = publish_model.stage()
    try:
        assert {'model.joblib', 'metrics.json', 'README.md'} <= {p.name for p in staging.iterdir()}
    finally:
        shutil.rmtree(staging)
    changed = json.loads(trained['registry'].read_text())
    changed[0]['notes'] = 'edited after training'
    (tmp_path / 'v.json').write_text(json.dumps(changed))
    monkeypatch.setattr(dataset, 'VOCABULARY', tmp_path / 'v.json')
    with pytest.raises(SystemExit, match='Refusing to publish'):
        publish_model.stage()
