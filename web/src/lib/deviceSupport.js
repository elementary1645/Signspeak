// Phone/tablet and slow-tracker detection for the "needs a laptop" notice. Display only: nothing is blocked.
// Measured on an iPhone (Safari and in-app browser, CPU and GPU, 640 and 320 px): about 267 ms per
// inference, so the tracker never reached the 7 FPS minimum of the 8 FPS model.
export const UNSUPPORTED_DEVICE_TEXT = 'SignSpeak needs a laptop or desktop with Chrome or Edge. '
  + 'Phones are too slow for the 8 FPS tracker right now.';
export const SLOW_FPS_MIN = 7;
export const SLOW_FPS_HOLD_MS = 5000;

const MOBILE_UA = /iPhone|iPad|iPod|Android|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i;

// env: { userAgent, maxTouchPoints, coarsePointer, screenWidth, screenHeight }
export function isPhoneOrTablet({ userAgent = '', maxTouchPoints = 0, coarsePointer = false, screenWidth = 0, screenHeight = 0 } = {}) {
  if (MOBILE_UA.test(userAgent)) return true;
  // iPadOS Safari reports a desktop Mac user agent; real Macs have no touch points.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return true;
  // Touch-first device with a small screen. Touch laptops have a fine primary pointer, so they pass.
  const shortSide = Math.min(screenWidth || Infinity, screenHeight || Infinity);
  return maxTouchPoints > 0 && coarsePointer && shortSide <= 1024;
}

export function browserEnv(win = globalThis.window) {
  if (!win) return {};
  let coarsePointer = false;
  try { coarsePointer = !!win.matchMedia?.('(pointer: coarse)').matches; } catch { /* old browsers */ }
  return { userAgent: win.navigator?.userAgent || '', maxTouchPoints: win.navigator?.maxTouchPoints || 0,
    coarsePointer, screenWidth: win.screen?.width || 0, screenHeight: win.screen?.height || 0 };
}

// Flags the tracker as too slow once the measured fps has stayed below minFps for holdMs.
// Sticky until reset() (the camera stopped), so the notice does not flicker around the limit.
export class SlowFpsWatch {
  constructor({ minFps = SLOW_FPS_MIN, holdMs = SLOW_FPS_HOLD_MS } = {}) {
    this.minFps = minFps;
    this.holdMs = holdMs;
    this.reset();
  }

  reset() { this.since = null; this.slow = false; this.lowest = null; }

  // Returns true once the tracker has been slow for long enough. Unknown fps neither starts nor stops the clock.
  update(nowMs, fps) {
    if (this.slow || typeof fps !== 'number' || !Number.isFinite(fps)) return this.slow;
    if (fps >= this.minFps) { this.since = null; this.lowest = null; return false; }
    if (this.since == null) this.since = nowMs;
    this.lowest = this.lowest == null ? fps : Math.min(this.lowest, fps);
    if (nowMs - this.since >= this.holdMs) this.slow = true;
    return this.slow;
  }
}
