import POLICY from './handValidation.json' with { type: 'json' };
export { POLICY };
const distance = (a, b, f) => Math.hypot((a[0] - b[0]) * f.w, (a[1] - b[1]) * f.h);
const inside = p => p && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;

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

export function validateHands(frame, options = POLICY) {
  const p = { ...POLICY, ...options }, pose = frame.pose;
  const reliable = v => inside(v) && v[3] >= p.minPoseVisibility;
  // Shoulder coordinates can provide scale without being a mandatory existence test.
  const width = pose && inside(pose[11]) && inside(pose[12]) ? distance(pose[11], pose[12], frame) : 0;
  const scale = width >= p.minShoulderWidthFraction * frame.w ? width : null;
  const nose = pose?.[0], faceKnown = reliable(nose) && scale != null;
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
      return { side: side === 0 ? 'L' : 'R', coordinates: pw || null, visibility: pw?.[3] ?? null,
        distancePixels: d, distanceShoulders: scale && d != null ? d / scale : null,
        armPlausible: !!armOk, reliable: !!reliable(pw), supported: !!(armOk && d <= p.maxWristDistanceShoulders * scale) };
    });
    const legacySide = legacySides[index], prior = wrists[legacySide === 'L' ? 0 : 1];
    let legacyReason = 'accepted';
    if (!scale || !reliable(pose?.[11]) || !reliable(pose?.[12])) legacyReason = 'unreliable-shoulders';
    else if (!reliable(pose?.[legacySide === 'L' ? 13 : 14]) || !prior.reliable) legacyReason = 'unreliable-arm-wrist';
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
      d.status = 'accepted'; d.reason = 'pose-supported'; d.side = matched === 0 ? 'L' : 'R'; d.sideSource = 'pose';
    } else if (!d.faceKnown || d.nearFace) {
      d.reason = d.nearFace ? 'face-proximity-without-wrist-support' : 'face-reference-unavailable';
    } else {
      const side = d.handedness === 'Right' ? 0 : d.handedness === 'Left' ? 1 : null;
      const conflict = side != null && d.poseWrists.some((pw, j) => j !== side && pw.reliable
        && pw.distanceShoulders != null && pw.distanceShoulders <= p.identityConflictShoulders);
      const duplicate = side != null && raw.some((other, j) => j !== i && best.sides[j] == null
        && other.handedness === d.handedness && other.handednessScore >= p.minFallbackHandednessScore);
      if (p.allowHandednessFallback === false) d.reason = 'legacy-model-needs-pose-identity';
      else if (side == null || d.handednessScore < p.minFallbackHandednessScore) d.reason = 'ambiguous-handedness';
      else if (conflict || duplicate || occupied.has(side)) d.reason = 'identity-conflict';
      else { d.status = 'accepted'; d.reason = 'hand-supported-pose-unavailable'; d.side = side === 0 ? 'L' : 'R'; d.sideSource = 'handedness'; occupied.add(side); }
    }
    d.accepted = d.status === 'accepted';
  });
  const accepted = raw.filter(d => d.accepted), uncertainCount = raw.filter(d => d.status === 'uncertain').length;
  return { frame: { ...frame, hands: accepted.map(d => frame.hands[d.index]) },
    diagnostics: { policy: p.policy, poseShoulders: pose ? [pose[11], pose[12]] : null,
      poseNose: nose || null, minPoseVisibility: p.minPoseVisibility, rawCount: raw.length, acceptedCount: accepted.length, uncertainCount,
      rejectedCount: raw.filter(d => d.status === 'rejected').length,
      state: uncertainCount ? 'uncertain' : accepted.length ? 'accepted' : raw.length ? 'rejected' : 'none',
      recordable: raw.every(d => d.accepted), raw } };
}

export function acceptedSides(frame) {
  const result = validateHands(frame);
  return result.diagnostics.raw.map(d => d.accepted ? d.side : '?');
}


export function policyMatches(policy) {
  return !!policy && Object.entries(POLICY).every(([key, value]) => policy[key] === value);
}
