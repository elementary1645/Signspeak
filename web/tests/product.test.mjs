// Product UI logic: speech player, translate state mapping, embeds, theme cycle. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speaker, pickVoice } from '../src/lib/speech.js';
import { viewState } from '../src/lib/translateState.js';
import { embedUrl } from '../src/lib/embed.js';
import { nextTheme } from '../src/lib/theme.js';

const voices = [{ lang: 'en-US', name: 'US' }, { lang: 'hi-IN', name: 'Hindi' }, { lang: 'ta_IN', name: 'Tamil' }];

test('pickVoice matches exact tag, then language, else null', () => {
  assert.equal(pickVoice(voices, 'hi-IN').name, 'Hindi');
  assert.equal(pickVoice(voices, 'en-IN').name, 'US');
  assert.equal(pickVoice(voices, 'ta-IN').name, 'Tamil');
  assert.equal(pickVoice(voices, 'kn-IN'), null);
});

function fakes({ playFails = false, voiceList = voices } = {}) {
  const played = [];
  const spoken = [];
  let clock = 0;
  class FakeAudio { constructor(url) { this.url = url; } play() { if (playFails) return Promise.reject(new Error('blocked')); played.push(this.url); return Promise.resolve(); } pause() {} }
  const synth = { getVoices: () => voiceList, speak: u => spoken.push(u), cancel() {}, addEventListener() {} };
  class Utterance { constructor(text) { this.text = text; } }
  const speaker = new Speaker({ AudioImpl: FakeAudio, synth, Utterance, now: () => clock, cooldownMs: 4000 });
  return { speaker, played, spoken, tick: ms => { clock += ms; } };
}

test('speaker prefers mp3, then speechSynthesis, else reports no voice', async () => {
  const { speaker, played, spoken } = fakes();
  speaker.setAudio({ WATER: { hi: '/audio/WATER/hi.mp3' } });
  assert.equal(await speaker.speak('WATER', { lang: 'hi', bcp47: 'hi-IN', text: 'पानी' }), 'mp3');
  assert.deepEqual(played, ['/audio/WATER/hi.mp3']);
  assert.equal(await speaker.speak('FOOD', { lang: 'hi', bcp47: 'hi-IN', text: 'खाना' }), 'synth');
  assert.equal(spoken[0].text, 'खाना');
  assert.equal(spoken[0].voice.name, 'Hindi');
  assert.equal(await speaker.speak('FOOD', { lang: 'kn', bcp47: 'kn-IN', text: 'ಊಟ', force: true }), 'none');
});

test('blocked mp3 falls back to synthesis', async () => {
  const { speaker, spoken } = fakes({ playFails: true });
  speaker.setAudio({ WATER: { en: '/audio/WATER/en.mp3' } });
  assert.equal(await speaker.speak('WATER', { lang: 'en', bcp47: 'en-IN', text: 'Water' }), 'synth');
  assert.equal(spoken.length, 1);
});

test('never speaks NONE/UNKNOWN; cooldown per label; replay forces', async () => {
  const { speaker, spoken, tick } = fakes();
  const opts = { lang: 'en', bcp47: 'en-IN', text: 'Hello' };
  assert.equal(await speaker.speak('NONE', opts), 'skipped');
  assert.equal(await speaker.speak('UNKNOWN', opts), 'skipped');
  assert.equal(await speaker.speak(null, opts), 'skipped');
  assert.equal(await speaker.speak('HELLO', opts), 'synth');
  tick(1000);
  assert.equal(await speaker.speak('HELLO', opts), 'cooldown');
  assert.equal(await speaker.speak('HELLO', { ...opts, force: true }), 'synth');
  tick(4001);
  assert.equal(await speaker.speak('HELLO', opts), 'synth');
  assert.equal(spoken.length, 3);
});

test('a language with no voice does not hold a cooldown', async () => {
  const { speaker } = fakes({ voiceList: [] });
  const opts = { lang: 'kn', bcp47: 'kn-IN', text: 'x' };
  assert.equal(await speaker.speak('HELLO', opts), 'none');
  assert.equal(await speaker.speak('HELLO', opts), 'none');
});

test('translate view state covers every PRD state honestly', () => {
  const notTrained = { ready: false, code: 'MODEL_NOT_TRAINED' };
  const ready = { ready: true, code: null };
  assert.equal(viewState({ camStatus: 'idle', transport: 'idle', status: null }).state, 'INITIALIZING');
  assert.equal(viewState({ camStatus: 'idle', transport: 'idle', status: ready }).state, 'READY');
  const off = viewState({ camStatus: 'idle', transport: 'idle', status: notTrained });
  assert.deepEqual([off.state, off.badge, off.notTrained], ['ERROR', 'Model not trained', true]);
  assert.equal(viewState({ camStatus: 'loading', transport: 'idle', status: ready }).state, 'INITIALIZING');
  assert.equal(viewState({ camStatus: 'running', transport: 'connecting', status: ready }).state, 'INITIALIZING');
  for (const s of ['DETECTING', 'RECOGNIZING', 'RECOGNIZED', 'UNKNOWN', 'NO_HAND']) {
    assert.equal(viewState({ camStatus: 'running', transport: 'ws', status: ready, result: { state: s } }).state, s);
  }
  const live = viewState({ camStatus: 'running', transport: 'ws', status: notTrained, result: { state: 'ERROR', code: 'MODEL_NOT_TRAINED' } });
  assert.equal(live.placeholder, 'Recognition is off until a model is trained');
  assert.equal(viewState({ camStatus: 'running', transport: 'http', status: ready, result: { state: 'NO_HAND' }, backendDown: true }).badge, 'Server unreachable');
  assert.equal(viewState({ camStatus: 'error', transport: 'idle', status: ready }).badge, 'Camera problem');
});

test('embeds only official-platform YouTube videos via youtube-nocookie', () => {
  assert.equal(embedUrl('https://www.youtube.com/watch?v=AbCdEfGhIj0'), 'https://www.youtube-nocookie.com/embed/AbCdEfGhIj0');
  assert.equal(embedUrl('https://youtu.be/AbCdEfGhIj0'), 'https://www.youtube-nocookie.com/embed/AbCdEfGhIj0');
  assert.equal(embedUrl('https://www.youtube.com/shorts/AbCdEfGhIj0'), 'https://www.youtube-nocookie.com/embed/AbCdEfGhIj0');
  assert.equal(embedUrl('http://www.youtube.com/watch?v=AbCdEfGhIj0'), null);
  assert.equal(embedUrl('https://divyangjan.depwd.gov.in/islrtc/entry.php?id=1'), null);
  assert.equal(embedUrl('https://www.youtube.com/watch?v=bad'), null);
  assert.equal(embedUrl('not a url'), null);
});

test('theme cycles auto -> light -> dark -> auto', () => {
  assert.equal(nextTheme('system'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'system');
});

test('a model still downloading shows a loading state, not "not trained"', () => {
  const v = viewState({ camStatus: 'idle', transport: 'idle', status: { ready: false, code: 'MODEL_LOADING' } });
  assert.deepEqual([v.state, v.badge, v.loading, v.notTrained], ['ERROR', 'Loading model', true, false]);
});

import { SlowFpsWatch, UNSUPPORTED_DEVICE_TEXT, isPhoneOrTablet } from '../src/lib/deviceSupport.js';

test('phone/tablet detection: user agent, iPadOS desktop UA, or touch-first small screen', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  assert.equal(isPhoneOrTablet({ userAgent: iphone }), true);
  assert.equal(isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36' }), true);
  assert.equal(isPhoneOrTablet({ userAgent: mac, maxTouchPoints: 5 }), true); // iPadOS
  assert.equal(isPhoneOrTablet({ userAgent: mac, maxTouchPoints: 0, screenWidth: 1512, screenHeight: 982 }), false);
  assert.equal(isPhoneOrTablet({ userAgent: chrome, maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080 }), false);
  // Touch laptop: touch points but a fine primary pointer.
  assert.equal(isPhoneOrTablet({ userAgent: chrome, maxTouchPoints: 10, coarsePointer: false, screenWidth: 1366, screenHeight: 768 }), false);
  assert.equal(isPhoneOrTablet({ userAgent: chrome, maxTouchPoints: 10, coarsePointer: true, screenWidth: 800, screenHeight: 1280 }), true);
  assert.equal(isPhoneOrTablet({}), false);
  assert.match(UNSUPPORTED_DEVICE_TEXT, /^SignSpeak needs a laptop or desktop with Chrome or Edge\. Phones are too slow for the 8 FPS tracker right now\.$/);
});

test('slow-fps watch fires only after fps stays below 7 for 5 s, then stays on until reset', () => {
  const w = new SlowFpsWatch();
  assert.equal(w.update(0, 3.7), false);
  assert.equal(w.update(4000, 3.7), false);
  assert.equal(w.update(4500, 7.5), false); // recovered: clock restarts
  assert.equal(w.update(5000, 6.9), false);
  assert.equal(w.update(9000, null), false); // unknown fps does not move the decision
  assert.equal(w.update(9999, 6.0), false);
  assert.equal(w.update(10000, 6.0), true);
  assert.equal(w.update(11000, 8), true); // sticky
  w.reset();
  assert.equal(w.update(12000, 8), false);
  assert.equal(new SlowFpsWatch().update(0, 8), false);
});
