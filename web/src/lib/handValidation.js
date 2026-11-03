import POLICY from './handValidation.json' with { type: 'json' };
export { POLICY };

const distance = (a, b, frame) => Math.hypot((a[0] - b[0]) * frame.w, (a[1] - b[1]) * frame.h);
const inImage = p => p && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;

// Exact hp-v1 pose-wrist assignment, independent of MediaPipe's selfie handedness label.
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
  const p = { ...POLICY, ...options };
  const reliable = point => inImage(point) && point[3] >= p.minPoseVisibility;
  const pose = frame.pose;
  const width = pose && reliable(pose[11]) && reliable(pose[12]) ? distance(pose[11], pose[12], frame) : 0;
  const bodyOk = width >= p.minShoulderWidthFraction * frame.w;
  const entries = frame.hands.map((hand, index) => ({ hand, index }));
  let remaining = entries;
  const checks = new Map();
  // Re-evaluate after rejection: removing one hand must never change another accepted
  // hand to an implausible wrist when downstream features assign sides again.
  for (let pass = 0; pass < 3; pass++) {
    const sides = poseSides({ ...frame, hands: remaining.map(e => e.hand) });
    const next = [];
    remaining.forEach((entry, i) => {
      const { hand, index } = entry;
      const side = sides[i];
      const j = side === 'L' ? 0 : 1;
      const shoulder = pose?.[11 + j], elbow = pose?.[13 + j], wrist = pose?.[15 + j];
      const gap = width && wrist ? distance(hand.landmarks[0], wrist, frame) / width : null;
      let reason = null;
      if (!bodyOk) reason = 'unreliable-shoulders';
      else if (!reliable(shoulder) || !reliable(elbow) || !reliable(wrist)) reason = 'unreliable-arm-wrist';
      else if (!inImage(hand.landmarks[0])) reason = 'hand-wrist-outside-image';
      else if ([distance(shoulder, elbow, frame) / width, distance(elbow, wrist, frame) / width]
        .some(length => length < p.minArmSegmentShoulders || length > p.maxArmSegmentShoulders)) reason = 'implausible-arm';
      else if (gap > p.maxWristDistanceShoulders) reason = 'wrist-mismatch';
      checks.set(index, { reason: reason || 'accepted', side, wristDistanceShoulders: gap });
      if (!reason) next.push(entry);
    });
    if (next.length === remaining.length) break;
    remaining = next;
  }
  const accepted = new Set(remaining.map(e => e.index));
  return {
    frame: { ...frame, hands: remaining.map(e => e.hand) },
    diagnostics: {
      policy: p.policy, rawCount: entries.length, acceptedCount: remaining.length,
      // Local only: never append raw/rejected results to an lm-v1 frame or take.
      raw: entries.map(({ hand, index }) => ({ index, handedness: hand.handedness,
        handednessScore: hand.score, landmarks: hand.landmarks, accepted: accepted.has(index),
        ...(checks.get(index) || {}) })),
    },
  };
}
