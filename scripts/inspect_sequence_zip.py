"""Read-only ZIP audit; never extract files or enable NumPy pickle loading."""
import argparse
from collections import Counter, defaultdict
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile
import numpy as np


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inspect(path):
    report = {'archive': str(path), 'bytes': path.stat().st_size, 'sha256': sha256(path),
              'numpy_version': np.__version__}
    groups = defaultdict(dict)
    shapes, dtypes, frame_hashes, sequence_hashes = Counter(), Counter(), Counter(), Counter()
    frame_labels, sequence_labels = defaultdict(set), defaultdict(set)
    errors, unsafe, other, representatives = [], [], [], []
    # Hypothesis only: classic Holistic pose/face/left/right concatenation.
    blocks = {'pose_candidate': (0, 132), 'face_candidate': (132, 1536),
              'left_hand_candidate': (1536, 1599), 'right_hand_candidate': (1599, 1662)}
    stats = {k: {'zero_frames': 0, 'min': float('inf'), 'max': float('-inf')} for k in blocks}
    lo, hi, nonfinite, allzero, moving, repeated_adjacent = float('inf'), float('-inf'), 0, 0, 0, 0
    deltas = []
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        report.update(entries=len(infos), uncompressed_bytes=sum(i.file_size for i in infos),
                      duplicate_paths=[n for n,c in Counter(i.filename for i in infos).items() if c > 1])
        for info in infos:
            p = PurePosixPath(info.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in info.filename:
                unsafe.append(info.filename)
            if info.is_dir():
                continue
            parts = p.parts
            if len(parts) >= 4 and parts[0] == 'MP_Data' and p.suffix == '.npy' and parts[-2].isdigit() and p.stem.isdigit():
                groups[('/'.join(parts[1:-2]), parts[-2])][int(p.stem)] = info
            else:
                other.append(info.filename)
        # Reading every member checks CRC as well as decompressibility. No extraction.
        for (label, seq), frames in sorted(groups.items()):
            arrays = []
            for frame, info in sorted(frames.items()):
                try:
                    if info.file_size > 1024 * 1024:
                        raise ValueError('Unexpected member >1 MiB')
                    raw = z.read(info)
                    a = np.load(io.BytesIO(raw), allow_pickle=False)
                    shapes[str(a.shape)] += 1
                    dtypes[str(a.dtype)] += 1
                    if not np.issubdtype(a.dtype, np.number):
                        raise ValueError('Non-numeric array')
                    nonfinite += int((~np.isfinite(a)).sum())
                    lo, hi = min(lo, float(a.min())), max(hi, float(a.max()))
                    allzero += int(not np.any(a))
                    h = hashlib.sha256(a.tobytes()).hexdigest()
                    frame_hashes[h] += 1
                    frame_labels[h].add(label)
                    arrays.append(a)
                    if a.shape == (1662,):
                        for name, (start, end) in blocks.items():
                            b = a[start:end]
                            s = stats[name]
                            s['zero_frames'] += int(not np.any(b))
                            s['min'] = min(s['min'], float(b.min()))
                            s['max'] = max(s['max'], float(b.max()))
                    if seq == '0' and frame in (0, 15, 29) and label in ('aboard', 'hello', 'thankyou'):
                        representatives.append({'path': info.filename, 'shape': list(a.shape), 'dtype': str(a.dtype),
                            'first_12': a[:12].tolist(), 'last_12': a[-12:].tolist(),
                            'candidate_block_first_8': {k:a[s:s+8].tolist() for k,(s,e) in blocks.items()}})
                except Exception as exc:
                    errors.append({'path': info.filename, 'error': str(exc)})
            if arrays and len({a.shape for a in arrays}) == 1:
                x = np.stack(arrays)
                h = hashlib.sha256(x.tobytes()).hexdigest()
                sequence_hashes[h] += 1
                sequence_labels[h].add(label)
                d = np.diff(x, axis=0)
                moving += int(np.any(d))
                repeated_adjacent += int(np.sum(np.all(d == 0, axis=tuple(range(1, d.ndim)))))
                deltas.append(float(np.mean(np.abs(d))))
        # Non-array members, if any, still need CRC verification.
        for name in other:
            with z.open(name) as f:
                while f.read(1024 * 1024):
                    pass
    classes = defaultdict(list)
    anomalies = []
    for (label, seq), frames in groups.items():
        classes[label].append(int(seq))
        if sorted(frames) != list(range(30)):
            anomalies.append({'class':label,'sequence':seq,'frame_indices': sorted(frames)})
    report.update(classes=len(classes), sequences=len(groups), frames=sum(len(f) for f in groups.values()),
        per_class={k:{'sequences':len(v),'sequence_ids':sorted(v), 'frames':sum(len(groups[(k,str(i))]) for i in v)} for k,v in sorted(classes.items())},
        frames_per_sequence=dict(Counter(len(f) for f in groups.values())), shapes=dict(shapes), dtypes=dict(dtypes),
        global_min=lo, global_max=hi, nonfinite_values=nonfinite, all_zero_frames=allzero,
        candidate_blocks=stats, representative_arrays=representatives, non_array_files=other,
        unsafe_paths=unsafe, frame_index_anomalies=anomalies, array_or_crc_errors=errors,
        exact_duplicate_frame_excess=sum(c-1 for c in frame_hashes.values()),
        frame_hashes_shared_across_classes=sum(len(v)>1 for v in frame_labels.values()),
        exact_duplicate_sequence_excess=sum(c-1 for c in sequence_hashes.values()),
        sequence_hashes_shared_across_classes=sum(len(v)>1 for v in sequence_labels.values()),
        sequences_with_numeric_change=moving, identical_adjacent_frames=repeated_adjacent,
        mean_absolute_adjacent_delta_range=[min(deltas),max(deltas)] if deltas else None,
        integrity_note='Every array member read fully (ZIP CRC checked) and loaded with allow_pickle=False; no extraction. CRC is not provenance authentication.')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.archive)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('per_class','representative_arrays')}, indent=2))
