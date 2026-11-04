// Live transport: WebSocket first, bounded reconnects, then POST /api/predict fallback.
// Same lm-v1 frames and same reply messages on both transports.
export const MAX_RETRIES = 5;
const POST_BATCH = 3;
const POST_MAX_BUFFER = 10;

export function wsUrl(location) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/recognize`;
}

export class RecognizerClient {
  constructor({ onMessage, onTransport, url, WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch?.bind(globalThis),
                setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), streamId }) {
    Object.assign(this, { onMessage, onTransport, url, WebSocketImpl, fetchImpl, setTimer, clearTimer });
    this.streamId = streamId || `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    this.retries = 0;
    this.mode = 'idle';
    this.buffer = [];
    this.inFlight = false;
    this.stopped = true;
    this.epoch = 0;
    this.ignoreBefore = -Infinity;
  }

  setMode(mode, detail) {
    this.mode = mode;
    this.onTransport?.({ mode, retries: this.retries, max: MAX_RETRIES, detail });
  }

  start() {
    this.stopped = false;
    this.retries = 0;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    this.setMode(this.retries ? 'reconnecting' : 'connecting');
    let opened = false;
    let ws;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (err) {
      this.failed(err.message);
      return;
    }
    this.ws = ws;
    ws.onopen = () => { opened = true; this.retries = 0; this.setMode('ws'); };
    ws.onmessage = event => {
      if (this.ws !== ws || this.stopped) return;
      try { const message = JSON.parse(event.data);
        if (message.type !== 'prediction' || (this.ignoreBefore === -Infinity || message.t_ms > this.ignoreBefore)) this.onMessage?.(message); } catch { /* ignore malformed server message */ }
    };
    ws.onclose = event => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      this.failed(opened ? `connection closed (${event.code})` : 'could not connect');
    };
  }

  failed(detail) {
    if (this.stopped) return;
    if (this.retries < MAX_RETRIES) {
      this.retries += 1;
      this.setMode('reconnecting', detail);
      this.timer = this.setTimer(() => this.connect(), 500 * 2 ** (this.retries - 1));
    } else {
      this.setMode('http', `WebSocket unavailable (${detail}); using HTTP fallback`);
    }
  }

  send(frame) {
    if (this.stopped) return;
    if (this.mode === 'ws' && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'frame', frame }));
    } else if (this.mode === 'http') {
      this.buffer.push(frame);
      if (this.buffer.length > POST_MAX_BUFFER) this.buffer.splice(0, this.buffer.length - POST_MAX_BUFFER);
      if (this.buffer.length >= POST_BATCH && !this.inFlight) this.flush();
    }
    // While connecting/reconnecting frames are dropped: the server buffer refills in ~1.6 s.
  }

  reset(timestamp) {
    this.epoch++;
    this.ignoreBefore = Math.max(this.ignoreBefore, timestamp);
    this.buffer = [];
    this.httpReset = true;
    if (this.mode === 'ws' && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'reset' }));
  }

  async flush() {
    const epoch = this.epoch;
    const reset = !!this.httpReset;
    this.httpReset = false;
    const frames = this.buffer.splice(0, this.buffer.length);
    this.inFlight = true;
    try {
      const r = await this.fetchImpl('/api/predict', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream_id: this.streamId, frames, reset }),
      });
      const body = await r.json();
      if (epoch !== this.epoch || this.stopped) return;
      if (!r.ok) this.onMessage?.({ type: 'error', code: body.code || `HTTP_${r.status}`, detail: body.detail });
      else body.replies.forEach(reply => {
        if (reply.type !== 'prediction' || (this.ignoreBefore === -Infinity || reply.t_ms > this.ignoreBefore)) this.onMessage?.(reply);
      });
    } catch (err) {
      if (epoch === this.epoch && !this.stopped) this.onMessage?.({ type: 'error', code: 'NETWORK', detail: err.message });
    } finally {
      this.inFlight = false;
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* already closed */ }
    this.buffer = [];
    this.setMode('idle');
  }
}
