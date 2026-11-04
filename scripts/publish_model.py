"""Publish the trained bundle, metrics.json and generated audio to a PRIVATE Hugging Face
model repo, where hosts that build from GitHub (Render) download it at startup.

  $env:HF_TOKEN = "<write token>"
  python -m scripts.publish_model [--repo Elementary1645/signspeak-model] [--dry-run]

The bundle never goes into GitHub. The repo is created private; an existing PUBLIC repo
is refused. HF_TOKEN is read from the environment only and never printed or written.
"""
import argparse
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.live import vocab  # noqa: E402
from backend.live.audio import PUBLIC_AUDIO  # noqa: E402
from backend.live.model import LiveModel, model_path  # noqa: E402

DEFAULT_REPO = 'Elementary1645/signspeak-model'
README = """---
license: other
tags: [private, signspeak]
---

Private SignSpeak hp-v1 bundle (scikit-learn joblib + metrics + audio), downloaded by the
app at startup via MODEL_REPO. Trained on pseudonymous landmark recordings from consenting
volunteers. Do not make this repository public; see docs/PRIVACY.md in the code repository.
joblib files execute code when loaded: only load bundles you trained.
"""


def stage():
    bundle = model_path()
    if not bundle.is_file():
        raise SystemExit(f'No trained bundle at {bundle}. Run python -m backend.live.train first.')
    try:
        LiveModel(bundle, vocab.verified())
    except Exception as exc:
        raise SystemExit(f'Refusing to publish: bundle does not load with the current vocabulary ({exc}). Retrain first.')
    staging = Path(tempfile.mkdtemp(prefix='signspeak-model-'))
    shutil.copyfile(bundle, staging / 'model.joblib')
    metrics = bundle.parent / 'metrics.json'
    if metrics.is_file():
        shutil.copyfile(metrics, staging / 'metrics.json')
    if (PUBLIC_AUDIO / 'manifest.json').is_file():
        shutil.copytree(PUBLIC_AUDIO, staging / 'audio')
    (staging / 'README.md').write_text(README, encoding='utf-8', newline='\n')
    return staging


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', default=os.getenv('MODEL_REPO') or DEFAULT_REPO)
    parser.add_argument('--dry-run', action='store_true', help='list what would be uploaded; upload nothing')
    args = parser.parse_args()
    sys.stdout.reconfigure(errors='replace')
    staging = stage()
    try:
        files = sorted(p.relative_to(staging).as_posix() for p in staging.rglob('*') if p.is_file())
        print(f'Staged {len(files)} files for {args.repo}: ' + ', '.join(files[:6]) + (' …' if len(files) > 6 else ''))
        if args.dry_run:
            return
        token = os.environ.get('HF_TOKEN')
        if not token:
            raise SystemExit('HF_TOKEN is not set. Create a WRITE token at https://huggingface.co/settings/tokens, then\n'
                             '  $env:HF_TOKEN = "<token>"; python -m scripts.publish_model')
        from huggingface_hub import HfApi
        from huggingface_hub.errors import RepositoryNotFoundError
        api = HfApi(token=token)
        try:
            if not api.repo_info(args.repo, repo_type='model').private:
                raise SystemExit(f'{args.repo} is PUBLIC. Make it private on huggingface.co (Settings) or choose another --repo.')
        except RepositoryNotFoundError:
            api.create_repo(args.repo, repo_type='model', private=True)
            print(f'Created private model repo {args.repo}')
        commit = api.upload_folder(repo_id=args.repo, repo_type='model', folder_path=str(staging),
                                   commit_message='Publish SignSpeak bundle', delete_patterns=['audio/*', 'audio/**'])
        print(f'Published: {getattr(commit, "commit_url", args.repo)}')
        print('Render: Manual Deploy -> "Restart service" (or "Deploy latest commit") to load it.')
    finally:
        shutil.rmtree(staging, ignore_errors=True)


if __name__ == '__main__':
    main()
