// Settings drawer (Stage 7b). Slides in from the right, hosts three
// collapsible sections in v1: Profile (CRUD), Discovery filters,
// Scoring weights. Every change writes to IDB immediately and notifies
// callers so the feed and the profile dropdown can re-render.
//
// Stage 7c will add: Channel groups, Pins / overrides, Hidden videos.
// Stage 7d will add: Drive backup.

import { STORES, DEFAULT_PROFILE } from './defaults.js';
import { getAll, put, del } from './storage.js';

let editingProfileId = null;
let onChangeCallback = null;

export function bindSettingsDrawer({ onChange } = {}) {
  onChangeCallback = onChange || null;

  document.getElementById('settings-btn')?.addEventListener('click', () => openDrawer());
  document.getElementById('settings-close')?.addEventListener('click', closeDrawer);

  document.getElementById('drawer-backdrop')?.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    const drawer = document.getElementById('settings-drawer');
    if (e.key === 'Escape' && drawer?.classList.contains('active')) closeDrawer();
  });

  // Section accordion toggles.
  document.querySelectorAll('.section-toggle').forEach((h) => {
    h.addEventListener('click', () => {
      const expanded = h.getAttribute('aria-expanded') === 'true';
      h.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      const body = h.nextElementSibling;
      if (body) body.hidden = expanded;
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
