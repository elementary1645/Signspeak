// Diagnostics only: a local, per-take timeline of every observation from countdown start to
// take end. Never used by admission, features, take storage or transport; never uploaded.
export const TAKE_DIAGNOSTICS_SCHEMA = 'take-diagnostics-v1';

export function summarizeObservation(observation, { recordingStart, added }) {
  return {
    t_ms: observation.t_ms,
    phase: recordingStart != null && observation.t_ms >= recordingStart ? 'recording' : 'countdown',
    state: observation.state, rawCount: observation.rawCount, acceptedCount: observation.acceptedCount,
    uncertainCount: observation.uncertainCount, rejectedCount: observation.rejectedCount,
    recordable: observation.recordable, addedToTake: added.has(observation.t_ms),
    resultAgeMs: observation.resultAgeMs ?? null,
    candidates: (observation.raw || []).map(d => ({
      status: d.status, reason: d.reason, faceEntry: d.faceEntry ?? null, trackContinuity: d.trackContinuity ?? null,
      side: d.side, sideSource: d.sideSource, handedness: d.handedness, handednessScore: d.handednessScore,
      handWrist: d.handWrist, nearFace: d.nearFace, palmPixels: d.palmPixels })),
    tracker: observation.tracker ?? null,
    framing: observation.framing ?? null,
  };
}

// One take's log. Observations arrive after onFrame/onUncertain for the same frame, so
// `added` already says whether that frame entered the take.
export class TakeDiagnosticsLog {
  constructor(countdownStart) {
    Object.assign(this, { countdownStart, recordingStart: null, closeAt: null, end: null, added: new Set(), frames: [], stale: [] });
  }
  observe(observation) {
    if (this.end != null || observation?.t_ms == null || observation.t_ms < this.countdownStart
      || (this.closeAt != null && observation.t_ms > this.closeAt)) return;
    this.frames.push(summarizeObservation(observation, this));
  }
  addedToTake(t_ms) { this.added.add(t_ms); }
  staleResult(t_ms) {
    if (this.end == null && t_ms >= this.countdownStart && (this.closeAt == null || t_ms <= this.closeAt)) this.stale.push(t_ms);
  }
  // The take ends inside onFrame, before that frame's observation reaches the ring; close
  // first, then finish once the current inference tick has completed.
  close(at) { this.closeAt = at; }
  finish(details) {
    const end = this.closeAt;
    this.end = end;
    const taken = [...this.added].sort((a, b) => a - b);
    return { schema: TAKE_DIAGNOSTICS_SCHEMA, countdownStart: this.countdownStart, recordingStart: this.recordingStart,
      end, ...details, takeFrameTimes: taken, takeFrameGapsMs: taken.slice(1).map((t, i) => t - taken[i]),
      staleResultTimes: this.stale, observations: this.frames };
  }
}
