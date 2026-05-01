// QueryCast entry point. Boots IDB, drives auth + feed rendering, and
// hosts the modal player + per-video action toast.

import { openDb, seedDefaults, getActiveProfile, getCredentials, getAll, put } from './storage.js';
import { renderSetupScreen } from './setup-screen.js';
import {
  signIn,
  signOut,
  isSignedIn,
  getValidAccessToken,
  AuthRequiredError,
} from './auth.js';
import { refreshFeed, getRenderableFeed, getSavedFeed } from './feed.js';
import { getDailyUsage, getQuotaCap } from './quota.js';
import { scoreBreakdown, resolveChannelWeight } from './scoring.js';
import { openPlayer, bindModalChrome, loadIframeApi } from './player.js';
import {
  markWatched, unmarkWatched,
  saveVideo, unsaveVideo,
  markNotInterested, unmarkNotInterested,
} from './video-actions.js';
import { STORES } from './defaults.js';
import { bindSettingsDrawer, openDrawer } from './settings-drawer.js';
import { bindThemeToggle } from './theme.js';

const { invoke } = window.__TAURI__.core;

// Index for current feed lookups (used by action handlers + modal opens
// to find a video object by id without a second IDB round-trip).
const feedIndex = new Map();

// Active feed view — 'today' (filtered + scored) or 'saved' (Save list).
let currentView = 'today';

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

  bindModalChrome();
  bindToast();
  bindFeedNav();
  bindProfileMenu();
  bindThemeToggle();
  bindSettingsDrawer({
    onChange: async () => {
      await renderProfileMenu();
      await renderCachedFeed();
      const profile = await getActiveProfile();
      setStatus('profile', profile ? `Active: ${profile.name}` : 'Not seeded', profile ? 'ok' : 'fail');
    },
    getToken: () => getValidAccessToken(),
  });
  // "Manage profiles…" entry in the profile dropdown jumps into the
  // drawer focused on the profile section.
  document.getElementById('profile-manage')?.addEventListener('click', async () => {
    closeProfileMenu();
    await openDrawer('section-profile');
  });
  await renderProfileMenu();
  // Warm the IFrame API in the background so the first modal open is snappy.
  loadIframeApi().catch((err) => console.warn('IFrame API preload failed', err));
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
    document.getElementById('featured-row').innerHTML = '';
    document.getElementById('grid').innerHTML = '';
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
  const [profile, feed] = await Promise.all([
    getActiveProfile(),
    currentView === 'saved' ? getSavedFeed() : getRenderableFeed(),
  ]);
  const board = document.getElementById('feed-board');
  const empty = document.getElementById('feed-empty');
  const featuredRow = document.getElementById('featured-row');
  const grid = document.getElementById('grid');
  const featuredLabel = document.getElementById('featured-label');
  const gridLabel = document.getElementById('grid-label');

  empty.innerHTML = currentView === 'saved'
    ? 'No saved videos yet. Hit <strong>★ Save</strong> in the info card to add one.'
    : 'No videos cached yet. Click <strong>Refresh</strong> to fetch your subscriptions.';

  if (feed.length === 0) {
    board.hidden = true;
    empty.hidden = false;
    featuredRow.innerHTML = '';
    grid.innerHTML = '';
    feedIndex.clear();
    return;
  }

  empty.hidden = true;
  board.hidden = false;

  feedIndex.clear();
  feed.forEach((v, idx) => {
    v._rank = idx + 1;
    feedIndex.set(v.videoId, v);
  });

  if (currentView === 'saved') {
    // Saved view: drop the featured-row hierarchy (rank #1 = "most
    // recently saved" doesn't deserve a giant card). Single grid label.
    featuredLabel.hidden = true;
    featuredRow.innerHTML = '';
    gridLabel.textContent = 'Saved videos';
    gridLabel.hidden = false;
    grid.innerHTML = feed.map((v, i) => videoCardHTML(v, i + 1, profile)).join('');
  } else {
    const top = feed.slice(0, 3);
    const rest = feed.slice(3, 100);
    featuredLabel.hidden = false;
    featuredLabel.textContent = 'Top picks · ranked by score';
    featuredRow.innerHTML = top.map((v, i) => videoCardHTML(v, i + 1, profile)).join('');
    gridLabel.hidden = rest.length === 0;
    gridLabel.textContent = 'More from your subscriptions';
    grid.innerHTML = rest.map((v, i) => videoCardHTML(v, i + 4, profile)).join('');
  }

  document.querySelectorAll('.video-card').forEach((el) => {
    const open = (event) => {
      if (event.target.closest('.action-btn')) return;
      if (event.target.closest('.info-card .desc, .info-card .score-breakdown')) return;
      const id = el.dataset.videoId;
      const v = feedIndex.get(id);
      if (v) handleCardOpen(v);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (event) => {
      // Mirror click for keyboard users — Enter / Space activates the
      // card the same way clicking the thumbnail does.
      if (event.key === 'Enter' || event.key === ' ') {
        if (event.target !== el) return; // let inner buttons handle their own
        event.preventDefault();
        open(event);
      }
    });
  });

  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.videoId;
      handleAction(action, id);
    });
  });
}

function videoCardHTML(v, rank, profile) {
  const featured = rank === 1;
  const date = formatRelativeDate(v.publishedAt);
  const durationLabel = v.duration ? formatDuration(v.duration) : '';
  const viewLabel = v.viewCount ? formatViewCount(v.viewCount) : '';

  const statBadges = [];
  if (v._pinned) statBadges.push(`<span class="badge pinned">PINNED</span>`);
  if (v.isShort) statBadges.push(`<span class="badge short">SHORT</span>`);
  if (v.liveStatus === 'live') statBadges.push(`<span class="badge live">LIVE</span>`);
  else if (v.liveStatus === 'upcoming') statBadges.push(`<span class="badge upcoming">UPCOMING</span>`);

  const scorePill =
    typeof v._score === 'number'
      ? `<span class="score-pill" title="Ranking score">${v._score.toFixed(2)}</span>`
      : '';

  const breakdownHtml = profile ? formatBreakdown(v, profile) : '';
  const desc = (v.description || '').trim();
  const descHtml = desc
    ? `<div class="desc">${escapeHtml(desc)}</div>`
    : `<div class="desc empty">No description.</div>`;
  const idAttr = escapeAttr(v.videoId);
  const actionsHtml = `
    <div class="actions">
      <button class="action-btn watch" data-action="watch" data-video-id="${idAttr}" title="Mark watched">✓ Watched</button>
      <button class="action-btn save" data-action="save" data-video-id="${idAttr}" title="Save for later">★ Save</button>
      <button class="action-btn skip" data-action="skip" data-video-id="${idAttr}" title="Not interested">✕ Hide</button>
    </div>
  `;

  return `
    <div class="video-card${featured ? ' featured' : ''}" data-video-id="${idAttr}" tabindex="0" role="button" aria-label="${escapeAttr(`Play: ${v.title}`)}">
      <div class="thumb-wrap">
        <img class="thumb" src="${escapeAttr(v.thumbnailUrl)}" loading="lazy" alt="">
        <span class="rank-badge">#${rank}</span>
        ${durationLabel ? `<span class="duration-badge">${durationLabel}</span>` : ''}
      </div>
      <div class="info">
        <div>
          <div class="title">${escapeHtml(v.title)}</div>
          <div class="meta-line">${escapeHtml(v.channelTitle || '')}</div>
        </div>
        <div class="stats">
          ${viewLabel ? `<span>${viewLabel}</span><span>·</span>` : ''}
          <span>${date}</span>
          ${scorePill}
          ${statBadges.join(' ')}
        </div>
      </div>
      <div class="info-card">
        ${descHtml}
        ${breakdownHtml ? `<div class="score-breakdown">${breakdownHtml}</div>` : ''}
        ${actionsHtml}
      </div>
    </div>
  `;
}

async function handleCardOpen(video) {
  try {
    await openPlayer(video, video._rank || 0, async (videoId) => {
      // Auto-watched at 30s — show toast with undo, refresh the feed in
      // the background so the video drops out (it's now in `watched`).
      await renderCachedFeed();
      showToast('Auto-marked watched', async () => {
        await unmarkWatched(videoId);
        await renderCachedFeed();
      });
    });
  } catch (err) {
    console.error('Failed to open player', err);
    // Fall back to opening on YouTube directly if the IFrame API failed.
    invoke('open_url', { url: `https://www.youtube.com/watch?v=${video.videoId}` });
  }
}

async function handleAction(action, videoId) {
  if (!videoId) return;
  try {
    if (action === 'watch') {
      await markWatched(videoId);
      await renderCachedFeed();
      showToast('Marked watched', async () => {
        await unmarkWatched(videoId);
        await renderCachedFeed();
      });
    } else if (action === 'save') {
      await saveVideo(videoId);
      // Save doesn't drop the video from the Today feed — it's a flag,
      // not a filter. But undoing a save in the Saved view should drop
      // it, so the undo callback re-renders only when relevant.
      showToast('Saved for later', async () => {
        await unsaveVideo(videoId);
        if (currentView === 'saved') await renderCachedFeed();
      });
    } else if (action === 'skip') {
      // Capture video metadata BEFORE the IDB write + re-render — the
      // feedIndex is rebuilt by renderCachedFeed() and the just-skipped
      // video drops out, so a post-render lookup returns undefined.
      const video = feedIndex.get(videoId);
      const channelId = video?.channelId;
      const channelTitle = video?.channelTitle || 'this channel';

      await markNotInterested(videoId);
      await renderCachedFeed();

      let weightApplied = false;
      let prevOverride; // captured if "See less" runs

      const undo = async () => {
        await unmarkNotInterested(videoId);
        if (weightApplied && channelId) {
          const profile = await getActiveProfile();
          if (profile) {
            profile.channelOverrides = profile.channelOverrides || {};
            if (prevOverride === undefined) {
              delete profile.channelOverrides[channelId];
            } else {
              profile.channelOverrides[channelId] = prevOverride;
            }
            await put(STORES.profiles, profile);
          }
        }
        await renderCachedFeed();
      };

      const secondary = channelId ? {
        label: `See less from ${channelTitle}`,
        fn: async () => {
          const profile = await getActiveProfile();
          if (!profile) return;
          profile.channelOverrides = profile.channelOverrides || {};
          // Capture before we mutate, for atomic undo.
          const existing = profile.channelOverrides[channelId];
          prevOverride = existing; // may be undefined if no prior override

          // Subtract 0.5 from the channel's *resolved* weight (override
          // wins over groups, otherwise group sum, else 0). Clamp to
          // [-2, +2] per the per-channel weight bound from ADR-007.
          const baseline = resolveChannelWeight(channelId, profile);
          const newOverride = Math.max(-2, Math.min(2, baseline - 0.5));
          profile.channelOverrides[channelId] = newOverride;

          await put(STORES.profiles, profile);
          weightApplied = true;
          await renderCachedFeed();

          const sign = newOverride >= 0 ? '+' : '';
          updateToastMessage(`Hidden · ${channelTitle} weighted ${sign}${newOverride.toFixed(1)}`);
          hideSecondaryAction(); // one-shot — can't compound on a single hide
        },
      } : null;

      showToast('Hidden', undo, secondary);
    }
  } catch (err) {
    console.error(`Action ${action} failed`, err);
  }
}

let toastTimer = null;
let toastUndoFn = null;
let toastSecondaryFn = null;

function bindToast() {
  document.getElementById('toast-undo').addEventListener('click', () => {
    const fn = toastUndoFn;
    hideToast();
    if (fn) fn();
  });
  document.getElementById('toast-secondary').addEventListener('click', () => {
    const fn = toastSecondaryFn;
    if (fn) fn();
    // Don't hide the toast on secondary — the action still gets a 5s
    // window to undo. The secondary button hides itself once invoked.
  });
}

// secondary: { label, fn } | null — shown to the left of Undo. Useful
// for follow-up offers like "See less from this channel" after a Hide.
function showToast(message, undoFn, secondary = null) {
  const toast = document.getElementById('action-toast');
  const msg = document.getElementById('toast-msg');
  const secBtn = document.getElementById('toast-secondary');
  msg.textContent = message;
  toastUndoFn = undoFn || null;
  toastSecondaryFn = secondary?.fn || null;
  if (secondary?.label) {
    secBtn.textContent = secondary.label;
    secBtn.hidden = false;
  } else {
    secBtn.hidden = true;
  }
  toast.hidden = false;
  // Force reflow so the .show transition kicks in even on rapid retoasts.
  void toast.offsetWidth;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function updateToastMessage(message) {
  const msg = document.getElementById('toast-msg');
  if (msg) msg.textContent = message;
}

function hideSecondaryAction() {
  document.getElementById('toast-secondary').hidden = true;
  toastSecondaryFn = null;
}

function hideToast() {
  const toast = document.getElementById('action-toast');
  toast.classList.remove('show');
  toastUndoFn = null;
  toastSecondaryFn = null;
  document.getElementById('toast-secondary').hidden = true;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  setTimeout(() => { toast.hidden = true; }, 200);
}

function bindFeedNav() {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      const view = tab.dataset.view;
      if (!view || view === currentView) return;
      currentView = view;
      document.querySelectorAll('.nav-tab').forEach((t) => {
        const active = t.dataset.view === view;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      await renderCachedFeed();
    });
  });
}

function bindProfileMenu() {
  const trigger = document.getElementById('profile-trigger');
  const menu = document.getElementById('profile-menu');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openProfileMenu();
    else closeProfileMenu();
  });

  document.addEventListener('click', (e) => {
    if (menu.hidden) return;
    if (!menu.contains(e.target) && e.target !== trigger) closeProfileMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) closeProfileMenu();
  });
}

function openProfileMenu() {
  document.getElementById('profile-menu').hidden = false;
  document.getElementById('profile-trigger').setAttribute('aria-expanded', 'true');
}
function closeProfileMenu() {
  document.getElementById('profile-menu').hidden = true;
  document.getElementById('profile-trigger').setAttribute('aria-expanded', 'false');
}

async function renderProfileMenu() {
  const profiles = await getAll(STORES.profiles);
  const active = profiles.find((p) => p.isActive) || profiles[0];
  document.getElementById('profile-name').textContent = active?.name || 'Default';

  const list = document.getElementById('profile-menu-list');
  list.innerHTML = profiles
    .map(
      (p) => `
      <button class="profile-menu-item${p.isActive ? ' active' : ''}" data-profile-id="${escapeAttr(p.profileId)}">
        <span>${escapeHtml(p.name)}</span>
      </button>
    `
    )
    .join('');

  list.querySelectorAll('.profile-menu-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await switchProfile(btn.dataset.profileId);
    });
  });
}

async function switchProfile(profileId) {
  if (!profileId) return;
  const profiles = await getAll(STORES.profiles);
  for (const p of profiles) {
    const next = { ...p, isActive: p.profileId === profileId };
    await put(STORES.profiles, next);
  }
  closeProfileMenu();
  await renderProfileMenu();
  setStatus('profile', `Active: ${profiles.find((p) => p.profileId === profileId)?.name || 'Default'}`, 'ok');
  await renderCachedFeed();
}

function formatBreakdown(v, profile) {
  if (typeof v._score !== 'number') return '';
  const b = scoreBreakdown(v, profile);
  const channelLabel = `channel ${b.channel >= 0 ? '+' : ''}${b.channel.toFixed(2)}`;
  const channelHtml =
    b.channel < 0 ? `<span class="neg">${channelLabel} (suppressed)</span>` : channelLabel;
  const parts = [
    `recency ${b.recency.toFixed(2)}`,
    `velocity ${b.velocity.toFixed(2)}`,
    channelHtml,
    `length-fit ${b.lengthFit.toFixed(2)}`,
  ];
  if (b.pinBoost > 0) {
    parts.push(`<span class="pin">pin +${b.pinBoost.toFixed(2)}</span>`);
  }
  return `<span class="label">Score: ${v._score.toFixed(2)}</span><br>${parts.join(' · ')}`;
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
