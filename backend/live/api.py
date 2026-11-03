"""Collection-side JSON API for the web app (/api/*). Inference lives in service.py."""
import json
import os
import threading
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from . import vocab
from .takes import NONE_PROMPTS, validate_take

ROOT = Path(__file__).resolve().parents[2]
TRANSLATIONS = ROOT / 'data/metadata/translations.json'
SERVER_TAKES = ROOT / 'data/raw/takes'
APP_VERSION = '0.3.0'
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
            'targets': {'per_sign': TAKES_PER_SIGN, 'none': TAKES_NONE}, 'capture_ms': 2000}


@router.get('/vocabulary')
def vocabulary():
    try:
        return {'signs': vocab.collectable(), 'none_label': vocab.NONE_LABEL}
    except ValueError as exc:
        raise HTTPException(503, f'Vocabulary registry invalid: {exc}') from exc


@router.get('/translations')
def get_translations():
    return translations()


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
