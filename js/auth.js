// OAuth 2.0 PKCE auth code flow per RFC 8252 (native app pattern).
// Per ADR-001: Tauri's Rust shell hosts a localhost listener for the redirect;
// JS handles PKCE generation, URL construction, and token exchange. Each user
// supplies their own Client ID + Secret (BYO model — see setup-screen.js).

import {
  SCOPES,
  OAUTH_AUTH_URL,
  OAUTH_TOKEN_URL,
  OAUTH_REVOKE_URL,
} from './config.js';
import {
  getCredentials,
  getTokens,
  saveTokens,
  clearTokens,
} from './storage.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Refresh threshold: refresh if access token has less than this much time left.
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

export async function isSignedIn() {
  const tokens = await getTokens();
  return !!(tokens && tokens.accessToken);
}

export async function signIn() {
  const creds = await getCredentials();
  if (!creds) throw new Error('No Google credentials configured. Run setup first.');

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  const port = await invoke('start_oauth_listener');
  const redirectUri = `http://127.0.0.1:${port}`;

  // Attach event listeners BEFORE opening the browser so we don't miss the redirect.
  const codePromise = waitForOAuthCallback();

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  const authUrl = `${OAUTH_AUTH_URL}?${params}`;

  await invoke('open_url', { url: authUrl });

  const code = await codePromise;

  const tokenResp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const errBody = await tokenResp.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${errBody.error_description || errBody.error || tokenResp.status}`);
  }

  const data = await tokenResp.json();
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Verify the OAuth client type is "Desktop app" and prompt=consent was used.');
  }

  const expiresAt = Date.now() + data.expires_in * 1000;
  await saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  });
}

export async function signOut() {
  const tokens = await getTokens();
  if (tokens?.accessToken) {
    // Best-effort revoke; network failure should not block local sign-out.
    try {
      await fetch(`${OAUTH_REVOKE_URL}?token=${encodeURIComponent(tokens.accessToken)}`, {
        method: 'POST',
      });
    } catch (e) {
      console.warn('Token revoke request failed:', e);
    }
  }
  await clearTokens();
}

export async function getValidAccessToken() {
  const tokens = await getTokens();
  if (!tokens) throw new AuthRequiredError('Not signed in');

  if (tokens.expiresAt && tokens.expiresAt > Date.now() + REFRESH_BEFORE_EXPIRY_MS) {
    return tokens.accessToken;
  }

  return await refreshAccessToken(tokens);
}

async function refreshAccessToken(tokens) {
  const creds = await getCredentials();
  if (!creds || !tokens.refreshToken) {
    throw new AuthRequiredError('Cannot refresh — credentials or refresh token missing');
  }

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (err.error === 'invalid_grant') {
      // Refresh token revoked or expired. Clear and force re-sign-in.
      await clearTokens();
      throw new AuthRequiredError('Sign-in expired — please sign in again');
    }
    throw new Error(`Refresh failed: ${err.error_description || err.error || resp.status}`);
  }

  const data = await resp.json();
  const expiresAt = Date.now() + data.expires_in * 1000;
  // Google does not return refresh_token on refresh; reuse the existing one.
  await saveTokens({
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt,
  });

  return data.access_token;
}

export class AuthRequiredError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'AuthRequiredError';
  }
}

// === PKCE helpers ===

function generateCodeVerifier() {
  // 32 bytes = 43 chars after base64url encoding (RFC 7636 minimum is 43, max 128).
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// === Tauri event plumbing ===

function waitForOAuthCallback() {
  return new Promise(async (resolve, reject) => {
    let unlistenCode;
    let unlistenError;
    const cleanup = () => {
      unlistenCode?.();
      unlistenError?.();
    };
    unlistenCode = await listen('oauth-code', (event) => {
      cleanup();
      resolve(event.payload);
    });
    unlistenError = await listen('oauth-error', (event) => {
      cleanup();
      reject(new Error(event.payload));
    });
  });
}
