// Kept takes are autosaved to IndexedDB the moment they are kept and restored on reload.
// The hand-off to the team is still "Download my data" (JSONL). Every access is guarded:
// if IndexedDB is unavailable (private window, blocked storage) takes stay in memory only.
const DB_NAME = 'signspeak';
const STORE = 'takes';
const LEGACY_KEY = 'signspeak.takes.v1'; // Phase 3 builds used localStorage

let dbPromise = null;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db(indexedDBImpl = globalThis.indexedDB) {
  if (!indexedDBImpl) return Promise.reject(new Error('IndexedDB unavailable'));
  dbPromise ||= new Promise((resolve, reject) => {
    const open = indexedDBImpl.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'take_id' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  }).catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}

async function tx(mode, fn) {
  const database = await db();
  const t = database.transaction(STORE, mode);
  const result = fn(t.objectStore(STORE));
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  return result instanceof IDBRequest ? result.result : result;
}

// Returns { takes, persistent, migrated }.
export async function loadTakes() {
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'); } catch { legacy = []; }
  try {
    if (Array.isArray(legacy) && legacy.length) {
      await tx('readwrite', store => legacy.forEach(t => store.put(t)));
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* keep the copy; harmless */ }
    }
    const takes = await tx('readonly', store => store.getAll());
    takes.sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1));
    return { takes, persistent: true, migrated: legacy.length };
  } catch {
    return { takes: Array.isArray(legacy) ? legacy : [], persistent: false, migrated: 0 };
  }
}

export async function saveTake(take) {
  try { await tx('readwrite', store => store.put(take)); return true; } catch { return false; }
}

export async function deleteTakes(ids) {
  try { await tx('readwrite', store => ids.forEach(id => store.delete(id))); return true; } catch { return false; }
}

export const takesToJsonl = takes => takes.map(t => JSON.stringify(t)).join('\n') + (takes.length ? '\n' : '');
