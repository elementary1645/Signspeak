"""Measure a real legacy CPU extractor; never trains or approves signs.

Run with the isolated experiments/holistic environment, from the repository root.
The public pose image is an extractor diagnostic, NOT an ISL example or webcam test.
"""
import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import time

import numpy as np
from backend.sequence.schema import BLOCKS, Contract, HolisticAdapter, pack_result

VERSION = '0.10.21'
IMAGE_URL = 'https://storage.googleapis.com/mediapipe-assets/pose.jpg'
IMAGE_SHA256 = 'c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b'
OPTIONS = dict(static_image_mode=False, model_complexity=1, smooth_landmarks=True,
               enable_segmentation=False, smooth_segmentation=False,
               refine_face_landmarks=False, min_detection_confidence=.5,
               min_tracking_confidence=.5)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def model_manifest(package_root):
    # Record all packaged model/graph assets rather than guessing transitive dependencies.
    root = Path(package_root)
    paths = sorted(p for p in (root/'modules').rglob('*')
                   if p.suffix in ('.tflite', '.binarypb'))
    if not paths:
        raise ValueError('Packaged CPU model assets unavailable')
    manifest = {str(p.relative_to(root)): {'sha256':sha(p),'bytes':p.stat().st_size} for p in paths}
    fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return manifest, fingerprint


def benchmark(image_path, frames=60):
    import cv2
    import mediapipe as mp
    if mp.__version__ != VERSION or np.__version__ != '1.26.4':
        raise ValueError('Use the isolated pinned environment; do not change the Tasks environment')
    if frames < 30:
        raise ValueError('At least 30 measured frames required')
    if sha(image_path) != IMAGE_SHA256:
        raise ValueError('Expected the documented public diagnostic image hash')
    image = cv2.cvtColor(cv2.imread(str(image_path)), cv2.COLOR_BGR2RGB)
    assets, asset_hash = model_manifest(Path(mp.__file__).parent)
    contract = Contract('mediapipe-legacy-holistic-'+VERSION, asset_hash,
                        json.dumps(OPTIONS,sort_keys=True,separators=(',', ':')), False, 100)
    start = time.perf_counter()
    processor = mp.solutions.holistic.Holistic(**OPTIONS)
    construction_ms = (time.perf_counter()-start)*1000
    try:
        adapter = HolisticAdapter(processor,contract)
        t = time.perf_counter()
        cold = adapter.extract(image)
        cold_ms = (time.perf_counter()-t)*1000
        # Warm-up not included in latency samples.
        for _ in range(5): adapter.extract(image)
        times, arrays, counts = [], [], []
        cpu_start, wall_start = time.process_time(), time.perf_counter()
        for _ in range(frames):
            t = time.perf_counter()
            r = processor.process(image)
            a = pack_result(r)
            times.append((time.perf_counter()-t)*1000)
            arrays.append(a)
            counts.append([len(getattr(r,n).landmark) if getattr(r,n) is not None else 0
                           for n,_,_ in BLOCKS])
        wall, cpu = time.perf_counter()-wall_start, time.process_time()-cpu_start
        x = np.stack(arrays)
        # Compare named protobuf output against packed slices, not just dimensions.
        offset = 0
        for name, count, width in BLOCKS:
            value = getattr(r,name)
            expected = np.zeros(count*width) if value is None else np.array([
                [getattr(p,k) for k in ('x','y','z','visibility')[:width]] for p in value.landmark]).ravel()
            np.testing.assert_array_equal(x[-1,offset:offset+count*width],expected)
            offset += count*width
        pose = x[-1,:132].reshape(33,4)
        wrists = {}
        for name,start,index in [('left',1536,15),('right',1599,16)]:
            wrist = x[-1,start:start+2]
            wrists[name] = {'hand_xy':wrist.tolist(),'pose_wrist_xy':pose[index,:2].tolist(),
                            'same_side_distance':float(np.linalg.norm(wrist-pose[index,:2])),
                            'opposite_side_distance':float(np.linalg.norm(wrist-pose[31-index,:2]))}
    finally:
        processor.close()
    # Fresh graph avoids tracked-person carryover when checking missing detections.
    with mp.solutions.holistic.Holistic(**OPTIONS) as blank_processor:
        missing = [pack_result(blank_processor.process(np.zeros_like(image))) for _ in range(3)]
    # Deliberate flipped-input diagnostic, never presented as v1 input or transformed silently.
    with mp.solutions.holistic.Holistic(**OPTIONS) as flip_processor:
        for _ in range(6): flipped_result = flip_processor.process(np.ascontiguousarray(image[:,::-1]))
        flipped = pack_result(flipped_result)
    coordinate_ranges = {}
    offset = 0
    for name, count, width in BLOCKS:
        block = x[:,offset:offset+count*width].reshape(frames,count,width)
        visible = block[np.any(block != 0,axis=(1,2))]
        coordinate_ranges[name] = {'min':visible.min(axis=(0,1)).tolist() if visible.size else None,
                                   'max':visible.max(axis=(0,1)).tolist() if visible.size else None,
                                   'zero_frames':int(np.sum(~np.any(block != 0,axis=(1,2))))}
        offset += count*width
    offset, cold_missing = 0, []
    for name, count, width in BLOCKS:
        end = offset + count * width
        if not np.any(cold[offset:end]):
            cold_missing.append(name)
        offset = end
    report = {'purpose':'extractor diagnostic only; repeated still image, not ISL or live webcam',
        'python':platform.python_version(),'platform':platform.platform(),'mediapipe':mp.__version__,
        'numpy':np.__version__,'opencv':cv2.__version__, 'cpu_count_visible':os.cpu_count(),
        'cpu_model':next((l.split(':',1)[1].strip() for l in Path('/proc/cpuinfo').read_text().splitlines()
                          if l.startswith('model name')), 'unknown'),
        'cpu_quota':Path('/sys/fs/cgroup/cpu.max').read_text().strip() if Path('/sys/fs/cgroup/cpu.max').exists() else None,
        'contract':asdict(contract),'contract_sha256':contract.fingerprint,
        'timing_status':'Unpaced throughput run; 100 ms in contract is a proposed capture target, not measured capture timing or archive FPS.',
        'legacy_internal_timestamp_increment_us':33333,
        'model_asset_manifest':assets, 'all_packaged_asset_bytes':sum(v['bytes'] for v in assets.values()),
        'image':{'url':IMAGE_URL,'sha256':sha(image_path),'shape':list(image.shape)},
        'construction_ms':construction_ms,'cold_first_frame_ms':cold_ms,'measured_frames':frames,
        'latency_ms':{'p50':float(np.percentile(times,50)),'p95':float(np.percentile(times,95)),
                      'min':min(times),'max':max(times)},
        'measured_wall_seconds':wall,'process_cpu_seconds':cpu,'cpu_core_equivalents':cpu/wall,
        'max_rss_mib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
        'landmark_count_patterns':sorted({tuple(c) for c in counts}),
        'sequence_shape':list(x[:30].shape),'dtype':str(x.dtype),'all_finite':bool(np.isfinite(x).all()),
        'coordinate_ranges_excluding_missing':coordinate_ranges,
        'cold_missing_blocks':cold_missing,
        'blank_all_zero':all(not np.any(a) for a in missing),
        'named_output_packing_exact':True,'unmirrored_wrist_diagnostics':wrists,
        'flipped_input_diagnostic':{'left_wrist_xy':flipped[1536:1538].tolist(),
                                    'right_wrist_xy':flipped[1599:1601].tolist(),
                                    'note':'Separate graph with deliberately flipped pixels; no automatic side swap. Not a dataset-mirror validation.'},
        'classifier_trained':False,'dataset_compatibility':'layout plausible; extractor version/settings/mirror/FPS unconfirmed',
        'limits':'Single process on development host; includes Python/MediaPipe imports in peak RSS. Excludes JPEG decode, network, classifier, real motion and concurrent sessions.'}
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--frames',type=int,default=60)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    report = benchmark(args.image,args.frames)
    args.output.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('model_asset_manifest','contract')},indent=2))
