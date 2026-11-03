// Small fetch helpers. Every number the UI shows comes from these endpoints.
export async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await r.json().catch(() => null);
  if (!body) throw new Error(`${url} returned HTTP ${r.status}`);
  return body; // /ready-style 503 bodies are still meaningful JSON
}

export const LANGUAGES = [
  { code: 'en', name: 'English', bcp47: 'en-IN' },
  { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada', bcp47: 'kn-IN' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', bcp47: 'hi-IN' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil', bcp47: 'ta-IN' },
];

export function readLanguage() {
  try { return LANGUAGES.some(l => l.code === localStorage.getItem('signspeak.lang')) ? localStorage.getItem('signspeak.lang') : 'en'; } catch { return 'en'; }
}

export function saveLanguage(code) {
  try { localStorage.setItem('signspeak.lang', code); } catch { /* convenience only */ }
}

export const meaningOf = (translations, label, lang) => translations?.[label]?.[lang] || translations?.[label]?.en || label;
