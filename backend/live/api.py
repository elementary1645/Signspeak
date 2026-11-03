"""Collection-side JSON API for the web app (/api/*). Inference lives in service.py."""
import json
import os
import threading
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from . import vocab
from .capture import PROTOCOLS
from .model import model_path
from .takes import NONE_PROMPTS, validate_take

ROOT = Path(__file__).resolve().parents[2]
TRANSLATIONS = ROOT / 'data/metadata/translations.json'
SERVER_TAKES = ROOT / 'data/raw/takes'
APP_VERSION = '0.4.0'
TAKES_PER_SIGN = 8
TAKES_NONE = 16
MAX_TAKE_BYTES = 1_000_000

router = APIRouter(prefix='/api')
_write_lock = threading.Lock()


def collection_enabled():
    return os.getenv('ENABLE_COLLECTION') == '1'


def translations():
    data = json.loads(TRANSLATIONS.read_text(encoding='utf-8'))
    return {k: v for k, v in data.items() if not k.startswith('_') and k != vocab.NONE_LABEL}


@router.get('/config')
def config():
    return {'app_version': APP_VERSION, 'server_save': collection_enabled(),
            'none_label': vocab.NONE_LABEL, 'none_prompts': list(NONE_PROMPTS),
            'targets': {'per_sign': TAKES_PER_SIGN, 'none': TAKES_NONE}, 'capture_ms': 2000,
            'capture_protocols': PROTOCOLS, 'default_capture_protocol': 'hp-v2-8fps-timed-1'}


@router.get('/vocabulary')
def vocabulary():
    try:
        return {'signs': vocab.collectable(), 'none_label': vocab.NONE_LABEL}
    except ValueError as exc:
        raise HTTPException(503, f'Vocabulary registry invalid: {exc}') from exc


@router.get('/translations')
def get_translations():
    return translations()


LEARN_FIELDS = ('label', 'reference_url', 'reference_id', 'hand_count', 'motion_required',
                'relative_hand_position_required', 'body_cues_required', 'notes', 'reviewed_on')


@router.get('/signs')
def signs(request: Request):
    """Learn ISL: details only for verified signs; unverified candidates are listed by name."""
    try:
        entries = vocab.live_entries()
        admitted = vocab.verified(entries)
    except ValueError as exc:
        raise HTTPException(503, f'Vocabulary registry invalid: {exc}') from exc
    words = translations()
    status = request.app.state.live.status()
    recognised = set(status['model']['labels']) if status['ready'] else set()
    verified = [dict({k: admitted[label].get(k) for k in LEARN_FIELDS}, translations=words.get(label),
                     recognised_by_model=label in recognised)
                for label in sorted(admitted)]
    pending = [{'label': e['label'], 'has_reference': vocab.has_exact_reference(e)}
               for e in entries if e['label'] not in admitted]
    return {'verified': verified, 'not_supported_yet': pending, 'model_ready': status['ready'],
            'recognised_count': len(recognised)}


@router.get('/model')
def model_report(request: Request):
    """Numbers shown on About & Model come only from the trained bundle's metrics.json."""
    path = model_path().parent / 'metrics.json'
    status = request.app.state.live.status()
    if not path.exists():
        return {'trained': False, 'loaded': status['ready'], 'detail': 'No model trained yet'}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        bundle, metrics = data['bundle'], data['metrics']
        open_set = metrics['open_set_with_rejection']
        return {
            'trained': True, 'loaded': status['ready'], 'load_detail': status['detail'],
            'schema': bundle['schema'], 'capture_protocol': bundle.get('capture_protocol'),
            'accepted_capture_protocols': bundle.get('accepted_capture_protocols'),
            'model_type': bundle['algorithm'], 'labels': bundle['labels'],
            'trained_at': bundle['trained_at'], 'sklearn_version': bundle['sklearn_version'],
            'counts': bundle['counts'], 'vocabulary_version': bundle['vocab_fingerprint'][:12],
            'dataset_sha256': bundle['dataset_sha256'], 'thresholds': bundle['thresholds'],
            'evaluation': {'scheme': metrics['scheme'],
                           'unseen_signers_measured': metrics['generalisation_to_unseen_signers_measured'],
                           'warning': metrics['warning']},
            'model_comparison_closed_set_macro_f1': metrics['model_comparison_closed_set_macro_f1'],
            'macro_f1_open_set': open_set['macro_f1'], 'macro_f1_closed_set': metrics['closed_set']['macro_f1'],
            'per_class': open_set['per_class'], 'confusion_matrix': open_set['confusion_matrix'],
            'none_false_accept_rate': metrics['none_false_accept_rate'],
            'sign_rejection_rate': metrics['sign_rejection_rate'],
            'held_out_sign_rejection': metrics['held_out_sign_rejection'],
            'evaluated_windows': metrics['evaluated_windows'],
            'latency': metrics.get('latency'),  # absent in bundles trained before --max-latency-ms
        }
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(500, f'metrics.json is unreadable: {type(exc).__name__}') from exc


@router.post('/takes')
async def save_take(request: Request):
    """Optional local save. Off unless the server was started with ENABLE_COLLECTION=1."""
    if not collection_enabled():
        raise HTTPException(403, 'Server save disabled; use "Download my data" or start with ENABLE_COLLECTION=1')
    body = await request.body()
    if len(body) > MAX_TAKE_BYTES:
        raise HTTPException(413, 'Take too large')
    try:
        raw = json.loads(body)
        meta, _ = validate_take(raw)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    path = SERVER_TAKES / f"server-{meta['signer_id']}.jsonl"
    with _write_lock:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('a', encoding='utf-8', newline='\n') as stream:
                stream.write(json.dumps(raw, separators=(',', ':')) + '\n')
        except OSError as exc:
            raise HTTPException(503, 'Could not write take; check server storage') from exc
    return {'saved': True, 'take_id': meta['take_id'], 'file': path.name}


@router.get('/audio')
def audio_manifest():
    """Which pre-generated mp3s are fresh for the current translations (stale ones are never offered)."""
    from .audio import audio_status, load_manifest, served_dir
    directory = served_dir()
    try:
        manifest = load_manifest(directory)
        labels = vocab.verified()
    except ValueError as exc:
        raise HTTPException(503, f'Audio manifest or vocabulary invalid: {exc}') from exc
    return audio_status(manifest, translations(), labels, directory)
