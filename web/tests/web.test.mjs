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

test('displaySides uses nearest pose wrist, like the server', () => {
  const f = toFrame(1, { landmarks: [handAt(0.66, 0.8), handAt(0.34, 0.8)], handedness: [[{ categoryName: 'Left', score: 1 }], [{ categoryName: 'Left', score: 1 }]] },
    { landmarks: [pose()] }, 640, 480);
  assert.deepEqual(displaySides(f), ['L', 'R']);
  assert.deepEqual(displaySides({ ...f, pose: null }), ['?', '?']);
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
  assert.equal(slow.valid, true);           // low fps is flagged, not dropped
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
