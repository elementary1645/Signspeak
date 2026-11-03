import POLICY from './handValidation.json' with { type: 'json' };
export { POLICY };
const distance = (a, b, f) => Math.hypot((a[0] - b[0]) * f.w, (a[1] - b[1]) * f.h);
const within = (p, lo, hi) => !!p && p.every(Number.isFinite) && p[0] >= lo && p[0] <= hi && p[1] >= lo && p[1] <= hi;
const inside = p => within(p, 0, 1);
const SIDES = ['L', 'R'];

// Legacy nearest-wrist rule is retained for comparison/diagnostics only.
export function poseSides(frame) {
  if (!frame.pose) return frame.hands.map(() => '?');
  const wrists = [frame.pose[15], frame.pose[16]];
  if (frame.hands.length === 2) {
    const [a, b] = frame.hands.map(h => h.landmarks[0]);
    return distance(a, wrists[0], frame) + distance(b, wrists[1], frame)
      <= distance(a, wrists[1], frame) + distance(b, wrists[0], frame) ? ['L', 'R'] : ['R', 'L'];
  }
  return frame.hands.map(h => distance(h.landmarks[0], wrists[0], frame) <= distance(h.landmarks[0], wrists[1], frame) ? 'L' : 'R');
}

// Per-frame evidence. "Provisional" acceptance is every rule except the face-entry rule,
// which needs history and is applied by HandEvidenceTracker.
function assessFrame(frame, p) {
  const pose = frame.pose, m = p.poseCoordinateMargin;
  // Pose points may sit slightly outside the image (cropped shoulders/elbows) when the
  // pose model still reports them as visible. The hand wrist must stay inside [0, 1].
  const posePoint = v => within(v, -m, 1 + m);
  const reliable = v => posePoint(v) && v[3] >= p.minPoseVisibility;
  const width = pose && posePoint(pose[11]) && posePoint(pose[12]) ? distance(pose[11], pose[12], frame) : 0;
  const scale = width >= p.minShoulderWidthFraction * frame.w ? width : null;
  const nose = pose?.[0], faceKnown = reliable(nose) && scale != null;
  // pose-wrist-v1 comparison only: strict [0, 1] bounds, as that policy used.
  const strictReliable = v => inside(v) && v[3] >= p.minPoseVisibility;
  const strictScale = pose && inside(pose[11]) && inside(pose[12]) && width >= p.minShoulderWidthFraction * frame.w;
  const legacySides = poseSides(frame);
  const raw = frame.hands.map((hand, index) => {
    const points = hand.landmarks, wrist = points[0];
    const finite = points.length === 21 && points.every(v => v.length === 3 && v.every(Number.isFinite));
    // Hand-local z shares x's scale; use it only inside the hand, never against Pose z.
    const delta = k => [(points[k][0] - wrist[0]) * frame.w, (points[k][1] - wrist[1]) * frame.h,
      (points[k][2] - wrist[2]) * frame.w];
    const palm = finite ? Math.hypot(...delta(9)) : 0;
    const palmWidth = finite ? Math.hypot((points[5][0] - points[17][0]) * frame.w,
      (points[5][1] - points[17][1]) * frame.h, (points[5][2] - points[17][2]) * frame.w) : 0;
    const a = finite ? delta(5) : [0, 0, 0], b = finite ? delta(17) : [0, 0, 0];
    const area = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
    const shapeOk = finite && palm >= p.minPalmPixels && palmWidth >= p.minPalmPixels
      && area >= p.minPalmAreaRatio * palm * palm;
    const nearFace = faceKnown && finite && [0, 5, 9, 13, 17].some(k =>
      distance(points[k], nose, frame) <= p.faceRadiusShoulders * scale);
    const wrists = [0, 1].map(side => {
      const shoulder = pose?.[11 + side], elbow = pose?.[13 + side], pw = pose?.[15 + side];
      const d = pw && finite ? distance(wrist, pw, frame) : null;
      const lengths = scale && shoulder && elbow && pw ? [distance(shoulder, elbow, frame) / scale, distance(elbow, pw, frame) / scale] : [];
      const armOk = reliable(shoulder) && reliable(elbow) && reliable(pw) && lengths.length === 2
        && lengths.every(v => v >= p.minArmSegmentShoulders && v <= p.maxArmSegmentShoulders);
      return { side: SIDES[side], coordinates: pw || null, visibility: pw?.[3] ?? null,
        distancePixels: d, distanceShoulders: scale && d != null ? d / scale : null,
        armPlausible: !!armOk, reliable: !!reliable(pw), supported: !!(armOk && d <= p.maxWristDistanceShoulders * scale) };
    });
    const legacySide = legacySides[index], prior = wrists[legacySide === 'L' ? 0 : 1];
    let legacyReason = 'accepted';
    if (!strictScale || !strictReliable(pose?.[11]) || !strictReliable(pose?.[12])) legacyReason = 'unreliable-shoulders';
    else if (!strictReliable(pose?.[legacySide === 'L' ? 13 : 14]) || !strictReliable(prior.coordinates)) legacyReason = 'unreliable-arm-wrist';
    else if (!inside(wrist)) legacyReason = 'hand-wrist-outside-image';
    else if (!prior.armPlausible) legacyReason = 'implausible-arm';
    else if (!prior.supported) legacyReason = 'wrist-mismatch';
    return { index, handedness: hand.handedness, handednessScore: hand.score,
      handWrist: wrist, handWristPixels: wrist ? [wrist[0] * frame.w, wrist[1] * frame.h] : null,
      landmarks: points, poseWrists: wrists, shoulderScalePixels: scale, palmPixels: palm,
      shapePlausible: shapeOk, faceKnown: !!faceKnown, nearFace: !!nearFace,
      legacySide, legacyReason, status: 'uncertain', reason: 'insufficient-evidence', side: '?', sideSource: null };
  });
  // Enumerate one-to-one supported pose matches, maximizing coverage then minimizing distance.
  let best = { count: -1, cost: Infinity, sides: [] };
  const search = (i, used, sides, count, cost) => {
    if (i === raw.length) { if (count > best.count || (count === best.count && cost < best.cost)) best = { count, cost, sides }; return; }
    search(i + 1, used, [...sides, null], count, cost);
    if (!raw[i].shapePlausible || !inside(raw[i].handWrist)) return;
    raw[i].poseWrists.forEach((pw, j) => {
      if (pw.supported && !used.includes(j)) search(i + 1, [...used, j], [...sides, j], count + 1, cost + pw.distancePixels);
    });
  };
  search(0, [], [], 0, 0);
  const occupied = new Set(best.sides.filter(v => v != null));
  raw.forEach((d, i) => {
    const matched = best.sides[i];
    if (!inside(d.handWrist) || !d.shapePlausible) {
      d.status = 'rejected'; d.reason = !inside(d.handWrist) ? 'hand-wrist-outside-image' : 'invalid-hand-geometry';
    } else if (matched != null) {
      d.status = 'accepted'; d.reason = 'pose-supported'; d.side = SIDES[matched]; d.sideSource = 'pose';
    } else if (!d.faceKnown) {
      d.reason = 'face-reference-unavailable';
    } else {
      const side = d.handedness === 'Right' ? 0 : d.handedness === 'Left' ? 1 : null;
      const conflict = side != null && d.poseWrists.some((pw, j) => j !== side && pw.reliable
        && pw.distanceShoulders != null && pw.distanceShoulders <= p.identityConflictShoulders);
      const duplicate = side != null && raw.some((other, j) => j !== i && best.sides[j] == null
        && other.handedness === d.handedness && other.handednessScore >= p.minFallbackHandednessScore);
      if (p.allowHandednessFallback === false) d.reason = 'legacy-model-needs-pose-identity';
      else if (side == null || d.handednessScore < p.minFallbackHandednessScore) d.reason = 'ambiguous-handedness';
      else if (conflict || duplicate || occupied.has(side)) d.reason = 'identity-conflict';
      else { d.status = 'accepted'; d.reason = 'hand-supported-pose-unavailable'; d.side = SIDES[side]; d.sideSource = 'handedness'; occupied.add(side); }
    }
  });
  return { pose, nose, raw };
}

// Accepted frames remember their sides so display code never re-validates them without history.
const SIDES_OF = new WeakMap();
const emptySide = () => ({ lastOutsideFaceMs: null, trackStartMs: null, lastSeenMs: null, faceEntered: false,
  lastWrist: null, lastScale: null, lastPalm: null });
const STEP_MS = 125; // one frame at 8 FPS: maxTrackStepShoulders is per 125 ms of real time

// Does this candidate plausibly continue the side's previous observation? Never looser on missing data.
function continuity(st, d, t, frame, p) {
  if (st.lastSeenMs == null) return 'new-track';
  if (st.lastScale == null || d.shoulderScalePixels == null) return 'restarted-no-scale';
  const step = distance(d.handWrist, st.lastWrist, frame) / Math.min(st.lastScale, d.shoulderScalePixels);
  if (step > p.maxTrackStepShoulders * (t - st.lastSeenMs) / STEP_MS) return 'restarted-step';
  if (Math.max(d.palmPixels, st.lastPalm) > p.maxPalmScaleRatio * Math.min(d.palmPixels, st.lastPalm)) return 'restarted-palm';
  return 'continued';
}

// hand-evidence-v3: a face-zone candidate is accepted only if the same side was accepted
// outside the face zone at most faceEntryWindowMs before it entered, and that side has been
// tracked (provisionally accepted) since then with no gap longer than maxTrackGapMs, each
// step moving at most maxTrackStepShoulders per 125 ms and changing palm size by at most
// maxPalmScaleRatio. Any break restarts the track and loses the entry.
export class HandEvidenceTracker {
  constructor(options = POLICY) {
    this.options = { ...POLICY, ...options };
    this.reset();
  }

  reset() {
    this.lastTms = null;
    this.sides = [emptySide(), emptySide()];
  }

  validate(frame) {
    const p = this.options, t = frame.t_ms;
    if (this.lastTms != null && !(t > this.lastTms)) this.reset(); // camera restart or clock jump
    this.lastTms = t;
    const gaps = this.sides.map((st, i) => {
      const gap = st.lastSeenMs == null ? null : t - st.lastSeenMs;
      if (gap != null && gap > p.maxTrackGapMs) this.sides[i] = emptySide();
      return gap;
    });
    const { pose, nose, raw } = assessFrame(frame, p);
    for (const d of raw) {
      d.faceEntry = 'not-required';
      d.trackContinuity = null;
      if (d.status !== 'accepted') continue;
      const i = SIDES.indexOf(d.side);
      d.trackContinuity = continuity(this.sides[i], d, t, frame, p);
      if (d.trackContinuity.startsWith('restarted')) this.sides[i] = emptySide();
      const st = this.sides[i];
      if (d.nearFace) {
        if (st.faceEntered || (st.lastOutsideFaceMs != null && t - st.lastOutsideFaceMs <= p.faceEntryWindowMs)) {
          st.faceEntered = true;
          d.faceEntry = 'entered';
        } else {
          d.faceEntry = 'missing';
          d.trackedSide = d.side;
          d.status = 'uncertain'; d.reason = 'face-zone-without-entry'; d.side = '?'; d.sideSource = null;
        }
      } else if (d.faceKnown) {
        st.lastOutsideFaceMs = t;
        st.faceEntered = false;
      }
      // Tracked = passes every rule except the face-entry rule.
      if (st.trackStartMs == null) st.trackStartMs = t;
      st.lastSeenMs = t;
      st.lastWrist = d.handWrist; st.lastScale = d.shoulderScalePixels; st.lastPalm = d.palmPixels;
    }
    raw.forEach(d => { d.accepted = d.status === 'accepted'; });
    const accepted = raw.filter(d => d.accepted), uncertainCount = raw.filter(d => d.status === 'uncertain').length;
    const tracker = Object.fromEntries(this.sides.map((st, i) => [SIDES[i], {
      lastOutsideFaceMs: st.lastOutsideFaceMs, trackStartMs: st.trackStartMs,
      trackAgeMs: st.trackStartMs == null ? null : t - st.trackStartMs,
      gapMs: gaps[i], faceEntered: st.faceEntered }]));
    const out = { ...frame, hands: accepted.map(d => frame.hands[d.index]) };
    SIDES_OF.set(out, accepted.map(d => d.side));
    return { frame: out,
      diagnostics: { policy: p.policy, poseShoulders: pose ? [pose[11], pose[12]] : null,
        poseNose: nose || null, minPoseVisibility: p.minPoseVisibility, rawCount: raw.length, acceptedCount: accepted.length, uncertainCount,
        rejectedCount: raw.filter(d => d.status === 'rejected').length,
        state: uncertainCount ? 'uncertain' : accepted.length ? 'accepted' : raw.length ? 'rejected' : 'none',
        recordable: raw.every(d => d.accepted), tracker, raw } };
  }
}

// One frame with no history: what a server sees for the first frame of a take.
export function validateHands(frame, options = POLICY) {
  return new HandEvidenceTracker(options).validate(frame);
}

// The shared sequence verdict used by takes, previews and tests (mirrors Python assess_sequence).
export function validateSequence(frames, options = POLICY) {
  const tracker = new HandEvidenceTracker(options);
  return frames.map(frame => tracker.validate(frame));
}

export function acceptedSides(frame) {
  const known = SIDES_OF.get(frame);
  if (known) return known;
  const result = validateHands(frame);
  return result.diagnostics.raw.map(d => d.accepted ? d.side : '?');
}


export function policyMatches(policy) {
  return !!policy && Object.entries(POLICY).every(([key, value]) => policy[key] === value);
}
