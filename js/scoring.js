// Pure filter + scoring functions per ADR-007.
// No IndexedDB or DOM access — caller threads in the active profile.

import { PIN_BOOST } from './defaults.js';

const PODCAST_THRESHOLD_SECS = 2 * 60 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ageInDays(iso) {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms / MS_PER_DAY);
}

export function passesFilters(video, profile) {
  const r = profile?.rules;
  if (!r) return true;

  const title = (video.title || '').toLowerCase();
  const description = (video.description || '').toLowerCase();
  const text = `${title} ${description}`;

  if (r.keywordsBlock?.length) {
    for (const kw of r.keywordsBlock) {
      if (kw && text.includes(kw.toLowerCase())) return false;
    }
  }

  if (r.keywordsRequire?.length) {
    let matched = false;
    for (const kw of r.keywordsRequire) {
      if (kw && text.includes(kw.toLowerCase())) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }

  const duration = video.duration || 0;
  if (r.durationMin && duration < r.durationMin) return false;
  if (r.durationMax && duration > r.durationMax) return false;

  if (r.ageMaxDays) {
    if (ageInDays(video.publishedAt) > r.ageMaxDays) return false;
  }

  if (r.viewsMin && (video.viewCount || 0) < r.viewsMin) return false;

  if (r.hideShorts && video.isShort) return false;
  if (r.hideLive && video.liveStatus && video.liveStatus !== 'none') return false;
  if (r.hidePodcasts && duration > PODCAST_THRESHOLD_SECS) return false;

  return true;
}

// Resolve a channel's effective weight from the profile.
//   1. Direct override channelOverrides[id]
//   2. Sum of group weights for groups containing channel
//   3. 0
export function resolveChannelWeight(channelId, profile) {
  if (!channelId || !profile) return 0;
  const overrides = profile.channelOverrides || {};
  if (Object.prototype.hasOwnProperty.call(overrides, channelId)) {
    return overrides[channelId] || 0;
  }
  let total = 0;
  for (const group of profile.channelGroups || []) {
    if (group.channelIds?.includes(channelId)) {
      total += group.weight || 0;
    }
  }
  return total;
}

export function isChannelPinned(channelId, profile) {
  if (!channelId || !profile) return false;
  return (profile.channelPins || []).includes(channelId);
}

// Score a video per ADR-007:
//   recency  = clamp(1 - ageDays / ageMaxDays, 0, 1)
//   velocity = log10(views / ageDays + 1) / 6
//   lengthFit = exp(-0.5 * ((duration - center) / width)^2)
//   score = w_recency*recency + w_velocity*velocity + w_channel*channelWeight
//         + w_lengthFit*lengthFit + (pinned ? PIN_BOOST : 0)
export function scoreVideo(video, profile) {
  const w = profile?.weights || {};
  const r = profile?.rules || {};

  const ageDays = Math.max(0.01, ageInDays(video.publishedAt));
  const ageMaxDays = r.ageMaxDays || 30;
  const recency = clamp(1 - ageDays / ageMaxDays, 0, 1);

  const velocity = Math.log10((video.viewCount || 0) / ageDays + 1) / 6;

  const duration = video.duration || 0;
  const center = w.sweetSpotCenterSec || 900;
  const width = Math.max(1, w.sweetSpotWidthSec || 600);
  const lengthFit = Math.exp(-0.5 * Math.pow((duration - center) / width, 2));

  const channelWeight = resolveChannelWeight(video.channelId, profile);
  const pinBoost = isChannelPinned(video.channelId, profile) ? PIN_BOOST : 0;

  return (
    (w.recency || 0) * recency +
    (w.velocity || 0) * velocity +
    (w.channel || 0) * channelWeight +
    (w.lengthFit || 0) * lengthFit +
    pinBoost
  );
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
