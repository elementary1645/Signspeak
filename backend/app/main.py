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


@asynccontextmanager
async def lifespan(app):
    app.state.detector = None
    app.state.error = None
    app.state.previous = {}  # bounded per-recording deduplication, no images
    app.state.write_lock = threading.Lock()
    try:
        app.state.detector = Detector()
    except Exception as exc:
        app.state.error = f'Hand landmarker unavailable: {type(exc).__name__}; download model and restart'
    yield
    if app.state.detector:
        app.state.detector.close()


app = FastAPI(title='SignSpeak Local — collection only', lifespan=lifespan)


class Frame(BaseModel):
    image: str = Field(max_length=2_000_000)
    mirrored: bool = False
    collect: bool = False
    sign_class: str = ''
    signer_id: str = ''
    session_id: str = ''
    recording_id: str = Field(default='', max_length=80)
    timestamp_ms: int = Field(ge=0)


@app.get('/health')
def health():
    return {'status': 'ok', 'detector_ready': app.state.detector is not None,
            'detail': app.state.error, 'schema': SCHEMA,
            'collection_enabled': os.getenv('ENABLE_COLLECTION') == '1'}


@app.get('/')
def index():
    return FileResponse(ROOT / 'frontend/index.html')


@app.get('/collector.js')
def javascript():
    return FileResponse(ROOT / 'frontend/collector.js', media_type='text/javascript')


@app.get('/vocabulary')
def get_vocabulary():
    return list(vocabulary().values())


@app.post('/frames')
def frame(request: Frame):
    if request.collect and os.getenv('ENABLE_COLLECTION') != '1':
        raise HTTPException(403, 'Persistence disabled; start with ENABLE_COLLECTION=1')
    if not app.state.detector:
        raise HTTPException(503, app.state.error)
    try:
        payload = base64.b64decode(request.image, validate=True)
        rgb = decode_image(payload, request.mirrored)
        hands = app.state.detector.detect(rgb)
        reliable = bool(hands) and all(h['handedness_score'] >= THRESHOLD for h in hands)
        features = normalize(hands) if reliable else None
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, str(exc)) from exc
    saved = False
    reason = 'ready' if reliable else 'No hands or unreliable handedness'
    if request.collect and reliable:
        try:
            entry = vocabulary().get(request.sign_class, {})
            record = Record(sign_class=request.sign_class, signer_id=request.signer_id,
                session_id=request.session_id, recording_id=request.recording_id,
                sample_id=str(uuid.uuid4()), timestamp_ms=request.timestamp_ms,
                hand_count=len(hands), features=features,
                handedness_scores=[h['handedness_score'] for h in hands],
                detection_threshold=THRESHOLD, input_mirrored=request.mirrored,
                vocabulary_reference_id=entry.get('reference_id', ''))
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from exc
        key = (request.signer_id, request.session_id, request.recording_id, request.sign_class)
        with app.state.write_lock:
            now = time.monotonic()
            previous = app.state.previous.get(key)
            reason = 'Rate limited or near-identical sample'
            if previous is None or (now - previous[0] >= 0.2 and
                    np.sqrt(np.mean((np.array(features) - previous[1]) ** 2)) >= 0.015):
                path = Path(os.getenv('DATASET_PATH', str(ROOT / 'data/processed/samples.jsonl')))
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('a') as stream:
                    stream.write(record.model_dump_json() + '\n')
                if len(app.state.previous) >= 1000:
                    app.state.previous.pop(next(iter(app.state.previous)))
                app.state.previous[key] = (now, np.array(features))
                saved, reason = True, 'Saved'
    return {'hands': hands, 'features': features, 'saved': saved, 'status': reason,
            'schema': SCHEMA}
