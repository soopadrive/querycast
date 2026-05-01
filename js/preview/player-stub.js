// Static preview stub for player.js. Mounts a placeholder card in the
// modal instead of an actual YouTube IFrame Player. Auto-watched fires
// at 5 seconds (vs 30 in production) so the preview can exercise the
// behavior without a long wait.

const AUTO_WATCHED_MS = 5 * 1000;

let lastFocused = null;
let watchedTimeout = null;

export function loadIframeApi() {
  return Promise.resolve();
}

export async function openPlayer(video, rank, onWatched) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const metaEl = document.getElementById('modal-meta');
  const rankEl = document.getElementById('modal-rank');
  const fallback = document.getElementById('modal-fallback');
  const closeBtn = document.getElementById('modal-close');
  const stub = document.getElementById('modal-stub');

  titleEl.textContent = video.title || '';
  rankEl.textContent = `#${rank}`;
  const metaParts = [];
  if (video.channelTitle) metaParts.push(video.channelTitle);
  if (video.viewCount) metaParts.push(`${formatViewCount(video.viewCount)} views`);
  if (video.publishedAt) metaParts.push(formatRelative(video.publishedAt));
  metaEl.textContent = metaParts.join(' · ');

  fallback.hidden = true;
  fallback.querySelector('a').href = `https://www.youtube.com/watch?v=${video.videoId}`;

  // Mock player face — visible cue that this is the preview, not the
  // real WebView2 + YT IFrame mount.
  stub.innerHTML = `
    <div style="
      width:100%; height:100%; display:flex; align-items:center;
      justify-content:center; flex-direction:column; gap:0.6rem;
      background:linear-gradient(135deg, #1f6feb22, #8957e522);
      color:#7eb8ff; font-family:'Cascadia Code', monospace;
      font-size:0.9rem; text-align:center; padding:2rem;
    ">
      <div style="font-size:2.5rem;">▶</div>
      <div><strong>[ MOCK PLAYER ]</strong></div>
      <div style="opacity:0.7; font-size:0.8rem;">${escape(video.videoId)}</div>
      <div style="opacity:0.5; font-size:0.75rem; margin-top:0.4rem;">
        Auto-marks watched after 5s · Esc / click-outside / × close
      </div>
    </div>
  `;

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  lastFocused = document.activeElement;
  closeBtn.focus();

  if (watchedTimeout) clearTimeout(watchedTimeout);
  watchedTimeout = setTimeout(() => {
    onWatched?.(video.videoId);
  }, AUTO_WATCHED_MS);
}

export function closePlayer() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.classList.contains('active')) return;

  if (watchedTimeout) {
    clearTimeout(watchedTimeout);
    watchedTimeout = null;
  }

  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');

  document.getElementById('modal-stub').innerHTML = '';

  if (lastFocused && typeof lastFocused.focus === 'function') {
    lastFocused.focus();
  }
  lastFocused = null;
}

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
      const focusable = overlay.querySelectorAll('button:not([disabled]), a[href]');
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

  const fallbackLink = document.querySelector('#modal-fallback a');
  fallbackLink.addEventListener('click', (e) => {
    e.preventDefault();
    console.info('[preview] open_url:', fallbackLink.href);
    closePlayer();
  });
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
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
