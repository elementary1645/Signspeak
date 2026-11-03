// Kept takes survive a page reload via localStorage (per browser only). The real
// hand-off is "Download my data"; storage may be unavailable, so every access is guarded.
const KEY = 'signspeak.takes.v1';

export function loadTakes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTakes(takes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(takes));
    return true;
  } catch {
    return false;
  }
}

export const takesToJsonl = takes => takes.map(t => JSON.stringify(t)).join('\n') + (takes.length ? '\n' : '');
