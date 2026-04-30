// Per ADR-001 + ADR-004, QueryCast uses BYO credentials. Each user supplies
// their own Google Cloud OAuth Client ID + Secret on first launch via the
// setup screen. There is intentionally NO embedded shared OAuth client.

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');

// OAuth endpoints
export const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// Defensive client-side cap on YouTube Data API units per local day.
// Per-user via BYO credentials, so only protects the user's own quota.
// Realistic usage is 5–10 units/day; 200 leaves 50× headroom.
export const DAILY_QUOTA_CAP = 200;

// IndexedDB
export const DB_NAME = 'querycast';
export const DB_VERSION = 2;
