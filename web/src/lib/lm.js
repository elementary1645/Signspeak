// lm-v1 wire format: raw landmarks only, never pixels. The Python server owns all
// feature engineering (backend/live/features.py), so nothing here affects the model.
export const FRAME_SCHEMA = 'lm-v1';
export const TAKE_SCHEMA = 'lm-take-v1';
export const APP_VERSION = '0.3.0';
export const TASKS_VISION_VERSION = '0.10.35';

const round = v => Math.round(v * 1e5) / 1e5;

// Detector results -> one lm-v1 frame. Input pixels are unmirrored; the preview is
// mirrored with CSS only, so x here is in the camera's own image coordinates.
export function toFrame(tMs, handResult, poseResult, w, h) {
  const handedness = handResult?.handedness || handResult?.handednesses || [];
  const hands = (handResult?.landmarks || []).map((points, i) => ({
    landmarks: points.map(p => [round(p.x), round(p.y), round(p.z)]),
    handedness: handedness[i]?.[0]?.categoryName ?? null,
    score: round(handedness[i]?.[0]?.score ?? 0),
  }));
  const posePoints = poseResult?.landmarks?.[0];
  const pose = posePoints?.length === 33
    ? posePoints.map(p => [round(p.x), round(p.y), round(p.z), round(p.visibility ?? 0)])
    : null;
  return { t_ms: Math.round(tMs), hands, pose, w, h };
}

// Display-only side guess (subject left/right) by nearest pose wrist, mirroring the
// server's rule: pose 15 = subject left wrist, 16 = subject right wrist.
export function displaySides(frame) {
  if (!frame.pose) return frame.hands.map(() => '?');
  const wrists = [frame.pose[15], frame.pose[16]];
  const d = (a, b) => Math.hypot((a[0] - b[0]) * frame.w, (a[1] - b[1]) * frame.h);
  if (frame.hands.length === 2) {
    const [a, b] = frame.hands.map(hand => hand.landmarks[0]);
    const straight = d(a, wrists[0]) + d(b, wrists[1]);
    const crossed = d(a, wrists[1]) + d(b, wrists[0]);
    return straight <= crossed ? ['L', 'R'] : ['R', 'L'];
  }
  return frame.hands.map(hand => (d(hand.landmarks[0], wrists[0]) <= d(hand.landmarks[0], wrists[1]) ? 'L' : 'R'));
}

export function frameQuality(frames) {
  const n = frames.length || 1;
  return {
    frames: frames.length,
    handRate: frames.filter(f => f.hands.length > 0).length / n,
    poseRate: frames.filter(f => f.pose).length / n,
    durationMs: frames.length > 1 ? frames[frames.length - 1].t_ms - frames[0].t_ms : 0,
  };
}

const HAND_EDGES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const POSE_EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16]];

export function drawOverlay(ctx, frame) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  if (!frame) return;
  const line = (pts, edges, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    for (const [a, b] of edges) {
      if (!pts[a] || !pts[b]) continue;
      ctx.beginPath(); ctx.moveTo(pts[a][0] * W, pts[a][1] * H); ctx.lineTo(pts[b][0] * W, pts[b][1] * H); ctx.stroke();
    }
  };
  if (frame.pose) {
    const visible = frame.pose.map(p => (p[3] >= 0.5 ? p : null));
    line(visible, POSE_EDGES, '#7aa2ff', 4);
    if (visible[0]) { ctx.fillStyle = '#7aa2ff'; ctx.beginPath(); ctx.arc(visible[0][0] * W, visible[0][1] * H, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  const sides = displaySides(frame);
  frame.hands.forEach((hand, i) => {
    const color = sides[i] === 'L' ? '#4fd1a5' : sides[i] === 'R' ? '#ffb347' : '#dddddd';
    line(hand.landmarks, HAND_EDGES, color, 2);
    ctx.fillStyle = color;
    for (const p of hand.landmarks) { ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, 3, 0, Math.PI * 2); ctx.fill(); }
  });
}
