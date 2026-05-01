// IndexedDB wrapper. Native API only — no idb/Dexie/localForage per Stack Lock.
// Schema versioned via DB_VERSION in config.js. Multi-tab safe via onblocked +
// onversionchange handlers (pre-mortem flagged this as a hang risk).

import { DB_NAME, DB_VERSION } from './config.js';
import { DEFAULT_PROFILE, STORES } from './defaults.js';

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      // Numbered migrations. Each case falls through into the next so a fresh
      // DB walks from 0 → DB_VERSION applying every step.
      switch (oldVersion) {
        case 0:
          db.createObjectStore(STORES.videos, { keyPath: 'videoId' });
          db.createObjectStore(STORES.subscriptions, { keyPath: 'channelId' });
          db.createObjectStore(STORES.tombstones, { keyPath: 'videoId' });
          db.createObjectStore(STORES.quota, { keyPath: 'date' });
          db.createObjectStore(STORES.profiles, { keyPath: 'profileId' });
          db.createObjectStore(STORES.watched, { keyPath: 'videoId' });
          db.createObjectStore(STORES.saved, { keyPath: 'videoId' });
          db.createObjectStore(STORES.notInterested, { keyPath: 'videoId' });
        // fallthrough
        case 1:
          // v2: add credentials store for BYO OAuth Client ID + Secret.
          // Single-row store keyed by id='oauth'.
          db.createObjectStore(STORES.credentials, { keyPath: 'id' });
        // future migrations append more cases here
      }
    };

    req.onblocked = () => {
      // Another tab holds an older version open. Surface to the user — closing
      // the other tab unblocks; auto-reload would race.
      console.warn('IndexedDB upgrade blocked by another tab. Close other QueryCast tabs.');
      alert('QueryCast is upgrading. Please close other QueryCast tabs to continue.');
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        // A different tab is upgrading. Drop our handle so it can proceed; reload
        // ensures we pick up the new schema.
        db.close();
        dbPromise = null;
        location.reload();
      };
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function put(storeName, value) {
  return tx(storeName, 'readwrite', (store) => store.put(value));
}

export function get(storeName, key) {
  return tx(storeName, 'readonly', (store) => store.get(key));
}

export function getAll(storeName) {
  return tx(storeName, 'readonly', (store) => store.getAll());
}

export function del(storeName, key) {
  return tx(storeName, 'readwrite', (store) => store.delete(key));
}

export async function count(storeName) {
  return tx(storeName, 'readonly', (store) => store.count());
}

export async function getActiveProfile() {
  const profiles = await getAll(STORES.profiles);
  return profiles.find((p) => p.isActive) ?? profiles[0] ?? null;
}

export async function seedDefaults() {
  const existing = await count(STORES.profiles);
  if (existing > 0) return;
  await put(STORES.profiles, structuredClone(DEFAULT_PROFILE));
}

export async function getCredentials() {
  const result = await get(STORES.credentials, 'oauth');
  return result || null;
}

export async function saveCredentials({ clientId, clientSecret }) {
  await put(STORES.credentials, { id: 'oauth', clientId, clientSecret });
}

export async function clearCredentials() {
  await del(STORES.credentials, 'oauth');
}

export async function getTokens() {
  const result = await get(STORES.credentials, 'tokens');
  return result || null;
}

export async function saveTokens({ accessToken, refreshToken, expiresAt }) {
  await put(STORES.credentials, { id: 'tokens', accessToken, refreshToken, expiresAt });
}

export async function clearTokens() {
  await del(STORES.credentials, 'tokens');
}
