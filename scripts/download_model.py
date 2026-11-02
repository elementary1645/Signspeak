"""Download official version 1 Hand Landmarker, verify against committed SHA256."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'backend/models/manifest.json'


def main():
    manifest = json.loads(MANIFEST.read_text())
    payload = urllib.request.urlopen(manifest['url'], timeout=60).read()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != manifest['sha256']:
        raise ValueError('Model checksum mismatch; refusing to save')
    target = MANIFEST.parent / 'hand_landmarker.task'
    target.write_bytes(payload)
    print(f'Downloaded {target.name}: {digest}')


if __name__ == '__main__':
    main()
