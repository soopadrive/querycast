// Deterministic mock data for the static preview path. Designed to
// exercise the full rendering surface: long titles, missing fields,
// shorts, lives, pinned channels, suppressed channels, varied ages,
// varied view counts, edge-case durations.

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function isoAgo(ms) {
  return new Date(NOW - ms).toISOString();
}

function makeThumbDataUrl(hue) {
  // Lightweight inline SVG so the preview renders without network — real
  // YouTube thumbs require fetching i.ytimg.com which we want to avoid
  // here. Each card gets a different hue so the grid is visually distinct.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 70%, 35%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 60) % 360}, 70%, 25%)"/>
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#g)"/>
    <text x="160" y="100" font-family="monospace" font-size="48" fill="rgba(255,255,255,0.4)" text-anchor="middle">▶</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const MOCK_VIDEOS = [
  {
    videoId: 'mock-001',
    title: 'How I Built a Self-Hosted Smart Home in 6 Months — Full Walkthrough',
    description: 'Long-form documentation of moving the entire home off cloud services to a self-hosted Home Assistant + Frigate stack. Includes hardware list, network segmentation, and the failure modes I hit along the way. Source code and homelab diagrams in the description.',
    channelId: 'UC_tinkerer',
    channelTitle: 'Tech Tinkerer',
    publishedAt: isoAgo(2 * DAY),
    duration: 1394, // 23:14
    viewCount: 342_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(220),
  },
  {
    videoId: 'mock-002',
    title: 'The Forgotten Math That Built Modern Cryptography',
    description: 'Long-form deep-dive into the lattice math that ended up underpinning post-quantum crypto. Includes interview footage with three of the original researchers and a walkthrough of NIST\'s selection process.',
    channelId: 'UC_numberphile',
    channelTitle: 'Numberphile Plus',
    publishedAt: isoAgo(7 * DAY),
    duration: 2843, // 47:23
    viewCount: 1_200_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(280),
  },
  {
    videoId: 'mock-003',
    title: 'Why Every Codebase Eventually Becomes a Mess',
    description: 'Argues that codebase entropy is a structural property of organizations, not a developer skill issue. Examples from FAANG case studies and a refreshingly honest discussion of how technical debt actually accumulates.',
    channelId: 'UC_swreality',
    channelTitle: 'Software Reality',
    publishedAt: isoAgo(3 * DAY),
    duration: 1125,
    viewCount: 234_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(180),
  },
  {
    videoId: 'mock-004',
    title: '10 Productivity Apps That Actually Made Me LESS Productive',
    description: 'Critique of the productivity-app industrial complex. Specific examples of tools that added more friction than they removed. Spoiler: half of them are notes apps.',
    channelId: 'UC_workflow',
    channelTitle: 'Workflow Critic',
    publishedAt: isoAgo(0.2 * DAY), // ~5 hours
    duration: 753,
    viewCount: 78_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(20),
  },
  {
    videoId: 'mock-005',
    title: 'I Played Every Soulslike So You Don\'t Have To',
    description: 'Catalogued playthroughs of 23 soulslike games. Ranks by combat, exploration, and story. Tier list at 1:08 if you just want the verdict.',
    channelId: 'UC_gamedecoded',
    channelTitle: 'GameDecoded',
    publishedAt: isoAgo(5 * DAY),
    duration: 4462,
    viewCount: 892_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(340),
  },
  {
    videoId: 'mock-006',
    title: 'Why C is Still the Most Important Language',
    description: 'Argument from a compiler engineer about C\'s continued centrality even as Rust grows. Honest about C\'s failures.',
    channelId: 'UC_compiler',
    channelTitle: 'Compiler Notes',
    publishedAt: isoAgo(6 * DAY),
    duration: 1511,
    viewCount: 189_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(160),
  },
  {
    videoId: 'mock-007',
    title: 'Building a Custom Mechanical Keyboard from Scratch',
    description: 'From PCB design through firmware to final keycap install. Includes the QMK config files and the rabbit hole of switch lubing.',
    channelId: 'UC_keys',
    channelTitle: 'Keys & Solder',
    publishedAt: isoAgo(8 * DAY),
    duration: 4097,
    viewCount: 445_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(120),
  },
  {
    videoId: 'mock-008',
    title: 'Restoring a 1972 Honda CB350 — Final Cut',
    description: 'Final cut of the 8-month restoration series. Walkaround, first start, and ride footage. Highlight reel of the rebuilds.',
    channelId: 'UC_garage',
    channelTitle: 'Garage Therapy',
    publishedAt: isoAgo(14 * DAY),
    duration: 1921,
    viewCount: 567_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(40),
  },
  {
    videoId: 'mock-009',
    title: 'Espresso Tasting: 12 Single-Origin Beans Ranked',
    description: 'Blind taste of 12 single-origin beans from a specialty roaster. Final ranking with tasting notes and a verdict on which is worth the price.',
    channelId: 'UC_cup',
    channelTitle: 'Cup & Crema',
    publishedAt: isoAgo(5 * DAY),
    duration: 2360,
    viewCount: 156_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(60),
  },
  {
    videoId: 'mock-010',
    title: 'A Quiet Tour of My Reading Nook',
    description: 'Slow-paced room tour. Books, lighting, plants. No music, ambient audio only.',
    channelId: 'UC_slow',
    channelTitle: 'Slow Living Channel',
    publishedAt: isoAgo(3 * DAY),
    duration: 895,
    viewCount: 23_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(300),
  },
  {
    videoId: 'mock-011',
    title: 'Linux Mint 22 in 60 Seconds',
    description: 'Whirlwind tour of what\'s new in Linux Mint 22.',
    channelId: 'UC_quicklinux',
    channelTitle: 'Quick Linux',
    publishedAt: isoAgo(1 * DAY),
    duration: 58,
    viewCount: 12_000,
    isShort: true, // tests hideShorts filter — should be filtered out by default profile
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(200),
  },
  {
    videoId: 'mock-012',
    title: 'GONE WRONG: I Tried Vibe Coding For A Week',
    description: 'Clickbait take on AI coding tools. Filtered low because of channel weight + keyword block.',
    channelId: 'UC_techhype',
    channelTitle: 'TechHype Daily',
    publishedAt: isoAgo(1 * DAY),
    duration: 522,
    viewCount: 2_300_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(0),
    // GONE WRONG is in the default keywordsBlock list — should be filtered
  },
  {
    videoId: 'mock-013',
    title: 'LIVE: Q&A — Smart Home Setup Help (Wednesdays at 5pm)',
    description: 'Recurring Q&A stream for smart home questions.',
    channelId: 'UC_tinkerer',
    channelTitle: 'Tech Tinkerer',
    publishedAt: isoAgo(0.05 * DAY),
    duration: 0,
    viewCount: 220,
    isShort: false,
    liveStatus: 'live', // tests hideLive filter
    thumbnailUrl: makeThumbDataUrl(140),
  },
  {
    videoId: 'mock-014',
    title: 'Backyard Greenhouse Tour — Spring Update',
    description: 'Quick tour of what\'s growing this season.',
    channelId: 'UC_garden',
    channelTitle: 'Backyard Botany',
    publishedAt: isoAgo(11 * DAY),
    duration: 612,
    viewCount: 41_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(90),
  },
  {
    videoId: 'mock-015',
    title: 'Ambient Music for Deep Focus — 1 Hour',
    description: 'Slowly-evolving ambient piece designed for sustained concentration.',
    channelId: 'UC_ambient',
    channelTitle: 'Drift Sessions',
    publishedAt: isoAgo(20 * DAY),
    duration: 3604,
    viewCount: 89_000,
    isShort: false,
    liveStatus: 'none',
    thumbnailUrl: makeThumbDataUrl(260),
  },
];

// Pin Tech Tinkerer to demonstrate PIN_BOOST + PINNED badge.
// Suppress TechHype Daily so its score breakdown shows the orange
// "channel -1.50" treatment.
export const MOCK_PROFILE = {
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
  channelOverrides: {
    UC_techhype: -1.5,
    UC_swreality: 0.5,
  },
  channelGroups: [],
  channelPins: ['UC_tinkerer'],
};

export const MOCK_CREDS = {
  id: 'oauth',
  clientId: 'mock-client-id.apps.googleusercontent.com',
  clientSecret: 'mock-client-secret',
};

export const MOCK_TOKENS = {
  id: 'tokens',
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  expiresAt: NOW + 60 * 60 * 1000,
};

// Mock subscriptions cache — Stage 7c needs a known set of channels
// to populate the Channels section. Each row mirrors what
// fetchSubscriptions() would write.
export const MOCK_SUBSCRIPTIONS = [
  { channelId: 'UC_tinkerer',   title: 'Tech Tinkerer',         cachedAt: NOW },
  { channelId: 'UC_numberphile', title: 'Numberphile Plus',     cachedAt: NOW },
  { channelId: 'UC_swreality',  title: 'Software Reality',      cachedAt: NOW },
  { channelId: 'UC_workflow',   title: 'Workflow Critic',       cachedAt: NOW },
  { channelId: 'UC_gamedecoded', title: 'GameDecoded',          cachedAt: NOW },
  { channelId: 'UC_compiler',   title: 'Compiler Notes',        cachedAt: NOW },
  { channelId: 'UC_keys',       title: 'Keys & Solder',         cachedAt: NOW },
  { channelId: 'UC_garage',     title: 'Garage Therapy',        cachedAt: NOW },
  { channelId: 'UC_cup',        title: 'Cup & Crema',           cachedAt: NOW },
  { channelId: 'UC_slow',       title: 'Slow Living Channel',   cachedAt: NOW },
  { channelId: 'UC_techhype',   title: 'TechHype Daily',        cachedAt: NOW },
  { channelId: 'UC_garden',     title: 'Backyard Botany',       cachedAt: NOW },
  { channelId: 'UC_ambient',    title: 'Drift Sessions',        cachedAt: NOW },
  { channelId: 'UC_quicklinux', title: 'Quick Linux',           cachedAt: NOW },
];

// Pre-seed a few action states so the Hidden Videos section + the
// Saved tab have something to show on first load.
export const MOCK_NOT_INTERESTED = [
  { videoId: 'mock-014', skippedAt: NOW - 2 * 60 * 60 * 1000 },
];
export const MOCK_WATCHED = [
  { videoId: 'mock-008', watchedAt: NOW - 1 * 60 * 60 * 1000 },
];
export const MOCK_SAVED = [
  { videoId: 'mock-002', savedAt: NOW - 30 * 60 * 1000 },
];
