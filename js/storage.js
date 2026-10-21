// Key/value record storage with one interface and three backends:
//   IndexedDB (normal), localStorage (fallback), memory (tests, or last resort).
// Every record has an `id`. Photos are stored as { id, blob }.

import { blobToDataUrl, dataUrlToBlob } from './blobs.js';

export const STORE_NAMES = ['players', 'coaches', 'matches', 'photos', 'settings'];
const DB_NAME = 'matchday-lineup';
const DB_VERSION = 2; // 2: coaches
const LS_PREFIX = 'matchday-lineup:';

export function createMemoryStore() {
  const data = Object.fromEntries(STORE_NAMES.map((n) => [n, new Map()]));
  const clone = (r) => (r && typeof structuredClone === 'function' ? structuredClone(r) : r);
  return {
    kind: 'memory',
    async getAll(name) { return [...data[name].values()].map(clone); },
    async get(name, id) { return clone(data[name].get(id)) ?? null; },
    async put(name, record) { data[name].set(record.id, clone(record)); return record; },
    async delete(name, id) { data[name].delete(id); },
  };
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function createIdbStore() {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const n of STORE_NAMES) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' });
  };
  open.onblocked = () => console.warn('Matchday Lineup is open in another tab; close it to finish updating storage.');
  const db = await req(open);
  // Let a newer version of the app in another tab upgrade the database.
  db.onversionchange = () => db.close();
  const tx = (name, mode) => db.transaction(name, mode).objectStore(name);
  return {
    kind: 'indexeddb',
    getAll: (name) => req(tx(name, 'readonly').getAll()),
    get: async (name, id) => (await req(tx(name, 'readonly').get(id))) ?? null,
    put: async (name, record) => { await req(tx(name, 'readwrite').put(record)); return record; },
    delete: (name, id) => req(tx(name, 'readwrite').delete(id)),
  };
}

function createLocalStorageStore() {
  const ls = globalThis.localStorage;
  const read = (name) => {
    try { return JSON.parse(ls.getItem(LS_PREFIX + name) || '{}'); } catch { return {}; }
  };
  const write = (name, obj) => ls.setItem(LS_PREFIX + name, JSON.stringify(obj));
  // Blobs can't go into JSON, so photos are kept as data URLs and turned back into Blobs on read.
  const revive = (r) => (r && r.dataUrl ? { id: r.id, blob: dataUrlToBlob(r.dataUrl) } : r);
  return {
    kind: 'localstorage',
    async getAll(name) { return Object.values(read(name)).map(revive); },
    async get(name, id) { return revive(read(name)[id]) ?? null; },
    async put(name, record) {
      let stored = record;
      if (record.blob) stored = { id: record.id, dataUrl: await blobToDataUrl(record.blob) };
      const all = read(name);
      all[record.id] = stored;
      write(name, all); // throws QuotaExceededError when full; caller shows the message
      return record;
    },
    async delete(name, id) { const all = read(name); delete all[id]; write(name, all); },
  };
}

/** Open the best storage available in this browser. */
export async function openStore() {
  if (globalThis.indexedDB) {
    try { return await createIdbStore(); } catch (e) { console.warn('IndexedDB unavailable, falling back', e); }
  }
  try {
    const k = LS_PREFIX + 'probe';
    globalThis.localStorage.setItem(k, '1');
    globalThis.localStorage.removeItem(k);
    return createLocalStorageStore();
  } catch (e) {
    console.warn('localStorage unavailable, using memory only', e);
  }
  return createMemoryStore();
}
