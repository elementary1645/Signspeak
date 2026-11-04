// Generates hand-sequences.json: synthetic hand-evidence-v3 sequences shared by the JS and
// Python suites. Geometry is synthetic (the existing "legitimate hand near nose and mouth"
// hand shape moved along a path); no real recordings. Expected verdicts are written by hand
// from the rule, not computed by either implementation. Run: node web/tests/fixtures/make-hand-sequences.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'hand-validation.json'), 'utf8'));
const base = cases.find(c => c.name === 'legitimate hand near nose and mouth').frame;
const template = base.hands[0].landmarks.map(p => [p[0] - base.hands[0].landmarks[0][0], p[1] - base.hands[0].landmarks[0][1], p[2]]);
const r5 = v => Math.round(v * 1e5) / 1e5;

const SIDE = [0.22, 0.62];   // beside the body, far from the face zone
const CHIN = [0.47, 0.36];   // inside the face zone (nose at 0.5, 0.25; radius 0.5 shoulder widths)
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

function frame(t_ms, wrist, { poseVisibility = 0.95, hand = true, palmScale = 1 } = {}) {
  const pose = base.pose.map(p => [...p]);
  pose[14] = [0.28, 0.65, 0, 0.95];                      // subject-right elbow
  pose[13] = [0.64, 0.55, 0, 0.95];                      // subject-left elbow
  pose[15] = [0.72, 0.85, 0, poseVisibility];            // subject-left wrist, far from the hand
  pose[16] = wrist ? [r5(wrist[0]), r5(wrist[1]), 0, poseVisibility] : [0.28, 0.85, 0, poseVisibility];
  const hands = hand && wrist ? [{ landmarks: template.map(p => [r5(wrist[0] + p[0] * palmScale), r5(wrist[1] + p[1] * palmScale), p[2] * palmScale]),
    handedness: 'Left', score: 0.99 }] : [];
  return { t_ms, w: 640, h: 480, hands, pose };
}
// continuity: 'new-track' | 'continued' | 'restarted-step' | 'restarted-palm' | 'restarted-no-scale'
const A = (reason, entry = 'not-required', continuity = 'continued') => ({ status: 'accepted', reason, side: 'R', faceEntry: entry, continuity });
const U = (continuity = 'continued') => ({ status: 'uncertain', reason: 'face-zone-without-entry', side: '?', faceEntry: 'missing', continuity });
const NONE = null; // frame without hand candidates
const first = (list, change) => list.map((v, i) => (i === 0 ? change(v) : v));
const fresh = v => ({ ...v, continuity: 'new-track' });

const sequences = [];
const path9 = Array.from({ length: 9 }, (_, i) => lerp(SIDE, CHIN, i / 8));
// nearFace by geometry (checked by hand): path points 6-8 are within the 96 px face radius.
const nearOnPath = path9.map((_, i) => i >= 6);

sequences.push({ name: '(a) pose-supported hand moves from the side to the chin over 1 s',
  frames: path9.map((w, i) => frame(1000 + i * 125, w)),
  expected: first(nearOnPath.map(n => A('pose-supported', n ? 'entered' : 'not-required')), fresh) });

sequences.push({ name: '(a2) handedness-fallback hand moves from the side to the chin over 1 s',
  frames: path9.map((w, i) => frame(1000 + i * 125, w, { poseVisibility: 0.2 })),
  expected: first(nearOnPath.map(n => A('hand-supported-pose-unavailable', n ? 'entered' : 'not-required')), fresh) });

sequences.push({ name: '(b) pose-supported hand appears directly at the chin with no history',
  frames: Array.from({ length: 9 }, (_, i) => frame(1000 + i * 125, CHIN)),
  expected: first(Array.from({ length: 9 }, () => U()), fresh) });

sequences.push({ name: '(c) a gap longer than 300 ms loses the entry',
  frames: [frame(1000, SIDE), frame(1125, SIDE), frame(1250, SIDE),
    frame(1375, null), frame(1500, null), frame(1625, null), frame(1750, CHIN), frame(1875, CHIN)],
  expected: [A('pose-supported', 'not-required', 'new-track'), A('pose-supported'), A('pose-supported'), NONE, NONE, NONE, U('new-track'), U()] });

// SIDE -> CHIN is 1.06 shoulder widths: within 0.6 sw per 125 ms over a 250 ms gap (1.2 sw).
sequences.push({ name: '(c2) a gap of 250 ms keeps the entry when the motion is plausible',
  frames: [frame(1000, SIDE), frame(1125, SIDE), frame(1250, SIDE), frame(1375, null), frame(1500, CHIN), frame(1625, CHIN)],
  expected: [A('pose-supported', 'not-required', 'new-track'), A('pose-supported'), A('pose-supported'), NONE,
    A('pose-supported', 'entered'), A('pose-supported', 'entered')] });

const held = [...path9, ...Array(16).fill(CHIN)];
sequences.push({ name: '(d) after entering, a hand held at the chin beyond 1500 ms stays accepted while tracked',
  frames: held.map((w, i) => frame(1000 + i * 125, w)),
  expected: first(held.map((_, i) => A('pose-supported', i >= 6 ? 'entered' : 'not-required')), fresh) });

// The hole: a real right hand accepted outside the face, then a face false positive 125 ms later
// (1.15 sw away, same 9.6 px palm). The jump breaks the track, so the entry is lost on every frame.
const right = cases.find(c => c.name === 'right raised above shoulder').frame;
const falseFace = cases.find(c => c.name === 'face false positive despite high handedness score').frame;
sequences.push({ name: '(e) real right hand, then a face false positive 125 ms later',
  frames: [...[0, 1, 2].map(i => ({ ...right, t_ms: 1000 + i * 125 })), ...[0, 1, 2, 3, 4, 5].map(i => ({ ...falseFace, t_ms: 1375 + i * 125 }))],
  expected: [A('hand-supported-pose-unavailable', 'not-required', 'new-track'), A('hand-supported-pose-unavailable'), A('hand-supported-pose-unavailable'),
    U('restarted-step'), U(), U(), U(), U(), U()] });

// FAR_SIDE -> CHIN is 1.57 sw: more than 0.6 sw per 125 ms over the 250 ms gap (1.2 sw).
const FAR_SIDE = [0.1, 0.75];
sequences.push({ name: '(f) same palm size, 250 ms later, too far away for the elapsed time',
  frames: [frame(1000, FAR_SIDE), frame(1125, FAR_SIDE), frame(1250, FAR_SIDE), frame(1375, null),
    frame(1500, CHIN), frame(1625, CHIN), frame(1750, CHIN), frame(1875, CHIN)],
  expected: [A('pose-supported', 'not-required', 'new-track'), A('pose-supported'), A('pose-supported'), NONE,
    U('restarted-step'), U(), U(), U()] });

// Fast but real: 0.5 sw per 125 ms from the side to the chin (192 px shoulder width).
const sw = 192, total = Math.hypot((CHIN[0] - SIDE[0]) * 640, (CHIN[1] - SIDE[1]) * 480) / sw;
const fast = [0, 0.5, 1.0].map(d => lerp(SIDE, CHIN, d / total)).concat(Array(4).fill(CHIN));
// nearFace by geometry: fractions 0, 0.47 are outside; 0.95 and the chin are inside.
sequences.push({ name: '(g) fast real motion, 0.5 sw per 125 ms, from the side to the chin',
  frames: fast.map((w, i) => frame(1000 + i * 125, w)),
  expected: first(fast.map((_, i) => A('pose-supported', i >= 2 ? 'entered' : 'not-required')), fresh) });

// Palm size doubling in one frame restarts the track (path points 5 -> 6: 0.13 sw step).
const P5 = path9[5], P6 = path9[6];
sequences.push({ name: '(h) palm size jumps x2 in one frame at the face boundary: track restarts, entry lost',
  frames: [frame(1000, P5), frame(1125, P5), frame(1250, P5), frame(1375, P6, { palmScale: 2 }), frame(1500, P6, { palmScale: 2 })],
  expected: [A('pose-supported', 'not-required', 'new-track'), A('pose-supported'), A('pose-supported'), U('restarted-palm'), U()] });
sequences.push({ name: '(h2) palm size jumps x2 in one frame outside the face: track restarts, still accepted',
  frames: [frame(1000, SIDE), frame(1125, SIDE), frame(1250, SIDE, { palmScale: 2 }), frame(1375, SIDE, { palmScale: 2 })],
  expected: [A('pose-supported', 'not-required', 'new-track'), A('pose-supported'), A('pose-supported', 'not-required', 'restarted-palm'), A('pose-supported')] });

// 16-frame takes for the hp-v2-8fps-timed-1 protocol.
const take16 = [...path9, ...Array(7).fill(CHIN)];
sequences.push({ name: 'take: entry happens inside the take',
  frames: take16.map((w, i) => frame(1000 + i * 125, w)),
  expected: first(take16.map((_, i) => A('pose-supported', i >= 6 ? 'entered' : 'not-required')), fresh) });
sequences.push({ name: 'take: starts with the hand already at the chin',
  frames: Array.from({ length: 16 }, (_, i) => frame(1000 + i * 125, CHIN)),
  expected: first(Array.from({ length: 16 }, () => U()), fresh) });

fs.writeFileSync(path.join(here, 'hand-sequences.json'), JSON.stringify(sequences, null, 1) + '\n');
console.log(`wrote ${sequences.length} sequences`);
