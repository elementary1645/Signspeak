import base64
import binascii
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError
import numpy as np
from .dataset import ROOT, Record, vocabulary
from .detector import Detector, THRESHOLD, decode_image
from .features import normalize, SCHEMA
from .recognition import Recognizer, Stabilizer
from backend.live import api as live_api, service as live_service, web


@asynccontextmanager
async def lifespan(app):
    app.state.detector = None
    app.state.error = None
    app.state.previous = {}  # bounded per-signer/session/label deduplication, no images
    app.state.write_lock = threading.Lock()
    app.state.recognition_lock = threading.Lock()
    app.state.streams = {}
    app.state.recognizer = None
    app.state.live = live_service.LiveService().load()  # hp-v1 model; never a guess without it
    app.state.model_error = 'No trained classifier. Verify signs, collect real data, train and restart.'
    model_path = Path(os.getenv('MODEL_PATH', str(ROOT / 'backend/models/baseline/baseline.joblib')))
    if model_path.exists():
        try:
            app.state.recognizer = Recognizer(model_path, vocabulary())
            app.state.model_error = None
        except Exception as exc:
            app.state.model_error = f'Model rejected: {type(exc).__name__}: {exc}'
    try:
        app.state.detector = Detector()
    except Exception as exc:
        app.state.error = f'Hand landmarker unavailable: {type(exc).__name__}; download model and restart'
    yield
    if app.state.detector:
        app.state.detector.close()


app = FastAPI(title='SignSpeak Local — ISL collection and recognition', lifespan=lifespan)
app.include_router(web.router)
app.include_router(live_api.router)
app.include_router(live_service.router)


class Frame(BaseModel):
    image: str = Field(max_length=2_000_000)
    mirrored: bool = False
    collect: bool = False
    sign_class: str = ''
    signer_id: str = ''
    session_id: str = ''
    recording_id: str = Field(default='', max_length=80)
    timestamp_ms: int = Field(ge=0)
    recognize: bool = False
    stream_id: str = Field(default='', pattern=r'^[A-Za-z0-9_-]{0,80}$')


@app.get('/health')
def health():
    ready = app.state.recognizer is not None
    model_detail = app.state.model_error
    if ready:
        try:
            ready = app.state.recognizer.compatible_with(current_vocabulary())
        except HTTPException:
            ready = False
        if not ready:
            model_detail = 'Vocabulary changed or invalid; retrain and restart'
    return {'status': 'ok', 'detector_ready': app.state.detector is not None,
            'detail': app.state.error, 'schema': SCHEMA,
            'collection_enabled': os.getenv('ENABLE_COLLECTION') == '1',
            'recognition_ready': ready,
            'model_detail': model_detail}


@app.get('/')
def index():
    # The built React app is the product; the Phase 1/2 lab stays available at /lab.
    return web.spa_index() if web.built() else FileResponse(ROOT / 'frontend/index.html')


@app.get('/lab')
def legacy_lab():
    return FileResponse(ROOT / 'frontend/index.html')


@app.get('/collector.js')
def javascript():
    return FileResponse(ROOT / 'frontend/collector.js', media_type='text/javascript')


@app.get('/vocabulary')
def get_vocabulary():
    return list(current_vocabulary().values())


@app.post('/frames')
def frame(request: Frame):
    started = time.perf_counter()
    if request.recognize and not request.stream_id:
        raise HTTPException(422, 'Recognition requires a per-camera stream_id')
    if request.collect and request.recognize:
        raise HTTPException(422, 'Choose collection or recognition mode')
    if request.collect and os.getenv('ENABLE_COLLECTION') != '1':
        raise HTTPException(403, 'Persistence disabled; start with ENABLE_COLLECTION=1')
    if not app.state.detector:
        raise HTTPException(503, app.state.error)
    try:
        payload = base64.b64decode(request.image, validate=True)
        rgb = decode_image(payload, request.mirrored)
        hands = app.state.detector.detect(rgb)
        reliable = (bool(hands) and all(h['handedness_score'] >= THRESHOLD for h in hands)
                    and len({h['side'] for h in hands}) == len(hands))
        features = normalize(hands) if reliable else None
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, 'Hand detection failed; retry or restart camera') from exc
    saved = False
    reason = 'ready' if reliable else 'No hands or unreliable handedness'
    if request.collect and reliable:
        try:
            entry = current_vocabulary().get(request.sign_class, {})
            record = Record(sign_class=request.sign_class, signer_id=request.signer_id,
                session_id=request.session_id, recording_id=request.recording_id,
                sample_id=str(uuid.uuid4()), timestamp_ms=request.timestamp_ms,
                hand_count=len(hands), features=features,
                handedness_scores=[h['handedness_score'] for h in hands],
                detection_threshold=THRESHOLD, input_mirrored=request.mirrored,
                vocabulary_reference_id=entry.get('reference_id', ''))
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from exc
        key = (request.signer_id, request.session_id, request.sign_class)
        with app.state.write_lock:
            now = time.monotonic()
            previous = app.state.previous.get(key)
            reason = 'Rate limited or near-identical sample'
            if previous is None or (now - previous[0] >= 0.2 and
                    np.sqrt(np.mean((np.array(features) - previous[1]) ** 2)) >= 0.015):
                path = Path(os.getenv('DATASET_PATH', str(ROOT / 'data/processed/samples.jsonl')))
                try:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with path.open('a') as stream:
                        stream.write(record.model_dump_json() + '\n')
                except OSError as exc:
                    raise HTTPException(503, 'Dataset could not be saved; check server storage permissions') from exc
                if len(app.state.previous) >= 1000:
                    app.state.previous.pop(next(iter(app.state.previous)))
                app.state.previous[key] = (now, np.array(features))
                saved, reason = True, 'Saved'
    prediction = recognize_frame(request, hands, features) if request.recognize else None
    return {'prediction': prediction, 'frame_latency_ms': (time.perf_counter() - started) * 1000,
            'quality': {'valid_landmarks': reliable, 'hand_count': len(hands)}, 'hands': hands, 'features': features, 'saved': saved, 'status': reason,
            'schema': SCHEMA}


def current_vocabulary():
    try:
        return vocabulary()
    except (ValueError, OSError, KeyError) as exc:
        raise HTTPException(503, 'Vocabulary registry invalid; review it before collection or recognition') from exc


def recognize_frame(request, hands, features):
    now = time.monotonic()
    with app.state.recognition_lock:
        # Bound memory and reset stability after a camera has been idle.
        for key, (last, _) in list(app.state.streams.items()):
            if now - last > 60:
                del app.state.streams[key]
        if request.stream_id not in app.state.streams:
            if len(app.state.streams) >= 128:
                oldest = min(app.state.streams, key=lambda key: app.state.streams[key][0])
                del app.state.streams[oldest]
            app.state.streams[request.stream_id] = (now, Stabilizer())
        stabilizer = app.state.streams[request.stream_id][1]
        app.state.streams[request.stream_id] = (now, stabilizer)
        prediction = {'state': 'model_unavailable', 'label': None, 'confidence': None,
                      'classifier_latency_ms': None, 'detail': app.state.model_error}
        try:
            recognizer = app.state.recognizer
            if not hands:
                prediction.update(state='no_hand', detail='No hand detected')
            elif features is None:
                prediction.update(state='unreliable', detail='Unreliable hand detection')
            elif recognizer is not None:
                if not recognizer.compatible_with(current_vocabulary()):
                    prediction.update(state='model_incompatible', detail='Vocabulary changed; retrain and restart')
                else:
                    prediction = recognizer.predict(features)
        except HTTPException:
            prediction.update(state='model_incompatible', detail='Vocabulary registry invalid')
        except Exception:
            prediction.update(state='error', detail='Classifier inference failed; check model and restart')
        return stabilizer.update(prediction, now)


@app.get('/review-candidates')
def review_candidates():
    return FileResponse(ROOT / 'data/metadata/review_candidates.json', media_type='application/json')


@app.get('/review.js')
def review_javascript():
    return FileResponse(ROOT / 'frontend/review.js', media_type='text/javascript')


@app.get('/dataset/quality')
def dataset_quality():
    if os.getenv('ENABLE_COLLECTION') != '1':
        raise HTTPException(403, 'Enable local collection to inspect the dataset')
    from backend.training.audit import audit
    path = Path(os.getenv('DATASET_PATH', str(ROOT / 'data/processed/samples.jsonl')))
    try:
        return audit(path)
    except FileNotFoundError:
        return {'samples': 0, 'per_class': {}, 'warnings': ['No collected dataset yet']}
    except (ValueError, OSError) as exc:
        raise HTTPException(422, 'Dataset integrity check failed; run the audit CLI for line-level details') from exc
