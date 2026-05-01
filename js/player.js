// YouTube IFrame Player (Stage 6b). Loads the IFrame API once at boot,
// then exposes openModal/closeModal that mount + tear down a YT.Player.
//
// Auto-marks the video watched after 30 seconds of accumulated PLAYING
// state (per ADR-007) — accumulated, not wall-clock, so seek/pause cycles
// don't double-count or under-count.
//
// Embed-disabled videos surface YT errors 101 / 150; we fall back to an
// "Open on youtube.com" link that defers to the Tauri shell.

import { markWatched } from './video-actions.js';

const { invoke } = window.__TAURI__.core;

const AUTO_WATCHED_MS = 30 * 1000;

let apiReadyPromise = null;
let currentPlayer = null;
let currentVideoId = null;
let lastFocused = null;

let playStartedAt = null;
let totalPlayedMs = 0;
let watchedFired = false;
let onWatchedCallback = null;
let tickInterval = null;

export function loadIframeApi() {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    window.onYouTubeIframeAPIReady = () => {
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      apiReadyPromise = null; // allow retry on a future open
      reject(new Error('Failed to load YouTube IFrame API'));
    };
    document.head.appendChild(tag);
  });
  return apiReadyPromise;
}

// Open the modal player for a given video object. Optional `onWatched`
// fires once when the auto-watched threshold is crossed; the caller uses
// it to re-render the feed and show the undo toast.
export async function openPlayer(video, rank, onWatched) {
  await loadIframeApi();

  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const metaEl = document.getElementById('modal-meta');
  const rankEl = document.getElementById('modal-rank');
  const fallback = document.getElementById('modal-fallback');
  const closeBtn = document.getElementById('modal-close');
  const stub = document.getElementById('modal-stub');

  currentVideoId = video.videoId;
  onWatchedCallback = onWatched || null;
  watchedFired = false;
  playStartedAt = null;
  totalPlayedMs = 0;

  titleEl.textContent = video.title || '';
  rankEl.textContent = `#${rank}`;
  const metaParts = [];
  if (video.channelTitle) metaParts.push(video.channelTitle);
  if (video.viewCount) metaParts.push(`${formatViewCount(video.viewCount)} views`);
  if (video.publishedAt) metaParts.push(formatRelative(video.publishedAt));
  metaEl.textContent = metaParts.join(' · ');

  fallback.hidden = true;
  fallback.querySelector('a').href = `https://www.youtube.com/watch?v=${video.videoId}`;

  // Fresh mount point — YT.Player replaces the element it mounts on with
  // its own iframe, so we need a new div on every open.
  stub.innerHTML = '<div id="player-mount"></div>';

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  lastFocused = document.activeElement;
  closeBtn.focus();

  currentPlayer = new window.YT.Player('player-mount', {
    videoId: video.videoId,
    playerVars: {
      autoplay: 1,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
    },
    events: {
      onStateChange: handleStateChange,
      onError: handlePlayerError,
    },
  });

  startTicker();
}

export function closePlayer() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.classList.contains('active')) return;

  // Flush any in-flight playing time before tearing down.
  if (playStartedAt !== null) {
    totalPlayedMs += Date.now() - playStartedAt;
    playStartedAt = null;
  }
  stopTicker();

  if (currentPlayer && typeof currentPlayer.destroy === 'function') {
    try { currentPlayer.destroy(); } catch { /* noop */ }
  }
  currentPlayer = null;
  currentVideoId = null;
  onWatchedCallback = null;

  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');

  const stub = document.getElementById('modal-stub');
  stub.innerHTML = '';

  if (lastFocused && typeof lastFocused.focus === 'function') {
    lastFocused.focus();
  }
  lastFocused = null;
}

function handleStateChange(e) {
  const PLAYING = 1;
  if (e.data === PLAYING) {
    if (playStartedAt === null) playStartedAt = Date.now();
  } else if (playStartedAt !== null) {
    totalPlayedMs += Date.now() - playStartedAt;
    playStartedAt = null;
  }
  checkAutoWatched();
}

function handlePlayerError(e) {
  // 101 + 150 are the embed-disabled codes. Treat anything that breaks
  // playback the same: surface the fallback link.
  console.warn('YT player error', e?.data);
  showFallback();
}

function showFallback() {
  const fallback = document.getElementById('modal-fallback');
  fallback.hidden = false;
}

function checkAutoWatched() {
  if (watchedFired) return;
  let total = totalPlayedMs;
  if (playStartedAt !== null) total += Date.now() - playStartedAt;
  if (total >= AUTO_WATCHED_MS) {
    watchedFired = true;
    const id = currentVideoId;
    const cb = onWatchedCallback;
    markWatched(id).then(() => cb?.(id)).catch((err) => console.error('autoWatched failed', err));
  }
}

function startTicker() {
  stopTicker();
  tickInterval = setInterval(checkAutoWatched, 1000);
}
function stopTicker() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

// Focus trap: keep Tab cycling within the modal.
export function bindModalChrome() {
  const overlay = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close');

  closeBtn.addEventListener('click', closePlayer);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePlayer();
  });

  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('active')) return;
    if (e.key === 'Escape') {
      closePlayer();
    } else if (e.key === 'Tab') {
      // Only one focusable target right now (close button + a fallback
      // link if shown). Cycle deterministically.
      const focusable = overlay.querySelectorAll(
        'button:not([disabled]), a[href]'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Fallback link: open via Tauri shell so YouTube launches in the
  // user's actual default browser, then close the modal.
  const fallbackLink = document.querySelector('#modal-fallback a');
  fallbackLink.addEventListener('click', (e) => {
    e.preventDefault();
    invoke('open_url', { url: fallbackLink.href });
    closePlayer();
  });
}

function formatViewCount(n) {
  if (!n || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString();
}
