"""Conditional coordinate diagnostics; does not validate the source schema."""
import argparse
from collections import Counter
import json
import numpy as np
from backend.sequence.archive import SequenceArchive


def inspect(path):
    archive = SequenceArchive(path)
    specs = {'pose':(0,132,4), 'face':(132,1536,3),
             'left':(1536,1599,3), 'right':(1599,1662,3)}
    stats = {name:{'min':np.full(width,np.inf), 'max':np.full(width,-np.inf),
                   'out_of_unit':np.zeros(width,dtype=int), 'values_per_coordinate':0,
                   'zero_frames':0,'presence_transitions':0}
             for name,(_,_,width) in specs.items()}
    hands = Counter()
    for (label, seq), x in archive.iter_sequences():
        masks = []
        for name,(start,end,width) in specs.items():
            a = x[:, start:end].reshape(30,-1,width)
            present = np.any(a != 0,axis=(1,2))
            s = stats[name]
            s['zero_frames'] += int((~present).sum())
            s['presence_transitions'] += int((present[1:] != present[:-1]).sum())
            valid = a[present]
            if valid.size:
                s['min'] = np.minimum(s['min'], valid.min(axis=(0,1)))
                s['max'] = np.maximum(s['max'], valid.max(axis=(0,1)))
                s['out_of_unit'] += ((valid<0)|(valid>1)).sum(axis=(0,1))
                s['values_per_coordinate'] += valid.shape[0]*valid.shape[1]
            if name in ('left','right'):
                masks.append(present)
        hands.update((masks[0].astype(int)+masks[1]).tolist())
    for s in stats.values():
        for key in ('min','max','out_of_unit'):
            s[key] = s[key].tolist()
    return {'status':'candidate_layout_only_not_validated',
            'convention':'pose xyz visibility; face xyz; left xyz; right xyz',
            'ranges_exclude_whole_zero_blocks':True,'candidate_blocks':stats,
            'frames_by_candidate_hand_count':dict(hands),
            'label_paths':sorted({k[0] for k in archive.index}),
            'note':'No label mapping or automatic approval. Ranges cannot prove handedness, mirroring, timing or extractor identity.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = inspect(args.archive)
    with open(args.output,'w') as f:
        json.dump(result,f,indent=2,allow_nan=False)
        f.write('\n')
    print(json.dumps(result['candidate_blocks'],indent=2))
