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
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Record take', exact: true }).click();
      const keep = page.getByRole('button', { name: 'Keep', exact: true });
      await keep.waitFor({ timeout: 15000 });
      console.log('8 FPS SYNTHETIC CAPTURE:', await page.getByText(/frames over/).textContent());
      if (await keep.isDisabled()) {
        assert.ok(await page.getByText('Timing contract failed:', { exact: false }).count());
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
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Record take', exact: true }).click();
  const keep = page.getByRole('button', { name: 'Keep', exact: true });
  await keep.waitFor({ timeout: 15000 });
  assert.equal(await keep.isDisabled(), true);
  console.log('REJECTED SYNTHETIC CAPTURE:', await page.getByText(/frames over/).textContent());
  assert.ok(await page.getByText('Timing contract failed:', { exact: false }).count());
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
  controlled.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/takes')) savedRequests.push(r.url()); });
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
  await controlled.getByRole('checkbox').check();
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
  for (const scene of ['legitimate hand near nose and mouth', 'legitimate hand near chest', 'crossed hands keep anatomical sides',
    'face false positive despite high handedness score', 'no visible hands', 'no pose wrists']) {
    await controlled.evaluate(scene => { window.validationScene = scene; }, scene);
    const example = handCases.find(c => c.name === scene);
    const expected = example.sides;
    await controlled.waitForFunction(({ count, rawCount, wrist }) => {
      const raw = document.querySelector('[aria-label="Hand validation diagnostics"]')?.textContent;
      if (!raw) return false;
      const d = JSON.parse(raw);
      return d.acceptedCount === count && d.rawCount === rawCount
        && (!wrist || JSON.stringify(d.raw?.[0]?.landmarks[0]) === JSON.stringify(wrist));
    }, { count: expected.length, rawCount: example.frame.hands.length, wrist: example.frame.hands[0]?.landmarks[0] });
    const text = await controlled.getByLabel('Accepted hand status', { exact: true }).textContent();
    if (!expected.length) assert.match(text, /Hands: none/);
    else for (const side of expected) assert.ok(text.includes(side === 'L' ? 'your left' : 'your right'));
    assert.equal((await controlled.evaluate(handPixels)) > 0, expected.length > 0, scene);
  }
  // A synchronized but old result, or a wrong source timestamp, must not repopulate the overlay.
  for (const scene of ['delayed-result', 'mismatched-result']) {
    await controlled.evaluate(scene => { window.validationScene = scene; }, scene);
    await controlled.waitForTimeout(900);
    assert.match(await controlled.getByLabel('Accepted hand status', { exact: true }).textContent(), /Hands: none/);
    assert.equal(await controlled.evaluate(handPixels), 0);
  }
  await controlled.evaluate(() => { window.validationScene = 'face false positive despite high handedness score'; });
  await controlled.waitForFunction(() => {
    const raw = document.querySelector('[aria-label="Hand validation diagnostics"]')?.textContent;
    return raw && JSON.parse(raw).rawCount === 1 && JSON.parse(raw).acceptedCount === 0;
  });
  await controlled.getByRole('button', { name: 'Record take', exact: true }).click();
  const controlledKeep = controlled.getByRole('button', { name: 'Keep', exact: true });
  await controlledKeep.waitFor({ timeout: 15000 });
  assert.equal(await controlledKeep.isDisabled(), false);
  assert.match(await controlled.getByText(/frames over/).textContent(), /16 frames/);
  console.log('CONTROLLED UI ACCEPTANCE (mock detector):', await controlled.getByText(/frames over/).textContent());
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
  assert.equal(saved.length, 1);
  assert.equal(saved[0].hand_validation, 'pose-wrist-v1');
  assert.ok(saved[0].frames.every(f => f.hands.length === 0));
  console.log('Rejected face landmarks excluded from the isolated temporary browser dataset.');
  await controlled.getByRole('button', { name: 'Stop camera', exact: true }).click();
  assert.deepEqual(savedRequests, []);
  await controlled.close();
  console.log('Browser worker lifecycle, protocol selection, valid UI capture and slow-capture rejection passed.');
} finally { await browser.close(); }
