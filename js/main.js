// Entry point. Stage 1 boots only the chassis: in-app gate, service worker,
// IndexedDB schema, default profile. Auth lands in Stage 2.

import { isInAppBrowser, renderInAppBrowserGate } from './inapp-browser-gate.js';
import { openDb, getActiveProfile, seedDefaults } from './storage.js';
import { STORES } from './defaults.js';

if (isInAppBrowser()) {
  renderInAppBrowserGate();
} else {
  bootApp();
}

async function bootApp() {
  setStatus('pwa', detectPwaContext(), 'info');
  await registerServiceWorker();
  await initStorage();
}

function setStatus(key, text, kind = 'ok') {
  const el = document.querySelector(`#status-${key} .value`);
  if (!el) return;
  el.textContent = text;
  el.className = `value ${kind}`;
}

function detectPwaContext() {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return 'Standalone (installed)';
  }
  if (navigator.standalone) {
    return 'Standalone (iOS home-screen)';
  }
  return 'In browser (not yet installed)';
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setStatus('sw', 'Not supported', 'fail');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    setStatus('sw', `Registered · scope ${reg.scope}`, 'ok');
  } catch (err) {
    setStatus('sw', `Failed: ${err.message}`, 'fail');
  }
}

async function initStorage() {
  try {
    const db = await openDb();
    setStatus('idb', `Open · DB v${db.version} · ${db.objectStoreNames.length} stores`, 'ok');
    await seedDefaults();
    const profile = await getActiveProfile();
    if (profile) {
      setStatus('profile', `Active: ${profile.name}`, 'ok');
    } else {
      setStatus('profile', 'No active profile', 'fail');
    }
  } catch (err) {
    setStatus('idb', `Failed: ${err.message}`, 'fail');
  }
}
