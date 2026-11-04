import { POLICY } from './handValidation.js';

// One outstanding request per worker, bounded by the camera loop (no frame queue).
export class TrackerWorker {
  constructor(kind, delegate, WorkerImpl = Worker) {
    this.worker = new WorkerImpl('/tracker-worker.js');
    this.pending = new Map();
    this.nextId = 0;
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.error) p.reject(new Error(data.error)); else p.resolve(data);
    };
    this.worker.onerror = e => this.close(new Error(e.message || 'Tracking worker failed'));
    this.ready = this.request({ type: 'init', kind, delegate, thresholds: {
      minHandDetectionConfidence: POLICY.minHandDetectionConfidence,
      minHandPresenceConfidence: POLICY.minHandPresenceConfidence,
      minTrackingConfidence: POLICY.minTrackingConfidence,
    } });
  }
  request(data, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.close(new Error('Tracking worker timed out')), 60000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ ...data, id }, transfer); }
      catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }
  close(error = new Error('Tracking stopped')) {
    this.worker.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
}

export function inferenceSize(width, height, maxWidth) {
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Bounded rolling timings. Report means and p95, rather than one fortunate frame.
export class TimingWindow {
  constructor(limit = 150) { this.limit = limit; this.samples = []; }
  add(sample) {
    this.samples.push(sample);
    if (this.samples.length > this.limit) this.samples.shift();
  }
  summary() {
    const result = { samples: this.samples.length };
    if (!this.samples.length) return result;
    for (const key of Object.keys(this.samples[0])) {
      const values = this.samples.map(s => s[key]).sort((a, b) => a - b);
      result[key] = values.reduce((a, b) => a + b, 0) / values.length;
      result[`${key}P95`] = values[Math.ceil(values.length * 0.95) - 1];
    }
    return result;
  }
}

// Map the camera's media clock into performance.now()'s time domain once.
// Keep real source intervals; never advance a duplicate/regressing source timestamp.
export class FrameClock {
  timestamp(mediaSeconds, now) {
    if (!Number.isFinite(mediaSeconds) || (this.last != null && mediaSeconds <= this.last)) return null;
    this.origin ??= now - mediaSeconds * 1000;
    this.last = mediaSeconds;
    return this.origin + mediaSeconds * 1000;
  }
}

// Keep the nominal cadence without losing whole camera periods to timer quantization.
// A source already inside the accepted rate ceiling can supply every real frame.
export class InferenceCadence {
  constructor(fps, maxSourceFps = null) {
    this.period = 1000 / fps;
    this.maxSourceFps = maxSourceFps;
    this.next = -Infinity;
  }
  ready(now, sourceMs) {
    const gap = this.previousSource == null ? 0 : sourceMs - this.previousSource;
    this.previousSource = sourceMs;
    if (this.maxSourceFps == null) return now + 2 >= this.next;
    if (gap >= 1000 / this.maxSourceFps) return true;
    return now + Math.min(Math.max(gap, 0) / 2, this.period / 2) + 2 >= this.next;
  }
  started(now) {
    this.next = this.maxSourceFps == null ? now + this.period
      : Math.max(Number.isFinite(this.next) ? this.next + this.period : now + this.period, now);
  }
}


// A synchronized result can still be too old to describe the live preview.
export function validResultPair(hand, pose, timestamp, ageMs, maxAgeMs = POLICY.maxResultAgeMs) {
  return hand.timestamp === timestamp && pose.timestamp === timestamp
    && hand.kind === 'hand' && pose.kind === 'pose' && ageMs >= 0 && ageMs <= maxAgeMs;
}

export class FreshFrame {
  constructor(publish, { now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id),
    maxAgeMs = POLICY.maxResultAgeMs } = {}) {
    Object.assign(this, { publish, now, setTimer, clearTimer, maxAgeMs });
    this.last = -Infinity;
    this.closed = false;
  }
  accept(frame, capturedAt) {
    const remaining = this.maxAgeMs - (this.now() - capturedAt);
    if (this.closed || frame.t_ms <= this.last || remaining <= 0) return false;
    this.clearTimer(this.timer);
    this.last = frame.t_ms;
    this.publish(frame);
    const publishedTimestamp = frame.t_ms;
    this.timer = this.setTimer(() => {
      if (!this.closed && this.last === publishedTimestamp) this.publish(null);
    }, remaining);
    return true;
  }
  close() { this.closed = true; this.clearTimer(this.timer); }
}
