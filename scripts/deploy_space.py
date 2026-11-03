"""Deploy SignSpeak to a Hugging Face Docker Space (builds remotely; no local Docker needed).

  set HF_TOKEN in the environment (a write token), then:
  python -m scripts.deploy_space --space <user>/<name> [--create] [--private] [--no-model] [--dry-run]

Uploads git-tracked code + Dockerfile, plus the current trained bundle
(backend/models/live/model.joblib + metrics.json, if present and compatible with the
current vocabulary) and generated audio (web/public/audio). The bundle is never committed
to GitHub. Collected data (data/raw, data/processed) is never uploaded. The token is read
from HF_TOKEN only and is never printed or written.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_FILES = ('backend/models/live/model.joblib', 'backend/models/live/metrics.json')
NEVER = ('data/raw/', 'data/processed/', '.env', 'experiments/')
SPACE_FRONTMATTER = """---
title: SignSpeak
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Recognises human-verified Indian Sign Language signs in the browser
---

"""
GITATTRIBUTES = '*.joblib filter=lfs diff=lfs merge=lfs -text\n*.mp3 filter=lfs diff=lfs merge=lfs -text\n'


def tracked_files():
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, check=True, capture_output=True).stdout
    return [p for p in out.decode().split('\0') if p]


def allowed(path):
    return not any(path == n.rstrip('/') or path.startswith(n) for n in NEVER) and not path.endswith('.task')


def check_bundle():
    """Return (ok, message). Refuse to ship a bundle the server would reject."""
    model = ROOT / BUNDLE_FILES[0]
    if not model.exists():
        return False, 'no trained bundle: the Space will show "model not trained yet"'
    sys.path.insert(0, str(ROOT))
    from backend.live import vocab
    from backend.live.model import LiveModel
    try:
        LiveModel(model, vocab.verified())
    except Exception as exc:
        raise SystemExit(f'Refusing to deploy: trained bundle is not loadable with the current vocabulary ({exc}). Retrain first, or pass --no-model.')
    return True, 'trained bundle included'


def stage(include_model=True):
    staging = Path(tempfile.mkdtemp(prefix='signspeak-space-'))
    files = [p for p in tracked_files() if allowed(p)]
    notes = []
    if include_model:
        ok, message = check_bundle()
        notes.append(message)
        if ok:
            files += [p for p in BUNDLE_FILES if (ROOT / p).exists()]
    else:
        notes.append('--no-model: bundle not included')
    audio = ROOT / 'web/public/audio'
    if audio.is_dir():
        extra = [str(p.relative_to(ROOT)).replace('\\', '/') for p in audio.rglob('*') if p.is_file()]
        files += extra
        notes.append(f'{len(extra)} audio files included')
    for rel in sorted(set(files)):
        if not allowed(rel):
            raise SystemExit(f'Internal error: refusing to stage {rel}')
        src, dst = ROOT / rel, staging / rel
        if not src.is_file():
            continue  # deleted in the working tree but still tracked
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    readme = (ROOT / 'README.md').read_text(encoding='utf-8')
    (staging / 'README.md').write_text(SPACE_FRONTMATTER + readme, encoding='utf-8', newline='\n')
    (staging / '.gitattributes').write_text(GITATTRIBUTES, encoding='utf-8', newline='\n')
    return staging, notes


def app_url(space):
    owner, name = space.split('/')
    return f"https://{re.sub(r'[^a-z0-9-]', '-', owner.lower())}-{re.sub(r'[^a-z0-9-]', '-', name.lower())}.hf.space"


def instructions(space):
    return f"""
Nothing was uploaded. To deploy:
  1. Create a write token: https://huggingface.co/settings/tokens  (type: Write)
  2. Either create the Space yourself: https://huggingface.co/new-space
       owner/name = {space or '<user>/<name>'}, SDK = Docker (blank template), hardware = CPU basic (free), Public
     or let this script do it by adding --create.
  3. In PowerShell:  $env:HF_TOKEN = "<token>"     (bash: export HF_TOKEN=<token>)
     python -m scripts.deploy_space --space {space or '<user>/<name>'} --create
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--space', help='Space repo id, e.g. myname/signspeak')
    parser.add_argument('--create', action='store_true', help='create the Space if it does not exist')
    parser.add_argument('--private', action='store_true', help='with --create: make the Space private')
    parser.add_argument('--no-model', action='store_true', help='deploy without the trained bundle')
    parser.add_argument('--dry-run', action='store_true', help='stage files and list them; upload nothing')
    args = parser.parse_args()
    sys.stdout.reconfigure(errors='replace')
    if args.space and not re.fullmatch(r'[A-Za-z0-9][\w.-]*/[A-Za-z0-9][\w.-]*', args.space):
        parser.exit(2, 'Use --space <user>/<name>\n')

    staging, notes = stage(include_model=not args.no_model)
    files = [p for p in staging.rglob('*') if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print(f'Staged {len(files)} files ({size / 1e6:.1f} MB) in {staging}')
    for note in notes:
        print(f'  - {note}')
    try:
        if args.dry_run:
            for p in sorted(files):
                print('   ', p.relative_to(staging).as_posix())
            return
        token = os.environ.get('HF_TOKEN')
        if not token or not args.space:
            print(('HF_TOKEN is not set.' if not token else '--space is missing.') + instructions(args.space))
            raise SystemExit(2)
        from huggingface_hub import HfApi
        from huggingface_hub.errors import HfHubHTTPError, RepositoryNotFoundError
        api = HfApi(token=token)
        try:
            api.repo_info(args.space, repo_type='space')
        except RepositoryNotFoundError:
            if not args.create:
                print(f'Space {args.space} does not exist (or the token cannot see it).' + instructions(args.space))
                raise SystemExit(2)
            api.create_repo(args.space, repo_type='space', space_sdk='docker', private=args.private, exist_ok=True)
            print(f'Created Space {args.space}')
        try:
            commit = api.upload_folder(repo_id=args.space, repo_type='space', folder_path=str(staging),
                                       commit_message='Deploy SignSpeak', delete_patterns=['*'])
        except HfHubHTTPError as exc:
            raise SystemExit(f'Upload failed: {exc.response.status_code if exc.response is not None else ""} {type(exc).__name__}')
        print(f'Uploaded: {getattr(commit, "commit_url", "")}')
        print(f'Space:    https://huggingface.co/spaces/{args.space}  (build logs under "Logs")')
        print(f'App:      {app_url(args.space)}  (first build takes several minutes)')
    finally:
        shutil.rmtree(staging, ignore_errors=True)


if __name__ == '__main__':
    main()
