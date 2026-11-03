"""All generated arrays/labels here are test fixtures, never ISL evaluation data."""
import base64
import json
import time
from types import SimpleNamespace
import joblib
import numpy as np
import pytest
import sklearn
from fastapi.testclient import TestClient
from backend.app import dataset, main
from backend.app.features import DIM, SCHEMA, normalize
from backend.app.recognition import Recognizer, Stabilizer, BUNDLE_VERSION, DEFAULT_POLICY
from backend.app.vocabulary import SignReview, fingerprint, verified_entries
from backend.training.audit import audit
from backend.training.train import load_records
from scripts.review_sign import apply_review
from backend.tests.test_foundation import reviewed, hand, record, image_bytes


@pytest.fixture
def two_reviews(reviewed):
    entries = list(dataset.vocabulary().values())
    entries.append(dict(entries[0], label='SECOND_FIXTURE', reference_id='second'))
    dataset.VOCABULARY.write_text(json.dumps(entries))
    return dataset.vocabulary()


class ProbabilityFixture:
    n_features_in_ = DIM
    classes_ = np.array(['SECOND_FIXTURE', 'TEST_FIXTURE'])

    def __init__(self, scores=(.05, .95)):
        self.scores = scores

    def predict_proba(self, x):
        return [self.scores]


def artifact(vocabulary, model=None):
    return {'bundle_version': BUNDLE_VERSION, 'model': model or ProbabilityFixture(),
            'schema': SCHEMA, 'labels': ['SECOND_FIXTURE', 'TEST_FIXTURE'],
            'metadata': {'feature_dim': DIM, 'sklearn_version': sklearn.__version__,
                'vocabulary_sha256': fingerprint(vocabulary), 'dataset_sha256': 'a'*64,
                'data_origin': 'browser_collection', 'confidence_kind': 'uncalibrated_forest_vote'},
            'rejection_policy': dict(DEFAULT_POLICY)}


def runtime(tmp_path, vocabulary, model=None, mutate=None):
    bundle = artifact(vocabulary, model)
    if mutate: mutate(bundle)
    path = tmp_path / 'fixture-only.joblib'
    joblib.dump(bundle, path)
    return Recognizer(path, vocabulary)


def test_explicit_human_review_required(reviewed):
    entry = next(iter(dataset.vocabulary().values()))
    for field in ['human_inspected', 'official_source_confirmed', 'reviewed_on', 'notes']:
        incomplete = dict(entry); del incomplete[field]
        with pytest.raises(ValueError): verified_entries([incomplete])
    with pytest.raises(ValueError): verified_entries([entry, entry])
    assert verified_entries([dict(label='HELLO', verified=False)]) == {}


@pytest.mark.parametrize('field,value', [('motion_required',True), ('facial_cues_required',True),
    ('body_cues_required',True), ('relative_hand_position_required',True), ('static',False),
    ('hands_v1_suitable',False), ('human_inspected',False), ('official_source_confirmed',False),
    ('verified','true'), ('reference_url','http://example.invalid'),
    ('reference_url','https://divyangjan.depwd.gov.in/islrtc/listpage.php?type=H'), ('reviewed_on','2099-01-01')])
def test_unsuitable_signs_cannot_be_admitted(reviewed, field, value):
    entry = next(iter(dataset.vocabulary().values()))
    with pytest.raises(ValueError): SignReview.model_validate(dict(entry, **{field:value}))


def test_review_import_is_individual_and_validated(reviewed, tmp_path):
    entry = next(iter(dataset.vocabulary().values()))
    new = dict(entry, label='SECOND_FIXTURE', reference_id='second')
    review_file = tmp_path / 'review.json'; review_file.write_text(json.dumps(new))
    apply_review(review_file, dataset.VOCABULARY)
    assert set(dataset.vocabulary()) == {'SECOND_FIXTURE','TEST_FIXTURE'}
    with pytest.raises(ValueError, match='Already approved'): apply_review(review_file, dataset.VOCABULARY)
    rejected = dict(new, label='DYNAMIC_FIXTURE', verified=False, static=False, motion_required=True)
    review_file.write_text(json.dumps(rejected)); apply_review(review_file, dataset.VOCABULARY)
    assert 'DYNAMIC_FIXTURE' not in dataset.vocabulary()


@pytest.mark.parametrize('mutate', [lambda b:b.update(bundle_version=1), lambda b:b.update(schema='old'),
    lambda b:b['metadata'].update(feature_dim=99), lambda b:b['metadata'].update(sklearn_version='old'),
    lambda b:b['metadata'].update(vocabulary_sha256='wrong'),
    lambda b:b['metadata'].update(data_origin='unconfirmed'),
    lambda b:b.update(labels=['TEST_FIXTURE','SECOND_FIXTURE']),
    lambda b:b.update(rejection_policy={'min_confidence':float('nan'),'min_margin':.15}),
    lambda b:b['metadata'].pop('confidence_kind')])
def test_model_compatibility(two_reviews, tmp_path, mutate):
    with pytest.raises(ValueError): runtime(tmp_path, two_reviews, mutate=mutate)


def test_revoked_review_invalidates_model(two_reviews, tmp_path):
    recognizer = runtime(tmp_path, two_reviews)
    assert recognizer.compatible_with(two_reviews)
    changed = {key:dict(value) for key,value in two_reviews.items()}
    changed['TEST_FIXTURE']['notes'] = 'Changed review requires retraining'
    assert not recognizer.compatible_with(changed)
    del changed['TEST_FIXTURE']
    assert not recognizer.compatible_with(changed)
    path = tmp_path / 'old.joblib'; joblib.dump(artifact(two_reviews), path)
    with pytest.raises(ValueError, match='revoked'): Recognizer(path, changed)


@pytest.mark.parametrize('scores,state', [((.05,.95),'candidate'), ((.3,.7),'unknown'), ((.5,.5),'unknown')])
def test_confidence_rejection(two_reviews, tmp_path, scores, state):
    recognizer = runtime(tmp_path, two_reviews, ProbabilityFixture(scores))
    prediction = recognizer.predict(normalize([hand()]))
    assert prediction['state'] == state
    assert prediction['classifier_latency_ms'] >= 0
    assert (prediction['label'] is not None) == (state == 'candidate')


@pytest.mark.parametrize('scores', [(float('nan'),.9), (-.1,1.1), (.1,.2), (.9,), (.1,.2,.7)])
def test_invalid_confidence_output(two_reviews, tmp_path, scores):
    recognizer = runtime(tmp_path, two_reviews, ProbabilityFixture(scores))
    with pytest.raises(ValueError): recognizer.predict(normalize([hand()]))


def test_expected_hand_count_and_feature_validation(two_reviews, tmp_path):
    recognizer = runtime(tmp_path, two_reviews)
    assert recognizer.predict(normalize([hand(),hand('Right')]))['state'] == 'unknown'
    for x in [[], [0]*DIM, [float('nan')]*DIM]:
        with pytest.raises(ValueError): recognizer.predict(x)


def candidate(label='TEST_FIXTURE', confidence=.95):
    return {'state':'candidate','label':label,'confidence':confidence}


def test_stability_smoothing_cooldown_and_release():
    smoother = Stabilizer()
    assert not smoother.update(candidate(confidence=.9), 0)['stable']
    assert not smoother.update(candidate(confidence=.95), .25)['stable']
    stable = smoother.update(candidate(confidence=1), .5)
    assert stable['stable'] and stable['event'] == 'TEST_FIXTURE'
    assert stable['smoothed_confidence'] == pytest.approx(.95)
    assert smoother.update(candidate(), 1)['event'] is None
    assert smoother.update(candidate(), 2)['event'] is None  # holding never repeats
    assert not smoother.update({'state':'no_hand','label':None}, 2.1)['stable']
    smoother.update(candidate(), 2.2); smoother.update(candidate(), 2.5)
    assert smoother.update(candidate(), 2.8)['event'] == 'TEST_FIXTURE'


def test_prediction_change_and_frame_gap_reset():
    smoother = Stabilizer()
    smoother.update(candidate(), 0); smoother.update(candidate(), .3)
    assert not smoother.update(candidate('SECOND_FIXTURE'), .6)['stable']
    smoother.update(candidate('SECOND_FIXTURE'), .9)
    assert smoother.update(candidate('SECOND_FIXTURE'), 1.2)['event'] == 'SECOND_FIXTURE'
    assert not smoother.update(candidate('SECOND_FIXTURE'), 4)['stable']
    assert not smoother.update({'state':'unknown','label':None}, 4.1)['stable']


def test_per_label_cooldown_across_different_signs():
    smoother = Stabilizer(frames=1, dwell_seconds=0)
    assert smoother.update(candidate(), 0)['event'] == 'TEST_FIXTURE'
    assert smoother.update(candidate('SECOND_FIXTURE'), .1)['event'] == 'SECOND_FIXTURE'
    assert smoother.update(candidate(), .2)['event'] is None
    assert smoother.update(candidate(), 1)['event'] is None
    assert smoother.update(candidate(), 2.1)['event'] == 'TEST_FIXTURE'


def test_dataset_recording_integrity_and_audit(reviewed, tmp_path):
    first = record()
    other = record(sample_id='other', signer_id='s2')
    path = tmp_path / 'data.jsonl'
    path.write_text(first.model_dump_json()+'\n'+other.model_dump_json())
    with pytest.raises(ValueError, match='Recording ID'): load_records(path)
    other = record(sample_id='other')
    path.write_text(first.model_dump_json()+'\n'+other.model_dump_json())
    with pytest.raises(ValueError, match='timestamp'): load_records(path)
    other = record(sample_id='other', timestamp_ms=20)
    path.write_text(first.model_dump_json()+'\n'+other.model_dump_json())
    quality = audit(path)
    assert quality['samples'] == 2 and quality['exact_duplicate_features'] == 1
    assert not quality['fixed_signer_split_ready'] and quality['warnings']


@pytest.fixture
def api(monkeypatch, tmp_path):
    class DetectorFixture:
        def detect(self, rgb): return [hand()]
        def close(self): pass
    monkeypatch.setattr(main, 'Detector', DetectorFixture)
    monkeypatch.setenv('MODEL_PATH', str(tmp_path/'absent.joblib'))
    with TestClient(main.app) as client:
        yield client


def request_frame(**changes):
    request = {'image':base64.b64encode(image_bytes()).decode(), 'timestamp_ms':10,
               'recognize':True, 'stream_id':'camera-1'}
    return dict(request, **changes)


def test_recognition_api_without_model_and_no_hands(api, monkeypatch):
    assert not api.get('/health').json()['recognition_ready']
    assert api.post('/frames',json=request_frame()).json()['prediction']['state'] == 'model_unavailable'
    monkeypatch.setattr(api.app.state.detector, 'detect', lambda rgb: [])
    result = api.post('/frames',json=request_frame()).json()
    assert result['prediction']['state'] == 'no_hand' and result['prediction']['label'] is None
    assert result['frame_latency_ms'] >= 0
    assert api.post('/frames',json=request_frame(stream_id='')).status_code == 422
    assert api.post('/frames',json=request_frame(collect=True)).status_code == 422


def test_recognition_api_failure_and_unreliable(api, monkeypatch):
    def fail(_): raise RuntimeError('fixture failure')
    api.app.state.recognizer = SimpleNamespace(compatible_with=lambda _:True, predict=fail)
    result = api.post('/frames',json=request_frame()).json()['prediction']
    assert result['state'] == 'error' and result['event'] is None
    low = hand(); low['handedness_score'] = .1
    monkeypatch.setattr(api.app.state.detector, 'detect', lambda rgb:[low])
    assert api.post('/frames',json=request_frame()).json()['prediction']['state'] == 'unreliable'
    monkeypatch.setattr(api.app.state.detector, 'detect', fail)
    assert api.post('/frames',json=request_frame()).status_code == 503
    assert api.post('/frames',json=request_frame(image='bad base64')).status_code == 422


def test_streams_are_isolated_and_revocation_resets(api, monkeypatch, two_reviews, tmp_path):
    api.app.state.recognizer = runtime(tmp_path, two_reviews)
    clock = [0.]
    monkeypatch.setattr(main, 'time', SimpleNamespace(monotonic=lambda:clock[0], perf_counter=time.perf_counter))
    def send(camera, now):
        clock[0] = now
        return api.post('/frames',json=request_frame(stream_id=camera)).json()['prediction']
    assert not send('camera-1',0)['stable']
    assert not send('camera-1',.3)['stable']
    assert not send('camera-2',.6)['stable']
    assert send('camera-1',.7)['event'] == 'TEST_FIXTURE'
    assert send('camera-1',1)['event'] is None
    dataset.VOCABULARY.write_text('[]')
    result = send('camera-1',1.3)
    assert result['state'] == 'model_incompatible' and result['stable_label'] is None


def test_collection_quality_and_cross_take_duplicates(api, reviewed, monkeypatch, tmp_path):
    monkeypatch.setenv('ENABLE_COLLECTION','1')
    monkeypatch.setenv('DATASET_PATH', str(tmp_path/'data.jsonl'))
    assert api.get('/dataset/quality').json()['samples'] == 0
    body = request_frame(recognize=False, collect=True, sign_class='TEST_FIXTURE',
                         signer_id='s1', session_id='day1', recording_id='take-1')
    assert api.post('/frames',json=body).json()['saved']
    body['recording_id'] = 'take-2'; body['timestamp_ms'] = 20
    assert not api.post('/frames',json=body).json()['saved']
    assert api.get('/dataset/quality').json()['samples'] == 1
    monkeypatch.setattr(api.app.state.detector,'detect',lambda rgb:[hand(),hand('Right')])
    assert api.post('/frames',json=body).status_code == 422  # sign expects one hand
    monkeypatch.setattr(api.app.state.detector,'detect',lambda rgb:[hand(),hand()])
    assert not api.post('/frames',json=body).json()['quality']['valid_landmarks']


def test_invalid_registry_api_fails_closed(api, reviewed):
    dataset.VOCABULARY.write_text('[{"label":"HELLO", "verified":true}]')
    assert api.get('/vocabulary').status_code == 503


def test_invalid_model_startup_keeps_preview_usable(monkeypatch, tmp_path):
    class DetectorFixture:
        def detect(self,rgb): return []
        def close(self): pass
    monkeypatch.setattr(main,'Detector',DetectorFixture)
    path = tmp_path/'bad.joblib'; path.write_bytes(b'invalid')
    monkeypatch.setenv('MODEL_PATH', str(path))
    with TestClient(main.app) as client:
        health = client.get('/health').json()
        assert health['detector_ready'] and not health['recognition_ready']
        assert client.post('/frames', json=request_frame()).status_code == 200
        for route in ['/review.js','/review-candidates']:
            assert client.get(route).status_code == 200


def test_margin_rejection_independent_of_confidence(two_reviews, tmp_path):
    recognizer = runtime(tmp_path, two_reviews, ProbabilityFixture((.45,.55)),
                         mutate=lambda b:b['rejection_policy'].update(min_confidence=.5))
    assert recognizer.predict(normalize([hand()]))['state'] == 'unknown'


@pytest.mark.parametrize('algorithm', ['rf','svm'])
def test_trained_bundle_roundtrip_and_scaler_isolation(two_reviews, tmp_path, algorithm, monkeypatch):
    from backend.training.train import train, split_records
    from sklearn.preprocessing import StandardScaler
    records = []
    for signer in range(8):
        for label,ref in [('TEST_FIXTURE','fixture'),('SECOND_FIXTURE','second')]:
            h = hand()
            h['landmarks'][8][1] += .01 * (signer+1) + (.3 if label == 'SECOND_FIXTURE' else 0)
            records.append(record(sign_class=label, vocabulary_reference_id=ref,
                signer_id=f's{signer}', sample_id=f'{signer}-{label}',
                recording_id=f'take-{signer}-{label}', features=normalize([h])))
    path = tmp_path/'fixture-data.jsonl'
    path.write_text('\n'.join(r.model_dump_json() for r in records))
    _, test, _ = split_records(records)
    test_rows = {tuple(records[i].features) for i in test}
    fits = []
    original_fit = StandardScaler.fit
    def spy_fit(self, x, *args, **kwargs):
        fits.append(np.asarray(x).tolist())
        return original_fit(self, x, *args, **kwargs)
    monkeypatch.setattr(StandardScaler, 'fit', spy_fit)
    output = tmp_path/'models'
    train(path, output, algorithm=algorithm, data_origin='test_fixture')
    with pytest.raises(ValueError, match='provenance'):
        Recognizer(output/'baseline.joblib', two_reviews)
    bundle = joblib.load(output/'baseline.joblib')
    # Alter declaration in this temporary fixture only, to exercise compatibility and inference.
    bundle['metadata']['data_origin'] = 'browser_collection'
    joblib.dump(bundle, output/'baseline.joblib')
    recognizer = Recognizer(output/'baseline.joblib', two_reviews)
    assert recognizer.predict(records[0].features)['state'] in ('candidate','unknown')
    if algorithm == 'svm':
        assert fits
        assert all(tuple(row) not in test_rows for batch in fits for row in batch)
        for fold in bundle['metadata']['calibration_groups']:
            assert not set(fold['fit']) & set(fold['calibration'])


def test_failed_dataset_write_is_safe(api, reviewed, tmp_path, monkeypatch):
    monkeypatch.setenv('ENABLE_COLLECTION','1')
    # A file used as a parent directory deterministically fails without OS permission tricks.
    parent = tmp_path/'not-a-directory'; parent.write_text('fixture')
    monkeypatch.setenv('DATASET_PATH', str(parent/'data.jsonl'))
    response = api.post('/frames',json=request_frame(recognize=False,collect=True,
        sign_class='TEST_FIXTURE',signer_id='s1',session_id='day1',recording_id='take-1'))
    assert response.status_code == 503
