"""Phase 3 (hp-v1) software checks. Every dataset here is SYNTHETIC (see live_fixtures.py):
generated geometry with SYNTH_ labels, never ISL data and never evidence of accuracy."""
import json
import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend.app import dataset, main
from backend.app.vocabulary import check_reference_url, verified_entries
from backend.live import api, features as F, service, vocab
from backend.live.model import LiveModel, decide
from backend.live.protocol import validate_frame, validate_frames
from backend.live.takes import validate_take
from backend.live.train import TrainingError, train
from backend.tests import live_fixtures as X
from scripts import merge_takes, verify_sign

SIGNS = ('SYNTH_CIRCLE', 'SYNTH_RAISE')
URL = 'https://example.invalid/synthetic/{}'


def entry(label, **changes):
    base = {'label': label, 'pipeline': 'hp-v1', 'verified': True, 'reference_url': URL.format(label),
            'reference_id': label, 'reviewer': 'fixture', 'reviewed_on': '2026-11-01', 'human_inspected': True,
            'official_source_confirmed': True, 'hand_count': 1, 'motion_required': True,
            'facial_cues_required': False, 'body_cues_required': False,
            'relative_hand_position_required': True, 'notes': 'synthetic fixture only'}
    return dict(base, **changes)


def write_registry(path, entries):
    path.write_text(json.dumps(entries), encoding='utf-8')
    return path


@pytest.fixture
def registry(tmp_path, monkeypatch):
    path = write_registry(tmp_path / 'vocabulary.json', [entry(s) for s in SIGNS])
    monkeypatch.setattr(dataset, 'VOCABULARY', path)
    return path


def synthetic_takes(signers=('synthA', 'synthB', 'synthC'), per=3):
    takes = []
    for s, signer in enumerate(signers):
        shift = (s - 1) * 0.03
        for k in range(per):
            seed = 1000 * s + k
            takes.append(X.take('SYNTH_CIRCLE', signer, f'sess{k % 2}', 'circle', seed, shift, URL.format('SYNTH_CIRCLE')))
            takes.append(X.take('SYNTH_RAISE', signer, f'sess{k % 2}', 'raise', seed + 100, shift, URL.format('SYNTH_RAISE')))
            takes.append(X.take('NONE', signer, f'sess{k % 2}', 'none' if k % 2 else 'still', seed + 200, shift))
    return takes


def write_takes(path, takes):
    path.write_text(''.join(json.dumps(t) + '\n' for t in takes), encoding='utf-8')
    return path


@pytest.fixture(scope='module')
def trained(tmp_path_factory):
    """Train once on synthetic takes (fast candidate) and keep the registry used."""
    root = tmp_path_factory.mktemp('live')
    with pytest.MonkeyPatch.context() as mp:
        registry_path = write_registry(root / 'vocabulary.json', [entry(s) for s in SIGNS])
        mp.setattr(dataset, 'VOCABULARY', registry_path)
        takes = write_takes(root / 'takes.jsonl', synthetic_takes())
        bundle, metrics = train(takes, root / 'model', candidates=('logistic_regression', 'random_forest'),
                                model_card=root / 'MODEL_CARD.md', log=lambda *_: None)
    return {'root': root, 'registry': registry_path, 'bundle': bundle, 'metrics': metrics,
            'model': root / 'model/model.joblib'}


# ---------- protocol and features ----------

def test_frame_validation_rejects_malformed():
    good = X.frame(10, ((X.hand((0.4, 0.6)), 'Left'),))
    assert validate_frame(good)['hands'][0]['landmarks'].shape == (21, 3)
    for bad in (dict(good, extra=1), dict(good, t_ms=-1), dict(good, w=0), dict(good, pose=[[0, 0, 0, 0]] * 32),
                dict(good, hands=[{'landmarks': [[0, 0, 0]] * 20, 'handedness': 'Left', 'score': 1}]),
                dict(good, hands=[{'landmarks': [[float('nan'), 0, 0]] * 21, 'handedness': 'Left', 'score': 1}]),
                dict(good, hands=[{'landmarks': [[0, 0, 0]] * 21, 'handedness': 'left', 'score': 1}])):
        with pytest.raises(ValueError):
            validate_frame(bad)
    with pytest.raises(ValueError, match='increase'):
        validate_frames([good, good])


def test_sides_assigned_by_nearest_pose_wrist_even_when_labels_lie():
    pose = X.pose()
    right_hand = X.hand(tuple(pose[16, :2]))   # near subject-right wrist
    left_hand = X.hand(tuple(pose[15, :2]))
    # Both labelled 'Left' and listed in the wrong order: pose must decide.
    f = validate_frame(X.frame(0, ((left_hand, 'Left'), (right_hand, 'Left'))))
    slots, from_label = F.assign_sides(f)
    assert not from_label
    assert slots[0] is f['hands'][0] and slots[1] is f['hands'][1]
    v = F.frame_vector(f)
    assert list(v[F.FLAGS]) == [1, 1, 1, 0]
    # Subject left wrist is on the image right of the shoulder midpoint: positive body-frame x.
    assert v[126] > 0 and v[130] < 0


def test_label_fallback_without_pose_is_flagged():
    h = X.hand((0.3, 0.6))
    f = validate_frame(X.frame(0, ((h, 'Left'),), with_pose=False))
    v = F.frame_vector(f)
    # MediaPipe 'Left' on an unmirrored image = subject's right hand.
    assert list(v[F.FLAGS]) == [0, 1, 0, 1]
    assert not v[F.LOCATION].any() and not v[F.BODY].any()  # no pose: nothing imputed


def test_missing_hands_are_zero_with_zero_flags():
    v = F.frame_vector(validate_frame(X.frame(0, ())))
    assert not v[F.SHAPE].any() and not v[F.LOCATION].any()
    assert list(v[F.FLAGS]) == [0, 0, 1, 0]


def test_resampling_is_nearest_frame_and_gaps_stay_missing():
    frames = validate_frames(X.gesture_frames('circle', duration_ms=2000))
    window = F.resample(frames, frames[0]['t_ms'])
    assert window.shape == (F.WINDOW, F.FRAME_DIM)
    assert np.allclose(window[0], F.frame_vector(frames[0]))
    # Drop the middle of the take: the grid points there must be all-missing, not interpolated.
    gap = [f for f in frames if not 500 <= f['t_ms'] - frames[0]['t_ms'] <= 900]
    w = F.resample(gap, frames[0]['t_ms'])
    missing = ~w.any(axis=1)
    assert missing[9:12].all() and not missing[:6].any()


def test_window_summary_fixed_dims_and_jittered_windows():
    frames = validate_frames(X.gesture_frames('raise'))
    windows = F.take_windows(frames)
    assert 1 < len(windows) <= 5
    for w in windows:
        assert F.summarize(w).shape == (F.SUMMARY_DIM,) == (474,)
    assert F.summarize(np.zeros((F.WINDOW, F.FRAME_DIM))).shape == (474,)
    with pytest.raises(ValueError):
        F.summarize(np.zeros((F.WINDOW - 1, F.FRAME_DIM)))


def test_mirror_swaps_sides_and_negates_x():
    frames = validate_frames(X.gesture_frames('circle'))
    original = F.frame_vector(frames[0])
    mirrored = F.frame_vector(F.mirror(frames)[0])
    assert list(original[F.FLAGS][:2]) == [0, 1] and list(mirrored[F.FLAGS][:2]) == [1, 0]
    # Right-slot shape becomes left-slot shape with x negated.
    a = original[63:126].reshape(21, 3)
    b = mirrored[0:63].reshape(21, 3)
    assert np.allclose(b[:, 0], -a[:, 0], atol=1e-6) and np.allclose(b[:, 1:], a[:, 1:], atol=1e-6)
    twice = F.mirror(F.mirror(frames))
    assert np.allclose(F.frame_vector(twice[0]), original)


# ---------- vocabulary gate v2 ----------

def test_gate_v2_allows_motion_rejects_face_and_reserves_none(registry):
    assert set(vocab.verified()) == set(SIGNS)
    write_registry(registry, [entry('SYNTH_FACE', facial_cues_required=True)])
    with pytest.raises(ValueError, match='facial'):
        vocab.verified()
    write_registry(registry, [entry('NONE')])
    with pytest.raises(ValueError, match='reserved'):
        vocab.verified()
    write_registry(registry, [entry('SYNTH_IDX', reference_url='https://divyangjan.depwd.gov.in/islrtc/listpage.php')])
    with pytest.raises(ValueError, match='exact'):
        vocab.verified()
    write_registry(registry, [entry('SYNTH_X', human_inspected=False)])
    with pytest.raises(ValueError):
        vocab.verified()


def test_unverified_candidates_are_collectable_only_with_exact_link(registry):
    write_registry(registry, [
        entry('SYNTH_A', verified=False, reviewer='', human_inspected=False),
        entry('SYNTH_B', verified=False, reference_url=''),
        entry('SYNTH_C')])
    assert set(vocab.verified()) == {'SYNTH_C'}
    listed = {e['label']: e['verified'] for e in vocab.collectable()}
    assert listed == {'SYNTH_A': False, 'SYNTH_C': True}


def test_hands_v1_gate_ignores_hp_v1_entries(registry):
    assert verified_entries(json.loads(registry.read_text())) == {}
    assert dataset.vocabulary() == {}


REAL_VERIFIED = {'HELLO', 'THANK_YOU', 'YES', 'NO'}


def test_real_registry_verifies_exactly_hello_thank_you_yes_no():
    entries = json.loads((dataset.ROOT / 'data/metadata/vocabulary.json').read_text(encoding='utf-8'))
    assert entries
    assert {e['label'] for e in entries if e['verified'] is True} == REAL_VERIFIED
    assert all(e['verified'] is False for e in entries if e['label'] not in REAL_VERIFIED)
    admitted = vocab.verified(entries)
    assert set(admitted) == REAL_VERIFIED
    for e in entries:
        if e['label'] in REAL_VERIFIED:
            review = vocab.LiveSignReview.model_validate(e)  # raises if any human answer is missing
            assert review.official_source_confirmed is True and review.human_inspected is True
            check_reference_url(review.reference_url)  # one exact official entry, not an index/channel
            assert admitted[e['label']]['reference_url'] == e['reference_url']
    assert verified_entries(entries) == {}  # hands-v1 gate still ignores hp-v1 entries
    translations = json.loads((dataset.ROOT / 'data/metadata/translations.json').read_text(encoding='utf-8'))
    for e in entries:
        t = translations[e['label']]
        assert set(t) == {'en', 'kn', 'hi', 'ta', 'needs_native_check'} and t['needs_native_check'] is True


def test_verify_sign_link_approve_revoke(registry):
    write_registry(registry, [entry('SYNTH_A', verified=False, reference_url='', reference_id='', reviewer='',
                                    human_inspected=False, official_source_confirmed=False, notes='')])
    with pytest.raises(ValueError):
        verify_sign.set_link('SYNTH_A', 'https://example.invalid/channel/abc')
    verify_sign.set_link('SYNTH_A', URL.format('SYNTH_A'), 'id-1')
    assert vocab.collectable()[0]['verified'] is False
    answers = {'human_inspected': True, 'official_source_confirmed': True, 'hand_count': 1, 'motion_required': True,
               'relative_hand_position_required': False, 'body_cues_required': False, 'facial_cues_required': True,
               'reviewer': 'rev1', 'reviewed_on': '2026-11-02', 'notes': 'synthetic fixture only'}
    with pytest.raises(ValueError, match='facial'):
        verify_sign.approve('SYNTH_A', answers)
    assert vocab.verified() == {}
    verify_sign.approve('SYNTH_A', dict(answers, facial_cues_required=False))
    assert set(vocab.verified()) == {'SYNTH_A'}
    verify_sign.revoke('SYNTH_A')
    assert vocab.verified() == {}


# ---------- takes and merging ----------

def test_take_validation(registry):
    t = X.take('SYNTH_CIRCLE', 'synthA', reference_url=URL.format('SYNTH_CIRCLE'))
    meta, frames = validate_take(t)
    assert meta['label'] == 'SYNTH_CIRCLE' and len(frames) == len(t['frames'])
    for bad in (dict(t, consent=False), dict(t, signer_id='Real Name'), dict(t, frames=t['frames'][:10]),
                dict(t, reference_url=None), dict(t, none_prompt='rest'),
                dict(X.take('NONE', 'synthA', kind='none'), none_prompt='made-up'),
                dict(t, frames=t['frames'][:16])):
        with pytest.raises(ValueError):
            validate_take(bad)


def test_merge_rejects_duplicates_and_malformed(tmp_path):
    a = X.take('NONE', 'synthA', kind='none', seed=1)
    b = X.take('NONE', 'synthA', kind='still', seed=2)
    same_frames_new_id = dict(a, take_id='00000000-0000-4000-8000-000000000000')
    changed_frames_same_id = dict(b, frames=a['frames'])
    src = tmp_path / 'in.jsonl'
    src.write_text('\n'.join([json.dumps(a), json.dumps(b), 'not json', json.dumps(dict(a, consent=False)),
                              json.dumps(same_frames_new_id), json.dumps(a)]) + '\n')
    out = tmp_path / 'takes.jsonl'
    report = merge_takes.merge([src], out)
    assert report['added'] == 2 and report['skipped_already_merged'] == 1 and len(report['rejected']) == 3
    again = tmp_path / 'again.jsonl'
    again.write_text(json.dumps(changed_frames_same_id) + '\n')
    report = merge_takes.merge([again, src], out)
    assert report['added'] == 0 and report['total'] == 2
    assert any('different frames' in reason for _, reason in report['rejected'])


# ---------- training ----------

def test_training_outputs_bundle_metrics_and_card(trained):
    b, m = trained['bundle'], trained['metrics']
    assert m['scheme'] == 'leave-one-signer-out' and m['generalisation_to_unseen_signers_measured'] is True
    assert b['labels'] == ['NONE', *SIGNS] and b['counts']['signers'] == 3
    assert set(m['model_comparison_closed_set_macro_f1']) == {'logistic_regression', 'random_forest'}
    assert 0 <= m['none_false_accept_rate'] <= 1
    assert set(m['held_out_sign_rejection']) == set(SIGNS)
    assert set(b['thresholds']) == {'min_confidence', 'min_margin'}
    assert len(b['dataset_sha256']) == 64 and b['sklearn_version']
    metrics = json.loads((trained['root'] / 'model/metrics.json').read_text())
    assert metrics['metrics']['chosen_model'] == b['algorithm']
    card = (trained['root'] / 'MODEL_CARD.md').read_text(encoding='utf-8')
    assert 'leave-one-signer-out' in card and 'AUTO:END' in card


def test_training_refuses_unverified_and_needs_none(registry, tmp_path):
    takes = synthetic_takes(per=2)
    path = write_takes(tmp_path / 'takes.jsonl', takes)
    write_registry(registry, [entry('SYNTH_CIRCLE'), entry('SYNTH_RAISE', verified=False)])
    with pytest.raises(TrainingError, match='unverified'):
        train(path, tmp_path / 'm', candidates=('logistic_regression',), model_card=None, log=lambda *_: None)
    write_registry(registry, [entry('SYNTH_CIRCLE'), entry('SYNTH_RAISE', reference_url=URL.format('OTHER'))])
    with pytest.raises(TrainingError, match='different reference'):
        train(path, tmp_path / 'm', candidates=('logistic_regression',), model_card=None, log=lambda *_: None)
    write_registry(registry, [entry(s) for s in SIGNS])
    write_takes(path, [t for t in takes if t['label'] != 'NONE'])
    with pytest.raises(TrainingError, match='NONE'):
        train(path, tmp_path / 'm', candidates=('logistic_regression',), model_card=None, log=lambda *_: None)


def test_training_with_few_signers_warns_generalisation_not_measured(registry, tmp_path):
    path = write_takes(tmp_path / 'takes.jsonl', synthetic_takes(signers=('synthA', 'synthB'), per=3))
    logged = []
    write_registry(registry, [entry('SYNTH_CIRCLE'), entry('SYNTH_RAISE', verified=False)])
    _, m = train(path, tmp_path / 'm', drop_unverified=True, mirror_augment=True,
                 candidates=('logistic_regression',), model_card=None, log=logged.append)
    assert m['generalisation_to_unseen_signers_measured'] is False and m['scheme'].startswith('grouped-by')
    assert any('NOT measured' in line for line in logged)
    assert m['held_out_sign_rejection'] == 'needs >= 2 verified signs'


def test_threshold_source_loso_tunes_on_cross_signer_predictions(registry, tmp_path):
    """Two signers: loso changes only the deployed thresholds, tuned on leave-one-signer-out predictions."""
    from backend.live import train as T
    path = write_takes(tmp_path / 'takes.jsonl', synthetic_takes(signers=('synthA', 'synthB'), per=4))
    quiet = dict(candidates=('logistic_regression',), log=lambda *_: None)
    _, grouped = train(path, tmp_path / 'g', model_card=None, **quiet)
    bundle, loso = train(path, tmp_path / 'l', model_card=tmp_path / 'CARD.md', threshold_source='loso', **quiet)
    assert grouped['scheme'].startswith('grouped-by') and loso['scheme'] == grouped['scheme']
    assert grouped['threshold_source'] == {'requested': 'grouped', 'tuned_on': grouped['scheme'],
                                           'grouped_thresholds': grouped['thresholds']}
    # Recompute independently: each signer predicted by a model trained on the other signer only.
    data = T.build_windows(T.load_takes(path))
    labels = [*SIGNS, 'NONE']
    p = np.full((len(data['y']), len(labels)), np.nan)
    for signer in ('synthA', 'synthB'):
        tr, te = data['signer'] != signer, data['signer'] == signer
        model = T.CANDIDATES['logistic_regression']().fit(data['x'][tr], data['y'][tr])
        p[te] = T.aligned_proba(model, data['x'][te], labels)
    expected = T.tune(p, data['y'], labels)
    assert bundle['thresholds'] == loso['thresholds'] == expected
    assert bundle['threshold_source'] == {'requested': 'loso', 'tuned_on': 'leave-one-signer-out'}
    source = loso['threshold_source']
    assert source['grouped_thresholds'] == grouped['thresholds'] and source['loso']['caveat'] == T.LOSO_CAVEAT
    assert set(source['loso']['per_signer']) == {'synthA', 'synthB'}
    assert source['loso']['pooled']['windows'] == sum(r['windows'] for r in source['loso']['per_signer'].values())
    # The reported (grouped) evaluation is unchanged; only the deployed thresholds moved.
    assert loso['open_set_with_rejection'] == grouped['open_set_with_rejection']
    saved = json.loads((tmp_path / 'l/metrics.json').read_text())
    assert saved['bundle']['threshold_source']['tuned_on'] == 'leave-one-signer-out'
    assert saved['metrics']['threshold_source']['loso']['thresholds'] == expected
    LiveModel(tmp_path / 'l/model.joblib', vocab.verified())  # the server accepts the bundle
    card = (tmp_path / 'CARD.md').read_text(encoding='utf-8')
    assert '`--threshold-source loso`' in card and 'leave-one-signer-out' in card and T.LOSO_CAVEAT in card


def test_threshold_source_loso_needs_two_signers_and_valid_choice(registry, tmp_path):
    path = write_takes(tmp_path / 'takes.jsonl', synthetic_takes(signers=('synthA',), per=4))
    quiet = dict(candidates=('logistic_regression',), model_card=None, log=lambda *_: None)
    with pytest.raises(TrainingError, match='at least 2 signers'):
        train(path, tmp_path / 'm', threshold_source='loso', **quiet)
    with pytest.raises(TrainingError, match='Unknown threshold source'):
        train(path, tmp_path / 'm', threshold_source='same-person', **quiet)


def test_decide_never_returns_none_class():
    labels = ['NONE', 'SYNTH_A', 'SYNTH_B']
    t = {'min_confidence': 0.6, 'min_margin': 0.2}
    assert decide([0.7, 0.2, 0.1], labels, t)[0] is None
    assert decide([0.1, 0.5, 0.4], labels, t)[:1] == (None,)
    assert decide([0.05, 0.85, 0.1], labels, t)[0] == 'SYNTH_A'


def test_bundle_rejected_when_vocabulary_changes(trained, monkeypatch):
    monkeypatch.setattr(dataset, 'VOCABULARY', trained['registry'])
    model = LiveModel(trained['model'], vocab.verified())
    assert model.compatible_with(vocab.verified())
    changed = {k: dict(v) for k, v in vocab.verified().items()}
    changed['SYNTH_RAISE']['notes'] = 'edited notes after training'
    assert not model.compatible_with(changed)
    with pytest.raises(ValueError, match='changed'):
        LiveModel(trained['model'], changed)
    with pytest.raises(ValueError, match='unverified'):
        LiveModel(trained['model'], {'SYNTH_CIRCLE': changed['SYNTH_CIRCLE']})


# ---------- live API ----------

@pytest.fixture
def no_model(tmp_path, monkeypatch, registry):
    monkeypatch.setattr(service, 'MAX_RATE', 10_000)  # tests replay frames faster than real time
    monkeypatch.setenv('LIVE_MODEL_PATH', str(tmp_path / 'missing.joblib'))
    with TestClient(main.app) as client:
        yield client


@pytest.fixture
def with_model(trained, monkeypatch):
    monkeypatch.setattr(service, 'MAX_RATE', 10_000)  # tests replay frames faster than real time
    monkeypatch.setattr(dataset, 'VOCABULARY', trained['registry'])
    monkeypatch.setenv('LIVE_MODEL_PATH', str(trained['model']))
    with TestClient(main.app) as client:
        yield client


def stream(ws, frames):
    replies = []
    for f in frames:
        ws.send_json({'type': 'frame', 'frame': f})
    for _ in range(len(frames) // service.PREDICT_EVERY):
        replies.append(ws.receive_json())
    return replies


def test_ready_and_ws_without_model_never_guess(no_model):
    r = no_model.get('/ready')
    assert r.status_code == 503 and r.json()['code'] == 'MODEL_NOT_TRAINED'
    assert no_model.get('/health').json()['status'] == 'ok'
    with no_model.websocket_connect('/ws/recognize') as ws:
        hello = ws.receive_json()
        assert hello['type'] == 'hello' and hello['ready'] is False and hello['state'] == 'ERROR'
        replies = stream(ws, X.gesture_frames('circle'))
    assert replies and all(r['state'] == 'ERROR' and r['label'] is None and r['code'] == 'MODEL_NOT_TRAINED' for r in replies)
    body = no_model.post('/api/predict', json={'stream_id': 'teststream1', 'frames': X.gesture_frames('raise')[:3]}).json()
    assert body['model_ready'] is False and body['replies'][0]['label'] is None


def test_ws_states_with_model(with_model):
    assert with_model.get('/ready').status_code == 200
    with with_model.websocket_connect('/ws/recognize') as ws:
        assert ws.receive_json()['state'] == 'READY'
        replies = stream(ws, X.gesture_frames('circle', start_ms=100, duration_ms=4000, seed=77))
        states = [r['state'] for r in replies]
        assert states[0] == 'DETECTING'
        assert 'RECOGNIZED' in states
        recognized = [r for r in replies if r['state'] == 'RECOGNIZED']
        assert {r['label'] for r in recognized} == {'SYNTH_CIRCLE'}
        assert sum(1 for r in replies if r['event']) == 1  # continuous hold emits once
        assert all(r['latency_ms']['server'] >= 0 for r in replies)
        rest = stream(ws, X.gesture_frames('none', start_ms=5000, duration_ms=1200))
        assert rest[-1]['state'] == 'NO_HAND' and rest[-1]['label'] is None
        ws.send_json({'type': 'frame', 'frame': {'t_ms': 1}})
        assert ws.receive_json()['code'] == 'BAD_FRAME'


def test_post_predict_matches_ws_contract(with_model):
    frames = X.gesture_frames('raise', start_ms=100, duration_ms=4000, seed=78)
    states = []
    for i in range(0, len(frames), 3):
        body = with_model.post('/api/predict', json={'stream_id': 'httpstream1', 'frames': frames[i:i + 3]}).json()
        states += [r['state'] for r in body['replies']]
    assert 'RECOGNIZED' in states
    assert with_model.post('/api/predict', json={'stream_id': 'x', 'frames': frames[:3]}).status_code == 422
    assert with_model.post('/api/predict', json={'stream_id': 'httpstream1', 'frames': [{'t_ms': 1}]}).status_code == 422


def test_ws_rate_and_size_limits(with_model, monkeypatch):
    monkeypatch.setattr(service, 'MAX_RATE', 5)
    with with_model.websocket_connect('/ws/recognize') as ws:
        ws.receive_json()
        frames = X.gesture_frames('circle')
        for f in frames[:12]:
            ws.send_json({'type': 'frame', 'frame': f})
        seen = [ws.receive_json() for _ in range(2)]
        assert any(m.get('code') == 'RATE_LIMITED' for m in seen)
    with with_model.websocket_connect('/ws/recognize') as ws:
        ws.receive_json()
        ws.send_text('x' * (service.MAX_MESSAGE_BYTES + 1))
        with pytest.raises(Exception):
            ws.receive_json()


def test_collection_api_server_save_is_opt_in(no_model, monkeypatch, tmp_path):
    monkeypatch.setattr(api, 'SERVER_TAKES', tmp_path / 'takes')
    take = X.take('SYNTH_CIRCLE', 'synthA', reference_url=URL.format('SYNTH_CIRCLE'))
    monkeypatch.delenv('ENABLE_COLLECTION', raising=False)
    assert no_model.get('/api/config').json()['server_save'] is False
    assert no_model.post('/api/takes', json=take).status_code == 403
    monkeypatch.setenv('ENABLE_COLLECTION', '1')
    assert no_model.post('/api/takes', json=dict(take, consent=False)).status_code == 422
    assert no_model.post('/api/takes', json=take).json()['saved'] is True
    assert len((tmp_path / 'takes/server-synthA.jsonl').read_text().splitlines()) == 1
    signs = no_model.get('/api/vocabulary').json()['signs']
    assert {s['label'] for s in signs} == set(SIGNS)
    assert 'NONE' not in no_model.get('/api/translations').json()


def test_only_manifest_models_are_served(no_model):
    assert no_model.get('/models/manifest.json').status_code == 404
    assert no_model.get('/models/../app/main.py').status_code == 404
    assert no_model.get('/lab').status_code == 200


def test_low_fps_metadata_is_optional_and_validated(registry):
    t = X.take('SYNTH_CIRCLE', 'synthA', reference_url=URL.format('SYNTH_CIRCLE'))
    assert validate_take(t)[0]['low_fps'] is None  # takes recorded before 0.4 stay valid
    meta, _ = validate_take(dict(t, low_fps=True, measured_fps=9.4, capture_ms=3000))
    assert meta['low_fps'] is True and meta['measured_fps'] == 9.4
    with pytest.raises(ValueError):
        validate_take(dict(t, measured_fps=-1))
