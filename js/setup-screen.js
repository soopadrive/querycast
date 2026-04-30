// First-launch BYO credentials setup screen. Per ADR-001 + ADR-004, each user
// supplies their own Google Cloud OAuth Client ID + Secret. Persisted to the
// IndexedDB `credentials` store; setup is one-time per install.

import { saveCredentials } from './storage.js';

export function renderSetupScreen() {
  document.body.innerHTML = `
    <div class="app-shell">
      <header>
        <h1 class="logo">◆ QueryCast</h1>
        <span class="status">Setup · v0.1</span>
      </header>
      <main class="setup">
        <h2>Set up your Google credentials</h2>
        <p class="lead">QueryCast uses your own Google Cloud OAuth credentials so your YouTube API quota is yours alone. This is a one-time, ~15-minute setup.</p>

        <div class="setup-step">
          <h3>Step 1 — Create a Google Cloud project</h3>
          <ol>
            <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com/projectcreate</a></li>
            <li>Project name: <code>QueryCast</code> (or any name you prefer)</li>
            <li>Click <strong>Create</strong></li>
          </ol>
        </div>

        <div class="setup-step">
          <h3>Step 2 — Enable required APIs</h3>
          <ol>
            <li>In your new project, go to <strong>APIs &amp; Services → Library</strong></li>
            <li>Search and enable: <strong>YouTube Data API v3</strong></li>
            <li>Search and enable: <strong>Google Drive API</strong></li>
          </ol>
        </div>

        <div class="setup-step">
          <h3>Step 3 — Configure OAuth consent screen</h3>
          <ol>
            <li>Go to <strong>APIs &amp; Services → OAuth consent screen</strong></li>
            <li>User Type: <strong>External</strong></li>
            <li>App name: <code>QueryCast</code></li>
            <li>User support email + Developer contact: your email</li>
            <li>Add scopes: <code>youtube.readonly</code> and <code>drive.appdata</code></li>
            <li>Add yourself as a test user</li>
            <li>Save</li>
          </ol>
        </div>

        <div class="setup-step">
          <h3>Step 4 — Create an OAuth Client ID</h3>
          <ol>
            <li>Go to <strong>APIs &amp; Services → Credentials</strong></li>
            <li>Click <strong>Create Credentials → OAuth client ID</strong></li>
            <li>Application type: <strong>Desktop app</strong></li>
            <li>Name: <code>QueryCast Desktop</code></li>
            <li>Click <strong>Create</strong></li>
            <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from the dialog</li>
          </ol>
        </div>

        <div class="setup-step">
          <h3>Step 5 — Paste your credentials below</h3>
          <form id="setup-form" class="setup-form">
            <label>
              <span>Client ID</span>
              <input type="text" id="client-id" autocomplete="off" spellcheck="false" placeholder="123456789-abc.apps.googleusercontent.com" required>
            </label>
            <label>
              <span>Client Secret</span>
              <input type="text" id="client-secret" autocomplete="off" spellcheck="false" placeholder="GOCSPX-..." required>
            </label>
            <p id="setup-error" class="setup-error" hidden></p>
            <button type="submit" class="primary">Save and continue</button>
          </form>
        </div>

        <p class="note">Your credentials live only in this app's local storage. They are never transmitted anywhere except to Google's OAuth endpoints during sign-in.</p>
      </main>
    </div>
  `;

  const form = document.getElementById('setup-form');
  const errorEl = document.getElementById('setup-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = document.getElementById('client-id').value.trim();
    const clientSecret = document.getElementById('client-secret').value.trim();

    errorEl.hidden = true;
    errorEl.textContent = '';

    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      showError('Client ID should end with .apps.googleusercontent.com');
      return;
    }
    if (clientSecret.length < 10) {
      showError('Client Secret looks too short — double-check you copied the full value.');
      return;
    }

    try {
      await saveCredentials({ clientId, clientSecret });
      location.reload();
    } catch (err) {
      showError(`Failed to save: ${err.message}`);
    }
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
}
