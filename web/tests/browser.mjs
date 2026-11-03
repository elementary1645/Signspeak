// Real MediaPipe, synthetic browser camera: verifies plumbing, never signing accuracy.
// Start the built app with LEGACY_DETECTOR=0 python -m uvicorn backend.app.main:app.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import handCases from './fixtures/hand-validation.json' with { type: 'json' };
const browser = await chromium.launch({ headless: true, args: [
  '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader',
] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.trackingTest = { workers: 0, streams: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.trackingTest.workers++; this.live = true; }
      postMessage(message, transfer) {
        if (message.type === 'frame' && window.trackingTest.delayInference) {
          setTimeout(() => { if (this.live) super.postMessage(message, transfer); }, 200);
        } else super.postMessage(message, transfer);
      }
      terminate() { if (this.live) { window.trackingTest.workers--; this.live = false; } super.terminate(); }
    };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (window.trackingTest.delayCamera) await new Promise(r => setTimeout(r, 500));
      const stream = await get(...args); window.trackingTest.streams.push(stream); return stream;
    };
  });
  await page.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:8000'}/collect`);
  for (const delegate of ['CPU', 'GPU']) {
    await page.getByLabel('Delegate', { exact: true }).selectOption(delegate);
    await page.getByRole('button', { name: 'Start camera', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Tracker diagnostics"]')?.textContent.includes('parallel workers') || document.querySelector('[role="alert"]'), { timeout: 90000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, await page.locator('[role="alert"]').allTextContents());
    await page.waitForTimeout(5000);
    console.log(`${delegate} SYNTHETIC CAMERA:`, await page.getByLabel('Tracker diagnostics').textContent());
    assert.equal(await page.locator('[role="alert"]').count(), 0, (await page.locator('[role="alert"]').allTextContents()).join(' '));
    assert.equal(await page.evaluate(() => window.trackingTest.workers), 2);
    assert.equal(await page.getByLabel('Collection protocol', { exact: true }).inputValue(), 'hp-v2-8fps-timed-1');
    assert.equal(await page.getByLabel('Inference FPS', { exact: true }).inputValue(), '8');
    if (delegate === 'CPU') {
      await page.getByPlaceholder('e.g. signer07').fill('synthetic_test');
      await page.getByRole('checkbox', { name: /I agree to record hand/ }).check();
      await page.getByRole('button', { name: 'Record take', exact: true }).click();
      const keep = page.getByRole('button', { name: 'Keep', exact: true });
      await keep.waitFor({ timeout: 15000 });
      console.log('8 FPS SYNTHETIC CAPTURE:', await page.getByText(/frames over/).textContent());
      if (await keep.isDisabled()) {
        assert.ok(await page.getByText(/Timing contract failed:|Uncertain hand detections occurred/).count());
        console.log('Host inference is insufficient/uneven; real capture correctly rejected.');
      }
      await page.getByRole('button', { name: 'Discard', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
    assert.equal(await page.evaluate(() => window.trackingTest.workers), 0);
    assert.equal(await page.evaluate(() => window.trackingTest.streams.some(s => s.getTracks().some(t => t.readyState === 'live'))), false);
  }
  // Deliberately slow real worker replies to verify insufficient FPS feedback. A low-rate loop must reach review with Keep disabled; never persist this fixture.
  await page.getByLabel('Delegate', { exact: true }).selectOption('CPU');
  assert.equal(await page.getByLabel('Inference FPS', { exact: true }).inputValue(), '8');
  assert.equal(await page.getByLabel('Inference FPS', { exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.trackingTest.delayInference = true; });
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await page.getByRole('button', { name: 'Stop camera', exact: true }).waitFor();
  await page.getByPlaceholder('e.g. signer07').fill('synthetic_test');
  await page.getByRole('checkbox', { name: /I agree to record hand/ }).check();
  await page.getByRole('button', { name: 'Record take', exact: true }).click();
  const keep = page.getByRole('button', { name: 'Keep', exact: true });
  await keep.waitFor({ timeout: 15000 });
  assert.equal(await keep.isDisabled(), true);
  console.log('REJECTED SYNTHETIC CAPTURE:', await page.getByText(/frames over/).textContent());
  assert.ok(await page.getByText(/Timing contract failed:|Uncertain hand detections occurred/).count());
  // Navigation releases workers and every camera track.
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.waitForFunction(() => window.trackingTest.workers === 0);
  assert.equal(await page.evaluate(() => window.trackingTest.streams.some(s => s.getTracks().some(t => t.readyState === 'live'))), false);
  // The original 15 FPS contract is still explicitly selectable while stopped.
  await page.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:8000'}/collect`);
  await page.getByLabel('Collection protocol', { exact: true }).selectOption('hp-v1-timed-1');
  assert.equal(await page.getByLabel('Inference FPS', { exact: true }).inputValue(), '15');
  assert.equal(await page.getByLabel('Inference FPS', { exact: true }).isDisabled(), true);
  // Late camera acquisition after navigation must stop its tracks, too.
  await page.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:8000'}/collect`);
  await page.evaluate(() => { window.trackingTest.delayCamera = true; });
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.trackingTest.workers), 0);
  assert.equal(await page.evaluate(() => window.trackingTest.streams.some(s => s.getTracks().some(t => t.readyState === 'live'))), false);
  assert.deepEqual(errors, []);
  // Controlled detector replies isolate the UI acceptance contract from host compute speed.
  // Camera frames/timestamps remain real synthetic-camera samples; only one isolated synthetic take is kept to verify rejected landmarks are absent.
  const controlled = await browser.newPage();
  const savedRequests = [];
  const diagnosticWrites = [];
  controlled.on('request', r => {
    if (r.method() === 'POST' && r.url().includes('/api/takes')) savedRequests.push(r.url());
    if (['POST', 'PUT', 'PATCH'].includes(r.method())) diagnosticWrites.push(r.url());
  });
  await controlled.addInitScript(cases => {
    window.validationScene = 'no visible hands';
    window.Worker = class {
      postMessage(message) {
        message.bitmap?.close();
        if (message.type === 'init') this.kind = message.kind;
        const frame = cases.find(c => c.name === window.validationScene)?.frame;
        const hand = this.kind === 'hand';
        const result = hand ? {
          landmarks: frame.hands.map(h => h.landmarks.map(([x, y, z]) => ({ x, y, z }))),
          handedness: frame.hands.map(h => [{ categoryName: h.handedness, score: h.score }]),
        } : { landmarks: frame.pose ? [frame.pose.map(([x, y, z, visibility]) => ({ x, y, z, visibility }))] : [] };
        const delay = window.validationScene === 'delayed-result' ? 600 : 0;
        setTimeout(() => this.onmessage?.({ data: message.type === 'init'
          ? { id: message.id, ready: true }
          : { id: message.id, timestamp: window.validationScene === 'mismatched-result' ? message.timestamp + 1 : message.timestamp,
            kind: this.kind, result, ms: delay } }), delay);
      }
      terminate() { this.onmessage = null; }
    };
  }, [...handCases,
    { name: 'delayed-result', frame: handCases.find(c => c.name === 'legitimate hand near nose and mouth').frame },
    { name: 'mismatched-result', frame: handCases.find(c => c.name === 'legitimate hand near nose and mouth').frame }]);
  // This isolated browser context may save only temporary synthetic test data locally.
  await controlled.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), server_save: false } });
  });
  await controlled.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:8000'}/collect`);
  await controlled.getByPlaceholder('e.g. signer07').fill('controlled_ui_fixture');
  await controlled.getByRole('checkbox', { name: /I agree to record hand/ }).check();
  await controlled.getByRole('button', { name: 'Start camera', exact: true }).click();
  await controlled.getByRole('button', { name: 'Stop camera', exact: true }).waitFor();
  const handPixels = () => {
    const canvas = document.querySelector('.stage canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if ((pixels[i] === 79 && pixels[i + 1] === 209 && pixels[i + 2] === 165)
        || (pixels[i] === 255 && pixels[i + 1] === 179 && pixels[i + 2] === 71)) n++;
    }
    return n;
  };
  for (const scene of ['legitimate hand near nose and mouth', 'legitimate hand near chest', 'crossed hands keep anatomical sides', 'left raised above shoulder', 'right raised above shoulder', 'both hands raised',
    'unreliable shoulders reported regression pattern', 'raised hand with missing pose wrist confidence',
    'face false positive despite high handedness score', 'no visible hands', 'no pose wrists']) {
    await controlled.evaluate(scene => { window.validationScene = scene; }, scene);
    const example = handCases.find(c => c.name === scene);
    const expected = example.sides;
    await controlled.waitForFunction(({ count, rawCount, wrist }) => {
      const raw = document.querySelector('[aria-label="Diagnostic observation JSON"]')?.value;
      if (!raw) return false;
      const d = JSON.parse(raw);
      return d.acceptedCount === count && d.rawCount === rawCount
        && (!wrist || JSON.stringify(d.raw?.[0]?.landmarks[0]) === JSON.stringify(wrist));
    }, { count: expected.length, rawCount: example.frame.hands.length, wrist: example.frame.hands[0]?.landmarks[0].map(v => Math.round(v * 1e5) / 1e5) });
    const text = await controlled.getByLabel('Accepted hand status', { exact: true }).textContent();
    const diagnostic = JSON.parse(await controlled.getByLabel('Diagnostic observation JSON', { exact: true }).inputValue());
    if (diagnostic.uncertainCount) assert.match(text, /uncertain/);
    else if (!expected.length) assert.match(text, /Hands: none/);
    if (expected.length) for (const side of expected) assert.ok(text.includes(side === 'L' ? 'your left' : 'your right'));
    assert.equal((await controlled.evaluate(handPixels)) > 0, expected.length > 0, scene);
  }
  // A synchronized but old result, or a wrong source timestamp, must not repopulate the overlay.
  for (const scene of ['delayed-result', 'mismatched-result']) {
    await controlled.evaluate(scene => { window.validationScene = scene; }, scene);
    await controlled.waitForTimeout(900);
    assert.match(await controlled.getByLabel('Accepted hand status', { exact: true }).textContent(), /waiting for fresh tracking/);
    assert.equal(await controlled.evaluate(handPixels), 0);
  }
  await controlled.evaluate(() => { window.validationScene = 'face false positive despite high handedness score'; });
  await controlled.waitForFunction(() => {
    const raw = document.querySelector('[aria-label="Diagnostic observation JSON"]')?.value;
    return raw && JSON.parse(raw).rawCount === 1 && JSON.parse(raw).acceptedCount === 0;
  });
  // hand-evidence-v3: a take is judged on its own frames, so it cannot start with a face-zone candidate.
  await controlled.getByRole('button', { name: 'Record take', exact: true }).click();
  await controlled.getByText('Start with your hands away from your face.', { exact: false }).waitFor({ timeout: 5000 });
  assert.equal(await controlled.getByRole('button', { name: 'Record take', exact: true }).count(), 1);
  console.log('Face-zone candidate refuses the start of a take.');
  // A face candidate appearing during a take still blocks the whole take.
  await controlled.evaluate(() => { window.validationScene = 'no visible hands'; });
  await controlled.waitForFunction(() => {
    const raw = document.querySelector('[aria-label="Diagnostic observation JSON"]')?.value;
    return raw && JSON.parse(raw).state === 'none';
  });
  await controlled.getByRole('button', { name: 'Record take', exact: true }).click();
  await controlled.getByText('Recording…', { exact: true }).waitFor({ timeout: 8000 });
  await controlled.evaluate(() => { window.validationScene = 'face false positive despite high handedness score'; });
  const controlledKeep = controlled.getByRole('button', { name: 'Keep', exact: true });
  await controlledKeep.waitFor({ timeout: 15000 });
  assert.equal(await controlledKeep.isDisabled(), true);
  assert.ok(await controlled.getByText('Uncertain hand detections occurred', { exact: false }).count());
  console.log('Uncertain face candidate blocks the entire take, rather than creating a false NONE recording.');
  await controlled.getByRole('button', { name: 'Discard', exact: true }).click();
  await controlled.evaluate(() => { window.validationScene = 'no visible hands'; });
  await controlled.waitForFunction(() => {
    const raw = document.querySelector('[aria-label="Diagnostic observation JSON"]')?.value;
    return raw && JSON.parse(raw).state === 'none';
  });
  await controlled.getByRole('button', { name: 'Record take', exact: true }).click();
  await controlledKeep.waitFor({ timeout: 15000 });
  assert.equal(await controlledKeep.isDisabled(), false);
  assert.match(await controlled.getByText(/frames over/).textContent(), /16 frames/);
  console.log('CONFIRMED NO-CANDIDATE UI CAPTURE:', await controlled.getByText(/frames over/).textContent());
  await controlledKeep.click();
  // Realistic independent-hand fixtures must also survive collection, not merely preview.
  await controlled.evaluate(() => { window.validationScene = 'both hands raised'; });
  await controlled.waitForFunction(() => {
    const raw = document.querySelector('[aria-label="Diagnostic observation JSON"]')?.value;
    return raw && JSON.parse(raw).acceptedCount === 2;
  });
  await controlled.evaluate(() => { window.validationScene = 'no visible hands'; });
  await controlled.waitForFunction(() => {
    const raw = document.querySelector('[aria-label="Diagnostic observation JSON"]')?.value;
    return raw && JSON.parse(raw).state === 'none';
  });
  assert.equal(await controlled.evaluate(handPixels), 0);
  await controlled.evaluate(() => { window.validationScene = 'both hands raised'; });
  await controlled.waitForFunction(() => {
    const raw = document.querySelector('[aria-label="Diagnostic observation JSON"]')?.value;
    return raw && JSON.parse(raw).acceptedCount === 2;
  });
  await controlled.getByRole('button', { name: 'Record take', exact: true }).click();
  await controlledKeep.waitFor({ timeout: 15000 });
  assert.equal(await controlledKeep.isDisabled(), false);
  await controlledKeep.click();
  const saved = await controlled.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('signspeak', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('takes').objectStore('takes').getAll();
      get.onsuccess = () => { resolve(get.result); open.result.close(); };
      get.onerror = () => reject(get.error);
    };
    open.onerror = () => reject(open.error);
  }));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].hand_validation, 'hand-evidence-v3');
  assert.ok(saved.some(t => t.frames.length === 16 && t.frames.every(f => f.hands.length === 0)));
  assert.ok(saved.some(t => t.frames.length === 16 && t.frames.every(f => f.hands.length === 2)));
  assert.ok(saved.every(t => t.hand_validation === 'hand-evidence-v3'));
  console.log('Uncertain face take was not saved; only the distinct no-candidate and accepted-raised-hand takes exist in the isolated browser dataset.');
  // Capture/freeze is independent of live tracking and of take storage.
  const diagnosticJson = controlled.getByLabel('Diagnostic observation JSON', { exact: true });
  const received = async () => Number((await controlled.getByLabel('Diagnostic buffer status', { exact: true }).textContent()).match(/Received: (\d+)/)[1]);
  await controlled.getByRole('button', { name: 'Capture Diagnostics', exact: true }).click();
  const firstFrozen = await diagnosticJson.inputValue();
  assert.equal(JSON.parse(firstFrozen).acceptedCount, 2);
  const firstVersion = await received();
  await controlled.waitForFunction(v => Number(document.querySelector('[aria-label="Diagnostic buffer status"]').textContent.match(/Received: (\d+)/)[1]) > v + 2, firstVersion);
  assert.equal(await diagnosticJson.inputValue(), firstFrozen);
  assert.ok(await controlled.getByRole('button', { name: 'Stop camera', exact: true }).count());
  await controlled.evaluate(() => { window.validationScene = 'no visible hands'; });
  await controlled.getByLabel('Accepted hand status', { exact: true }).filter({ hasText: 'Hands: none' }).waitFor();
  assert.equal(await controlled.evaluate(handPixels), 0, 'overlay remains live while JSON is frozen');
  assert.equal(await diagnosticJson.inputValue(), firstFrozen);
  await controlled.getByRole('button', { name: 'Resume Diagnostics', exact: true }).click();
  await controlled.waitForFunction(() => JSON.parse(document.querySelector('[aria-label="Diagnostic observation JSON"]').value).rawCount === 0);
  assert.equal(await controlled.getByRole('button', { name: 'Copy JSON', exact: true }).isDisabled(), true);
  await controlled.getByRole('button', { name: 'Freeze Diagnostics', exact: true }).click();
  const emptyFrozen = await diagnosticJson.inputValue();
  const beforeFailure = await received();
  await controlled.evaluate(() => { window.validationScene = 'face false positive despite high handedness score'; });
  await controlled.getByLabel('Accepted hand status', { exact: true }).filter({ hasText: 'uncertain' }).waitFor();
  await controlled.waitForFunction(v => Number(document.querySelector('[aria-label="Diagnostic buffer status"]').textContent.match(/Received: (\d+)/)[1]) > v + 2, beforeFailure);
  await controlled.evaluate(() => { window.validationScene = 'no visible hands'; });
  await controlled.getByLabel('Accepted hand status', { exact: true }).filter({ hasText: 'Hands: none' }).waitFor();
  assert.equal(await diagnosticJson.inputValue(), emptyFrozen);
  await controlled.getByRole('button', { name: 'Capture Failure B', exact: true }).click();
  const failureJson = await diagnosticJson.inputValue();
  const failure = JSON.parse(failureJson);
  assert.equal(failure.rawCount, 1); assert.equal(failure.acceptedCount, 0);
  assert.equal(failure.raw[0].landmarks.length, 21);
  assert.equal(failure.raw[0].poseWrists.length, 2);
  assert.equal(failure.raw[0].handednessScore, .99);
  assert.ok(failure.raw[0].reason && failure.workerTimestamps && failure.t_ms);
  assert.equal(failure.sourceTimestamp, failure.workerTimestamps.hand);
  assert.equal(failure.sourceTimestamp, failure.workerTimestamps.pose);
  const capturedVersion = await received();
  await controlled.waitForFunction(v => Number(document.querySelector('[aria-label="Diagnostic buffer status"]').textContent.match(/Received: (\d+)/)[1]) > v + 2, capturedVersion);
  assert.equal(await diagnosticJson.inputValue(), failureJson);
  await controlled.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async value => { window.copiedDiagnostic = value; } } });
  });
  await controlled.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  assert.equal(await controlled.evaluate(() => window.copiedDiagnostic), failureJson);
  await controlled.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('Clipboard denied in test'); } } });
  });
  await controlled.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  await controlled.getByText('Automatic clipboard access is unavailable.', { exact: false }).waitFor();
  assert.equal(await diagnosticJson.inputValue(), failureJson);
  assert.match(await controlled.getByLabel('Diagnostic buffer status', { exact: true }).textContent(), /100\/100 observations/);
  assert.deepEqual(savedRequests, []);
  assert.deepEqual(diagnosticWrites, []);
  const remainingTakes = await controlled.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('signspeak', 1);
    open.onsuccess = () => {
      const count = open.result.transaction('takes').objectStore('takes').count();
      count.onsuccess = () => { resolve(count.result); open.result.close(); };
      count.onerror = () => reject(count.error);
    };
    open.onerror = () => reject(open.error);
  }));
  assert.equal(remainingTakes, 2, 'diagnostic controls must not create training takes');
  console.log('Diagnostic ring capture/freeze/Failure B/copy passed; camera kept running and no diagnostic upload occurred.');

  await controlled.getByRole('button', { name: 'Stop camera', exact: true }).click();
  assert.equal(await diagnosticJson.inputValue(), failureJson, 'stopping the camera does not discard frozen evidence');
  assert.deepEqual(savedRequests, []);
  // Mixed deployments must not save new-policy observations to an old-policy server.
  await controlled.route('**/api/config', async route => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, server_save: false,
      hand_validation: { ...config.hand_validation, policy: 'pose-wrist-v1' } } });
  });
  await controlled.reload();
  assert.equal(await controlled.getByRole('button', { name: 'Copy JSON', exact: true }).isDisabled(), true);
  await controlled.getByRole('button', { name: 'Capture Failure B', exact: true }).click();
  await controlled.getByText('No raw-candidate / zero-accepted-hand event remains', { exact: false }).waitFor();

  await controlled.getByPlaceholder('e.g. signer07').fill('mixed_policy_fixture');
  await controlled.getByRole('checkbox', { name: /I agree to record hand/ }).check();
  await controlled.getByRole('button', { name: 'Start camera', exact: true }).click();
  await controlled.getByRole('button', { name: 'Stop camera', exact: true }).waitFor();
  assert.equal(await controlled.getByRole('button', { name: 'Record take', exact: true }).isDisabled(), true);
  assert.ok(await controlled.getByRole('alert').filter({ hasText: 'policies differ' }).count());
  await controlled.getByRole('button', { name: 'Stop camera', exact: true }).click();
  const sockets = [];
  controlled.on('websocket', socket => sockets.push(socket.url()));
  await controlled.route('**/api/status', route => route.fulfill({ json: {
    ready: true, model: { schema: 'hp-v2-8fps', fps: 8, window: 16, labels: [],
      capture_protocol: 'hp-v2-8fps-timed-1', hand_validation: { policy: 'pose-wrist-v1' } },
  } }));
  await controlled.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:8000'}/translate`);
  await controlled.getByText('Browser and model observation policies differ.', { exact: false }).waitFor();
  await controlled.getByRole('button', { name: 'Start camera', exact: true }).click();
  await controlled.getByRole('button', { name: 'Stop camera', exact: true }).waitFor();
  assert.deepEqual(sockets, []);
  await controlled.getByRole('button', { name: 'Stop camera', exact: true }).click();
  await controlled.close();
  console.log('Browser worker lifecycle, protocol selection, valid UI capture and slow-capture rejection passed.');
} finally { await browser.close(); }
