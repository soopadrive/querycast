// Defaults seeded into IndexedDB on first run.
// Anti-clickbait skew per ADR-007 — favors recent, mid-length, channel-trusted content.

export const DEFAULT_PROFILE = {
  profileId: 'default',
  name: 'Default',
  isActive: true,
  rules: {
    keywordsBlock: ['MUST WATCH', '!!!!', 'YOU WONT BELIEVE', 'GONE WRONG'],
    keywordsRequire: [],
    durationMin: 0,
    durationMax: 7200,
    ageMaxDays: 30,
    viewsMin: 0,
    hideShorts: true,
    hideLive: true,
    hidePodcasts: false,
  },
  weights: {
    recency: 0.4,
    velocity: 0.3,
    channel: 0.2,
    lengthFit: 0.1,
    sweetSpotCenterSec: 900,
    sweetSpotWidthSec: 600,
  },
  channelOverrides: {},
  channelGroups: [],
  channelPins: [],
};

// Pin-channel score boost added on top of normal scoring. ADR-007.
export const PIN_BOOST = 1.0;

// IndexedDB store names — single source of truth.
export const STORES = {
  videos: 'videos',
  subscriptions: 'subscriptions',
  tombstones: 'tombstones',
  quota: 'quota',
  profiles: 'profiles',
  watched: 'watched',
  saved: 'saved',
  notInterested: 'not_interested',
  credentials: 'credentials',
};
