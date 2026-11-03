"""Optional startup download of the trained bundle (+ metrics, audio) from a private
Hugging Face model repo, for hosts that build from GitHub (Render), where the bundle is
never committed.

Env: MODEL_REPO=<user>/<repo> (unset = skip), HF_TOKEN (read-only token for a private repo).
Runs in a background thread so /health answers immediately. The bundle is verified with
the current vocabulary BEFORE it is installed; on any failure the server keeps its
previous state (honestly "model not trained" when no local bundle exists).
"""
import os
from pathlib import Path
import shutil
import tempfile
import threading
from . import vocab
from .audio import DIST_AUDIO
from .model import LiveModel, model_path

AUDIO_DEST = DIST_AUDIO
ALLOW = ['model.joblib', 'metrics.json', 'audio/*', 'audio/**']


def snapshot_download(**kwargs):
    from huggingface_hub import snapshot_download as download
    return download(**kwargs)


def fetch_and_install(service, repo, token=None):
    """Download, verify, install, reload. Returns True when the remote model is live."""
    service.code, service.detail = 'MODEL_LOADING', 'Downloading the trained model…'
    workdir = Path(tempfile.mkdtemp(prefix='signspeak-model-'))
    try:
        local = Path(snapshot_download(repo_id=repo, repo_type='model', token=token or None,
                                       allow_patterns=ALLOW, local_dir=str(workdir)))
        bundle = local / 'model.joblib'
        if not bundle.is_file():
            raise ValueError('the repo has no model.joblib')
        LiveModel(bundle, vocab.verified())  # refuse anything the server would reject
        dest = model_path()
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(bundle, dest)
        if (local / 'metrics.json').is_file():
            shutil.copyfile(local / 'metrics.json', dest.parent / 'metrics.json')
        if (local / 'audio').is_dir():
            shutil.copytree(local / 'audio', AUDIO_DEST, dirs_exist_ok=True)
        service.load()
        return service.model is not None
    except Exception as exc:  # network, auth, missing files, incompatible bundle
        reason = f'{type(exc).__name__}: {str(exc)[:200]}'
        service.load()  # back to whatever is on disk (usually: not trained)
        if service.model is None:
            service.code = 'MODEL_NOT_TRAINED'
            service.detail = f'Model not trained yet (could not use the published model: {reason})'
        return False
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def start(service):
    """Start the background download if MODEL_REPO is set; returns the thread or None."""
    repo = os.getenv('MODEL_REPO', '').strip()
    if not repo:
        return None
    thread = threading.Thread(target=fetch_and_install, args=(service, repo, os.getenv('HF_TOKEN')),
                              name='model-fetch', daemon=True)
    thread.start()
    return thread
