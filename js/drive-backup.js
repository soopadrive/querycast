// Drive appdata backup (Stage 7d). Serializes user state — profiles +
// watched + saved + not-interested — to a single JSON file in the
// per-app `appDataFolder` on the user's Drive. Files there are hidden
// from the Drive UI and only readable by the same OAuth client that
// wrote them, which lines up with the BYO-credentials model in ADR-001.
//
// Intentionally NOT backed up:
//   - videos: transient cache, can be re-fetched (would also be the
//     bulk of the backup size)
//   - subscriptions: re-derivable from the YouTube API
//   - tombstones / quota: TTL-managed, ephemeral
//   - credentials: the BYO Client ID + Secret + OAuth tokens are
//     local-only by design — putting them in Drive defeats BYO
//
// File naming: a single file `querycast-backup.json` is overwritten on
// each backup (Drive returns a new revision via the API anyway). Keeps
// the surface simple; multi-snapshot history can come later.

import { STORES } from './defaults.js';
import { getAll, put, del } from './storage.js';

const BACKUP_FILENAME = 'querycast-backup.json';
const SCHEMA_VERSION = 1;

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

// Stores that get serialized into a backup. Order is stable so diffs
// across backup files stay readable.
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

async function findBackupFile(token) {
  const url = `${DRIVE_FILES}?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)&q=name='${encodeURIComponent(BACKUP_FILENAME)}'`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.files?.[0] || null;
}

// Returns { exists, modifiedTime, size } so the UI can show the latest
// backup state without committing to a download.
export async function getBackupInfo(token) {
  const file = await findBackupFile(token);
  if (!file) return { exists: false };
  return {
    exists: true,
    fileId: file.id,
    modifiedTime: file.modifiedTime,
    size: file.size ? parseInt(file.size, 10) : null,
  };
}

// Multipart upload — Drive lets us send metadata + body in one request.
// Use this for both create (no fileId) and replace (with fileId).
async function uploadJson(token, fileId, payload) {
  const boundary = `qc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = fileId
    ? {} // PATCH update keeps the same name + parent
    : { name: BACKUP_FILENAME, parents: ['appDataFolder'] };

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify(payload) + `\r\n` +
    `--${boundary}--`;

  const url = fileId
    ? `${DRIVE_UPLOAD}/${fileId}?uploadType=multipart&fields=id,modifiedTime,size`
    : `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,modifiedTime,size`;

  const res = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function backupNow(token) {
  const payload = await collectState();
  const existing = await findBackupFile(token);
  const result = await uploadJson(token, existing?.id || null, payload);
  return {
    fileId: result.id,
    modifiedTime: result.modifiedTime,
    size: result.size ? parseInt(result.size, 10) : null,
    counts: countsOf(payload),
  };
}

export async function restoreLatest(token) {
  const file = await findBackupFile(token);
  if (!file) {
    throw new Error('No backup found in Drive appdata.');
  }
  const url = `${DRIVE_FILES}/${file.id}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
  }
  const payload = await res.json();
  if (!payload.stores) {
    throw new Error('Backup file is malformed (no stores key).');
  }
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version: ${payload.schemaVersion}`);
  }

  // Atomic-ish swap: wipe each restored store, then write all rows.
  // If a write fails midway, the affected store is left partially
  // populated — rare enough not to warrant a transaction wrapper.
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
  // Mirrors the keyPath choices in storage.js / preview/storage-stub.js.
  // Profiles use profileId; the action stores all key on videoId.
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
