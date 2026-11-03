"""Describe real dataset quality without training or silently dropping invalid records."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import numpy as np
from .train import load_records, split_records


def audit(path):
    records = load_records(path)
    counts = Counter(r.sign_class for r in records)
    signers, sessions, takes = defaultdict(set), defaultdict(set), defaultdict(set)
    signatures = Counter()
    for r in records:
        signers[r.sign_class].add(r.signer_id)
        sessions[r.sign_class].add((r.signer_id, r.session_id))
        takes[r.sign_class].add(r.recording_id)
        signatures[hashlib.sha256(np.asarray(r.features, dtype='<f8').tobytes()).hexdigest()] += 1
    warnings = []
    if len(counts) < 2:
        warnings.append('At least two reviewed classes are required')
    if any(len(group) < 2 for group in signers.values()):
        warnings.append('Some classes have fewer than two signers; unseen-signer evaluation is not credible')
    if counts and max(counts.values()) > 3 * min(counts.values()):
        warnings.append('Class imbalance exceeds 3:1')
    duplicates = sum(n - 1 for n in signatures.values())
    if duplicates:
        warnings.append('Exact duplicate feature vectors exist; investigate before evaluation')
    try:
        split_records(records)
        split_ready = True
    except ValueError as exc:
        split_ready = False
        warnings.append(str(exc))
    return {'samples': len(records), 'per_class': {
        label: {'samples': counts[label], 'signers': len(signers[label]),
                'sessions': len(sessions[label]), 'recordings': len(takes[label])}
        for label in sorted(counts)}, 'exact_duplicate_features': duplicates,
        'fixed_signer_split_ready': split_ready, 'warnings': warnings,
        'note': 'Split readiness is a structural check, not proof of dataset authenticity or adequate size.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='data/processed/samples.jsonl')
    args = parser.parse_args()
    try:
        print(json.dumps(audit(args.data), indent=2))
    except (ValueError, OSError) as exc:
        parser.exit(2, f'Dataset unavailable or invalid: {exc}\n')


if __name__ == '__main__':
    main()
