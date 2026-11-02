import base64
import io
import json
from types import SimpleNamespace
import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sklearn.ensemble import RandomForestClassifier
from backend.app import dataset, main
from backend.app.dataset import Record
from backend.app.detector import decode_image
from backend.app.features import DIM, normalize
from backend.training.train import load_records, split_records


def hand(side='Left'):
    return {'side': side, 'handedness_score': .95,
            'landmarks': [[i / 30, i / 50, i / 100] for i in range(21)]}


@pytest.fixture
def reviewed(monkeypatch, tmp_path):
    path = tmp_path / 'vocabulary.json'
    path.write_text(json.dumps([{'label':'TEST_FIXTURE', 'verified':True, 'static':True,
        'reference_url':'https://example.invalid/test-only', 'reviewer':'unit-test',
        'reference_id':'fixture', 'hand_count':1}]))
    monkeypatch.setattr(dataset, 'VOCABULARY', path)


def record(**changes):
    values = dict(sign_class='TEST_FIXTURE', signer_id='s1', session_id='day1', recording_id='r1',
        sample_id='id1', timestamp_ms=10, hand_count=1, features=normalize([hand()]),
        handedness_scores=[.95], detection_threshold=.7, input_mirrored=False,
        vocabulary_reference_id='fixture')
    values.update(changes)
    return Record(**values)


def test_dimensions_order_and_missing():
    assert normalize([]) == [0.] * DIM
    assert normalize([hand()])[-2:] == [1,0]
    assert normalize([hand('Right')])[-2:] == [0,1]
    assert normalize([hand(),hand('Right')]) == normalize([hand('Right'),hand()])


def test_translation_and_scale_invariant():
    first = normalize([hand()])
    other = hand()
    other['landmarks'] = (np.array(other['landmarks']) * 3 + 10).tolist()
    assert np.allclose(first, normalize([other]))
    assert first[:3] == [0,0,0]


@pytest.mark.parametrize('hands', [[hand(),hand()], [{'side':'Left','landmarks':[[0,0,0]]*21}],
    [{'side':'Left','landmarks':[[float('nan'),0,0]]*21}], [{'side':'Left','landmarks':[]} ]])
def test_bad_landmarks(hands):
    with pytest.raises(ValueError): normalize(hands)


def test_records(reviewed, tmp_path):
    r = record()
    assert len(r.features) == DIM
    path = tmp_path / 'samples.jsonl'
    path.write_text(r.model_dump_json() + '\n')
    assert load_records(path) == [r]
    path.write_text(r.model_dump_json() + '\n' + r.model_dump_json())
    with pytest.raises(ValueError, match='Duplicate'): load_records(path)


@pytest.mark.parametrize('changes', [{'features':[0]*127}, {'hand_count':2}, {'sign_class':'HELLO'},
    {'signer_id':'../name'}, {'handedness_scores':[.2]}, {'schema_version':'v0'},
    {'features':[float('nan')]*128}, {'vocabulary_reference_id':'wrong'}, {'timestamp_ms':-1}])
def test_invalid_records(reviewed, changes):
    with pytest.raises(ValueError): record(**changes)


def test_group_split():
    records = [SimpleNamespace(sign_class=c, signer_id=f's{s}', session_id='day')
               for s in range(8) for c in ['a','b']]
    train, test, groups = split_records(records)
    assert not set(groups[train]) & set(groups[test])
    assert np.array_equal(train, split_records(records)[0])
    with pytest.raises(ValueError): split_records(records[:2])


def test_model_roundtrip(tmp_path):
    # Synthetic numbers test serialization only, never reported as ISL evaluation.
    x = [[0]*DIM, [1]*DIM]
    model = RandomForestClassifier(n_estimators=2, random_state=42).fit(x, ['a','b'])
    path = tmp_path / 'model.joblib'
    joblib.dump({'model':model, 'schema':'hands-v1'}, path)
    assert list(joblib.load(path)['model'].predict(x)) == list(model.predict(x))


def image_bytes():
    stream = io.BytesIO()
    image = Image.new('RGB', (2,1)); image.putpixel((0,0), (255,0,0))
    image.save(stream, format='PNG')
    return stream.getvalue()


def test_decode_and_mirror():
    raw = image_bytes()
    assert np.array_equal(decode_image(raw, True), decode_image(raw)[:,::-1])
    with pytest.raises(ValueError): decode_image(b'garbage')


def test_api_collection(monkeypatch, tmp_path, reviewed):
    class FakeDetector:
        def detect(self, rgb): return [hand()]
        def close(self): pass
    monkeypatch.setattr(main, 'Detector', FakeDetector)
    destination = tmp_path / 'samples.jsonl'
    monkeypatch.setenv('DATASET_PATH', str(destination))
    monkeypatch.delenv('ENABLE_COLLECTION', raising=False)
    with TestClient(main.app) as client:
        assert client.get('/health').json()['detector_ready']
        assert client.get('/').status_code == 200
        request = dict(image=base64.b64encode(image_bytes()).decode(), timestamp_ms=10)
        assert client.post('/frames', json=request).json()['saved'] is False
        assert not destination.exists()
        request.update(collect=True, sign_class='TEST_FIXTURE', signer_id='s1', session_id='day1', recording_id='r1')
        assert client.post('/frames', json=request).status_code == 403
        monkeypatch.setenv('ENABLE_COLLECTION', '1')
        assert client.post('/frames', json=request).json()['saved'] is True
        assert client.post('/frames', json=request).json()['saved'] is False
        assert len(load_records(destination)) == 1
        request['sign_class'] = 'UNVERIFIED'
        assert client.post('/frames', json=request).status_code == 422
        monkeypatch.setattr(client.app.state.detector, 'detect', lambda rgb: [])
        result = client.post('/frames', json=request).json()
        assert not result['saved'] and result['features'] is None


def test_detector_failure(monkeypatch):
    def fail(): raise FileNotFoundError()
    monkeypatch.setattr(main, 'Detector', fail)
    with TestClient(main.app) as client:
        assert not client.get('/health').json()['detector_ready']
        assert client.post('/frames', json={'image':'', 'timestamp_ms':0}).status_code == 503


def test_training_artifacts(reviewed, monkeypatch, tmp_path):
    # Fixture classes verify the pipeline mechanics only; no real metrics are claimed.
    from backend.training.train import train
    entries = list(dataset.vocabulary().values())
    second = dict(entries[0], label='SECOND_FIXTURE', reference_id='second')
    dataset.VOCABULARY.write_text(json.dumps(entries + [second]))
    records = []
    for signer in range(8):
        for label, ref in [('TEST_FIXTURE','fixture'), ('SECOND_FIXTURE','second')]:
            records.append(record(sign_class=label, vocabulary_reference_id=ref,
                signer_id=f's{signer}', sample_id=f'{signer}-{label}'))
    path = tmp_path / 'fixture.jsonl'
    path.write_text('\n'.join(r.model_dump_json() for r in records))
    for algorithm in ['rf', 'svm']:
        output = tmp_path / algorithm
        metrics = train(path, output, algorithm)
        assert not set(metrics['train_groups']) & set(metrics['test_groups'])
        assert len(metrics['confusion_matrix']) == 2
        bundle = joblib.load(output / 'baseline.joblib')
        assert bundle['schema'] == 'hands-v1'
        assert len(bundle['model'].predict([records[0].features])) == 1
        assert json.loads((output / 'labels.json').read_text()) == metrics['labels']
