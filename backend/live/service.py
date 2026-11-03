"""Live recognition: WebSocket /ws/recognize, POST /api/predict fallback, /ready.

Both transports share one contract. The client sends lm-v1 frames (~15 fps); the server
keeps a per-connection buffer, predicts every 3rd frame on the latest 24-frame window and
replies with a state message. With no compatible model it says so and never guesses.

States: INITIALIZING, READY, DETECTING, RECOGNIZING, RECOGNIZED, UNKNOWN, NO_HAND, ERROR.
"""
from collections import deque
import json
import os
import threading
import time
from anyio import to_thread
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from backend.app.recognition import Stabilizer
from . import features, vocab
from .model import LiveModel, model_path
from .protocol import validate_frame



def predict_every():
    """Prediction stride in frames (env PREDICT_EVERY, default 3 = 5 predictions/s at 15 fps).

    Raise it on tiny CPUs (Render free = 0.1 CPU); the stabilizer still needs 3 accepted
    predictions spanning >= 0.5 s, so larger strides only make recognition slower to appear.
    """
    try:
        value = int(os.getenv('PREDICT_EVERY', '3'))
    except ValueError:
        return 3
    return min(max(value, 1), 15)


PREDICT_EVERY = predict_every()
MAX_RATE = 20            # messages per second per connection
MAX_MESSAGE_BYTES = 32_000
BUFFER_MS = 3000
NO_HAND_MS = 500
MIN_HAND_RATE = 0.5      # below this the window is mostly empty: still DETECTING
MAX_STREAMS = 64
STREAM_TTL_S = 60

router = APIRouter()


class LiveService:
    """Model state for the process. Loaded once at startup; restart after training."""
    def __init__(self):
        self.model = None
        self.code = 'MODEL_NOT_TRAINED'
        self.detail = 'Model not trained yet'
        self.streams = {}
        self.lock = threading.Lock()

    def load(self, path=None):
        path = path or model_path()
        self.model = None
        if not path.exists():
            self.code, self.detail = 'MODEL_NOT_TRAINED', 'Model not trained yet. Collect, merge and train, then restart.'
            return self
        try:
            self.model = LiveModel(path, vocab.verified())
            self.code, self.detail = None, None
        except Exception as exc:  # any load failure fails closed, with the reason shown
            self.code, self.detail = 'MODEL_INCOMPATIBLE', f'Model rejected: {exc}'
        return self

    def status(self):
        ready, code, detail = False, self.code, self.detail
        if self.model is not None:
            try:
                ready = self.model.compatible_with(vocab.verified())
            except ValueError:
                ready = False
            if not ready:
                code, detail = 'MODEL_INCOMPATIBLE', 'Vocabulary changed since training; retrain and restart'
        return {'ready': ready, 'code': None if ready else code, 'detail': None if ready else detail,
                'model': self.model.info() if ready else None, 'schema': features.SCHEMA}


class RateLimiter:
    def __init__(self, rate=None):
        self.rate = rate or MAX_RATE
        self.tokens, self.last = float(self.rate), time.monotonic()

    def allow(self):
        now = time.monotonic()
        self.tokens = min(self.rate, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


class Session:
    """One camera stream: frame buffer, prediction cadence and temporal smoothing."""
    def __init__(self, service):
        self.service = service
        self.frames = deque()
        self.vectors = deque()  # frame_vector() of each buffered frame, computed once on arrival
        self.count = 0
        self.stabilizer = Stabilizer()
        self.limiter = RateLimiter()
        self.touched = time.monotonic()

    def reset(self):
        self.frames.clear()
        self.vectors.clear()
        self.count = 0
        self.stabilizer = Stabilizer()

    def push(self, raw):
        """Add one raw lm-v1 frame. Returns a prediction message every PREDICT_EVERY frames."""
        started = time.perf_counter()
        self.touched = time.monotonic()
        frame = validate_frame(raw)
        if self.frames and frame['t_ms'] <= self.frames[-1]['t_ms']:
            self.reset()  # camera restarted or clock jumped: start a fresh buffer
        self.frames.append(frame)
        self.vectors.append(features.frame_vector(frame))
        while self.frames[-1]['t_ms'] - self.frames[0]['t_ms'] > BUFFER_MS:
            self.frames.popleft()
            self.vectors.popleft()
        self.count += 1
        if self.count % PREDICT_EVERY:
            return None
        message = self._predict(frame)
        message['t_ms'] = frame['t_ms']
        message['latency_ms']['server'] = (time.perf_counter() - started) * 1000
        return message

    def _predict(self, frame):
        status = self.service.status()
        base = {'type': 'prediction', 'label': None, 'confidence': None, 'margin': None, 'event': None,
                'model_ready': status['ready'], 'code': None, 'detail': None, 'latency_ms': {'model': None}}
        if not status['ready']:
            return dict(base, state='ERROR', code=status['code'], detail=status['detail'])
        now = frame['t_ms'] / 1000
        recent = [f for f in self.frames if frame['t_ms'] - f['t_ms'] <= NO_HAND_MS]
        if not any(f['hands'] for f in recent):
            self.stabilizer.update({'state': 'no_hand', 'label': None}, now)
            return dict(base, state='NO_HAND')
        window = features.latest_window(list(self.frames), list(self.vectors))
        hand_rate = (window[:, 148:150].max(axis=1) > 0.5).mean()
        if self.frames[-1]['t_ms'] - self.frames[0]['t_ms'] < 0.9 * (features.WINDOW - 1) * features.PERIOD_MS \
                or hand_rate < MIN_HAND_RATE:
            self.stabilizer.update({'state': 'detecting', 'label': None}, now)
            return dict(base, state='DETECTING')
        try:
            p = self.service.model.predict(window)
        except Exception:
            self.stabilizer.reset()
            return dict(base, state='ERROR', code='INFERENCE_FAILED', detail='Classifier failed on this window')
        out = self.stabilizer.update({'state': 'candidate' if p['label'] else 'unknown', 'label': p['label'],
                                      'confidence': p['confidence']}, now)
        base.update(confidence=p['confidence'], margin=p['margin'], latency_ms={'model': p['model_latency_ms']})
        if p['label'] is None:  # NONE won or below thresholds: never displayed
            return dict(base, state='UNKNOWN', detail='not a known sign' if p['reason'] == 'none' else 'low confidence')
        return dict(base, state='RECOGNIZED' if out['stable'] else 'RECOGNIZING', label=p['label'], event=out['event'])


def hello(service):
    status = service.status()
    return {'type': 'hello', 'protocol': 'lm-v1', 'state': 'READY' if status['ready'] else 'ERROR',
            'predict_every': PREDICT_EVERY, 'max_rate': MAX_RATE, **status}


@router.get('/ready')
def ready(request: Request):
    status = request.app.state.live.status()
    return JSONResponse(status, status_code=200 if status['ready'] else 503)


@router.get('/api/status')
def api_status(request: Request):
    return hello(request.app.state.live)


@router.websocket('/ws/recognize')
async def recognize(websocket: WebSocket):
    service = websocket.app.state.live
    await websocket.accept()
    session = Session(service)
    await websocket.send_json(hello(service))
    last_warning = 0.0
    try:
        while True:
            text = await websocket.receive_text()
            if len(text) > MAX_MESSAGE_BYTES:
                await websocket.close(code=1009, reason='Message too large')
                return
            if not session.limiter.allow():
                if time.monotonic() - last_warning > 1:
                    last_warning = time.monotonic()
                    await websocket.send_json({'type': 'error', 'code': 'RATE_LIMITED', 'detail': f'Max {MAX_RATE} messages/s; frame dropped'})
                continue
            try:
                message = json.loads(text)
                if message.get('type') == 'reset':
                    session.reset()
                    continue
                if message.get('type') != 'frame':
                    raise ValueError('Expected {"type": "frame", "frame": {...}}')
                reply = await to_thread.run_sync(session.push, message.get('frame'))
            except (ValueError, AttributeError, TypeError) as exc:
                await websocket.send_json({'type': 'error', 'code': 'BAD_FRAME', 'detail': str(exc)[:300]})
                continue
            if reply is not None:
                await websocket.send_json(reply)
    except WebSocketDisconnect:
        return


class PredictRequest(BaseModel):
    stream_id: str = Field(pattern=r'^[A-Za-z0-9_-]{8,80}$')
    frames: list[dict] = Field(min_length=1, max_length=10)
    reset: bool = False


def stream_session(service, stream_id):
    with service.lock:
        now = time.monotonic()
        for key, session in list(service.streams.items()):
            if now - session.touched > STREAM_TTL_S:
                del service.streams[key]
        if stream_id not in service.streams:
            if len(service.streams) >= MAX_STREAMS:
                oldest = min(service.streams, key=lambda k: service.streams[k].touched)
                del service.streams[oldest]
            service.streams[stream_id] = Session(service)
        return service.streams[stream_id]


@router.post('/api/predict')
def predict(request: Request, body: PredictRequest):
    """Fallback transport: same frames, same replies, batched (send ~3 frames per request)."""
    service = request.app.state.live
    session = stream_session(service, body.stream_id)
    if body.reset:
        session.reset()
    replies = []
    for raw in body.frames:
        if not session.limiter.allow():
            replies.append({'type': 'error', 'code': 'RATE_LIMITED', 'detail': f'Max {MAX_RATE} frames/s; frame dropped'})
            continue
        try:
            reply = session.push(raw)
        except ValueError as exc:
            return JSONResponse({'type': 'error', 'code': 'BAD_FRAME', 'detail': str(exc)[:300]}, status_code=422)
        if reply is not None:
            replies.append(reply)
    return {'type': 'batch', 'replies': replies, 'model_ready': service.status()['ready']}
