"""Validate signers' downloaded take files and merge them into data/processed/takes.jsonl.

  python -m scripts.merge_takes path/to/signspeak-takes-*.jsonl data/raw/takes/

Malformed takes and duplicates (same take_id or identical frames) are rejected and
reported; already-merged takes are skipped. Output is git-ignored.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
from backend.live.takes import content_hash, read_jsonl, validate_take

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / 'data/processed/takes.jsonl'


def input_files(paths):
    for path in map(Path, paths):
        if path.is_dir():
            yield from sorted(path.glob('*.jsonl'))
        else:
            yield path


def merge(inputs, out=DEFAULT_OUT):
    out = Path(out)
    kept, ids, hashes = [], {}, set()
    if out.exists():
        for number, raw in read_jsonl(out):
            if isinstance(raw, ValueError):
                raise ValueError(f'Existing {out}:{number} is corrupt: {raw}')
            validate_take(raw)
            ids[raw['take_id']] = content_hash(raw)
            hashes.add(ids[raw['take_id']])
            kept.append(raw)
    existing = len(kept)
    rejected, skipped = [], 0
    for path in input_files(inputs):
        if path.resolve() == out.resolve():
            continue
        for number, raw in read_jsonl(path):
            where = f'{path.name}:{number}'
            if isinstance(raw, ValueError):
                rejected.append((where, str(raw)))
                continue
            try:
                meta, _ = validate_take(raw)
            except ValueError as exc:
                rejected.append((where, str(exc)))
                continue
            digest = content_hash(raw)
            if ids.get(meta['take_id']) == digest:
                skipped += 1
                continue
            if meta['take_id'] in ids:
                rejected.append((where, 'take_id already merged with different frames'))
                continue
            if digest in hashes:
                rejected.append((where, 'identical frames already merged under another take_id'))
                continue
            ids[meta['take_id']] = digest
            hashes.add(digest)
            kept.append(raw)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8', newline='\n') as stream:
        for raw in kept:
            stream.write(json.dumps(raw, separators=(',', ':')) + '\n')
    tmp.replace(out)
    return {'added': len(kept) - existing, 'total': len(kept), 'skipped_already_merged': skipped,
            'rejected': rejected,
            'by_signer_label': Counter((t['signer_id'], t['label']) for t in kept)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('inputs', nargs='+', help='downloaded .jsonl files or folders of them')
    parser.add_argument('--out', default=str(DEFAULT_OUT))
    parser.add_argument('--strict', action='store_true', help='exit non-zero if anything was rejected')
    args = parser.parse_args()
    try:
        report = merge(args.inputs, args.out)
    except (ValueError, OSError) as exc:
        parser.exit(2, f'Merge failed: {exc}\n')
    for where, reason in report['rejected']:
        print(f'REJECTED {where}: {reason}')
    print(f"Added {report['added']}, skipped {report['skipped_already_merged']} already merged, "
          f"rejected {len(report['rejected'])}. Total takes in {args.out}: {report['total']}")
    for (signer, label), count in sorted(report['by_signer_label'].items()):
        print(f'  {signer:20s} {label:12s} {count}')
    if args.strict and report['rejected']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
