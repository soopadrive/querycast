// QueryCast entry point. Tauri's WebView2 loads this on launch.
// Stage 2 wires up the PKCE auth flow on top of Stage 1's chassis.

import { openDb, seedDefaults, getActiveProfile, getCredentials } from './storage.js';
import { renderSetupScreen } from './setup-screen.js';
import { signIn, signOut, isSignedIn, getValidAccessToken, AuthRequiredError } from './auth.js';

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
  setStatus('creds', 'Configured', 'ok');
  setStatus('idb', `Open · DB v${db.version} · ${db.objectStoreNames.length} stores`, 'ok');

  const profile = await getActiveProfile();
  setStatus('profile', profile ? `Active: ${profile.name}` : 'Not seeded', profile ? 'ok' : 'fail');

  // Auth state
  const signedIn = await isSignedIn();
  if (signedIn) {
    // Validate the token isn't already revoked.
    try {
      await getValidAccessToken();
      setStatus('auth', 'Signed in', 'ok');
      setSignedInUi();
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setStatus('auth', 'Sign-in expired', 'fail');
        setSignedOutUi();
      } else {
        setStatus('auth', `Token check failed: ${err.message}`, 'fail');
        setSignedOutUi();
      }
    }
  } else {
    setStatus('auth', 'Signed out', 'info');
    setSignedOutUi();
  }

  document.getElementById('sign-in-btn')?.addEventListener('click', handleSignIn);
  document.getElementById('sign-out-btn')?.addEventListener('click', handleSignOut);
}

async function handleSignIn() {
  const btn = document.getElementById('sign-in-btn');
  const msg = document.getElementById('auth-msg');
  btn.disabled = true;
  msg.textContent = 'Opening browser… complete sign-in there, then return here.';

  try {
    await signIn();
    setStatus('auth', 'Signed in', 'ok');
    setSignedInUi();
    msg.textContent = '';
  } catch (err) {
    btn.disabled = false;
    msg.textContent = `Sign-in failed: ${err.message}`;
    msg.className = 'note error';
  }
}

async function handleSignOut() {
  const btn = document.getElementById('sign-out-btn');
  btn.disabled = true;
  try {
    await signOut();
    setStatus('auth', 'Signed out', 'info');
    setSignedOutUi();
  } catch (err) {
    btn.disabled = false;
    document.getElementById('auth-msg').textContent = `Sign-out failed: ${err.message}`;
  }
}

function setSignedInUi() {
  const signIn = document.getElementById('sign-in-btn');
  const signOut = document.getElementById('sign-out-btn');
  const msg = document.getElementById('auth-msg');
  signIn.hidden = true;
  signOut.hidden = false;
  signOut.disabled = false;
  msg.textContent = "You're signed in. Subscriptions and feed render arrive in Stage 3.";
  msg.className = 'note';
}

function setSignedOutUi() {
  const signIn = document.getElementById('sign-in-btn');
  const signOut = document.getElementById('sign-out-btn');
  const msg = document.getElementById('auth-msg');
  signIn.hidden = false;
  signIn.disabled = false;
  signOut.hidden = true;
  msg.textContent = "You'll be redirected to your browser to sign in. Refresh tokens persist across launches.";
  msg.className = 'note';
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
