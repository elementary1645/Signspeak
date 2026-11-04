"""hp-v1 model bundle: loading with compatibility checks, and the shared accept/reject rule.

joblib/pickle executes code on load: only load bundles trained locally by this project.
"""
import os
from pathlib import Path
import time
import joblib
import numpy as np
import sklearn
from . import features, vocab
from .capture import accepted_protocols, for_schema
from .hand_validation import POLICY

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = ROOT / 'backend/models/live/model.joblib'
BUNDLE_VERSION = 'hp-live-2'


def model_path():
    return Path(os.getenv('LIVE_MODEL_PATH', str(DEFAULT_MODEL)))


def decide(probabilities, labels, thresholds):
    """Return (label or None, confidence, margin, top_label, reason). Used in training and live.

    Unknown = NONE wins, or confidence/margin below the tuned thresholds. NONE is never returned.
    """
    p = np.asarray(probabilities, dtype=float)
    order = np.argsort(p)[::-1]
    top = str(labels[int(order[0])])
    confidence = float(p[order[0]])
    margin = float(confidence - (p[order[1]] if len(p) > 1 else 0.0))
    if top == vocab.NONE_LABEL:
        return None, confidence, margin, top, 'none'
    if confidence < thresholds['min_confidence'] or margin < thresholds['min_margin']:
        return None, confidence, margin, top, 'low_confidence'
    return top, confidence, margin, top, 'accepted'


class LiveModel:
    def __init__(self, path, admitted):
        bundle = joblib.load(Path(path))
        if not isinstance(bundle, dict) or bundle.get('bundle_version') != BUNDLE_VERSION:
            raise ValueError('Not a versioned hp live bundle; retrain with python -m backend.live.train')
        temporal = features.for_schema(bundle.get('schema'))
        capture_protocol, timing = for_schema(temporal.SCHEMA)
        if (bundle.get('feature_dim') != temporal.SUMMARY_DIM
                or bundle.get('window') != temporal.WINDOW or bundle.get('fps') != temporal.FPS
                or bundle.get('capture_protocol') != capture_protocol
                or bundle.get('accepted_capture_protocols') != accepted_protocols(temporal.SCHEMA)
                or bundle.get('temporal') != timing):
            raise ValueError('Feature schema/window mismatch; retrain')
        if temporal.SCHEMA == 'hp-v2-8fps' and bundle.get('hand_validation') != POLICY:
            raise ValueError('Hand observation validation policy mismatch; retrain with validated recordings')
        if bundle.get('sklearn_version') != sklearn.__version__:
            raise ValueError(f'scikit-learn {bundle.get("sklearn_version")} bundle, {sklearn.__version__} installed; retrain or use the lock file')
        labels = bundle.get('labels')
        if not isinstance(labels, list) or len(labels) < 2 or len(set(labels)) != len(labels):
            raise ValueError('Invalid model labels')
        signs = [label for label in labels if label != vocab.NONE_LABEL]
        missing = [label for label in signs if label not in admitted]
        if missing:
            raise ValueError(f'Model includes unverified or revoked signs: {missing}')
        if bundle.get('vocab_fingerprint') != vocab.selection_fingerprint(admitted, signs):
            raise ValueError('Vocabulary entries changed since training; retrain')
        model = bundle.get('model')
        if [str(c) for c in getattr(model, 'classes_', [])] != labels or getattr(model, 'n_features_in_', None) != features.SUMMARY_DIM:
            raise ValueError('Model classes/feature count do not match bundle')
        thresholds = bundle.get('thresholds') or {}
        if set(thresholds) != {'min_confidence', 'min_margin'} or not all(
                isinstance(v, float) and 0 <= v <= 1 for v in thresholds.values()):
            raise ValueError('Invalid thresholds')
        self.bundle, self.model, self.labels, self.thresholds = bundle, model, labels, thresholds
        self.signs = signs
        self.features = temporal
        self.capture_protocol = capture_protocol

    def compatible_with(self, admitted):
        return (all(label in admitted for label in self.signs)
                and vocab.selection_fingerprint(admitted, self.signs) == self.bundle['vocab_fingerprint'])

    def predict(self, window):
        x = self.features.summarize(window)
        started = time.perf_counter()
        p = self.model.predict_proba(x[None, :])[0]
        latency_ms = (time.perf_counter() - started) * 1000
        if p.shape != (len(self.labels),) or not np.isfinite(p).all():
            raise ValueError('Invalid classifier output')
        label, confidence, margin, top, reason = decide(p, self.labels, self.thresholds)
        return {'label': label, 'confidence': confidence, 'margin': margin, 'top_label': top,
                'reason': reason, 'model_latency_ms': latency_ms}

    def info(self):
        b = self.bundle
        return {'schema': b['schema'], 'fps': b['fps'], 'window': b['window'],
                'capture_protocol': self.capture_protocol, 'accepted_capture_protocols': b['accepted_capture_protocols'],
                'temporal': b['temporal'], 'hand_validation': b.get('hand_validation'), 'labels': self.signs, 'algorithm': b['algorithm'], 'trained_at': b['trained_at'],
                'thresholds': self.thresholds, 'signers': b['counts']['signers'],
                'generalisation_to_unseen_signers_measured': b['generalisation_to_unseen_signers_measured']}
