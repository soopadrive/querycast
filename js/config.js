// Public OAuth client ID — safe to commit per ADR-001 (GIS public-client model).
// Replace if the OAuth client is rotated; no other env var dance required.
export const OAUTH_CLIENT_ID = '621777699755-eub8u6ha03ps6i1r2aq0pmo1ot3f3lbu.apps.googleusercontent.com';

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');

// Defensive client-side cap on YouTube Data API units per UTC day.
// Realistic usage is 5–10 units/day; 200 leaves 50× headroom and trips long
// before exhaustion if a render bug hot-loops.
export const DAILY_QUOTA_CAP = 200;

// IndexedDB
export const DB_NAME = 'querycast';
export const DB_VERSION = 1;
