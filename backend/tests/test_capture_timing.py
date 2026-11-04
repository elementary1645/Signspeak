"""Synthetic timestamps only; no training data or model changes."""
import pytest
from backend.live.takes import validate_take
from backend.tests.live_fixtures import take, frame


def sample(fps=15, count=26):
    raw = take('NONE', 'timing', kind='none')
    raw['capture_protocol'] = 'hp-v1-timed-1'
    raw['frames'] = [frame(round(1000 + i * 1000 / fps)) for i in range(count)]
    return raw


def test_timed_contract_accepts_real_rate():
    assert len(validate_take(sample())[1]) == 26
    assert len(validate_take(sample(count=24))[1]) == 24


@pytest.mark.parametrize('fps', [3, 8, 10, 20, 30])
def test_timed_contract_rejects_wrong_rate(fps):
    with pytest.raises(ValueError):
        validate_take(sample(fps))


def test_timed_contract_rejects_hole_even_at_good_average_rate():
    raw = sample()
    raw['frames'][5]['t_ms'] += 40
    with pytest.raises(ValueError, match='timing contract'):
        validate_take(raw)


def test_legacy_takes_remain_readable():
    raw = sample(fps=8)
    del raw['capture_protocol']
    assert validate_take(raw)


def test_worker_and_bundle_are_served_as_javascript(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.live import web
    monkeypatch.setattr(web, 'DIST', tmp_path)
    (tmp_path / 'mediapipe').mkdir()
    (tmp_path / 'tracker-worker.js').write_text('self.onmessage = () => {};')
    (tmp_path / 'mediapipe/vision_bundle.cjs').write_text('exports.test = true;')
    with TestClient(app) as client:
        for path in ['/tracker-worker.js', '/mediapipe/vision_bundle.cjs']:
            response = client.get(path)
            assert response.status_code == 200
            assert response.headers['content-type'].startswith('application/javascript')
