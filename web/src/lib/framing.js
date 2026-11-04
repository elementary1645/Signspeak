// UI guidance only: never used by admission, features, takes or transport.
export const FRAMING = { windowMs: 2000, maxNoseY: 0.6, maxShoulderY: 1.0, minFraction: 0.5, minSamples: 4 };
export const FRAMING_MESSAGE = 'Tilt your screen down so your face is in the upper half and your shoulders are in view.';
export const FACE_START_MESSAGE = 'Start with your hands away from your face.';

// Warns when the nose is low (y > 0.6) or a shoulder is below the image (y > 1.0) in most
// of the last ~2 s of observations that contain a pose.
export class FramingMonitor {
  constructor(config = FRAMING) {
    this.config = config;
    this.reset();
  }
  reset() { this.samples = []; }
  add(t_ms, pose) {
    const c = this.config;
    if (this.samples.length && t_ms <= this.samples.at(-1).t_ms) this.reset();
    if (pose) this.samples.push({ t_ms, bad: pose[0][1] > c.maxNoseY || pose[11][1] > c.maxShoulderY || pose[12][1] > c.maxShoulderY });
    while (this.samples.length && t_ms - this.samples[0].t_ms > c.windowMs) this.samples.shift();
    const bad = this.samples.filter(s => s.bad).length, n = this.samples.length;
    return { warn: n >= c.minSamples && bad / n > c.minFraction, badFraction: n ? bad / n : null, samples: n };
  }
}

// A take is judged only on its own frames, so it must not start with any hand candidate
// (accepted or uncertain) in the face zone.
export function startBlockMessage(diagnostics, framingWarn = false) {
  const inFace = (diagnostics?.raw || []).some(d => d.nearFace && d.status !== 'rejected');
  if (!inFace) return null;
  return framingWarn ? `${FACE_START_MESSAGE} ${FRAMING_MESSAGE}` : FACE_START_MESSAGE;
}
