"""Pre-generated speech: manifest format and staleness check (shared by script + API).

web/public/audio/manifest.json:
  {"version": 1, "entries": {LABEL: {lang: {"file": "LABEL/lang.mp3", "text_sha256": ..., "engine": ..., "voice": ...}}}}
An entry is fresh only if its text hash matches the current translations.json text and
the file exists. Anything else is stale or missing, and the player falls back to the
browser's speech synthesis.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_AUDIO = ROOT / 'web/public/audio'
DIST_AUDIO = ROOT / 'web/dist/audio'
LANGS = ('en', 'kn', 'hi', 'ta')


def text_hash(text):
    return hashlib.sha256(text.strip().encode('utf-8')).hexdigest()


def served_dir():
    """The directory whose files the server actually serves at /audio (dist when built)."""
    return DIST_AUDIO if (DIST_AUDIO / 'manifest.json').exists() else PUBLIC_AUDIO


def load_manifest(directory):
    path = Path(directory) / 'manifest.json'
    if not path.exists():
        return {'version': 1, 'entries': {}}
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('version') != 1 or not isinstance(data.get('entries'), dict):
        raise ValueError('Unsupported audio manifest')
    return data


def audio_status(manifest, translations, labels, directory):
    """Return {'available': {label: {lang: url}}, 'stale': [...], 'missing': [...]} for labels."""
    available, stale, missing = {}, [], []
    for label in sorted(labels):
        words = translations.get(label) or {}
        for lang in LANGS:
            text = words.get(lang)
            if not text:
                continue
            entry = manifest['entries'].get(label, {}).get(lang)
            if not entry or not (Path(directory) / entry['file']).is_file():
                missing.append(f'{label}/{lang}')
            elif entry.get('text_sha256') != text_hash(text):
                stale.append(f'{label}/{lang}')
            else:
                available.setdefault(label, {})[lang] = f"/audio/{entry['file']}"
    return {'available': available, 'stale': stale, 'missing': missing}
