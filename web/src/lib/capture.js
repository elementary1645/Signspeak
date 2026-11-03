import PROTOCOLS from './captureProtocols.json' with { type: 'json' };
export { PROTOCOLS };
export const DEFAULT_PROTOCOL = 'hp-v2-8fps-timed-1';
// Pure capture logic for /collect (unit-tested in web/tests).
export const CAPTURE_MIN_FRAMES = 26;  // small margin beyond the 24-frame hp-v1 window
export const CAPTURE_MAX_MS = 3000;    // deadline for rejecting a stalled/slow recording
export const LOW_FPS = 14;
export const MIN_FRAMES = 24;          // minimum for new hp-v1 timed captures
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

export function captureDone(frames, startMs, nowMs, protocol = 'hp-v1-timed-1') {
  const p = PROTOCOLS[protocol];
  return !!p && (frames.length >= p.captureFrames || nowMs - startMs >= p.deadlineMs);
}

export function measuredFps(frames) {
  if (frames.length < 2) return 0;
  const span = frames[frames.length - 1].t_ms - frames[0].t_ms;
  return span > 0 ? ((frames.length - 1) * 1000) / span : 0;
}

export function takeVerdict(frames, protocol = 'hp-v1-timed-1') {
  const p = PROTOCOLS[protocol];
  const fps = measuredFps(frames);
  const span = frames.length > 1 ? frames.at(-1).t_ms - frames[0].t_ms : 0;
  const gaps = frames.slice(1).map((f, i) => f.t_ms - frames[i].t_ms);
  const tolerance = p?.timestampToleranceMs ?? 0;
  const rateOk = !!p && span >= (frames.length - 1) * 1000 / p.maxFps - tolerance
    && span <= (frames.length - 1) * 1000 / p.minFps + tolerance;
  return {
    fps, span, maxGap: Math.max(0, ...gaps), lowFps: !p || fps < p.minFps,
    valid: !!p && frames.length >= p.minFrames && frames.length <= p.maxFrames
      && span >= p.minSpanMs && span <= p.maxSpanMs && rateOk
      && frames.every(f => Number.isFinite(f.t_ms) && f.t_ms >= 0)
      && gaps.every(g => g > 0 && g >= p.minGapMs && g <= p.maxGapMs),
  };
}

export function timingInstructions(protocol) {
  const p = PROTOCOLS[protocol];
  return `${p.minFrames === p.maxFrames ? 'Exactly' : 'At least'} ${p.minFrames} distinct frames, ${p.minFps}–${p.maxFps} effective FPS, span ${(p.minSpanMs / 1000).toFixed(2)}–${(p.maxSpanMs / 1000).toFixed(2)} s, gaps ${p.minGapMs}–${p.maxGapMs} ms.`;
}

// Per-signer completion summary: is this person done before they leave?
export function sessionSummary(takes, signer, session, labels, targets, noneLabel, protocol = null) {
  const mine = takes.filter(t => t.signer_id === signer && (!protocol || t.capture_protocol === protocol));
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
