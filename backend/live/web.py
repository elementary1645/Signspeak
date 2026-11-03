"""Single-origin serving: built React app, self-hosted .task models, SPA routes.

Nothing assumes localhost. In dev, Vite proxies /api, /ws, /ready and /models here.
"""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'web/dist'
MODELS = ROOT / 'backend/models'
SPA_ROUTES = ('/translate', '/collect', '/learn', '/how-it-works', '/about')

router = APIRouter()


def built():
    return (DIST / 'index.html').is_file()


def served_models():
    manifest = json.loads((MODELS / 'manifest.json').read_text())
    return {asset['file'] for asset in manifest.get('assets', [])}


@router.get('/models/{name}')
def model_file(name: str):
    # Only manifest-listed assets; never arbitrary files from the models directory.
    if name not in served_models() or not (MODELS / name).is_file():
        raise HTTPException(404, 'Model asset not downloaded; run python scripts/download_model.py')
    return FileResponse(MODELS / name, media_type='application/octet-stream',
                        headers={'Cache-Control': 'public, max-age=86400'})


def spa_index():
    if not built():
        raise HTTPException(404, 'Web app not built; run npm run build in web/ (or use the Vite dev server)')
    return FileResponse(DIST / 'index.html', headers={'Cache-Control': 'no-cache'})


for _route in SPA_ROUTES:
    router.add_api_route(_route, spa_index, methods=['GET'], include_in_schema=False)


@router.get('/assets/{path:path}', include_in_schema=False)
def asset(path: str):
    return _dist_file('assets', path)


@router.get('/audio/{path:path}', include_in_schema=False)
def audio(path: str):
    return _dist_file('audio', path)


@router.get('/favicon.svg', include_in_schema=False)
def favicon():
    return _dist_file('.', 'favicon.svg')


@router.get('/mediapipe/{path:path}', include_in_schema=False)
def mediapipe_runtime(path: str):
    return _dist_file('mediapipe', path)


def _dist_file(folder, path):
    base = (DIST / folder).resolve()
    target = (base / path).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(404, 'Not found')
    media = {'.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml'}.get(target.suffix)
    return FileResponse(target, media_type=media)
