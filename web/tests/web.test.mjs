// Browser-logic checks with fake detector results and a fake WebSocket. Synthetic only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displaySides, frameQuality, toFrame } from '../src/lib/lm.js';
import { MAX_RETRIES, RecognizerClient, wsUrl } from '../src/lib/recognizerClient.js';
import { takesToJsonl } from '../src/lib/takeStore.js';

const point = (x, y) => ({ x, y, z: 0, visibility: 0.9 });
const handAt = (x, y) => Array.from({ length: 21 }, (_, i) => point(x + i * 0.001, y - i * 0.002));
const pose = () => Array.from({ length: 33 }, (_, i) => (i === 15 ? point(0.66, 0.8) : i === 16 ? point(0.34, 0.8) : point(0.5, 0.5)));

test('toFrame builds lm-v1 with rounding, handedness and null pose', () => {
  const f = toFrame(1234.6, { landmarks: [handAt(0.341234567, 0.8)], handedness: [[{ categoryName: 'Left', score: 0.987654321 }]] }, { landmarks: [] }, 640, 480);
  assert.equal(f.t_ms, 1235);
  assert.equal(f.pose, null);
  assert.equal(f.hands[0].landmarks.length, 21);
  assert.equal(f.hands[0].landmarks[0][0], 0.34123);
  assert.deepEqual(Object.keys(f).sort(), ['h', 'hands', 'pose', 't_ms', 'w']);
  assert.equal(f.hands[0].handedness, 'Left');
  assert.equal(toFrame(1, { landmarks: [handAt(0.3, 0.8)], handednesses: [[{ categoryName: 'Right', score: 1 }]] }, null, 640, 480).hands[0].handedness, 'Right');
});

test('legacy pose assignment remains nearest wrist for comparison', () => {
  const f = toFrame(1, { landmarks: [handAt(0.66, 0.8), handAt(0.34, 0.8)], handedness: [[{ categoryName: 'Left', score: 1 }], [{ categoryName: 'Left', score: 1 }]] },
    { landmarks: [pose()] }, 640, 480);
  assert.deepEqual(poseSides(f), ['L', 'R']);
  assert.deepEqual(poseSides({ ...f, pose: null }), ['?', '?']);
});

test('frameQuality and JSONL export', () => {
  const frames = [{ t_ms: 0, hands: [{}], pose: null }, { t_ms: 1000, hands: [], pose: [[0]] }];
  assert.deepEqual(frameQuality(frames), { frames: 2, handRate: 0.5, poseRate: 0.5, durationMs: 1000 });
  assert.equal(takesToJsonl([{ a: 1 }, { b: 2 }]), '{"a":1}\n{"b":2}\n');
  assert.equal(takesToJsonl([]), '');
});

test('wsUrl follows page protocol and host (no localhost assumption)', () => {
  assert.equal(wsUrl({ protocol: 'https:', host: 'x.hf.space' }), 'wss://x.hf.space/ws/recognize');
  assert.equal(wsUrl({ protocol: 'http:', host: '127.0.0.1:5173' }), 'ws://127.0.0.1:5173/ws/recognize');
});

class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeSocket.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  fail(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

test('client reconnects with bounded retries, then falls back to POST batches', async () => {
  FakeSocket.instances = [];
  const timers = [];
  const transports = [];
  const posts = [];
  const messages = [];
  const client = new RecognizerClient({
    url: 'ws://h/ws/recognize', WebSocketImpl: FakeSocket, onTransport: t => transports.push(t.mode),
    onMessage: m => messages.push(m), setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {},
    fetchImpl: async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ replies: [{ type: 'prediction', state: 'NO_HAND' }] }) }; },
  });
  client.start();
  FakeSocket.instances[0].open();
  client.send({ t_ms: 1 });
  assert.deepEqual(FakeSocket.instances[0].sent, [{ type: 'frame', frame: { t_ms: 1 } }]);
  FakeSocket.instances[0].fail();
  for (let i = 0; i < MAX_RETRIES; i++) {
    assert.equal(client.mode, 'reconnecting');
    timers.shift()();
    FakeSocket.instances.at(-1).fail();
  }
  assert.equal(client.mode, 'http');
  assert.equal(FakeSocket.instances.length, 1 + MAX_RETRIES);
  for (let t = 10; t < 16; t++) client.send({ t_ms: t });
  await new Promise(r => setTimeout(r, 0));
  assert.ok(posts.length >= 1 && posts[0].frames.length === 3 && posts[0].stream_id);
  assert.equal(messages[0].state, 'NO_HAND');
  client.stop();
  assert.equal(client.mode, 'idle');
  assert.ok(transports.includes('ws') && transports.includes('http'));
});

import { CAPTURE_MAX_MS, FpsMeter, captureDone, measuredFps, sessionSummary, takeVerdict } from '../src/lib/capture.js';

const framesAt = (fps, n, start = 1000) => Array.from({ length: n }, (_, i) => ({ t_ms: start + (i * 1000) / fps }));

test('adaptive capture stops at 26 frames or 3.0 s, whichever first', () => {
  assert.equal(captureDone(framesAt(15, 25), 1000, 1000 + 1600), false);
  assert.equal(captureDone(framesAt(15, 26), 1000, 1000 + 1667), true);
  assert.equal(captureDone(framesAt(6, 17), 1000, 1000 + CAPTURE_MAX_MS - 1), false);
  assert.equal(captureDone(framesAt(6, 18), 1000, 1000 + CAPTURE_MAX_MS), true);
});

test('fps meter and low_fps verdict', () => {
  const meter = new FpsMeter();
  framesAt(15, 40).forEach(f => meter.add(f.t_ms));
  assert.ok(Math.abs(meter.fps() - 15) < 0.01);
  assert.equal(new FpsMeter().fps(), null);
  assert.ok(Math.abs(measuredFps(framesAt(10, 30)) - 10) < 1e-9);
  const ok = takeVerdict(framesAt(15, 26));
  assert.ok(Math.abs(ok.fps - 15) < 1e-6 && ok.lowFps === false && ok.valid === true);
  const slow = takeVerdict(framesAt(8, 24));
  assert.equal(slow.lowFps, true);
  assert.equal(slow.valid, false);          // slow capture cannot satisfy hp-v1
  assert.equal(takeVerdict(framesAt(15, 14)).valid, false);
});

test('session summary reports completion, per-session counts and low_fps', () => {
  const t = (label, session, low = false) => ({ signer_id: 'p1', session_id: session, label, low_fps: low });
  const takes = [t('A', 's1'), t('A', 's2', true), t('NONE', 's2'), { ...t('A', 's2'), signer_id: 'other' }];
  const s = sessionSummary(takes, 'p1', 's2', ['A', 'NONE'], { per_sign: 2, none: 2 }, 'NONE');
  assert.deepEqual(s.rows.map(r => [r.label, r.thisSession, r.total, r.lowFps, r.complete]), [['A', 1, 2, 1, true], ['NONE', 1, 1, 0, false]]);
  assert.equal(s.complete, false);
  assert.deepEqual(s.missing, ['NONE (1 more)']);
  assert.equal(s.lowFps, 1);
  assert.equal(sessionSummary([...takes, t('NONE', 's2')], 'p1', 's2', ['A', 'NONE'], { per_sign: 2, none: 2 }, 'NONE').complete, true);
});

import { inferenceSize, TrackerWorker } from '../src/lib/tracking.js';
test('inference resolution is bounded and preserves source aspect ratio', () => {
  assert.deepEqual(inferenceSize(1280, 960, 640), { width: 640, height: 480 });
  assert.deepEqual(inferenceSize(1280, 720, 640), { width: 640, height: 360 });
  assert.deepEqual(inferenceSize(320, 240, 640), { width: 320, height: 240 });
});
test('timing rejects sparse, duplicate, out of order and stalled samples without inventing frames', () => {
  for (const fps of [3, 8, 10, 20, 30]) assert.equal(takeVerdict(framesAt(fps, 26)).valid, false);
  assert.equal(takeVerdict(framesAt(15, 24)).valid, true);
  const duplicate = framesAt(15, 26); duplicate[5].t_ms = duplicate[4].t_ms;
  assert.equal(takeVerdict(duplicate).valid, false);
  const gap = framesAt(15, 26); gap[5].t_ms += 40;
  assert.equal(takeVerdict(gap).valid, false);
  const invalid = framesAt(15, 26); invalid[5].t_ms = NaN;
  assert.equal(takeVerdict(invalid).valid, false);
});
test('worker correlates replies and rejects pending work on stop', async () => {
  class FakeWorker {
    static instance;
    constructor() { FakeWorker.instance = this; this.messages = []; }
    postMessage(msg) { this.messages.push(msg); }
    terminate() { this.terminated = true; }
  }
  const tracker = new TrackerWorker('hand', 'CPU', FakeWorker);
  const worker = FakeWorker.instance;
  assert.equal(worker.messages[0].delegate, 'CPU');
  worker.onmessage({ data: { id: 1, ready: true } });
  await tracker.ready;
  const p = tracker.request({ type: 'frame', timestamp: 123 });
  const rejected = assert.rejects(p, /stopped/);
  tracker.close();
  await rejected;
  assert.equal(worker.terminated, true);
  assert.equal(tracker.pending.size, 0);
});

import { TimingWindow } from '../src/lib/tracking.js';
test('timing window reports bounded means and p95', () => {
  const window = new TimingWindow(3);
  assert.deepEqual(window.summary(), { samples: 0 });
  for (const ms of [1000, 10, 20, 30]) window.add({ handMs: ms });
  assert.deepEqual(window.summary(), { samples: 3, handMs: 20, handMsP95: 30 });
});

import { FrameClock } from '../src/lib/tracking.js';
test('frame timestamps preserve actual camera intervals and never fabricate progress', () => {
  const clock = new FrameClock();
  assert.equal(clock.timestamp(10, 5000), 5000);
  assert.equal(clock.timestamp(10, 5100), null);
  assert.equal(clock.timestamp(9, 5200), null);
  assert.equal(clock.timestamp(10.3, 5600), 5300); // completion delay is not capture time
  assert.equal(clock.timestamp(NaN, 5700), null);
});

import { DEFAULT_PROTOCOL, PROTOCOLS, timingInstructions } from '../src/lib/capture.js';
test('8 FPS contract accepts laptop rates and preserves all source timestamps', () => {
  const protocol = DEFAULT_PROTOCOL;
  assert.equal(PROTOCOLS[protocol].window, 16);
  for (const fps of [7, 7.5, 8, 8.8, 9, 9.2, 9.5]) {
    const frames = framesAt(fps, 16).map(f => ({ t_ms: Math.round(f.t_ms) }));
    const before = JSON.stringify(frames);
    assert.equal(takeVerdict(frames, protocol).valid, true, `rate ${fps}`);
    assert.equal(JSON.stringify(frames), before);
  }
  assert.equal(captureDone(framesAt(8, 15), 1000, 2800, protocol), false);
  assert.equal(captureDone(framesAt(8, 16), 1000, 2875, protocol), true);
  assert.match(timingInstructions(protocol), /Exactly 16/);
});
test('8 FPS contract rejects count, rate and gap violations; old protocol stays separate', () => {
  for (const [fps, n] of [[5, 16], [6.9, 16], [10, 16], [15, 16], [8, 15], [8, 17]]) {
    assert.equal(takeVerdict(framesAt(fps, n), DEFAULT_PROTOCOL).valid, false);
  }
  for (const delta of [-125, -130, -50, 75, NaN]) {
    const frames = framesAt(8, 16); frames[5].t_ms += delta;
    assert.equal(takeVerdict(frames, DEFAULT_PROTOCOL).valid, false);
  }
  assert.equal(takeVerdict(framesAt(8, 16), 'hp-v1-timed-1').valid, false);
  assert.equal(takeVerdict(framesAt(15, 26), 'hp-v1-timed-1').valid, true);
  assert.equal(takeVerdict(framesAt(8, 16), 'unknown').valid, false);
});
test('collection summary never counts other temporal protocols toward the selected target', () => {
  const takes = [DEFAULT_PROTOCOL, 'hp-v1-timed-1', undefined].map(capture_protocol => ({
    signer_id: 'p1', session_id: 's1', label: 'NONE', capture_protocol,
  }));
  assert.equal(sessionSummary(takes, 'p1', 's1', ['NONE'], { none: 2 }, 'NONE', DEFAULT_PROTOCOL).total, 1);
});

import { InferenceCadence } from '../src/lib/tracking.js';
test('8 FPS scheduling avoids 20/30 FPS camera quantization and keeps a native 9 FPS source', () => {
  for (const cameraFps of [9, 20, 30]) {
    const cadence = new InferenceCadence(8, 9.5);
    const times = [];
    for (let i = 0; i < cameraFps * 4; i++) {
      const t = i * 1000 / cameraFps;
      if (cadence.ready(t, t)) { cadence.started(t); times.push(t); }
    }
    const frames = times.slice(-16).map(t_ms => ({ t_ms }));
    assert.equal(takeVerdict(frames, DEFAULT_PROTOCOL).valid, true, `source ${cameraFps} FPS`);
  }
});

import handCases from './fixtures/hand-validation.json' with { type: 'json' };
import { POLICY, validateHands, poseSides } from '../src/lib/handValidation.js';
import { FreshFrame, validResultPair } from '../src/lib/tracking.js';
test('browser geometry gate rejects false face detections and preserves face/chest/crossed signing', () => {
  for (const c of handCases) {
    const original = JSON.stringify(c.frame);
    const result = validateHands(c.frame);
    assert.deepEqual(displaySides(result.frame), c.sides, c.name);
    assert.equal(result.frame.hands.length, c.sides.length, c.name);
    assert.equal(JSON.stringify(c.frame), original, 'raw diagnostic input is not mutated');
    assert.equal(result.diagnostics.rawCount, c.frame.hands.length);
  }
});
test('geometry thresholds are configurable without any facial exclusion zone', () => {
  const frame = structuredClone(handCases.find(c => c.name === 'single subject left ignores misleading handedness').frame);
  frame.hands[0].landmarks[0][0] += 0.1;
  assert.equal(validateHands(frame).frame.hands.length, 1);
  assert.equal(validateHands(frame, { maxWristDistanceShoulders: 0.2 }).frame.hands.length, 0);
  const falseFace = handCases[0].frame;
  const recording = Array.from({ length: 16 }, (_, i) => validateHands({ ...falseFace, t_ms: 1000 + i * 125 }).frame);
  assert.equal(takeVerdict(recording, DEFAULT_PROTOCOL).valid, true);
  assert.ok(recording.every(f => f.hands.length === 0));
  assert.ok(!takesToJsonl([{ frames: recording }]).includes('0.99'));
});
test('synchronized workers reject timestamp/kind mix-ups and expired inference', () => {
  const hand = { timestamp: 100, kind: 'hand' }, pose = { timestamp: 100, kind: 'pose' };
  assert.equal(validResultPair(hand, pose, 100, 80), true);
  assert.equal(validResultPair(hand, { ...pose, timestamp: 101 }, 100, 80), false);
  assert.equal(validResultPair(pose, hand, 100, 80), false);
  assert.equal(validResultPair(hand, pose, 100, POLICY.maxResultAgeMs + 1), false);
});
test('no-hand updates, expiry, stop and out-of-order results cannot leave stale hands on screen', () => {
  let now = 100;
  const published = [], timers = new Map(); let id = 0;
  const fresh = new FreshFrame(f => published.push(f), { now: () => now,
    setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: key => timers.delete(key) });
  const hand = handCases[2].frame;
  assert.equal(fresh.accept(hand, 90), true);
  assert.equal(fresh.accept({ ...hand, t_ms: 999 }, 90), false);
  assert.equal(fresh.accept({ ...hand, t_ms: 1001, hands: [] }, 90), true);
  assert.equal(published.at(-1).hands.length, 0);
  timers.get(id)();
  assert.equal(published.at(-1), null);
  now = 900;
  assert.equal(fresh.accept({ ...hand, t_ms: 1002 }, 100), false);
  fresh.close();
  assert.equal(fresh.accept({ ...hand, t_ms: 1003 }, 900), false);
});

test('a queued expiry for an older observation cannot clear a newer frame', () => {
  const output = [], timers = [];
  const fresh = new FreshFrame(f => output.push(f), { now: () => 100,
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  fresh.accept({ t_ms: 100 }, 100);
  fresh.accept({ t_ms: 200 }, 100);
  timers[0]();
  assert.equal(output.at(-1).t_ms, 200);
  fresh.close();
  timers[1]();
  assert.equal(output.at(-1).t_ms, 200);
});

test('raised/independent hands do not need valid shoulders or wrist alignment', () => {
  for (const name of ['left raised above shoulder', 'right raised above shoulder', 'both hands raised',
    'unreliable shoulders reported regression pattern', 'raised hand with missing pose wrist confidence']) {
    const c = handCases.find(c => c.name === name);
    const result = validateHands(c.frame);
    assert.equal(result.diagnostics.recordable, true, name);
    assert.deepEqual(displaySides(result.frame), c.sides, name);
    assert.ok(result.diagnostics.raw.every(d => d.sideSource === 'handedness'), name);
  }
  const sample = validateHands(handCases.find(c => c.name === 'unreliable shoulders reported regression pattern').frame);
  assert.equal(sample.diagnostics.raw[0].legacyReason, 'unreliable-shoulders');
  assert.equal(sample.diagnostics.raw[0].reason, 'hand-supported-pose-unavailable');
  assert.equal(sample.diagnostics.raw[0].poseWrists.length, 2);
});
test('face conflict and unavailable pose are uncertain, not no hands or a recording', () => {
  for (const name of ['face false positive despite high handedness score', 'no pose wrists',
    'face proximity and missing wrists are uncertain']) {
    const result = validateHands(handCases.find(c => c.name === name).frame);
    assert.equal(result.diagnostics.state, 'uncertain');
    assert.equal(result.diagnostics.recordable, false);
    assert.equal(result.frame.hands.length, 0);
  }
  assert.equal(validateHands(handCases.find(c => c.name === 'no visible hands').frame).diagnostics.state, 'none');
});
test('uncertainty resets WebSocket history and ignores predictions from before the reset', () => {
  FakeSocket.instances = [];
  const messages = [];
  const client = new RecognizerClient({ url: 'ws://fixture', WebSocketImpl: FakeSocket, onMessage: m => messages.push(m) });
  client.start();
  const socket = FakeSocket.instances[0]; socket.open();
  client.send({ t_ms: 90 });
  client.reset(100);
  assert.deepEqual(socket.sent.at(-1), { type: 'reset' });
  socket.onmessage({ data: JSON.stringify({ type: 'prediction', t_ms: 90, event: 'STALE' }) });
  socket.onmessage({ data: JSON.stringify({ type: 'prediction', t_ms: 101, label: null }) });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].t_ms, 101);
  client.stop();
});
test('uncertainty suppresses an in-flight HTTP response and resets the next batch', async () => {
  const messages = [], posts = [];
  let resolveRequest;
  const client = new RecognizerClient({ url: 'ws://fixture', onMessage: m => messages.push(m),
    fetchImpl: async (_url, init) => {
      posts.push(JSON.parse(init.body));
      if (posts.length === 1) await new Promise(resolve => { resolveRequest = resolve; });
      return { ok: true, json: async () => ({ replies: [{ type: 'prediction', t_ms: posts.length === 1 ? 90 : 101 }] }) };
    } });
  client.stopped = false; client.mode = 'http';
  [80, 85, 90].forEach(t_ms => client.send({ t_ms }));
  client.reset(100); resolveRequest();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(messages.length, 0);
  [101, 102, 103].forEach(t_ms => client.send({ t_ms }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(posts[1].reset, true);
  assert.equal(messages.length, 1);
  client.stop();
});

import { policyMatches } from '../src/lib/handValidation.js';
test('mixed browser/server observation policies fail closed without changing capture timing', () => {
  assert.equal(policyMatches(POLICY), true);
  assert.equal(policyMatches(null), false);
  assert.equal(policyMatches({ ...POLICY, policy: 'pose-wrist-v1' }), false);
  assert.equal(policyMatches({ ...POLICY, minHandPresenceConfidence: .65 }), false);
  assert.equal(PROTOCOLS[DEFAULT_PROTOCOL].fps, 8);
  assert.equal(PROTOCOLS[DEFAULT_PROTOCOL].window, 16);
});

import { DiagnosticBuffer } from '../src/lib/diagnosticBuffer.js';
test('diagnostic ring retains exactly the latest 100 complete observations', () => {
  const buffer = new DiagnosticBuffer();
  assert.equal(buffer.latest(), null);
  assert.equal(buffer.latestFailureB(), null);
  buffer.append({ t_ms: 0, rawCount: 1, acceptedCount: 0 });
  for (let i = 1; i <= 100; i++) buffer.append({ t_ms: i, rawCount: 0, acceptedCount: 0 });
  assert.equal(buffer.size, 100);
  assert.equal(buffer.getVersion(), 101);
  assert.equal(buffer.latest().t_ms, 100);
  assert.equal(buffer.latestFailureB(), null, 'old event is evicted rather than misreported as recent');
});
test('Failure B capture finds the newest raw-candidate/no-accepted event after the live state changes', () => {
  const buffer = new DiagnosticBuffer();
  buffer.append({ t_ms: 1, rawCount: 1, acceptedCount: 0, reason: 'old event' });
  buffer.append({ t_ms: 2, rawCount: 1, acceptedCount: 0, reason: 'latest event' });
  buffer.append({ t_ms: 3, rawCount: 1, acceptedCount: 1 });
  buffer.append({ t_ms: 4, rawCount: 0, acceptedCount: 0 });
  assert.equal(buffer.latest().t_ms, 4);
  assert.equal(buffer.latestFailureB().t_ms, 2);
});
test('frozen diagnostic copies preserve full evidence independently of source mutations and ring overwrite', () => {
  const buffer = new DiagnosticBuffer(2);
  const input = {
    policy: 'hand-evidence-v2', rawCount: 1, acceptedCount: 0, t_ms: 192676,
    sourceTimestamp: 192676.071, workerTimestamps: { hand: 192676.071, pose: 192676.071 },
    poseShoulders: [[.72, 1.03, -.33, .98], [.34, 1.004, -.33, .99]],
    presenceConfidence: null,
    raw: [{ handedness: 'Right', handednessScore: .9802, landmarks: structuredClone(handCases[0].frame.hands[0].landmarks),
      poseWrists: [{ coordinates: [.604, 1.01, -.88, .68], distancePixels: 297.8 },
        { coordinates: [.248, .641, -1.66, .8177], distancePixels: 10.77 }],
      status: 'uncertain', reason: 'face-reference-unavailable', side: '?', sideSource: null }],
    additionalEvidence: { nested: ['must be preserved verbatim'] },
  };
  const expected = structuredClone(input);
  buffer.append(input);
  input.raw[0].landmarks[0][0] = 999;
  const frozen = buffer.latestFailureB();
  assert.deepEqual(frozen, expected);
  frozen.raw[0].handednessScore = 0;
  assert.deepEqual(buffer.latestFailureB(), expected, 'returned copies cannot mutate the ring');
  const pinned = buffer.latestFailureB();
  buffer.append({ rawCount: 0, acceptedCount: 0, t_ms: 2 });
  buffer.append({ rawCount: 0, acceptedCount: 0, t_ms: 3 });
  assert.equal(buffer.latestFailureB(), null);
  assert.deepEqual(pinned, expected, 'freeze survives eviction and continuing camera observations');
});
test('diagnostic subscriptions can detach or fail without interrupting observation storage', () => {
  const buffer = new DiagnosticBuffer(); let notified = 0;
  const detach = buffer.subscribe(() => notified++);
  buffer.subscribe(() => { throw new Error('viewer failure'); });
  buffer.append({ t_ms: 1 });
  detach();
  buffer.append({ t_ms: 2 });
  assert.equal(notified, 1);
  assert.equal(buffer.size, 2);
  assert.equal(buffer.latest().t_ms, 2);
});

// hand-evidence-v3. laptop_capture_*.json are real laptop diagnostics stored with the signer's
// consent under backend/tests/fixtures only; their pose holds just points 0 and 11-16 (the
// rest are visibility-0 placeholders the validator ignores). hand-sequences.json is synthetic
// and asserted identically by backend/tests/test_hand_evidence_v3.py.
import fs from 'node:fs';
import handSequences from './fixtures/hand-sequences.json' with { type: 'json' };
import { HandEvidenceTracker, validateSequence } from '../src/lib/handValidation.js';
import { FRAMING_MESSAGE, FACE_START_MESSAGE, FramingMonitor, startBlockMessage } from '../src/lib/framing.js';
const capture = name => {
  const c = JSON.parse(fs.readFileSync(new URL(`../../backend/tests/fixtures/laptop_capture_${name}.json`, import.meta.url)));
  const pose = Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0]);
  pose[0] = c.poseNose; [pose[11], pose[12]] = c.poseShoulders; [pose[13], pose[14]] = c.poseElbows;
  [pose[15], pose[16]] = c.raw[0].poseWrists.map(w => w.coordinates);
  return { t_ms: c.t_ms, w: c.input.width, h: c.input.height, pose,
    hands: c.raw.map(r => ({ landmarks: r.landmarks, handedness: r.handedness, score: r.handednessScore })) };
};
const verdictOf = r => r.diagnostics.raw[0]
  ? (({ status, reason, side, faceEntry, trackContinuity }) => ({ status, reason, side, faceEntry, continuity: trackContinuity }))(r.diagnostics.raw[0]) : null;

test('hand-evidence-v3 policy parameters are explicit', () => {
  assert.equal(POLICY.policy, 'hand-evidence-v3');
  assert.deepEqual([POLICY.poseCoordinateMargin, POLICY.faceEntryWindowMs, POLICY.maxTrackGapMs, POLICY.maxTrackStepShoulders, POLICY.maxPalmScaleRatio],
    [0.5, 1500, 300, 0.6, 1.6]);
});
test('laptop capture 1: real raised hand with cropped shoulders/elbow is accepted right', () => {
  const r = validateHands(capture('1_real_hand'));
  const d = r.diagnostics.raw[0];
  assert.deepEqual([d.status, d.reason, d.side, d.nearFace], ['accepted', 'pose-supported', 'R', false]);
  assert.equal(d.legacyReason, 'unreliable-shoulders'); // pose-wrist-v1 comparison keeps strict bounds
  assert.deepEqual(displaySides(r.frame), ['R']);
});
test('laptop captures 2 and 3: face hallucinations alone are uncertain', () => {
  for (const name of ['2_face_hallucination', '3_chin_hallucination']) {
    const r = validateHands(capture(name));
    assert.equal(r.diagnostics.recordable, false, name);
    assert.equal(r.frame.hands.length, 0, name);
    assert.deepEqual([r.diagnostics.raw[0].reason, r.diagnostics.raw[0].nearFace], ['face-zone-without-entry', true], name);
  }
});
test('hand sequences match the hand-written expectations shared with Python', () => {
  for (const s of handSequences) assert.deepEqual(validateSequence(s.frames).map(verdictOf), s.expected, s.name);
});
test('real capture 1 followed 125 ms later by capture 3 or 2 never lends the hallucination an entry', () => {
  const real = capture('1_real_hand');
  for (const [name, reason] of [['3_chin_hallucination', 'restarted-step'], ['2_face_hallucination', 'restarted-step']]) {
    const fake = { ...capture(name), t_ms: real.t_ms + 125 };
    const [a, b] = validateSequence([real, fake]).map(verdictOf);
    assert.deepEqual(a, { status: 'accepted', reason: 'pose-supported', side: 'R', faceEntry: 'not-required', continuity: 'new-track' }, name);
    assert.deepEqual(b, { status: 'uncertain', reason: 'face-zone-without-entry', side: '?', faceEntry: 'missing', continuity: reason }, name);
  }
});
test('tracker state is in diagnostics, resets on clock jump, and display sides never lose entry', () => {
  const s = handSequences.find(c => c.name.startsWith('(a) '));
  const tracker = new HandEvidenceTracker();
  let last;
  for (const f of s.frames) last = tracker.validate(f);
  assert.deepEqual(last.diagnostics.tracker.R, { lastOutsideFaceMs: 1625, trackStartMs: 1000, trackAgeMs: 1000, gapMs: 125, faceEntered: true });
  assert.deepEqual(displaySides(last.frame), ['R']);           // the accepted frame keeps its side
  assert.deepEqual(displaySides({ ...last.frame }), ['?']);    // a copy re-validated without history would not
  assert.equal(tracker.validate({ ...s.frames.at(-1), t_ms: 500 }).diagnostics.raw[0].reason, 'face-zone-without-entry');
  tracker.validate(s.frames[0]);
  tracker.reset();
  assert.equal(tracker.validate(s.frames.at(-1)).diagnostics.raw[0].faceEntry, 'missing');
});
test('framing warning needs most of the last ~2 s to be badly framed', () => {
  const bad = capture('1_real_hand').pose, good = handSequences[0].frames[0].pose;
  const monitor = new FramingMonitor();
  assert.equal(monitor.add(0, bad).warn, false);               // too few samples
  for (let t = 125; t <= 500; t += 125) monitor.add(t, bad);
  assert.equal(monitor.add(625, bad).warn, true);
  for (let t = 750; t <= 2625; t += 125) monitor.add(t, good);
  assert.equal(monitor.add(2750, good).warn, false);
  assert.equal(new FramingMonitor().add(0, null).samples, 0);
});
test('collect refuses to start with any accepted or uncertain candidate in the face zone', () => {
  const chin = validateHands(capture('3_chin_hallucination')).diagnostics;
  assert.equal(startBlockMessage(chin), FACE_START_MESSAGE);
  assert.equal(startBlockMessage(chin, true), `${FACE_START_MESSAGE} ${FRAMING_MESSAGE}`);
  assert.equal(startBlockMessage(validateHands(capture('1_real_hand')).diagnostics), null);
  assert.equal(startBlockMessage({ raw: [{ nearFace: true, status: 'rejected' }] }), null);
  assert.equal(startBlockMessage(null), null);
});
import { TakeDiagnosticsLog } from '../src/lib/takeDiagnostics.js';
test('take diagnostics log every observation from countdown start and mark take membership', () => {
  const log = new TakeDiagnosticsLog(1000);
  const obs = (t_ms, extra = {}) => ({ t_ms, state: 'accepted', rawCount: 1, acceptedCount: 1, uncertainCount: 0, rejectedCount: 0,
    recordable: true, raw: [{ status: 'accepted', reason: 'pose-supported', faceEntry: 'not-required', trackContinuity: 'continued',
      side: 'R', sideSource: 'pose', handedness: 'Left', handednessScore: 0.9, handWrist: [0.2, 0.6, 0], nearFace: false, palmPixels: 40, landmarks: [] }],
    framing: { warn: false, badFraction: 0, samples: 4 }, ...extra });
  log.observe(obs(900));                       // before countdown: ignored
  log.observe(obs(1100));                      // countdown
  log.recordingStart = 4000;
  log.addedToTake(4100); log.observe(obs(4100));
  log.observe(obs(4225, { state: 'rejected', recordable: false, acceptedCount: 0, rejectedCount: 1,
    raw: [{ status: 'rejected', reason: 'hand-wrist-outside-image', handWrist: [0.3, 1.02, 0], nearFace: false, palmPixels: 30 }] }));
  log.staleResult(4350);
  log.addedToTake(4475); log.observe(obs(4475));
  log.close(4500);
  log.observe(obs(4475 + 125));                // after close time: ignored
  const out = log.finish({ label: 'NONE', protocol: 'hp-v2-8fps-timed-1', verdict: { valid: false } });
  log.observe(obs(4600));                      // after the take: ignored
  assert.equal(out.observations.length, 4);
  assert.deepEqual(out.observations.map(o => [o.phase, o.addedToTake]), [['countdown', false], ['recording', true], ['recording', false], ['recording', true]]);
  assert.equal(out.observations[2].candidates[0].reason, 'hand-wrist-outside-image');
  assert.equal('landmarks' in out.observations[1].candidates[0], false);
  assert.deepEqual([out.takeFrameGapsMs, out.staleResultTimes], [[375], [4350]]);
  assert.deepEqual(out.observations[1].framing, { warn: false, badFraction: 0, samples: 4 });
});

test('translate debug log: newest first, capped, browser-uncertain bursts merge, nothing else changes', async () => {
  const { LOG_SIZE, appendLog, fromBrowserUncertain, fromPrediction } = await import('../src/lib/predictionLog.js');
  let log = [];
  for (let i = 0; i < LOG_SIZE + 3; i++) {
    log = appendLog(log, fromPrediction({ state: 'RECOGNIZING', label: 'THANK_YOU', confidence: 0.6, margin: 0.3, t_ms: i * 375 }));
  }
  assert.equal(log.length, LOG_SIZE);
  assert.equal(log[0].t_ms, (LOG_SIZE + 2) * 375);
  const unknown = fromPrediction({ state: 'UNKNOWN', label: null, confidence: 0.51, margin: 0.1, detail: 'not a known sign', t_ms: 1 });
  assert.deepEqual([unknown.state, unknown.label, unknown.reason, unknown.event], ['UNKNOWN', null, 'not a known sign', null]);
  const face = { t_ms: 10, raw: [{ status: 'uncertain', reason: 'face-zone-without-entry' }, { status: 'accepted', reason: 'pose-supported' }] };
  log = appendLog(appendLog([], fromBrowserUncertain(face)), fromBrowserUncertain({ ...face, t_ms: 20 }));
  assert.equal(log.length, 1);
  assert.equal(log[0].count, 2);
  assert.equal(log[0].t_ms, 20);
  assert.equal(log[0].reason, 'face-zone-without-entry · session reset');
  log = appendLog(log, fromBrowserUncertain({ t_ms: 30, state: 'stale' }));
  assert.equal(log.length, 2);
  assert.equal(log[0].reason, 'stale-tracker-result · session reset');
});

test('timing notice: re-reading right after a reset, FPS warning only outside the contract', async () => {
  const { REREAD_MS, timingNotice } = await import('../src/lib/translateState.js');
  const base = { code: 'INSUFFICIENT_TIMING', minFps: 7, maxFps: 9.5 };
  assert.equal(timingNotice({ ...base, sinceResetMs: 400, fps: 8.1 }), 'rereading');
  assert.equal(timingNotice({ ...base, sinceResetMs: REREAD_MS - 1, fps: 4 }), 'rereading');
  assert.equal(timingNotice({ ...base, sinceResetMs: REREAD_MS, fps: 8.1 }), null);
  assert.equal(timingNotice({ ...base, sinceResetMs: Infinity, fps: 6.9 }), 'fps');
  assert.equal(timingNotice({ ...base, sinceResetMs: Infinity, fps: 9.6 }), 'fps');
  assert.equal(timingNotice({ ...base, sinceResetMs: Infinity, fps: 7 }), null);
  assert.equal(timingNotice({ ...base, sinceResetMs: Infinity, fps: null }), null);
  assert.equal(timingNotice({ code: 'INSUFFICIENT_TIMING', sinceResetMs: Infinity, fps: 6 }), 'fps'); // defaults 7–9.5
  assert.equal(timingNotice({ ...base, code: 'UNCERTAIN_HANDS', sinceResetMs: 10, fps: 3 }), null);
});

test('translate debug log keeps the UNKNOWN top label and confidence', async () => {
  const { fromPrediction } = await import('../src/lib/predictionLog.js');
  const row = fromPrediction({ state: 'UNKNOWN', label: null, confidence: 0.48, margin: 0.05, top_label: 'THANK_YOU',
    top_confidence: 0.48, detail: 'low confidence', t_ms: 5 });
  assert.deepEqual([row.label, row.topLabel, row.topConfidence, row.reason], [null, 'THANK_YOU', 0.48, 'low confidence']);
  assert.deepEqual([fromPrediction({ state: 'NO_HAND' }).topLabel, fromPrediction({ state: 'NO_HAND' }).topConfidence], [null, null]);
});
