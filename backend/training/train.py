"""Train only on reviewed real records; refuse splits missing classes."""
import argparse
import json
from pathlib import Path
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from backend.app.dataset import Record
from backend.app.features import SCHEMA

SEED = 42


def load_records(path):
    records = []
    seen = set()
    for line_number, line in enumerate(Path(path).read_text().splitlines(), 1):
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
    return records


def split_records(records, group_by='signer'):
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


def train(dataset, output, algorithm='rf', group_by='signer'):
    records = load_records(dataset)
    train_idx, test_idx, groups = split_records(records, group_by)
    x = np.array([r.features for r in records])
    y = np.array([r.sign_class for r in records])
    model = (RandomForestClassifier(n_estimators=200, random_state=SEED, class_weight='balanced', n_jobs=-1)
             if algorithm == 'rf' else make_pipeline(StandardScaler(), SVC(kernel='rbf', class_weight='balanced')))
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
    joblib.dump({'model': model, 'schema': SCHEMA, 'labels': labels}, destination / 'baseline.joblib')
    (destination / 'metrics.json').write_text(json.dumps(metrics, indent=2))
    (destination / 'labels.json').write_text(json.dumps(labels, indent=2))
    return metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='data/processed/samples.jsonl')
    parser.add_argument('--output', default='backend/models/baseline')
    parser.add_argument('--algorithm', choices=['rf', 'svm'], default='rf')
    parser.add_argument('--group-by', choices=['signer', 'session'], default='signer')
    args = parser.parse_args()
    try:
        result = train(args.data, args.output, args.algorithm, args.group_by)
    except (ValueError, FileNotFoundError) as exc:
        parser.exit(2, f'Training not evaluated: {exc}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
