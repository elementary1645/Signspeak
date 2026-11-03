"""Train only on reviewed real records; refuse splits missing classes."""
import argparse
from datetime import datetime, timezone
import hashlib
import sklearn
import json
from pathlib import Path
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit, GroupKFold
from sklearn.calibration import CalibratedClassifierCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from backend.app.dataset import Record, vocabulary
from backend.app.vocabulary import fingerprint
from backend.app.recognition import BUNDLE_VERSION, DEFAULT_POLICY
from backend.app.features import SCHEMA

SEED = 42


def load_records(path, *, payload=None):
    records = []
    seen = set()
    content = Path(path).read_text() if payload is None else payload
    for line_number, line in enumerate(content.splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = Record.model_validate_json(line)
            if record.sample_id in seen:
                raise ValueError('Duplicate sample ID')
            seen.add(record.sample_id)
            records.append(record)
        except ValueError as exc:
            raise ValueError(f'Invalid dataset line {line_number}: {exc}') from exc
    recording_groups = {}
    frame_keys = set()
    for record in records:
        take = record.recording_id
        identity = (record.signer_id, record.session_id, record.sign_class)
        if take in recording_groups and recording_groups[take] != identity:
            raise ValueError('Recording ID spans signers, sessions or labels')
        recording_groups[take] = identity
        frame_key = (*identity, take, record.timestamp_ms)
        if frame_key in frame_keys:
            raise ValueError('Duplicate frame timestamp in recording')
        frame_keys.add(frame_key)
    return records


def split_records(records, group_by='signer'):
    if group_by not in ('signer', 'session'):
        raise ValueError('Unknown grouping policy')
    if len(records) < 4:
        raise ValueError('Insufficient labelled data: need multiple classes and independent groups')
    labels = np.array([r.sign_class for r in records])
    groups = np.array([r.signer_id if group_by == 'signer' else
                       f'{r.signer_id}/{r.session_id}' for r in records])
    classes = set(labels)
    if len(classes) < 2 or len(set(groups)) < 2:
        raise ValueError('Need at least two classes and two independent groups')
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=SEED)
    train, test = next(splitter.split(labels, labels, groups))
    if set(labels[train]) != classes or set(labels[test]) != classes:
        raise ValueError('Fixed grouped split lacks class coverage; collect more groups per class')
    return train, test, groups


def train(dataset, output, algorithm='rf', group_by='signer', data_origin='unconfirmed'):
    snapshot = Path(dataset).read_bytes()
    reviewed = vocabulary()
    records = load_records(dataset, payload=snapshot.decode('utf-8'))
    train_idx, test_idx, groups = split_records(records, group_by)
    x = np.array([r.features for r in records])
    y = np.array([r.sign_class for r in records])
    calibration_groups = []
    if algorithm == 'rf':
        model = RandomForestClassifier(n_estimators=200, random_state=SEED, class_weight='balanced', n_jobs=-1)
        confidence_kind = 'uncalibrated_forest_vote'
    elif algorithm == 'svm':
        folds = list(GroupKFold(n_splits=min(3, len(set(groups[train_idx])))).split(
            x[train_idx], y[train_idx], groups[train_idx]))
        for fit, calibration in folds:
            calibration_groups.append({'fit': sorted(set(groups[train_idx][fit])),
                                       'calibration': sorted(set(groups[train_idx][calibration]))})
            if set(y[train_idx][fit]) != set(y) or set(y[train_idx][calibration]) != set(y):
                raise ValueError('Insufficient independent groups per class for SVM calibration')
        model = CalibratedClassifierCV(
            make_pipeline(StandardScaler(), SVC(kernel='rbf', class_weight='balanced', random_state=SEED)),
            cv=folds, method='sigmoid')
        confidence_kind = 'group_calibrated_svm'
    else:
        raise ValueError('Unsupported algorithm')
    model.fit(x[train_idx], y[train_idx])
    prediction = model.predict(x[test_idx])
    labels = sorted(set(y))
    metrics = {'accuracy': accuracy_score(y[test_idx], prediction),
               'macro_f1': f1_score(y[test_idx], prediction, average='macro'),
               'per_class': classification_report(y[test_idx], prediction, labels=labels, output_dict=True, zero_division=0),
               'confusion_matrix': confusion_matrix(y[test_idx], prediction, labels=labels).tolist(),
               'labels': labels, 'seed': SEED, 'group_by': group_by,
               'train_groups': sorted(set(groups[train_idx])), 'test_groups': sorted(set(groups[test_idx])),
               'train_samples': len(train_idx), 'test_samples': len(test_idx),
               'limitations': 'Closed vocabulary, frame-level static features; unknown signs may be misclassified.'}
    destination = Path(output)
    destination.mkdir(parents=True, exist_ok=True)
    selected = {label: reviewed[label] for label in labels}
    if selected != {label: vocabulary().get(label) for label in labels}:
        raise ValueError('Vocabulary changed during training; retry with a stable registry')
    metadata = {
        'feature_dim': x.shape[1], 'sklearn_version': sklearn.__version__,
        'trained_at': datetime.now(timezone.utc).isoformat(), 'algorithm': algorithm,
        'seed': SEED, 'calibration_groups': calibration_groups, 'dataset_sha256': hashlib.sha256(snapshot).hexdigest(),
        'vocabulary_sha256': fingerprint(selected), 'vocabulary': selected,
        'data_origin': data_origin, 'confidence_kind': confidence_kind,
        'evaluation': metrics,
    }
    joblib.dump({'bundle_version': BUNDLE_VERSION, 'model': model, 'schema': SCHEMA,
                 'labels': labels, 'metadata': metadata, 'rejection_policy': DEFAULT_POLICY},
                destination / 'baseline.joblib')
    (destination / 'metadata.json').write_text(json.dumps(metadata, indent=2))
    (destination / 'metrics.json').write_text(json.dumps(metrics, indent=2))
    (destination / 'labels.json').write_text(json.dumps(labels, indent=2))
    return metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='data/processed/samples.jsonl')
    parser.add_argument('--output', default='backend/models/baseline')
    parser.add_argument('--algorithm', choices=['rf', 'svm'], default='rf')
    parser.add_argument('--group-by', choices=['signer', 'session'], default='signer')
    parser.add_argument('--confirm-real-data', action='store_true',
                        help='Attest that samples are genuine browser-collected signs, not generated fixtures')
    args = parser.parse_args()
    if not args.confirm_real_data:
        parser.exit(2, 'Training not evaluated: pass --confirm-real-data only after auditing genuine collected samples\n')
    try:
        result = train(args.data, args.output, args.algorithm, args.group_by, data_origin='browser_collection')
    except (ValueError, OSError) as exc:
        parser.exit(2, f'Training not evaluated: {exc}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
