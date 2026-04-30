// QueryCast entry point. Tauri's WebView2 loads this on launch.
// Stage 1 boots the chassis: open IndexedDB, check for BYO credentials,
// route to setup screen or main app placeholder. Auth lands in Stage 2.

import { openDb, seedDefaults, getActiveProfile, getCredentials } from './storage.js';
import { renderSetupScreen } from './setup-screen.js';

bootApp();

async function bootApp() {
  let db;
  try {
    db = await openDb();
    await seedDefaults();
  } catch (err) {
    renderFatal(`Local storage failed: ${err.message}`);
    return;
  }

  const creds = await getCredentials();
  if (!creds || !creds.clientId || !creds.clientSecret) {
    renderSetupScreen();
    return;
  }

  await renderMainApp(db);
}

async function renderMainApp(db) {
  setStatus('idb', `Open · DB v${db.version} · ${db.objectStoreNames.length} stores`, 'ok');
  const profile = await getActiveProfile();
  setStatus('profile', profile ? `Active: ${profile.name}` : 'Not seeded', profile ? 'ok' : 'fail');
  setStatus('creds', 'Configured', 'ok');
}

function setStatus(key, text, kind = 'ok') {
  const el = document.querySelector(`#status-${key} .value`);
  if (!el) return;
  el.textContent = text;
  el.className = `value ${kind}`;
}

function renderFatal(msg) {
  document.body.innerHTML = `
    <div class="app-shell">
      <header><h1 class="logo">◆ QueryCast</h1></header>
      <main>
        <h2 style="color:var(--red);">Failed to start</h2>
        <p class="lead">${msg}</p>
        <p class="note">Try restarting the app. If the problem persists, your local storage may be corrupted; clearing the app's data and restarting will reset state.</p>
      </main>
    </div>
  `;
}
