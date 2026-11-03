"""Generate speech for every VERIFIED hp-v1 label x en/kn/hi/ta in translations.json.

  python -m scripts.generate_audio [--force] [--prune] [--engine edge|gtts]
  python -m scripts.generate_audio --list-voices

Writes web/public/audio/<LABEL>/<lang>.mp3 and manifest.json with each text's SHA256, so
audio made before a translation edit is detected as stale (and not played). NONE is
never voiced. Uses edge-tts Indian neural voices, falling back to gTTS per file.
Needs internet. Rebuild the web app (or redeploy) afterwards so dist/ picks it up.
"""
import argparse
import asyncio
import json
import shutil
import sys
from backend.live import vocab
from backend.live.api import translations
from backend.live.audio import LANGS, PUBLIC_AUDIO, audio_status, load_manifest, text_hash

EDGE_VOICES = {'en': 'en-IN-NeerjaNeural', 'kn': 'kn-IN-SapnaNeural', 'hi': 'hi-IN-SwaraNeural', 'ta': 'ta-IN-PallaviNeural'}
GTTS_ARGS = {'en': {'lang': 'en', 'tld': 'co.in'}, 'kn': {'lang': 'kn'}, 'hi': {'lang': 'hi'}, 'ta': {'lang': 'ta'}}


async def list_voices():
    import edge_tts
    voices = await edge_tts.list_voices()
    for v in sorted(voices, key=lambda v: v['ShortName']):
        if v['Locale'] in ('en-IN', 'kn-IN', 'hi-IN', 'ta-IN'):
            print(f"{v['ShortName']:28s} {v['Locale']}  {v['Gender']}")


async def edge(text, lang, path):
    import edge_tts
    await edge_tts.Communicate(text, EDGE_VOICES[lang]).save(str(path))
    return 'edge-tts', EDGE_VOICES[lang]


def gtts(text, lang, path):
    from gtts import gTTS
    gTTS(text, **GTTS_ARGS[lang]).save(str(path))
    return 'gTTS', f"{GTTS_ARGS[lang]['lang']}{'/' + GTTS_ARGS[lang]['tld'] if 'tld' in GTTS_ARGS[lang] else ''}"


async def synthesize(text, lang, path, engine):
    errors = []
    for name in (['edge', 'gtts'] if engine == 'edge' else ['gtts']):
        try:
            result = await edge(text, lang, path) if name == 'edge' else gtts(text, lang, path)
            if path.stat().st_size < 500:
                raise ValueError('audio file suspiciously small')
            return result
        except Exception as exc:
            errors.append(f'{name}: {type(exc).__name__}: {exc}')
    raise RuntimeError('; '.join(errors))


async def generate(force=False, prune=False, engine='edge', log=print):
    words = translations()
    labels = sorted(vocab.verified())  # verified signs only; NONE is never in the vocabulary
    manifest = load_manifest(PUBLIC_AUDIO)
    entries = manifest['entries']
    made = failed = kept = 0
    for label in labels:
        for lang in LANGS:
            text = (words.get(label) or {}).get(lang)
            if not text:
                log(f'skip {label}/{lang}: no translation')
                continue
            rel = f'{label}/{lang}.mp3'
            path = PUBLIC_AUDIO / rel
            current = entries.get(label, {}).get(lang)
            if not force and current and current.get('text_sha256') == text_hash(text) and path.is_file():
                kept += 1
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                engine_used, voice = await synthesize(text, lang, path, engine)
            except RuntimeError as exc:
                failed += 1
                log(f'FAILED {rel}: {exc}')
                continue
            entries.setdefault(label, {})[lang] = {'file': rel, 'text_sha256': text_hash(text), 'text': text,
                                                   'engine': engine_used, 'voice': voice}
            made += 1
            log(f'made {rel} ({engine_used} {voice})')
    if prune:
        for label in [l for l in entries if l not in labels]:
            del entries[label]
            shutil.rmtree(PUBLIC_AUDIO / label, ignore_errors=True)
            log(f'pruned {label}')
    PUBLIC_AUDIO.mkdir(parents=True, exist_ok=True)
    (PUBLIC_AUDIO / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    status = audio_status(manifest, words, labels, PUBLIC_AUDIO)
    return {'labels': labels, 'made': made, 'kept': kept, 'failed': failed, **status}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--force', action='store_true', help='regenerate even fresh files')
    parser.add_argument('--prune', action='store_true', help='delete audio for labels that are no longer verified')
    parser.add_argument('--engine', choices=['edge', 'gtts'], default='edge')
    parser.add_argument('--list-voices', action='store_true')
    args = parser.parse_args()
    sys.stdout.reconfigure(errors='replace')
    if args.list_voices:
        asyncio.run(list_voices())
        return
    report = asyncio.run(generate(args.force, args.prune, args.engine))
    if not report['labels']:
        print('No verified signs yet: nothing to voice. Verify signs first (docs/HOW_TO_VERIFY_A_SIGN.md).')
    print(f"made {report['made']}, up to date {report['kept']}, failed {report['failed']}; "
          f"stale {len(report['stale'])}, missing {len(report['missing'])}")
    print('Next: cd web && npm run build   (or redeploy the Space)')
    if report['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
