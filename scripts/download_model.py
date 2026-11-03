"""Download official MediaPipe .task models, verify each against the committed SHA256.

Files land in backend/models/ (git-ignored). FastAPI serves them to the browser from
/models/<file>, so no model is fetched from a CDN at runtime.
"""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'backend/models/manifest.json'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def assets(manifest):
    # Older manifests only had the single top-level hand model.
    return manifest.get('assets') or [dict(manifest, file='hand_landmarker.task')]


def main():
    manifest = json.loads(MANIFEST.read_text())
    for asset in assets(manifest):
        target = MANIFEST.parent / asset['file']
        if target.exists() and sha256(target.read_bytes()) == asset['sha256']:
            print(f'Present {target.name}: {asset["sha256"]}')
            continue
        payload = urllib.request.urlopen(asset['url'], timeout=60).read()
        digest = sha256(payload)
        if digest != asset['sha256']:
            raise ValueError(f'{asset["file"]}: checksum mismatch; refusing to save')
        target.write_bytes(payload)
        print(f'Downloaded {target.name}: {digest}')


if __name__ == '__main__':
    main()
