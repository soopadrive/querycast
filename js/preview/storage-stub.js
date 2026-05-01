// Static preview stub for storage.js. Same export surface, but in-memory
// instead of IndexedDB so the preview opens in a regular browser without
// a Tauri shell or persistent state.
//
// Seeded from MOCK_VIDEOS / MOCK_PROFILE / MOCK_CREDS / MOCK_TOKENS at
// load time. Every reload starts from the same state — refresh the page
// to undo all interactions.

import { STORES } from '../defaults.js';
import { MOCK_VIDEOS, MOCK_PROFILE, MOCK_CREDS, MOCK_TOKENS } from './mock-data.js';

const data = {
  [STORES.videos]: MOCK_VIDEOS.slice(),
  [STORES.subscriptions]: [],
  [STORES.tombstones]: [],
  [STORES.quota]: [],
  [STORES.profiles]: [structuredClone(MOCK_PROFILE)],
  [STORES.watched]: [],
  [STORES.saved]: [],
  [STORES.notInterested]: [],
  [STORES.credentials]: [structuredClone(MOCK_CREDS), structuredClone(MOCK_TOKENS)],
};

const KEY_PATHS = {
  [STORES.videos]: 'videoId',
  [STORES.subscriptions]: 'channelId',
  [STORES.tombstones]: 'videoId',
  [STORES.quota]: 'date',
  [STORES.profiles]: 'profileId',
  [STORES.watched]: 'videoId',
  [STORES.saved]: 'videoId',
  [STORES.notInterested]: 'videoId',
  [STORES.credentials]: 'id',
};

function keyOf(storeName, value) {
  return value?.[KEY_PATHS[storeName]];
}

export async function openDb() {
  // Just enough surface for main.js's setStatus('idb', ...).
  return {
    version: 2,
    objectStoreNames: { length: Object.keys(data).length },
  };
}

export async function put(storeName, value) {
  const arr = data[storeName];
  if (!arr) throw new Error(`Unknown store: ${storeName}`);
  const k = keyOf(storeName, value);
  const idx = arr.findIndex((v) => keyOf(storeName, v) === k);
  if (idx >= 0) arr[idx] = structuredClone(value);
  else arr.push(structuredClone(value));
}

export async function get(storeName, key) {
  const arr = data[storeName] || [];
  return arr.find((v) => keyOf(storeName, v) === key) || undefined;
}

export async function getAll(storeName) {
  const arr = data[storeName] || [];
  return arr.map((v) => structuredClone(v));
}

export async function del(storeName, key) {
  const arr = data[storeName];
  if (!arr) return;
  const idx = arr.findIndex((v) => keyOf(storeName, v) === key);
  if (idx >= 0) arr.splice(idx, 1);
}

export async function count(storeName) {
  return (data[storeName] || []).length;
}

export async function getActiveProfile() {
  const profiles = await getAll(STORES.profiles);
  return profiles.find((p) => p.isActive) ?? profiles[0] ?? null;
}

export async function seedDefaults() {
  // Already seeded at module load; no-op.
}

export async function getCredentials() {
  return (await get(STORES.credentials, 'oauth')) || null;
}

export async function saveCredentials({ clientId, clientSecret }) {
  await put(STORES.credentials, { id: 'oauth', clientId, clientSecret });
}

export async function clearCredentials() {
  await del(STORES.credentials, 'oauth');
}

export async function getTokens() {
  return (await get(STORES.credentials, 'tokens')) || null;
}

export async function saveTokens({ accessToken, refreshToken, expiresAt }) {
  await put(STORES.credentials, { id: 'tokens', accessToken, refreshToken, expiresAt });
}

export async function clearTokens() {
  await del(STORES.credentials, 'tokens');
}
