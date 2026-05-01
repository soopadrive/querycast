// QueryCast entry point. Stage 3 wires up the feed view on top of Stage 2's
// auth chassis: refresh subscriptions, fetch RSS, render placeholder list.

import { openDb, seedDefaults, getActiveProfile, getCredentials } from './storage.js';
import { renderSetupScreen } from './setup-screen.js';
import {
  signIn,
  signOut,
  isSignedIn,
  getValidAccessToken,
  AuthRequiredError,
} from './auth.js';
import { refreshFeed, getRenderableFeed } from './feed.js';
import { getDailyUsage, getQuotaCap } from './quota.js';

const { invoke } = window.__TAURI__.core;

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

  await updateQuotaStatus();

  const signedIn = await isSignedIn();
  if (signedIn) {
    try {
      await getValidAccessToken();
      setStatus('auth', 'Signed in', 'ok');
      setSignedInUi();
      await renderCachedFeed();
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setStatus('auth', 'Sign-in expired', 'fail');
      } else {
        setStatus('auth', `Token check failed: ${err.message}`, 'fail');
      }
      setSignedOutUi();
    }
  } else {
    setStatus('auth', 'Signed out', 'info');
    setSignedOutUi();
  }

  document.getElementById('sign-in-btn')?.addEventListener('click', handleSignIn);
  document.getElementById('sign-out-btn')?.addEventListener('click', handleSignOut);
  document.getElementById('refresh-btn')?.addEventListener('click', handleRefresh);
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
    // First sign-in: trigger an initial refresh.
    await handleRefresh();
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
    document.getElementById('feed-list').innerHTML = '';
  } catch (err) {
    btn.disabled = false;
    document.getElementById('auth-msg').textContent = `Sign-out failed: ${err.message}`;
  }
}

async function handleRefresh() {
  const btn = document.getElementById('refresh-btn');
  const status = document.getElementById('feed-status');
  btn.disabled = true;
  status.className = 'note';
  status.textContent = 'Starting refresh…';

  try {
    const result = await refreshFeed((progress) => {
      if (progress.phase === 'subs') {
        status.textContent = progress.message || 'Loading subscriptions…';
      } else if (progress.phase === 'rss' && progress.total) {
        status.textContent = `Fetched RSS for ${progress.completed}/${progress.total} channels…`;
      } else if (progress.phase === 'enrich') {
        if (progress.total) {
          status.textContent = `Enriching ${progress.completed || 0}/${progress.total} videos…`;
        } else {
          status.textContent = progress.message || 'Enriching metadata…';
        }
      } else if (progress.phase === 'done') {
        status.textContent = progress.message || 'Done.';
        if (progress.quotaExhausted) {
          status.className = 'note error';
        }
      }
    });
    if (!status.textContent || status.textContent === 'Done.') {
      status.textContent = `Refreshed ${result.channelsOk}/${result.subs} channels · enriched ${result.enriched}${result.tombstoned ? ` · ${result.tombstoned} unavailable` : ''}.`;
    }
    await renderCachedFeed();
  } catch (err) {
    status.textContent = `Refresh failed: ${err.message}`;
    status.className = 'note error';
  } finally {
    await updateQuotaStatus();
    btn.disabled = false;
  }
}

async function updateQuotaStatus() {
  const used = await getDailyUsage();
  const cap = getQuotaCap();
  const pct = (used / cap) * 100;
  const kind = pct >= 90 ? 'fail' : pct >= 50 ? 'info' : 'ok';
  setStatus('quota', `${used} / ${cap} units`, kind);
}

async function renderCachedFeed() {
  const feed = await getRenderableFeed();
  const list = document.getElementById('feed-list');
  const empty = document.getElementById('feed-empty');

  if (feed.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  list.innerHTML = feed.slice(0, 100).map(renderItem).join('');
  list.querySelectorAll('.feed-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.videoId;
      if (id) invoke('open_url', { url: `https://www.youtube.com/watch?v=${id}` });
    });
  });
}

function renderItem(v) {
  const date = formatRelativeDate(v.publishedAt);
  const durationLabel = v.duration ? formatDuration(v.duration) : '';
  const viewLabel = v.viewCount ? formatViewCount(v.viewCount) : '';
  const isLive = v.liveStatus === 'live' || v.liveStatus === 'upcoming';

  const badges = [];
  if (v._pinned) badges.push(`<span class="badge pinned">PINNED</span>`);
  if (v.isShort) badges.push(`<span class="badge short">SHORT</span>`);
  if (v.liveStatus === 'live') badges.push(`<span class="badge live">LIVE</span>`);
  else if (v.liveStatus === 'upcoming') badges.push(`<span class="badge upcoming">UPCOMING</span>`);

  const metaParts = [escapeHtml(v.channelTitle)];
  if (viewLabel) metaParts.push(viewLabel);
  metaParts.push(date);

  const scorePill =
    typeof v._score === 'number'
      ? `<span class="score-pill" title="Ranking score">${v._score.toFixed(2)}</span>`
      : '';

  return `
    <li class="feed-item" data-video-id="${escapeAttr(v.videoId)}">
      <div class="thumb-wrap">
        <img class="thumb" src="${escapeAttr(v.thumbnailUrl)}" loading="lazy" alt="">
        ${durationLabel ? `<span class="duration-badge">${durationLabel}</span>` : ''}
      </div>
      <div class="info">
        <div class="title">${escapeHtml(v.title)}${scorePill}</div>
        <div class="meta">${metaParts.join(' · ')} ${badges.join(' ')}</div>
      </div>
    </li>
  `;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViewCount(n) {
  if (!n || n < 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K views`;
  return `${n} views`;
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function setSignedInUi() {
  document.getElementById('sign-in-btn').hidden = true;
  const so = document.getElementById('sign-out-btn');
  so.hidden = false;
  so.disabled = false;
  document.getElementById('auth-msg').textContent = "You're signed in.";
  document.getElementById('feed-section').hidden = false;
}

function setSignedOutUi() {
  const si = document.getElementById('sign-in-btn');
  si.hidden = false;
  si.disabled = false;
  document.getElementById('sign-out-btn').hidden = true;
  document.getElementById('auth-msg').textContent =
    "You'll be redirected to your browser to sign in. Refresh tokens persist across launches.";
  document.getElementById('auth-msg').className = 'note';
  document.getElementById('feed-section').hidden = true;
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
        <p class="lead">${escapeHtml(msg)}</p>
      </main>
    </div>
  `;
}
