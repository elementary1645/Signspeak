"""Real classifier inference and per-camera temporal filtering. No fallback predictions."""
from collections import deque
from pathlib import Path
import time
import joblib
import numpy as np
import sklearn
from .features import DIM, SCHEMA
from .vocabulary import fingerprint

BUNDLE_VERSION = 2
DEFAULT_POLICY = {'min_confidence': 0.8, 'min_margin': 0.15}


class Recognizer:
    def __init__(self, path, vocabulary):
        # Pickle/joblib is executable: only use artifacts trained by this project locally.
        bundle = joblib.load(Path(path))
        if not isinstance(bundle, dict) or bundle.get('bundle_version') != BUNDLE_VERSION:
            raise ValueError('Unsupported model bundle; retrain with Phase 2 pipeline')
        self.model = bundle.get('model')
        self.labels = bundle.get('labels')
        metadata = bundle.get('metadata', {})
        if bundle.get('schema') != SCHEMA or metadata.get('feature_dim') != DIM:
            raise ValueError('Model feature schema mismatch')
        if metadata.get('sklearn_version') != sklearn.__version__:
            raise ValueError('scikit-learn version mismatch; use locked environment or retrain')
        if not isinstance(self.labels, list) or len(self.labels) < 2 or len(set(self.labels)) != len(self.labels):
            raise ValueError('Invalid model labels')
        if any(label not in vocabulary for label in self.labels):
            raise ValueError('Model includes an unverified or revoked sign')
        selected = {label: vocabulary[label] for label in self.labels}
        self.vocabulary_hash = fingerprint(selected)
        if metadata.get('vocabulary_sha256') != self.vocabulary_hash:
            raise ValueError('Vocabulary reference/review changed; retrain')
        if metadata.get('data_origin') != 'browser_collection' or not metadata.get('dataset_sha256'):
            raise ValueError('Missing real-data provenance declaration')
        if not hasattr(self.model, 'predict_proba') or getattr(self.model, 'n_features_in_', None) != DIM:
            raise ValueError('Model does not expose compatible probability scores')
        if list(self.model.classes_) != self.labels:
            raise ValueError('Model class order differs from label mapping')
        self.policy = bundle.get('rejection_policy', {})
        if set(self.policy) != set(DEFAULT_POLICY) or any(
                not isinstance(v, (int, float)) or not np.isfinite(v) or not 0 <= v <= 1
                for v in self.policy.values()):
            raise ValueError('Invalid rejection thresholds')
        if metadata.get('confidence_kind') not in ('uncalibrated_forest_vote', 'group_calibrated_svm'):
            raise ValueError('Missing confidence semantics')
        self.vocabulary = selected
        self.metadata = metadata

    def compatible_with(self, vocabulary):
        return all(label in vocabulary for label in self.labels) and fingerprint(
            {label: vocabulary[label] for label in self.labels}) == self.vocabulary_hash

    def predict(self, features):
        x = np.asarray(features, dtype=float)
        if x.shape != (DIM,) or not np.isfinite(x).all():
            raise ValueError('Invalid inference features')
        mask = x[-2:]
        if any(v not in (0, 1) for v in mask) or sum(mask) == 0:
            raise ValueError('Invalid inference hand mask')
        started = time.perf_counter()
        probabilities = np.asarray(self.model.predict_proba([x]), dtype=float)
        latency_ms = (time.perf_counter() - started) * 1000
        if probabilities.shape != (1, len(self.labels)) or not np.isfinite(probabilities).all():
            raise ValueError('Invalid classifier confidence output')
        p = probabilities[0]
        if np.any(p < 0) or np.any(p > 1) or not np.isclose(p.sum(), 1, atol=1e-5):
            raise ValueError('Classifier probabilities out of bounds')
        order = np.argsort(p)
        label = self.labels[int(order[-1])]
        confidence = float(p[order[-1]])
        margin = float(confidence - p[order[-2]])
        accepted = (confidence >= self.policy['min_confidence'] and margin >= self.policy['min_margin']
                    and sum(mask) == self.vocabulary[label]['hand_count'])
        return {'state': 'candidate' if accepted else 'unknown',
                'label': label if accepted else None, 'confidence': confidence,
                'margin': margin, 'classifier_latency_ms': latency_ms,
                'confidence_kind': self.metadata['confidence_kind']}


class Stabilizer:
    """Three consecutive accepted frames + minimum dwell, max gap and repeat cooldown."""
    def __init__(self, frames=3, dwell_seconds=0.5, max_gap=1.5, cooldown=2.0):
        self.frames = frames
        self.dwell = dwell_seconds
        self.max_gap = max_gap
        self.cooldown = cooldown
        self.history = deque(maxlen=frames)
        self.started = None
        self.previous_time = None
        self.released = True
        self.last_emitted_times = {}
        self.last_emitted = None
        self.last_emitted_time = float('-inf')

    def update(self, prediction, now):
        output = dict(prediction, stable=False, stable_label=None, event=None, smoothed_confidence=None)
        if self.previous_time is not None and (now <= self.previous_time or now - self.previous_time > self.max_gap):
            self.history.clear()
            self.started = None
            self.released = True
        self.previous_time = now
        label = prediction.get('label')
        if not label or prediction.get('state') != 'candidate':
            self.history.clear()
            self.started = None
            self.released = True
            return output
        if self.history and self.history[-1][0] != label:
            self.history.clear()
            self.started = None
            self.released = True
        if self.started is None:
            self.started = now
        self.history.append((label, prediction['confidence']))
        output['smoothed_confidence'] = sum(c for _, c in self.history) / len(self.history)
        if len(self.history) == self.frames and now - self.started >= self.dwell:
            output.update(state='stable', stable=True, stable_label=label)
            # Continuous holding emits once. Release/change then cooldown allows a repeat.
            if ((self.last_emitted != label or self.released) and
                    now - self.last_emitted_times.get(label, float('-inf')) >= self.cooldown):
                output['event'] = label
                self.last_emitted, self.last_emitted_time = label, now
                self.last_emitted_times[label] = now
                self.released = False
        return output

    def reset(self):
        self.history.clear()
        self.started = None
        self.previous_time = None
        self.released = True
