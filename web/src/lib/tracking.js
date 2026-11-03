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
    this.ready = this.request({ type: 'init', kind, delegate });
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
