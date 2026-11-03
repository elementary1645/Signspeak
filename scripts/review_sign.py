"""Apply one human-authored review. This command does not verify a gesture itself."""
import argparse
import json
from pathlib import Path
from backend.app.dataset import VOCABULARY
from backend.app.vocabulary import SignReview, verified_entries


def apply_review(review_file, registry=VOCABULARY):
    review = SignReview.model_validate_json(Path(review_file).read_text())
    path = Path(registry)
    entries = json.loads(path.read_text())
    if any(e['label'] == review.label and e.get('pipeline', 'hands-v1') != 'hands-v1' for e in entries):
        raise ValueError('Label belongs to the hp-v1 registry; use python -m scripts.verify_sign instead')
    if any(e['label'] == review.label and e.get('verified') is True for e in entries):
        raise ValueError('Already approved: revoke explicitly in registry before changing reference; retrain afterwards')
    entries = [e for e in entries if e['label'] != review.label] + [review.model_dump()]
    verified_entries(entries)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(entries, indent=2) + '\n')
    temporary.replace(path)
    return review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review_file')
    parser.add_argument('--confirm-human-review', action='store_true', required=True,
                        help='Attest that a human watched the exact official sign reference and authored this decision')
    args = parser.parse_args()
    try:
        review = apply_review(args.review_file)
    except (ValueError, OSError) as exc:
        parser.exit(2, f'Review not applied: {exc}\n')
    print(f'{review.label}: {"approved for collection" if review.verified else "excluded"}. Restart server; retrain if registry changed.')


if __name__ == '__main__':
    main()
