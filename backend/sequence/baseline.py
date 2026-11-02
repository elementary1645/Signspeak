"""Review-gated CPU research baseline. No production artifact or API registration.

Serialized pickle/joblib is executable: load ONLY locally trusted project artifacts.
"""
from dataclasses import asdict
import hashlib
import re
import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix
from backend.app.dataset import vocabulary
from backend.app.vocabulary import fingerprint
from .schema import Contract, SCHEMA
from .features import summarize, FEATURE_SCHEMA, FEATURE_DIM


def digest(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def selected_reviews(labels, mapping):
    approved = vocabulary()  # Existing strict human review remains authoritative.
    if set(mapping) != set(labels) or len(set(mapping.values())) != len(mapping):
        raise ValueError('One explicit, unique reviewed mapping per source label is required')
    if any(label not in approved for label in mapping.values()):
        raise ValueError('Unapproved vocabulary; human review required')
    return {label: approved[label] for label in sorted(mapping.values())}


def validate_evidence(evidence, contract):
    required = {'dataset_sha256', 'source_url', 'provenance_evidence', 'layout_evidence',
                'capture_protocol_evidence', 'contract_sha256'}
    if not isinstance(evidence, dict) or set(evidence) != required:
        raise ValueError('Provenance/layout/capture evidence required; no inferred defaults')
    if (not digest(evidence['dataset_sha256']) or evidence['contract_sha256'] != contract.fingerprint
            or not isinstance(evidence['source_url'], str) or not evidence['source_url'].startswith('https://')):
        raise ValueError('Invalid evidence hashes/source')
    if any(not isinstance(evidence[k], str) or len(evidence[k].strip()) < 20
           for k in ('provenance_evidence', 'layout_evidence', 'capture_protocol_evidence')):
        raise ValueError('Document evidence, not just a confirmation flag')


def fit_baseline(sequences, labels, signer_ids, *, heldout_signers, mapping, contract, evidence):
    """Train once on explicit signer partition; never split or window individual frames.

    Evidence is a human-maintained declaration, not automatically verified authenticity.
    Caller must supply actual signer IDs; sequence ordinals are not signer IDs.
    """
    if not isinstance(contract, Contract):
        raise ValueError('Explicit extraction contract required')
    validate_evidence(evidence, contract)
    labels, signers = list(labels), list(signer_ids)
    reviews = selected_reviews(set(labels), mapping)
    if len(sequences) != len(labels) or len(signers) != len(labels) or len(set(labels)) < 2:
        raise ValueError('Need aligned sequences/labels/signers and at least two classes')
    if any(not isinstance(s, str) or not re.fullmatch('[A-Za-z0-9_-]{1,48}', s) for s in signers):
        raise ValueError('Real pseudonymous signer metadata required')
    heldout = set(heldout_signers)
    if not heldout or not heldout <= set(signers):
        raise ValueError('Explicit known held-out signers required')
    train = [i for i,s in enumerate(signers) if s not in heldout]
    test = [i for i,s in enumerate(signers) if s in heldout]
    if set(labels[i] for i in train) != set(labels) or set(labels[i] for i in test) != set(labels):
        raise ValueError('Every class must occur in both signer partitions')
    # Exact-sequence leakage is fatal; near duplicates still require external review.
    seen = set()
    for value in sequences:
        from .schema import sequence
        h = hashlib.sha256(sequence(value).astype('<f8').tobytes()).hexdigest()
        if h in seen:
            raise ValueError('Duplicate sequence; investigate data independence')
        seen.add(h)
    x = np.stack([summarize(s) for s in sequences])
    y = np.array([mapping[label] for label in labels])
    model = RandomForestClassifier(n_estimators=100, max_depth=10, min_samples_leaf=2,
                                   class_weight='balanced', random_state=42, n_jobs=1)
    model.fit(x[train], y[train])
    predictions = model.predict(x[test])
    metrics = {'accuracy': float(accuracy_score(y[test], predictions)),
               'macro_f1': float(f1_score(y[test], predictions, average='macro')),
               'labels': model.classes_.tolist(),
               'confusion_matrix': confusion_matrix(y[test], predictions, labels=model.classes_).tolist(),
               'train_signers': sorted(set(signers)-heldout), 'test_signers': sorted(heldout),
               'train_sequences':len(train), 'test_sequences':len(test),
               'limitations':'Closed-set sequence research only; no webcam/open-set/CPU acceptance.'}
    return {'version':1, 'research_only':True, 'schema':SCHEMA, 'feature_schema':FEATURE_SCHEMA,
            'feature_dim':FEATURE_DIM, 'contract':asdict(contract), 'contract_sha256':contract.fingerprint,
            'sklearn_version':sklearn.__version__, 'vocabulary_sha256':fingerprint(reviews),
            'mapping':dict(mapping), 'evidence':dict(evidence), 'model':model, 'metrics':metrics}


def save_baseline(bundle, path):
    # Never emits the existing recognizer bundle format.
    if bundle.get('research_only') is not True:
        raise ValueError('Only research artifacts supported')
    joblib.dump(bundle, path)


class ResearchRecognizer:
    def __init__(self, path, contract):
        b = joblib.load(path)  # Only trusted locally produced files.
        if not isinstance(b, dict) or not isinstance(contract, Contract):
            raise ValueError('Invalid bundle or extraction contract')
        expected = {'version':1, 'research_only':True, 'schema':SCHEMA,
                    'feature_schema':FEATURE_SCHEMA, 'feature_dim':FEATURE_DIM,
                    'sklearn_version':sklearn.__version__, 'contract':asdict(contract),
                    'contract_sha256':contract.fingerprint}
        if any(b.get(k) != v for k,v in expected.items()):
            raise ValueError('Sequence model compatibility mismatch')
        validate_evidence(b['evidence'], contract)
        self.bundle = b
        self.model = b['model']
        self._check_reviews()
        if (getattr(self.model, 'n_features_in_', None) != FEATURE_DIM or
                list(self.model.classes_) != sorted(b['mapping'].values())):
            raise ValueError('Classifier dimension/class order mismatch')

    def _check_reviews(self):
        b = self.bundle
        reviews = selected_reviews(set(b['mapping']), b['mapping'])
        if fingerprint(reviews) != b['vocabulary_sha256']:
            raise ValueError('Vocabulary changed or revoked')

    def score(self, value, contract):
        """Research scores only: do not emit recognized/stable sign events."""
        if asdict(contract) != self.bundle['contract']:
            raise ValueError('Extraction contract mismatch')
        self._check_reviews()
        probabilities = self.model.predict_proba([summarize(value)])[0]
        return {'state':'research_only', 'label':None, 'scores':dict(zip(self.model.classes_, probabilities.tolist())),
                'confidence_kind':'uncalibrated_forest_vote', 'deployment_accepted':False}
