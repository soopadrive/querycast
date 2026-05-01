// Settings drawer (Stage 7b). Slides in from the right, hosts three
// collapsible sections in v1: Profile (CRUD), Discovery filters,
// Scoring weights. Every change writes to IDB immediately and notifies
// callers so the feed and the profile dropdown can re-render.
//
// Stage 7c will add: Channel groups, Pins / overrides, Hidden videos.
// Stage 7d will add: Drive backup.

import { STORES, DEFAULT_PROFILE } from './defaults.js';
import { getAll, put, del } from './storage.js';
import { backupNow, restoreLatest, getBackupInfo } from './drive-backup.js';

let editingProfileId = null;
let onChangeCallback = null;
let getTokenCallback = null;

export function bindSettingsDrawer({ onChange, getToken } = {}) {
  onChangeCallback = onChange || null;
  getTokenCallback = getToken || null;

  document.getElementById('settings-btn')?.addEventListener('click', () => openDrawer());
  document.getElementById('settings-close')?.addEventListener('click', closeDrawer);

  document.getElementById('drawer-backdrop')?.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    const drawer = document.getElementById('settings-drawer');
    if (!drawer?.classList.contains('active')) return;
    if (e.key === 'Escape') {
      closeDrawer();
      return;
    }
    if (e.key === 'Tab') {
      // Focus trap — Tab cycles within the drawer only. Skip currently-
      // disabled buttons and elements inside collapsed (hidden) sections.
      const focusables = Array.from(
        drawer.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
        )
      ).filter((el) => el.offsetParent !== null); // visible only
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Section accordion toggles. Click works; Enter/Space mirrors click
  // because the heading has role=button + tabindex=0 — without this,
  // keyboard users can focus but not activate.
  document.querySelectorAll('.section-toggle').forEach((h) => {
    const toggle = () => {
      const expanded = h.getAttribute('aria-expanded') === 'true';
      h.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      const body = h.nextElementSibling;
      if (body) body.hidden = expanded;
    };
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });

  // Profile section
  document.getElementById('profile-edit-select').addEventListener('change', (e) => {
    editingProfileId = e.target.value;
    renderEditingProfile();
  });
  document.getElementById('profile-name-input').addEventListener('change', (e) => {
    updateEditing((p) => { p.name = e.target.value.trim() || 'Untitled'; });
  });
  document.getElementById('profile-active-check').addEventListener('change', async (e) => {
    if (e.target.checked) await setActive(editingProfileId);
    // Don't allow un-checking — exactly one profile must be active.
    else e.target.checked = true;
  });
  document.getElementById('profile-add').addEventListener('click', async () => {
    const id = `profile-${Date.now()}`;
    const fresh = structuredClone(DEFAULT_PROFILE);
    fresh.profileId = id;
    fresh.name = 'New profile';
    fresh.isActive = false;
    await put(STORES.profiles, fresh);
    editingProfileId = id;
    await renderAll();
    notify();
  });
  document.getElementById('profile-duplicate').addEventListener('click', async () => {
    const profile = await getProfile(editingProfileId);
    if (!profile) return;
    const id = `profile-${Date.now()}`;
    const dup = structuredClone(profile);
    dup.profileId = id;
    dup.name = `${profile.name} (copy)`;
    dup.isActive = false;
    await put(STORES.profiles, dup);
    editingProfileId = id;
    await renderAll();
    notify();
  });
  document.getElementById('profile-delete').addEventListener('click', async () => {
    const profiles = await getAll(STORES.profiles);
    if (profiles.length <= 1) return;
    const target = profiles.find((p) => p.profileId === editingProfileId);
    if (!target || target.isActive) return;
    if (!confirm(`Delete profile "${target.name}"?`)) return;
    await del(STORES.profiles, editingProfileId);
    const remaining = profiles.filter((p) => p.profileId !== editingProfileId);
    editingProfileId = remaining.find((p) => p.isActive)?.profileId || remaining[0].profileId;
    await renderAll();
    notify();
  });

  // Discovery filters
  bindKeywordEditor('kw-block-list', 'kw-block-input', 'keywordsBlock');
  bindKeywordEditor('kw-require-list', 'kw-require-input', 'keywordsRequire');
  bindNumberInput('duration-min', (p, v) => { p.rules.durationMin = v; });
  bindNumberInput('duration-max', (p, v) => { p.rules.durationMax = v; });
  bindNumberInput('age-max', (p, v) => { p.rules.ageMaxDays = v; });
  bindNumberInput('views-min', (p, v) => { p.rules.viewsMin = v; });
  bindCheckbox('hide-shorts', (p, v) => { p.rules.hideShorts = v; });
  bindCheckbox('hide-live', (p, v) => { p.rules.hideLive = v; });
  bindCheckbox('hide-podcasts', (p, v) => { p.rules.hidePodcasts = v; });

  // Scoring weights — `input` event for live updates as the slider drags.
  bindSlider('w-recency', (p, v) => { p.weights.recency = v; });
  bindSlider('w-velocity', (p, v) => { p.weights.velocity = v; });
  bindSlider('w-channel', (p, v) => { p.weights.channel = v; });
  bindSlider('w-length-fit', (p, v) => { p.weights.lengthFit = v; });
  bindNumberInput('sweet-center', (p, v) => { p.weights.sweetSpotCenterSec = v; });
  bindNumberInput('sweet-width', (p, v) => { p.weights.sweetSpotWidthSec = Math.max(60, v); });

  document.getElementById('reset-defaults').addEventListener('click', async () => {
    if (!confirm('Reset filters and scoring weights to defaults? Profile name and active state are preserved.')) return;
    const profile = await getProfile(editingProfileId);
    if (!profile) return;
    profile.rules = structuredClone(DEFAULT_PROFILE.rules);
    profile.weights = structuredClone(DEFAULT_PROFILE.weights);
    await put(STORES.profiles, profile);
    await renderEditingProfile();
    notify();
  });

  // Channels section (Stage 7c)
  const search = document.getElementById('channel-search');
  search?.addEventListener('input', () => renderChannelList(search.value));
  document.getElementById('channel-list')?.addEventListener('click', handleChannelAction);
  document.getElementById('channel-list')?.addEventListener('change', handleChannelAction);

  // Channel groups section (Stage 7c)
  document.getElementById('group-add')?.addEventListener('click', async () => {
    const id = `group-${Date.now()}`;
    await updateEditing((p) => {
      p.channelGroups = p.channelGroups || [];
      p.channelGroups.push({ id, name: 'New group', channelIds: [], weight: 0.5 });
    });
  });
  document.getElementById('groups-list')?.addEventListener('click', handleGroupAction);
  document.getElementById('groups-list')?.addEventListener('change', handleGroupAction);
  document.getElementById('groups-list')?.addEventListener('input', handleGroupAction);

  // Hidden videos section (Stage 7c)
  document.getElementById('hidden-skip-list')?.addEventListener('click', handleHiddenAction);
  document.getElementById('hidden-watch-list')?.addEventListener('click', handleHiddenAction);

  // Drive backup section (Stage 7d)
  document.getElementById('backup-now')?.addEventListener('click', handleBackupNow);
  document.getElementById('restore-now')?.addEventListener('click', handleRestore);
  // Auto-fetch backup info when the section is opened.
  document.getElementById('section-backup')?.querySelector('.section-toggle')
    ?.addEventListener('click', () => {
      // Defer so the click toggles aria-expanded first.
      setTimeout(() => {
        const expanded = document.querySelector('#section-backup .section-toggle')
          ?.getAttribute('aria-expanded') === 'true';
        if (expanded) refreshBackupStatus();
      }, 10);
    });
}

export async function openDrawer(scrollToSection) {
  const drawer = document.getElementById('settings-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!editingProfileId) {
    const profiles = await getAll(STORES.profiles);
    const active = profiles.find((p) => p.isActive) || profiles[0];
    editingProfileId = active?.profileId || null;
  }
  await renderAll();
  drawer.classList.add('active');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.hidden = false;
  document.body.classList.add('drawer-open');
  if (scrollToSection) {
    const sec = document.getElementById(scrollToSection);
    sec?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    // Also auto-expand it
    const toggle = sec?.querySelector('.section-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') !== 'true') {
      toggle.click();
    }
  }
  // Focus the close button so Esc / Tab work predictably.
  document.getElementById('settings-close')?.focus();
}

export function closeDrawer() {
  const drawer = document.getElementById('settings-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  drawer.classList.remove('active');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.hidden = true;
  document.body.classList.remove('drawer-open');
}

async function renderAll() {
  await renderProfileSelect();
  await renderEditingProfile();
}

async function renderProfileSelect() {
  const profiles = await getAll(STORES.profiles);
  if (!editingProfileId && profiles.length) {
    editingProfileId = profiles.find((p) => p.isActive)?.profileId || profiles[0].profileId;
  }
  const sel = document.getElementById('profile-edit-select');
  sel.innerHTML = profiles
    .map((p) => `<option value="${escapeAttr(p.profileId)}"${p.profileId === editingProfileId ? ' selected' : ''}>${escapeHtml(p.name)}${p.isActive ? ' · active' : ''}</option>`)
    .join('');
}

async function renderEditingProfile() {
  const profile = await getProfile(editingProfileId);
  if (!profile) return;

  document.getElementById('profile-name-input').value = profile.name;
  document.getElementById('profile-active-check').checked = !!profile.isActive;

  const profiles = await getAll(STORES.profiles);
  document.getElementById('profile-delete').disabled =
    profiles.length <= 1 || profile.isActive;

  // Filters
  renderKeywordList('kw-block-list', profile.rules.keywordsBlock, 'keywordsBlock');
  renderKeywordList('kw-require-list', profile.rules.keywordsRequire, 'keywordsRequire');
  document.getElementById('duration-min').value = profile.rules.durationMin ?? 0;
  document.getElementById('duration-max').value = profile.rules.durationMax ?? 7200;
  document.getElementById('age-max').value = profile.rules.ageMaxDays ?? 30;
  document.getElementById('views-min').value = profile.rules.viewsMin ?? 0;
  document.getElementById('hide-shorts').checked = !!profile.rules.hideShorts;
  document.getElementById('hide-live').checked = !!profile.rules.hideLive;
  document.getElementById('hide-podcasts').checked = !!profile.rules.hidePodcasts;

  // Weights
  setSlider('w-recency', profile.weights.recency);
  setSlider('w-velocity', profile.weights.velocity);
  setSlider('w-channel', profile.weights.channel);
  setSlider('w-length-fit', profile.weights.lengthFit);
  document.getElementById('sweet-center').value = profile.weights.sweetSpotCenterSec ?? 900;
  document.getElementById('sweet-width').value = profile.weights.sweetSpotWidthSec ?? 600;

  // Channels + groups + hidden videos (Stage 7c)
  await renderChannelList(document.getElementById('channel-search')?.value || '');
  await renderGroupsList();
  await renderHiddenVideos();
}

// === Channels section ===

async function getKnownChannels() {
  const subs = await getAll(STORES.subscriptions);
  if (subs.length > 0) {
    return subs.map((s) => ({ channelId: s.channelId, title: s.title })).sort(byTitle);
  }
  // Fallback: derive unique (id, title) from cached videos.
  const videos = await getAll(STORES.videos);
  const seen = new Map();
  for (const v of videos) {
    if (v.channelId && !seen.has(v.channelId)) {
      seen.set(v.channelId, v.channelTitle || v.channelId);
    }
  }
  return [...seen.entries()]
    .map(([channelId, title]) => ({ channelId, title }))
    .sort(byTitle);
}

function byTitle(a, b) {
  return (a.title || '').localeCompare(b.title || '');
}

async function renderChannelList(filterText = '') {
  const list = document.getElementById('channel-list');
  if (!list) return;
  const profile = await getProfile(editingProfileId);
  if (!profile) return;
  const channels = await getKnownChannels();
  const overrides = profile.channelOverrides || {};
  const pins = new Set(profile.channelPins || []);
  const filter = filterText.trim().toLowerCase();

  const filtered = filter
    ? channels.filter((c) => c.title.toLowerCase().includes(filter))
    : channels;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="chip-empty">${filter ? 'No channels match.' : 'No channels yet — refresh to populate.'}</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((c) => {
      const override = overrides[c.channelId];
      const hasOverride = override !== undefined && override !== null;
      const pinned = pins.has(c.channelId);
      return `
        <div class="channel-row" data-channel-id="${escapeAttr(c.channelId)}">
          <button class="pin-toggle${pinned ? ' active' : ''}"
                  data-action="pin"
                  aria-pressed="${pinned}"
                  aria-label="${pinned ? 'Unpin' : 'Pin'} ${escapeAttr(c.title)}"
                  title="${pinned ? 'Pinned — newest videos boosted +1.0' : 'Pin channel'}">★</button>
          <span class="channel-title" title="${escapeAttr(c.channelId)}">${escapeHtml(c.title)}</span>
          <input type="number" class="channel-weight"
                 data-action="weight"
                 step="0.1" min="-2" max="2"
                 placeholder="—"
                 value="${hasOverride ? override : ''}"
                 title="Override weight (-2 to +2). Leave blank to use group sums." />
        </div>
      `;
    })
    .join('');
}

async function handleChannelAction(e) {
  const row = e.target.closest('.channel-row');
  if (!row) return;
  const channelId = row.dataset.channelId;
  const action = e.target.dataset.action;
  if (action === 'pin') {
    await updateEditing((p) => {
      const pins = p.channelPins || [];
      const idx = pins.indexOf(channelId);
      if (idx >= 0) pins.splice(idx, 1);
      else pins.push(channelId);
      p.channelPins = pins;
    });
  } else if (action === 'weight' && e.type === 'change') {
    const raw = e.target.value.trim();
    await updateEditing((p) => {
      p.channelOverrides = p.channelOverrides || {};
      if (raw === '') {
        delete p.channelOverrides[channelId];
      } else {
        const v = parseFloat(raw);
        if (Number.isFinite(v)) {
          p.channelOverrides[channelId] = Math.max(-2, Math.min(2, v));
        }
      }
    });
  }
}

// === Channel groups section ===

async function renderGroupsList() {
  const list = document.getElementById('groups-list');
  if (!list) return;
  const profile = await getProfile(editingProfileId);
  if (!profile) return;
  const groups = profile.channelGroups || [];
  const channels = await getKnownChannels();

  if (groups.length === 0) {
    list.innerHTML = '<div class="chip-empty">No groups yet. Use a group to weight a set of channels together.</div>';
    return;
  }

  list.innerHTML = groups
    .map((g) => {
      const memberSet = new Set(g.channelIds || []);
      const memberRows = channels
        .map((c) => {
          const checked = memberSet.has(c.channelId);
          return `
            <label class="group-member-row">
              <input type="checkbox"
                     data-group-id="${escapeAttr(g.id)}"
                     data-action="member"
                     data-channel-id="${escapeAttr(c.channelId)}"
                     ${checked ? 'checked' : ''} />
              <span>${escapeHtml(c.title)}</span>
            </label>
          `;
        })
        .join('');

      return `
        <details class="group-card" data-group-id="${escapeAttr(g.id)}">
          <summary>
            <span class="group-summary-name">${escapeHtml(g.name)}</span>
            <span class="group-summary-count">${memberSet.size} ch</span>
            <span class="group-summary-weight">w ${(g.weight ?? 0).toFixed(2)}</span>
          </summary>
          <div class="group-edit">
            <label class="field">
              <span>Name</span>
              <input type="text" data-action="name" data-group-id="${escapeAttr(g.id)}" value="${escapeAttr(g.name)}" />
            </label>
            <label class="field slider-field">
              <span>Weight <span class="value-display" data-value-for="group-w-${escapeAttr(g.id)}">${(g.weight ?? 0).toFixed(2)}</span></span>
              <input type="range"
                     id="group-w-${escapeAttr(g.id)}"
                     data-action="weight"
                     data-group-id="${escapeAttr(g.id)}"
                     min="-2" max="2" step="0.1"
                     value="${g.weight ?? 0}" />
            </label>
            <div class="group-members">
              <div class="subsection">Members</div>
              ${memberRows || '<div class="chip-empty">No channels yet.</div>'}
            </div>
            <button class="danger" data-action="delete" data-group-id="${escapeAttr(g.id)}">Delete group</button>
          </div>
        </details>
      `;
    })
    .join('');
}

async function handleGroupAction(e) {
  const action = e.target.dataset.action;
  const groupId = e.target.dataset.groupId;
  if (!action || !groupId) return;

  if (action === 'name' && e.type === 'change') {
    await updateEditing((p) => {
      const g = (p.channelGroups || []).find((x) => x.id === groupId);
      if (g) g.name = e.target.value.trim() || 'Untitled';
    });
  } else if (action === 'weight') {
    const v = parseFloat(e.target.value);
    if (e.type === 'input') {
      // Live value display while dragging — don't write to IDB on every tick.
      const display = document.querySelector(`[data-value-for="group-w-${cssEscape(groupId)}"]`);
      if (display) display.textContent = v.toFixed(2);
      return;
    }
    if (e.type === 'change') {
      await updateEditing((p) => {
        const g = (p.channelGroups || []).find((x) => x.id === groupId);
        if (g) g.weight = v;
      });
    }
  } else if (action === 'member' && e.type === 'change') {
    const channelId = e.target.dataset.channelId;
    await updateEditing((p) => {
      const g = (p.channelGroups || []).find((x) => x.id === groupId);
      if (!g) return;
      g.channelIds = g.channelIds || [];
      const idx = g.channelIds.indexOf(channelId);
      if (e.target.checked && idx < 0) g.channelIds.push(channelId);
      if (!e.target.checked && idx >= 0) g.channelIds.splice(idx, 1);
    });
  } else if (action === 'delete' && e.type === 'click') {
    const profile = await getProfile(editingProfileId);
    const g = (profile?.channelGroups || []).find((x) => x.id === groupId);
    if (!g || !confirm(`Delete group "${g.name}"?`)) return;
    await updateEditing((p) => {
      p.channelGroups = (p.channelGroups || []).filter((x) => x.id !== groupId);
    });
  }
}

// === Hidden videos section ===

async function renderHiddenVideos() {
  const skipList = document.getElementById('hidden-skip-list');
  const watchList = document.getElementById('hidden-watch-list');
  if (!skipList || !watchList) return;

  const [skipped, watched, videos] = await Promise.all([
    getAll(STORES.notInterested),
    getAll(STORES.watched),
    getAll(STORES.videos),
  ]);
  const videoMap = new Map(videos.map((v) => [v.videoId, v]));

  document.getElementById('hidden-skip-count').textContent = skipped.length;
  document.getElementById('hidden-watch-count').textContent = watched.length;

  skipList.innerHTML = renderHiddenList(skipped, videoMap, 'skippedAt', 'unskip')
    || '<li class="chip-empty">Nothing hidden.</li>';
  watchList.innerHTML = renderHiddenList(watched, videoMap, 'watchedAt', 'unwatch')
    || '<li class="chip-empty">Nothing here yet.</li>';
}

function renderHiddenList(rows, videoMap, dateKey, action) {
  if (rows.length === 0) return '';
  const sorted = rows.slice().sort((a, b) => (b[dateKey] || 0) - (a[dateKey] || 0));
  return sorted
    .map((row) => {
      const v = videoMap.get(row.videoId);
      const title = v?.title || `[metadata gone — ${row.videoId}]`;
      const channel = v?.channelTitle || '';
      const buttonLabel = action === 'unskip' ? 'Un-hide' : 'Un-mark';
      return `
        <li class="hidden-row" data-video-id="${escapeAttr(row.videoId)}">
          <div class="hidden-info">
            <span class="hidden-title">${escapeHtml(title)}</span>
            ${channel ? `<span class="hidden-channel">${escapeHtml(channel)}</span>` : ''}
          </div>
          <button class="secondary" data-action="${action}" data-video-id="${escapeAttr(row.videoId)}">${buttonLabel}</button>
        </li>
      `;
    })
    .join('');
}

async function handleHiddenAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const videoId = btn.dataset.videoId;
  const action = btn.dataset.action;
  if (action === 'unskip') {
    await del(STORES.notInterested, videoId);
  } else if (action === 'unwatch') {
    await del(STORES.watched, videoId);
  } else {
    return;
  }
  await renderHiddenVideos();
  notify();
}

function cssEscape(s) {
  // Minimal CSS attribute selector escape for our group ids.
  return String(s).replace(/"/g, '\\"');
}

// === Drive backup section (Stage 7d) ===

async function refreshBackupStatus() {
  const statusEl = document.getElementById('backup-status');
  if (!statusEl) return;
  if (!getTokenCallback) {
    statusEl.textContent = 'Sign in required to use Drive backup.';
    setBackupButtonsEnabled(false);
    return;
  }
  statusEl.textContent = 'Checking Drive…';
  try {
    const token = await getTokenCallback();
    const info = await getBackupInfo(token);
    if (info.exists) {
      const when = new Date(info.modifiedTime).toLocaleString();
      const size = info.size != null ? ` · ${formatBytes(info.size)}` : '';
      statusEl.textContent = `Last backup: ${when}${size}`;
      document.getElementById('restore-now').disabled = false;
    } else {
      statusEl.textContent = 'No backup yet — click "Backup now" to create one.';
      document.getElementById('restore-now').disabled = true;
    }
    document.getElementById('backup-now').disabled = false;
  } catch (err) {
    statusEl.textContent = `Drive check failed: ${err.message}`;
    setBackupButtonsEnabled(false);
  }
}

async function handleBackupNow() {
  if (!getTokenCallback) return;
  const msgEl = document.getElementById('backup-message');
  setBackupButtonsEnabled(false);
  msgEl.textContent = 'Backing up…';
  msgEl.className = 'backup-message';
  try {
    const token = await getTokenCallback();
    const result = await backupNow(token);
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    msgEl.textContent = `Backed up · ${total} rows across ${Object.keys(result.counts).length} stores`;
    msgEl.className = 'backup-message ok';
    await refreshBackupStatus();
  } catch (err) {
    msgEl.textContent = `Backup failed: ${err.message}`;
    msgEl.className = 'backup-message error';
  } finally {
    setBackupButtonsEnabled(true);
  }
}

async function handleRestore() {
  if (!getTokenCallback) return;
  if (!confirm('Restore from Drive? This will overwrite current profiles, watched, saved, and hidden videos with whatever is in the latest backup.')) return;
  const msgEl = document.getElementById('backup-message');
  setBackupButtonsEnabled(false);
  msgEl.textContent = 'Restoring…';
  msgEl.className = 'backup-message';
  try {
    const token = await getTokenCallback();
    const result = await restoreLatest(token);
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    msgEl.textContent = `Restored · ${total} rows · backup from ${new Date(result.exportedAt).toLocaleString()}`;
    msgEl.className = 'backup-message ok';
    // Re-render the drawer + feed so the restored data shows.
    editingProfileId = null;
    await renderAll();
    notify();
  } catch (err) {
    msgEl.textContent = `Restore failed: ${err.message}`;
    msgEl.className = 'backup-message error';
  } finally {
    setBackupButtonsEnabled(true);
  }
}

function setBackupButtonsEnabled(enabled) {
  const ids = ['backup-now', 'restore-now'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function bindKeywordEditor(listId, inputId, ruleKey) {
  const input = document.getElementById(inputId);
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const kw = input.value.trim();
    if (!kw) return;
    await updateEditing((p) => {
      const arr = p.rules[ruleKey] || [];
      if (!arr.includes(kw)) arr.push(kw);
      p.rules[ruleKey] = arr;
    });
    input.value = '';
  });
  // Removal is delegated from the list container.
  document.getElementById(listId).addEventListener('click', async (e) => {
    const btn = e.target.closest('.chip-x');
    if (!btn) return;
    const kw = btn.dataset.kw;
    await updateEditing((p) => {
      p.rules[ruleKey] = (p.rules[ruleKey] || []).filter((k) => k !== kw);
    });
  });
}

function renderKeywordList(listId, keywords, ruleKey) {
  const list = document.getElementById(listId);
  if (!keywords || keywords.length === 0) {
    list.innerHTML = '<span class="chip-empty">None</span>';
    return;
  }
  list.innerHTML = keywords
    .map(
      (kw) => `<span class="chip">${escapeHtml(kw)}<button class="chip-x" data-kw="${escapeAttr(kw)}" aria-label="Remove">×</button></span>`
    )
    .join('');
}

function bindNumberInput(id, mutator) {
  document.getElementById(id).addEventListener('change', async (e) => {
    const v = parseInt(e.target.value, 10) || 0;
    await updateEditing((p) => mutator(p, v));
  });
}

function bindCheckbox(id, mutator) {
  document.getElementById(id).addEventListener('change', async (e) => {
    await updateEditing((p) => mutator(p, e.target.checked));
  });
}

function bindSlider(id, mutator) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    updateValueDisplay(id, v);
  });
  el.addEventListener('change', async () => {
    const v = parseFloat(el.value);
    await updateEditing((p) => mutator(p, v));
  });
}

function setSlider(id, value) {
  const el = document.getElementById(id);
  el.value = value ?? 0;
  updateValueDisplay(id, parseFloat(el.value));
}

function updateValueDisplay(id, value) {
  const display = document.querySelector(`[data-value-for="${id}"]`);
  if (display) display.textContent = value.toFixed(2);
}

async function updateEditing(mutator) {
  const profile = await getProfile(editingProfileId);
  if (!profile) return;
  mutator(profile);
  await put(STORES.profiles, profile);
  await renderEditingProfile();
  await renderProfileSelect();
  notify();
}

async function setActive(profileId) {
  const profiles = await getAll(STORES.profiles);
  for (const p of profiles) {
    const next = { ...p, isActive: p.profileId === profileId };
    await put(STORES.profiles, next);
  }
  await renderAll();
  notify();
}

async function getProfile(profileId) {
  if (!profileId) return null;
  const profiles = await getAll(STORES.profiles);
  return profiles.find((p) => p.profileId === profileId) || null;
}

function notify() {
  if (typeof onChangeCallback === 'function') {
    Promise.resolve(onChangeCallback()).catch((err) =>
      console.error('Settings onChange callback failed', err)
    );
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s);
}
