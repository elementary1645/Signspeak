"""Phase 3.1 checks: model report, Learn ISL API, audio staleness, deploy staging.
All fixtures are SYNTHETIC (SYNTH_ labels), never ISL data or evidence of accuracy."""
import asyncio
import json
import shutil
from backend.live import api
from backend.live import audio as audio_mod
from backend.live.audio import audio_status, load_manifest, text_hash
from backend.tests.test_live import (URL, entry, no_model, registry, trained, with_model,  # noqa: F401 (fixtures)
                                     write_registry)
from scripts import deploy_space
from scripts import generate_audio as gen


def test_api_model_without_metrics_shows_no_numbers(no_model):
    body = no_model.get('/api/model').json()
    assert body == {'trained': False, 'loaded': False, 'detail': 'No model trained yet'}


def test_api_model_reports_metrics_json_verbatim(with_model, trained):
    body = with_model.get('/api/model').json()
    saved = json.loads((trained['root'] / 'model/metrics.json').read_text())
    m, b = saved['metrics'], saved['bundle']
    assert body['trained'] is True and body['loaded'] is True
    assert body['model_type'] == b['algorithm'] and body['counts'] == b['counts']
    assert body['macro_f1_open_set'] == m['open_set_with_rejection']['macro_f1']
    assert body['macro_f1_closed_set'] == m['closed_set']['macro_f1']
    assert body['per_class'] == m['open_set_with_rejection']['per_class']
    assert body['none_false_accept_rate'] == m['none_false_accept_rate']
    assert body['evaluation']['scheme'] == m['scheme'] == 'leave-one-signer-out'
    assert body['vocabulary_version'] == b['vocab_fingerprint'][:12] and body['trained_at'] == b['trained_at']


def test_api_signs_details_only_for_verified(no_model, registry):
    write_registry(registry, [entry('SYNTH_CIRCLE'), entry('SYNTH_PENDING', verified=False, reference_url='', notes='')])
    body = no_model.get('/api/signs').json()
    assert [s['label'] for s in body['verified']] == ['SYNTH_CIRCLE']
    card = body['verified'][0]
    assert card['reference_url'] == URL.format('SYNTH_CIRCLE') and card['motion_required'] is True
    assert card['recognised_by_model'] is False and 'reviewer' not in card
    assert body['not_supported_yet'] == [{'label': 'SYNTH_PENDING', 'has_reference': False}]
    assert body['model_ready'] is False and body['recognised_count'] == 0


def test_api_signs_marks_model_labels(with_model):
    body = with_model.get('/api/signs').json()
    assert body['recognised_count'] == 2 and all(s['recognised_by_model'] for s in body['verified'])


def test_audio_staleness(tmp_path):
    (tmp_path / 'A').mkdir()
    (tmp_path / 'A/en.mp3').write_bytes(b'x' * 600)
    (tmp_path / 'A/hi.mp3').write_bytes(b'x' * 600)
    manifest = {'version': 1, 'entries': {'A': {
        'en': {'file': 'A/en.mp3', 'text_sha256': text_hash('Water')},
        'hi': {'file': 'A/hi.mp3', 'text_sha256': text_hash('old text')},
        'kn': {'file': 'A/kn.mp3', 'text_sha256': text_hash('kn text')}}}}
    words = {'A': {'en': 'Water', 'hi': 'पानी', 'kn': 'kn text', 'ta': 'தண்ணீர்'}}
    status = audio_status(manifest, words, ['A'], tmp_path)
    assert status['available'] == {'A': {'en': '/audio/A/en.mp3'}}
    assert status['stale'] == ['A/hi'] and sorted(status['missing']) == ['A/kn', 'A/ta']
    assert audio_status(manifest, words, [], tmp_path)['available'] == {}  # unverified labels never offered


def test_generate_audio_regenerates_only_stale_and_never_none(registry, tmp_path, monkeypatch):
    monkeypatch.setattr(gen, 'PUBLIC_AUDIO', tmp_path)
    words = {'SYNTH_CIRCLE': {'en': 'Circle', 'kn': 'ವೃತ್ತ', 'hi': 'गोला', 'ta': 'வட்டம்', 'needs_native_check': True}}
    monkeypatch.setattr(gen, 'translations', lambda: words)
    calls = []

    async def fake(text, lang, path, engine):
        calls.append((text, lang))
        path.write_bytes(b'ID3' + text.encode() * 200)
        return 'fake', 'voice'
    monkeypatch.setattr(gen, 'synthesize', fake)
    write_registry(registry, [entry('SYNTH_CIRCLE'), entry('SYNTH_RAISE')])
    quiet = {'log': lambda *_: None}
    report = asyncio.run(gen.generate(**quiet))
    assert report['made'] == 4 and report['missing'] == [] and set(report['available']) == {'SYNTH_CIRCLE'}
    assert asyncio.run(gen.generate(**quiet))['made'] == 0  # fresh files are kept
    words['SYNTH_CIRCLE']['hi'] = 'वृत्त'
    status = audio_status(load_manifest(tmp_path), words, ['SYNTH_CIRCLE'], tmp_path)
    assert status['stale'] == ['SYNTH_CIRCLE/hi']
    report = asyncio.run(gen.generate(**quiet))
    assert report['made'] == 1 and calls[-1] == ('वृत्त', 'hi') and report['stale'] == []
    write_registry(registry, [entry('SYNTH_RAISE')])
    asyncio.run(gen.generate(prune=True, **quiet))
    assert not (tmp_path / 'SYNTH_CIRCLE').exists() and load_manifest(tmp_path)['entries'] == {}


def test_api_audio_offers_only_fresh_files(no_model, registry, monkeypatch, tmp_path):
    monkeypatch.setattr(audio_mod, 'served_dir', lambda: tmp_path)
    monkeypatch.setattr(api, 'translations', lambda: {'SYNTH_CIRCLE': {'en': 'Circle', 'hi': 'गोला'}})
    (tmp_path / 'SYNTH_CIRCLE').mkdir()
    for lang in ('en', 'hi'):
        (tmp_path / f'SYNTH_CIRCLE/{lang}.mp3').write_bytes(b'x' * 600)
    (tmp_path / 'manifest.json').write_text(json.dumps({'version': 1, 'entries': {'SYNTH_CIRCLE': {
        'en': {'file': 'SYNTH_CIRCLE/en.mp3', 'text_sha256': text_hash('Circle')},
        'hi': {'file': 'SYNTH_CIRCLE/hi.mp3', 'text_sha256': text_hash('outdated')}}}}))
    body = no_model.get('/api/audio').json()
    assert body['available'] == {'SYNTH_CIRCLE': {'en': '/audio/SYNTH_CIRCLE/en.mp3'}}
    assert body['stale'] == ['SYNTH_CIRCLE/hi']


def test_deploy_staging_never_includes_collected_data():
    for path in ('data/raw/takes/server-a.jsonl', 'data/processed/takes.jsonl',
                 'backend/models/hand_landmarker.task', 'experiments/holistic/README.md', '.env'):
        assert not deploy_space.allowed(path)
    assert deploy_space.allowed('data/metadata/vocabulary.json')
    staging, _ = deploy_space.stage(include_model=False)
    try:
        files = {p.relative_to(staging).as_posix() for p in staging.rglob('*') if p.is_file()}
        assert {'Dockerfile', '.dockerignore', 'README.md', 'requirements.lock.txt', 'data/metadata/vocabulary.json'} <= files
        assert not any(f.startswith(('data/raw', 'data/processed', 'experiments/')) or f.endswith('.task') for f in files)
        readme = (staging / 'README.md').read_text(encoding='utf-8')
        assert readme.startswith('---\n') and 'sdk: docker' in readme and 'app_port: 7860' in readme
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    assert deploy_space.app_url('My_User/Sign.Speak') == 'https://my-user-sign-speak.hf.space'
