// Speech output: pre-generated mp3 first, then the browser's speechSynthesis with a voice
// for the language, else text only. Only recognised sign events are ever spoken.
export const SPEAK_COOLDOWN_MS = 4000;
const NEVER = new Set(['NONE', 'UNKNOWN', null, undefined, '']);

// Best voice for a BCP-47 tag like 'kn-IN': exact match, then same language.
export function pickVoice(voices, bcp47) {
  const want = bcp47.toLowerCase();
  const base = want.split('-')[0];
  const norm = v => (v.lang || '').toLowerCase().replace('_', '-');
  return voices.find(v => norm(v) === want) || voices.find(v => norm(v).split('-')[0] === base) || null;
}

export class Speaker {
  constructor({ AudioImpl = globalThis.Audio, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance,
                now = () => Date.now(), cooldownMs = SPEAK_COOLDOWN_MS } = {}) {
    Object.assign(this, { AudioImpl, synth, Utterance, now, cooldownMs });
    this.audio = {};
    this.last = {};
    this.current = null;
    // Browsers load voices lazily; ask early so the first recognition can use one.
    try { this.synth?.getVoices?.(); this.synth?.addEventListener?.('voiceschanged', () => {}); } catch { /* no synthesis */ }
  }

  setAudio(available) { this.audio = available || {}; }

  voices() {
    try { return this.synth?.getVoices?.() || []; } catch { return []; }
  }

  canSpeak(lang, bcp47) {
    return Boolean(this.audio && Object.values(this.audio).some(m => m[lang])) || Boolean(pickVoice(this.voices(), bcp47));
  }

  // Returns 'mp3' | 'synth' | 'none' (no voice) | 'cooldown' | 'skipped'.
  async speak(label, { lang, bcp47, text, force = false }) {
    if (NEVER.has(label) || !text) return 'skipped';
    const t = this.now();
    if (!force && t - (this.last[label] ?? -Infinity) < this.cooldownMs) return 'cooldown';
    this.last[label] = t;
    this.stop();
    const url = this.audio[label]?.[lang];
    if (url && this.AudioImpl) {
      try {
        const audio = new this.AudioImpl(url);
        this.current = audio;
        await audio.play();
        return 'mp3';
      } catch { /* blocked or failed: fall back to synthesis */ }
    }
    const voice = pickVoice(this.voices(), bcp47);
    if (voice && this.synth && this.Utterance) {
      const u = new this.Utterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      this.synth.speak(u);
      return 'synth';
    }
    delete this.last[label]; // nothing was spoken, so do not hold a cooldown
    return 'none';
  }

  stop() {
    try { this.current?.pause?.(); } catch { /* ignore */ }
    this.current = null;
    try { this.synth?.cancel?.(); } catch { /* ignore */ }
  }
}

export function readAutoSpeak() {
  try { return localStorage.getItem('signspeak.autospeak') !== 'off'; } catch { return true; }
}

export function saveAutoSpeak(on) {
  try { localStorage.setItem('signspeak.autospeak', on ? 'on' : 'off'); } catch { /* convenience only */ }
}
