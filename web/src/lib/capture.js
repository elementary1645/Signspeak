// Pure capture logic for /collect (unit-tested in web/tests).
export const CAPTURE_MIN_FRAMES = 26;  // stop as soon as this many raw frames arrived...
export const CAPTURE_MAX_MS = 3000;    // ...or after this long, whichever comes first
export const LOW_FPS = 12;
export const MIN_FRAMES = 15;          // server rejects shorter takes (backend/live/takes.py)
export const MIN_SPAN_MS = 1380;

// Rolling frames-per-second over the last ~1 s of frame timestamps.
export class FpsMeter {
  constructor(windowMs = 1000) { this.windowMs = windowMs; this.times = []; }
  add(t) {
    this.times.push(t);
    while (this.times.length > 2 && t - this.times[0] > this.windowMs) this.times.shift();
  }
  fps() {
    const n = this.times.length;
    if (n < 2) return null;
    const span = this.times[n - 1] - this.times[0];
    return span > 0 ? ((n - 1) * 1000) / span : null;
  }
}

export function captureDone(frames, startMs, nowMs) {
  return frames.length >= CAPTURE_MIN_FRAMES || nowMs - startMs >= CAPTURE_MAX_MS;
}

export function measuredFps(frames) {
  if (frames.length < 2) return 0;
  const span = frames[frames.length - 1].t_ms - frames[0].t_ms;
  return span > 0 ? ((frames.length - 1) * 1000) / span : 0;
}

export function takeVerdict(frames) {
  const fps = measuredFps(frames);
  const span = frames.length > 1 ? frames[frames.length - 1].t_ms - frames[0].t_ms : 0;
  return {
    fps,
    lowFps: fps < LOW_FPS,
    valid: frames.length >= MIN_FRAMES && span >= MIN_SPAN_MS,
  };
}

// Per-signer completion summary: is this person done before they leave?
export function sessionSummary(takes, signer, session, labels, targets, noneLabel) {
  const mine = takes.filter(t => t.signer_id === signer);
  const rows = labels.map(label => {
    const all = mine.filter(t => t.label === label);
    const target = label === noneLabel ? targets.none : targets.per_sign;
    return {
      label, target, total: all.length,
      thisSession: all.filter(t => t.session_id === session).length,
      lowFps: all.filter(t => t.low_fps).length,
      complete: all.length >= target,
    };
  });
  return {
    rows,
    total: mine.length,
    lowFps: mine.filter(t => t.low_fps).length,
    complete: rows.length > 0 && rows.every(r => r.complete),
    missing: rows.filter(r => !r.complete).map(r => `${r.label} (${r.target - r.total} more)`),
  };
}
