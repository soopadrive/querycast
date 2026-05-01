// Static preview stub for drive-backup.js. Same export surface, but
// uses sessionStorage as a fake Drive — so the preview can exercise
// the backup/restore button states + status messages without needing
// real Google auth. Real Drive validation has to happen in a Tauri
// dev session against a signed-in account.

import { STORES } from '../defaults.js';
import { getAll, put, del } from '../storage.js';

const FAKE_KEY = 'qc-preview-drive-backup';
const SCHEMA_VERSION = 1;

const BACKUP_STORES = [
  STORES.profiles,
  STORES.watched,
  STORES.saved,
  STORES.notInterested,
];

async function collectState() {
  const out = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), stores: {} };
  for (const name of BACKUP_STORES) {
    out.stores[name] = await getAll(name);
  }
  return out;
}

export async function getBackupInfo(/* token */) {
  const raw = sessionStorage.getItem(FAKE_KEY);
  if (!raw) return { exists: false };
  try {
    const meta = JSON.parse(raw);
    return {
      exists: true,
      fileId: 'preview-fake-id',
      modifiedTime: meta.modifiedTime,
      size: raw.length,
    };
  } catch {
    return { exists: false };
  }
}

export async function backupNow(/* token */) {
  const payload = await collectState();
  const wrapper = {
    payload,
    modifiedTime: new Date().toISOString(),
  };
  sessionStorage.setItem(FAKE_KEY, JSON.stringify(wrapper));
  return {
    fileId: 'preview-fake-id',
    modifiedTime: wrapper.modifiedTime,
    size: JSON.stringify(wrapper).length,
    counts: countsOf(payload),
  };
}

export async function restoreLatest(/* token */) {
  const raw = sessionStorage.getItem(FAKE_KEY);
  if (!raw) throw new Error('No backup found in (fake) Drive appdata.');
  const wrapper = JSON.parse(raw);
  const payload = wrapper.payload;
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version: ${payload.schemaVersion}`);
  }
  for (const name of BACKUP_STORES) {
    const rows = payload.stores[name] || [];
    const existing = await getAll(name);
    const keyPath = inferKeyPath(name);
    for (const row of existing) {
      await del(name, row[keyPath]);
    }
    for (const row of rows) {
      await put(name, row);
    }
  }
  return {
    counts: countsOf(payload),
    exportedAt: payload.exportedAt,
  };
}

function inferKeyPath(storeName) {
  if (storeName === STORES.profiles) return 'profileId';
  return 'videoId';
}

function countsOf(payload) {
  const out = {};
  for (const name of BACKUP_STORES) {
    out[name] = (payload.stores[name] || []).length;
  }
  return out;
}
