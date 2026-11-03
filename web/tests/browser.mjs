// Real MediaPipe, synthetic browser camera: verifies plumbing, never signing accuracy.
// Start the built app with LEGACY_DETECTOR=0 python -m uvicorn backend.app.main:app.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
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
    assert.equal(await page.evaluate(() => window.trackingTest.workers), 2);
    await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
    assert.equal(await page.evaluate(() => window.trackingTest.workers), 0);
    assert.equal(await page.evaluate(() => window.trackingTest.streams.some(s => s.getTracks().some(t => t.readyState === 'live'))), false);
  }
  // A real low-rate loop must reach review with Keep disabled; never persist this fixture.
  await page.getByLabel('Delegate', { exact: true }).selectOption('CPU');
  await page.getByLabel('Inference FPS', { exact: true }).selectOption('5');
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
  // Late camera acquisition after navigation must stop its tracks, too.
  await page.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:8000'}/collect`);
  await page.evaluate(() => { window.trackingTest.delayCamera = true; });
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.trackingTest.workers), 0);
  assert.equal(await page.evaluate(() => window.trackingTest.streams.some(s => s.getTracks().some(t => t.readyState === 'live'))), false);
  assert.deepEqual(errors, []);
  console.log('Browser worker lifecycle and capture rejection passed.');
} finally { await browser.close(); }
