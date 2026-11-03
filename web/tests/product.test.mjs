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
