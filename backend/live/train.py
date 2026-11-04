"""Train the hp-v1 live recognizer on merged real takes. CPU scikit-learn only.

  python -m backend.live.train [--takes data/processed/takes.jsonl] [--out backend/models/live]

- Windows are cut from each take with start-offset jitter; every window keeps its take's
  group, so no window of a validation take is ever trained on.
- Leave-one-signer-out with >= 3 signers. Otherwise grouped folds by session/take, with
  a loud warning that generalisation to unseen signers is NOT measured.
- Candidates (RF, ExtraTrees, LogisticRegression, SVM) are compared by out-of-fold macro-F1.
- min_confidence/min_margin are tuned on out-of-fold (validation) predictions only;
  the reported open-set metrics use thresholds tuned without the evaluated fold.
- --threshold-source loso (fewer than 3 signers): the DEPLOYED thresholds are tuned instead on
  pooled leave-one-signer-out predictions of the chosen algorithm (each signer predicted by a
  model trained on the others). Tuned and scored on the same predictions: no independent
  test remains. With >= 3 signers the folds are already leave-one-signer-out.
- Labels must be human-verified hp-v1 vocabulary (NONE is the only exception).
"""
import argparse
import platform
import time
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import joblib
import numpy as np
import sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import LeaveOneGroupOut, StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from . import features, vocab
from .model import BUNDLE_VERSION, DEFAULT_MODEL, decide
from .takes import load_takes
from .hand_validation import POLICY
from .capture import accepted_protocols, for_schema, require_training_protocol

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TAKES = ROOT / 'data/processed/takes.jsonl'
MODEL_CARD = ROOT / 'docs/MODEL_CARD.md'
SEED = 42
CANDIDATES = {
    'random_forest': lambda: RandomForestClassifier(n_estimators=200, class_weight='balanced', random_state=SEED, n_jobs=-1),
    'extra_trees': lambda: ExtraTreesClassifier(n_estimators=200, class_weight='balanced', random_state=SEED, n_jobs=-1),
    'logistic_regression': lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, class_weight='balanced')),
    'svm_rbf': lambda: make_pipeline(StandardScaler(), CalibratedClassifierCV(
        SVC(C=3.0, class_weight='balanced', random_state=SEED), method='sigmoid', cv=3, ensemble=False)),
}
CONFIDENCE_GRID = np.round(np.arange(0.30, 0.96, 0.05), 2)
MARGIN_GRID = np.round(np.arange(0.0, 0.51, 0.05), 2)
DEFAULT_MAX_LATENCY_MS = 10.0  # per live window on the training machine; Render free has 0.1 CPU
NO_SIGNER_WARNING = ('WARNING: fewer than 3 signers. Generalisation to UNSEEN SIGNERS is NOT measured; '
                     'these numbers only describe new takes/sessions of the same people.')


class TrainingError(ValueError):
    pass


def select_takes(takes, admitted, drop_unverified=False):
    """Keep NONE + verified labels recorded against the current reference. Refuse others."""
    kept, problems = [], Counter()
    for meta, frames in takes:
        label = meta['label']
        if label != vocab.NONE_LABEL:
            if label not in admitted:
                problems[f'{label}: not verified'] += 1
                continue
            if meta['reference_url'] != admitted[label]['reference_url']:
                problems[f'{label}: recorded against a different reference URL'] += 1
                continue
        kept.append((meta, frames))
    if problems and not drop_unverified:
        detail = '; '.join(f'{k} ({v} takes)' for k, v in sorted(problems.items()))
        raise TrainingError(f'Refusing to train on unverified labels: {detail}. Verify them '
                            '(docs/HOW_TO_VERIFY_A_SIGN.md) or pass --drop-unverified to leave them out.')
    return kept, dict(problems)


def build_windows(takes, mirror_augment=False, feature_schema=features.SCHEMA):
    require_training_protocol(takes, feature_schema)
    temporal = features.for_schema(feature_schema)
    rows = {'x': [], 'y': [], 'take': [], 'signer': [], 'session': [], 'mirrored': []}
    for meta, frames in takes:
        variants = [(frames, False)] + ([(features.mirror(frames), True)] if mirror_augment else [])
        for variant, mirrored in variants:
            for window in temporal.take_windows(variant):
                rows['x'].append(temporal.summarize(window))
                rows['y'].append(meta['label'])
                rows['take'].append(meta['take_id'])
                rows['signer'].append(meta['signer_id'])
                rows['session'].append(f"{meta['signer_id']}/{meta['session_id']}")
                rows['mirrored'].append(mirrored)
    return {k: np.array(v) for k, v in rows.items()}


def make_folds(data):
    """Return (folds, scheme, measured_unseen_signers). Mirrored copies are never evaluated."""
    signers = sorted(set(data['signer']))
    evaluate = ~data['mirrored']
    if len(signers) >= 3:
        groups, scheme, measured = data['signer'], 'leave-one-signer-out', True
        splits = LeaveOneGroupOut().split(data['x'], data['y'], groups)
    else:
        sessions = set(data['session'])
        if len(sessions) >= 3:
            groups, scheme = data['session'], 'grouped-by-session'
        else:
            groups, scheme = data['take'], 'grouped-by-take'
        n = min(5, len(set(groups)))
        if n < 2:
            raise TrainingError('Need at least two independent takes/sessions')
        splitter = StratifiedGroupKFold(n_splits=n, shuffle=True, random_state=SEED)
        splits = splitter.split(data['x'], data['y'], groups)
        measured = False
    folds = []
    for train, test in splits:
        test_groups = set(groups[test])
        # Mirrored windows follow their source group: drop them from test, and from train if their group is tested.
        train = np.array([i for i in range(len(groups)) if groups[i] not in test_groups])
        test = np.array([i for i in test if evaluate[i]])
        if len(test):
            folds.append((train, test))
    return folds, scheme, measured


def aligned_proba(model, x, labels):
    p = np.zeros((len(x), len(labels)))
    columns = [labels.index(c) for c in model.classes_]
    p[:, columns] = model.predict_proba(x)
    return p


def out_of_fold(make, data, folds, labels, exclude_label=None):
    """Validation probabilities for every evaluated window (NaN rows where not evaluated)."""
    p = np.full((len(data['y']), len(labels)), np.nan)
    for train, test in folds:
        if exclude_label is not None:
            train = train[data['y'][train] != exclude_label]
        if len(set(data['y'][train])) < 2:
            continue
        model = make().fit(data['x'][train], data['y'][train])
        p[test] = aligned_proba(model, data['x'][test], labels)
    return p


def thresholded(p, labels, thresholds):
    return np.array([decide(row, labels, thresholds)[0] or vocab.NONE_LABEL for row in p])


def tune(p, y, labels):
    """Grid-search thresholds maximizing open-set macro-F1 (rejections count as NONE)."""
    best = None
    for c in CONFIDENCE_GRID:
        for m in MARGIN_GRID:
            t = {'min_confidence': float(c), 'min_margin': float(m)}
            score = f1_score(y, thresholded(p, labels, t), labels=labels, average='macro', zero_division=0)
            # Ties go to stricter thresholds: rejecting is safer than a wrong word.
            key = (round(score, 6), c, m)
            if best is None or key > best[0]:
                best = (key, t)
    return best[1]


def report(y_true, y_pred, labels):
    return {'macro_f1': float(f1_score(y_true, y_pred, labels=labels, average='macro', zero_division=0)),
            'per_class': {k: v for k, v in classification_report(
                y_true, y_pred, labels=labels, output_dict=True, zero_division=0).items() if k in labels},
            'confusion_matrix': {'labels': labels, 'rows_true_cols_pred': confusion_matrix(y_true, y_pred, labels=labels).tolist()}}


def none_false_accept(y_true, y_pred):
    none = y_true == vocab.NONE_LABEL
    return float((y_pred[none] != vocab.NONE_LABEL).mean()) if none.any() else None


THRESHOLD_SOURCES = ('grouped', 'loso')
LOSO_CAVEAT = 'Thresholds were tuned and scored on the same pooled predictions: no independent test remains.'


def counts_check(y_true, y_pred):
    """Exact counts (no rounding) for a thresholded prediction."""
    none, sign = y_true == vocab.NONE_LABEL, y_true != vocab.NONE_LABEL
    return {'windows': int(len(y_true)),
            'none_false_accept': [int((y_pred[none] != vocab.NONE_LABEL).sum()), int(none.sum())],
            'sign_rejected': [int((y_pred[sign] == vocab.NONE_LABEL).sum()), int(sign.sum())],
            'sign_correct': [int((y_pred[sign] == y_true[sign]).sum()), int(sign.sum())]}


def loso_thresholds(make, data, labels):
    """Tune thresholds on pooled leave-one-signer-out predictions of one algorithm.

    Each signer's (non-mirrored) windows are predicted by a model trained on every other
    signer only (mirrored copies follow their signer). Returns the thresholds plus per-signer
    and pooled counts, which are scored on the same predictions they were tuned on.
    """
    signers = sorted(set(data['signer']))
    if len(signers) < 2:
        raise TrainingError('--threshold-source loso needs takes from at least 2 signers')
    evaluate = ~data['mirrored']
    q = np.full((len(data['y']), len(labels)), np.nan)
    for signer in signers:
        train_idx = np.where(data['signer'] != signer)[0]
        test_idx = np.where((data['signer'] == signer) & evaluate)[0]
        missing = sorted(set(labels) - set(data['y'][train_idx]))
        if missing:
            raise TrainingError(f'--threshold-source loso: without {signer}, the other signers have no takes of {missing}')
        model = make().fit(data['x'][train_idx], data['y'][train_idx])
        q[test_idx] = aligned_proba(model, data['x'][test_idx], labels)
    mask = evaluate & ~np.isnan(q).any(axis=1)
    thresholds = tune(q[mask], data['y'][mask], labels)
    pred = thresholded(q[mask], labels, thresholds)
    y, who = data['y'][mask], data['signer'][mask]
    per_signer = {}
    for signer in signers:
        s = who == signer
        per_signer[signer] = {'macro_f1': float(f1_score(y[s], pred[s], labels=labels, average='macro', zero_division=0)),
                              **counts_check(y[s], pred[s])}
    pooled = {'macro_f1': float(f1_score(y, pred, labels=labels, average='macro', zero_division=0)), **counts_check(y, pred)}
    return {'thresholds': thresholds, 'per_signer': per_signer, 'pooled': pooled, 'caveat': LOSO_CAVEAT}


def measure_latency(name, model, x, repeats=30):
    """Median ms of one single-row predict_proba, the way the live server calls it."""
    rows = [x[i % len(x)][None, :] for i in range(repeats + 5)]
    times = []
    for i, row in enumerate(rows):
        started = time.perf_counter()
        model.predict_proba(row)
        if i >= 5:  # warm-up excluded
            times.append((time.perf_counter() - started) * 1000)
    return float(np.median(times))


def feature_latency(frames, repeats=30, feature_schema=features.SCHEMA):
    """Median ms to build + summarize one live window (same for every model)."""
    temporal = features.for_schema(feature_schema)
    times = []
    for i in range(repeats + 5):
        started = time.perf_counter()
        temporal.summarize(temporal.latest_window(frames))
        if i >= 5:
            times.append((time.perf_counter() - started) * 1000)
    return float(np.median(times))


def train(takes_path=DEFAULT_TAKES, out_dir=DEFAULT_MODEL.parent, drop_unverified=False, mirror_augment=False,
          candidates=tuple(CANDIDATES), model_card=MODEL_CARD, log=print, max_latency_ms=DEFAULT_MAX_LATENCY_MS,
          feature_schema=features.SCHEMA, threshold_source='grouped'):
    if threshold_source not in THRESHOLD_SOURCES:
        raise TrainingError(f'Unknown threshold source {threshold_source!r}; choose from {", ".join(THRESHOLD_SOURCES)}')
    temporal = features.for_schema(feature_schema)
    capture_protocol, timing = for_schema(feature_schema)
    takes_path = Path(takes_path)
    if not takes_path.exists():
        raise TrainingError(f'No merged takes at {takes_path}. Record on /collect, then run python -m scripts.merge_takes <files>')
    dataset_sha256 = hashlib.sha256(takes_path.read_bytes()).hexdigest()
    admitted = vocab.verified()
    loaded = load_takes(takes_path)
    require_training_protocol(loaded, feature_schema)
    takes, dropped = select_takes(loaded, admitted, drop_unverified)
    label_counts = Counter(meta['label'] for meta, _ in takes)
    signs = sorted(l for l in label_counts if l != vocab.NONE_LABEL)
    if vocab.NONE_LABEL not in label_counts:
        raise TrainingError('No NONE takes. Record the guided NONE prompts on /collect: they are required for rejection.')
    if not signs:
        raise TrainingError('No verified sign takes to train on.')
    thin = [l for l, n in label_counts.items() if n < 2]
    if thin:
        raise TrainingError(f'Each label needs at least 2 takes: {thin}')
    labels = signs + [vocab.NONE_LABEL]
    data = build_windows(takes, mirror_augment, feature_schema)
    folds, scheme, measured = make_folds(data)
    if not measured:
        log(NO_SIGNER_WARNING)
    evaluated = np.zeros(len(data['y']), dtype=bool)
    for _, test in folds:
        evaluated[test] = True
    y = data['y'][evaluated]

    comparison, oof = {}, {}
    for name in candidates:
        p = out_of_fold(CANDIDATES[name], data, folds, labels)
        oof[name] = p
        pred = np.array([labels[i] for i in np.argmax(p[evaluated], axis=1)])
        comparison[name] = float(f1_score(y, pred, labels=labels, average='macro', zero_division=0))
        log(f'  {name:20s} closed-set macro-F1 {comparison[name]:.3f} ({scheme})')
    # Deploy budget: fit each candidate on all data and time one live prediction.
    feature_ms = feature_latency(takes[0][1], feature_schema=feature_schema)
    fitted, latency = {}, {}
    for name in candidates:
        fitted[name] = single_threaded(CANDIDATES[name]().fit(data['x'], data['y']))
        latency[name] = round(feature_ms + measure_latency(name, fitted[name], data['x']), 3)
    eligible = [n for n in candidates if latency[n] <= max_latency_ms]
    excluded = [n for n in candidates if n not in eligible]
    for name in excluded:
        log(f'  {name:20s} excluded: {latency[name]:.1f} ms/window > --max-latency-ms {max_latency_ms}')
    if not eligible:
        raise TrainingError(f'No model meets --max-latency-ms {max_latency_ms} (measured {latency}). '
                            'Raise the limit or use a faster machine budget.')
    chosen = max(eligible, key=lambda k: (comparison[k], -list(candidates).index(k)))
    p = oof[chosen]

    # Honest open-set evaluation: each fold's thresholds are tuned on the OTHER folds' validation predictions.
    open_pred = np.empty(len(data['y']), dtype=object)
    fold_thresholds = []
    for _, test in folds:
        others = evaluated.copy()
        others[test] = False
        t = tune(p[others], data['y'][others], labels) if others.any() else tune(p[evaluated], y, labels)
        fold_thresholds.append(t)
        open_pred[test] = thresholded(p[test], labels, t)
    open_pred = open_pred[evaluated].astype(str)
    thresholds = tune(p[evaluated], y, labels)  # deployed thresholds: all validation predictions
    threshold_info = {'requested': threshold_source,
                      'tuned_on': 'leave-one-signer-out' if measured else scheme,
                      'grouped_thresholds': thresholds}
    if threshold_source == 'loso' and not measured:
        # Same-person folds overstate confidence for new people; use cross-person predictions instead.
        loso = loso_thresholds(CANDIDATES[chosen], data, labels)
        thresholds = loso['thresholds']
        threshold_info.update(tuned_on='leave-one-signer-out', loso=loso)

    closed_pred = np.array([labels[i] for i in np.argmax(p[evaluated], axis=1)])
    open_set = {}
    if len(signs) >= 2:
        for sign in signs:
            q = out_of_fold(CANDIDATES[chosen], data, folds, labels, exclude_label=sign)
            mask = evaluated & (data['y'] == sign) & ~np.isnan(q).any(axis=1)
            if mask.any():
                rejected = thresholded(q[mask], labels, thresholds) == vocab.NONE_LABEL
                open_set[sign] = {'windows': int(mask.sum()), 'rejected_rate': float(rejected.mean())}
    metrics = {
        'scheme': scheme, 'generalisation_to_unseen_signers_measured': measured,
        'warning': None if measured else NO_SIGNER_WARNING,
        'model_comparison_closed_set_macro_f1': comparison, 'chosen_model': chosen,
        'latency': {'ms_per_window': latency, 'feature_ms': round(feature_ms, 3), 'max_latency_ms': max_latency_ms,
                    'excluded_for_latency': excluded, 'measured_on': f'{platform.system()} {platform.machine()} {platform.processor()}'.strip(),
                    'note': 'single-threaded, median of 30 live-style predictions on the training machine'},
        'thresholds': thresholds, 'threshold_source': threshold_info, 'fold_thresholds': fold_thresholds,
        'closed_set': report(y, closed_pred, labels),
        'open_set_with_rejection': report(y, open_pred, labels),
        'none_false_accept_rate': none_false_accept(y, open_pred),
        'sign_rejection_rate': float((open_pred[y != vocab.NONE_LABEL] == vocab.NONE_LABEL).mean()),
        'held_out_sign_rejection': open_set or 'needs >= 2 verified signs',
        'evaluated_windows': int(evaluated.sum()),
    }
    counts = {'takes': len(takes), 'takes_per_label': dict(sorted(label_counts.items())),
              'signers': len(set(data['signer'])), 'sessions': len(set(data['session'])),
              'windows': int((~data['mirrored']).sum()), 'mirrored_windows': int(data['mirrored'].sum()),
              'takes_dropped_unverified': dropped,
              # Recorded policy per take; every take was re-checked under the current policy above.
              'takes_per_hand_validation': dict(sorted(Counter(m.get('hand_validation') or 'unrecorded' for m, _ in takes).items()))}
    model = fitted[chosen]
    bundle = {
        'bundle_version': BUNDLE_VERSION, 'schema': temporal.SCHEMA, 'feature_dim': temporal.SUMMARY_DIM,
        'capture_protocol': capture_protocol, 'accepted_capture_protocols': accepted_protocols(feature_schema),
        'temporal': timing, 'hand_validation': POLICY if feature_schema == 'hp-v2-8fps' else None,
        'window': temporal.WINDOW, 'fps': temporal.FPS, 'model': model, 'labels': [str(c) for c in model.classes_],
        'algorithm': chosen, 'thresholds': thresholds,
        'threshold_source': {'requested': threshold_source, 'tuned_on': threshold_info['tuned_on']},
        'vocab_fingerprint': vocab.selection_fingerprint(admitted, signs),
        'vocabulary': {s: admitted[s] for s in signs}, 'dataset_sha256': dataset_sha256,
        'counts': counts, 'sklearn_version': sklearn.__version__, 'seed': SEED,
        'trained_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'generalisation_to_unseen_signers_measured': measured, 'mirror_augment': mirror_augment,
    }
    if bundle['labels'] != sorted(labels):
        raise TrainingError('Final model is missing a class')
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, out_dir / 'model.joblib')
    summary = {k: v for k, v in bundle.items() if k not in ('model', 'vocabulary')}
    (out_dir / 'metrics.json').write_text(json.dumps({'bundle': summary, 'metrics': metrics}, indent=2), encoding='utf-8')
    if model_card:
        write_model_card(Path(model_card), summary, metrics)
    return summary, metrics


def single_threaded(model):
    """One live window at a time: thread start-up would dominate latency."""
    for name in model.get_params():
        if name == 'n_jobs' or name.endswith('__n_jobs'):
            model.set_params(**{name: 1})
    return model


def write_model_card(path, bundle, metrics):
    open_set = metrics['open_set_with_rejection']
    rows = '\n'.join(f"| {label} | {m['precision']:.2f} | {m['recall']:.2f} | {m['f1-score']:.2f} | {int(m['support'])} |"
                     for label, m in open_set['per_class'].items())
    held_out = metrics['held_out_sign_rejection']
    held_out_text = (held_out if isinstance(held_out, str) else
                     ', '.join(f"{k}: {v['rejected_rate']:.0%} rejected" for k, v in held_out.items()))
    source = metrics.get('threshold_source') or {'requested': 'grouped', 'tuned_on': metrics['scheme']}
    threshold_line = (f"- Thresholds: min_confidence {bundle['thresholds']['min_confidence']}, min_margin {bundle['thresholds']['min_margin']}"
                      f" · tuned on **{source['tuned_on']}** out-of-fold predictions (`--threshold-source {source['requested']}`)")
    loso = source.get('loso')
    if loso:
        def check(name, r):
            truncated = int(r['macro_f1'] * 10000) / 10000  # never rounded up
            return (f"{name} macro-F1 {truncated:.4f}, NONE false-accept {r['none_false_accept'][0]}/{r['none_false_accept'][1]}, "
                    f"signs rejected {r['sign_rejected'][0]}/{r['sign_rejected'][1]}")
        g = source['grouped_thresholds']
        threshold_line += (f" (grouped folds would have chosen {g['min_confidence']} / {g['min_margin']})"
                           f"\n- Pooled leave-one-signer-out check of these thresholds: "
                           + '; '.join([check(s, r) for s, r in loso['per_signer'].items()] + [check('pooled', loso['pooled'])])
                           + f". **{loso['caveat']}**")
    section = f"""<!-- AUTO:BEGIN (written by python -m backend.live.train; do not edit by hand) -->
## Latest trained model

- Trained: {bundle['trained_at']} · algorithm **{bundle['algorithm']}** · scikit-learn {bundle['sklearn_version']}
- Data: {bundle['counts']['takes']} takes, {bundle['counts']['signers']} signers, {bundle['counts']['sessions']} sessions, {bundle['counts']['windows']} windows · dataset sha256 `{bundle['dataset_sha256'][:16]}…`
- Features: {bundle['schema']} · capture protocol {bundle['capture_protocol']} · {bundle['window']} frames at {bundle['fps']} FPS
- Labels: {', '.join(bundle['labels'])}
- Evaluation: **{metrics['scheme']}**{'' if metrics['generalisation_to_unseen_signers_measured'] else ' · **generalisation to unseen signers NOT measured**'}
- Model comparison (closed-set macro-F1): {', '.join(f'{k} {v:.3f}' for k, v in metrics['model_comparison_closed_set_macro_f1'].items())}
{threshold_line}
- Live cost per window (features + model, single-threaded, training machine): {', '.join(f'{k} {v:.1f} ms' for k, v in metrics['latency']['ms_per_window'].items())}; limit {metrics['latency']['max_latency_ms']} ms{'; excluded ' + ', '.join(metrics['latency']['excluded_for_latency']) if metrics['latency']['excluded_for_latency'] else ''}
- Open-set macro-F1 (with rejection, thresholds tuned without the evaluated fold): {open_set['macro_f1']:.3f}
- NONE false-accept rate: {metrics['none_false_accept_rate']:.1%} · sign rejection rate: {metrics['sign_rejection_rate']:.1%}
- Held-out-sign check (model trained without the sign): {held_out_text}

| Label | Precision | Recall | F1 | Windows |
|---|---|---|---|---|
{rows}
<!-- AUTO:END -->"""
    text = path.read_text(encoding='utf-8') if path.exists() else '# Model card\n\n<!-- AUTO:BEGIN --><!-- AUTO:END -->\n'
    text = re.sub(r'<!-- AUTO:BEGIN.*?<!-- AUTO:END -->', lambda _: section, text, flags=re.S)
    path.write_text(text, encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--feature-schema', choices=['hp-v1', 'hp-v2-8fps'], default='hp-v1',
                        help='explicit temporal version; hp-v2-8fps requires separately tagged 8 FPS takes')
    parser.add_argument('--takes', default=str(DEFAULT_TAKES))
    parser.add_argument('--out', default=str(DEFAULT_MODEL.parent))
    parser.add_argument('--drop-unverified', action='store_true', help='leave out unverified labels instead of refusing')
    parser.add_argument('--mirror-augment', action='store_true', help='add mirrored copies (left-handed signers) to training folds')
    parser.add_argument('--models', default=','.join(CANDIDATES), help=f'comma list from {",".join(CANDIDATES)}')
    parser.add_argument('--max-latency-ms', type=float, default=DEFAULT_MAX_LATENCY_MS,
                        help='exclude models slower than this per live window (features + predict), measured here')
    parser.add_argument('--threshold-source', choices=THRESHOLD_SOURCES, default='grouped',
                        help='tune deployed rejection thresholds on the evaluation folds (grouped, default) or, '
                             'with fewer than 3 signers, on pooled leave-one-signer-out predictions (loso)')
    parser.add_argument('--no-model-card', action='store_true')
    args = parser.parse_args()
    sys.stdout.reconfigure(errors='replace')
    candidates = tuple(m for m in args.models.split(',') if m)
    if not candidates or any(m not in CANDIDATES for m in candidates):
        parser.exit(2, f'Unknown model in --models; choose from {",".join(CANDIDATES)}\n')
    try:
        bundle, metrics = train(args.takes, args.out, args.drop_unverified, args.mirror_augment, candidates,
                                None if args.no_model_card else MODEL_CARD, max_latency_ms=args.max_latency_ms,
                                feature_schema=args.feature_schema, threshold_source=args.threshold_source)
    except (TrainingError, ValueError, OSError) as exc:
        parser.exit(2, f'Training not run: {exc}\n')
    print(json.dumps({'chosen': bundle['algorithm'], 'thresholds': bundle['thresholds'],
                      'threshold_source': bundle['threshold_source'],
                      'latency_ms_per_window': metrics['latency']['ms_per_window'],
                      'scheme': metrics['scheme'], 'open_set_macro_f1': metrics['open_set_with_rejection']['macro_f1'],
                      'none_false_accept_rate': metrics['none_false_accept_rate'],
                      'counts': bundle['counts']}, indent=2))
    if metrics['warning']:
        print(metrics['warning'])
    print(f'Saved {Path(args.out) / "model.joblib"}. Restart the server to load it.')


if __name__ == '__main__':
    main()
