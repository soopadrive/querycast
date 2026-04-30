# QueryCast — Project Context

A user-controlled YouTube subscription-feed curation PWA. Built on YouTube's official APIs (read-only). No algorithm, no machine learning — every score is a deterministic linear combination of weighted signals visible to the user.

> Mental model: "Gmail or RSS reader for YouTube subscriptions" — not a YouTube alternative. The product replaces *discovery*, not playback.

## Stack

- Vanilla JS (ES2020+, ES modules), no frameworks, no build tools
- PWA via hand-written `manifest.json` + `service-worker.js` (no Workbox)
- Vercel static hosting + 1 minimal serverless function (added in Stage 3)
- IndexedDB for local persistence (native API only — no idb/Dexie)
- Google Identity Services for auth (NOT PKCE — see ADR-001)
- YouTube IFrame Player API for ToS-compliant playback

**Hard prohibitions** (see plan's Stack Lock section): no React/Vue/TypeScript/Tailwind, no bundlers, no npm dependencies anywhere, no video file caching, no autoplay-on-hover, no telemetry to a server, no ML.

## File structure

```
querycast/
├── index.html              # App shell
├── manifest.json           # PWA metadata
├── service-worker.js       # Hand-written SW
├── style.css               # All styles
├── privacy.html            # Test-mode privacy policy
├── vercel.json             # Routing + CORS headers
├── .gitattributes          # eol=lf to prevent CRLF on WSL/Windows
├── icon-192.png            # PWA icon (placeholder)
├── icon-512.png            # PWA icon (placeholder)
├── favicon-32.png          # Browser tab favicon
├── js/
│   ├── main.js             # Entry point — boot sequence
│   ├── config.js           # OAuth client ID, scopes, daily quota cap, DB version
│   ├── defaults.js         # Default profile, store name constants
│   ├── storage.js          # IndexedDB wrapper (8 stores, multi-tab safe)
│   └── inapp-browser-gate.js  # UA detection + interstitial for blocked browsers
└── api/
    └── (Stage 3 adds rss-proxy.js)
```

## Plan + ADRs

The full implementation plan, decisions, and mockups live in:

- `~/plans/querycast.html` — v3 plan (post-pre-mortem, post-ADR-007)
- `~/plans/querycast-final-design.html` — locked Stage 7 design mockup
- `~/plans/querycast-ui-mockups.html` — exploratory layout/preview/playback options
- `~/plans/decisions/querycast/` — seven ADRs + privacy draft + sunset criteria

**Reading order:** ADR-005 (name + domain) → ADR-001 (auth) → ADR-003 (persistence) → ADR-007 (controls) → ADR-006 (UI) → ADR-004 + ADR-002 (framing).

## Running locally

```bash
cd /mnt/c/Users/kc311/querycast
vercel dev   # http://localhost:3000
```

`vercel dev` serves static files + any `api/*.js` functions as serverless. Service worker registers on first load; check DevTools → Application → Service Workers to verify.

## Deployment

After committing:

```bash
git push origin main   # Triggers Vercel auto-deploy if connected
```

If using `vercel` CLI directly:
```bash
vercel              # Deploy to preview URL
vercel --prod       # Deploy to production .vercel.app subdomain
```

## Stages

Per the v3 plan:

- **Stage 0 (✅ done):** decisions + non-dev prep — ADRs, name (QueryCast), TESS verification, domain decision (deferred), privacy draft, sunset criteria, icons
- **Stage 1 (current):** scaffold + PWA + IndexedDB contract
- **Stage 2:** GIS auth + browser matrix gate (HARD GATE — must pass on Chrome/Firefox-strict-ETP/Safari-iOS/Gmail-iOS-link before Stage 3)
- **Stage 3:** minimal RSS proxy
- **Stage 4:** subscriptions + first feed render
- **Stage 5:** metadata + tombstones + client quota cap
- **Stage 6:** filter + ranking engine (channel groups, pins, sweet spot)
- **Stage 7:** UI per ADR-006 + per-video actions + saved view + profile switcher
- **Stage 8:** settings (profiles, channel groups, hidden videos) + Drive backup
- **Stage 9:** soft launch + kill criterion check

## Gotchas

(Add new ones here as discovered. See plan's Risk Register for pre-identified items.)

- **WSL2 + Windows line endings.** `.gitattributes` enforces `eol=lf`. If you see Vercel emitting malformed HTTP headers, check `vercel.json` for CRLF.
- **PKCE is impossible.** Google does not issue refresh tokens to public clients. Use Google Identity Services (`tokenClient`) with hidden-iframe silent reauth + popup fallback. See ADR-001.
- **In-app browsers silently break OAuth.** Detect Instagram/Gmail-iOS/Reddit/etc. via UA and show an interstitial before any OAuth attempt. See `js/inapp-browser-gate.js` and ADR-001.
- **`videos.list` silently drops region-locked / deleted / private items.** Tombstone every requested-but-not-returned ID with a 7-day TTL or you'll re-fetch the same missing IDs forever. See ADR-003.
- **IndexedDB schema bump hangs without `onblocked` and `onversionchange` handlers.** Already wired in `js/storage.js`. Test by opening two tabs and bumping `DB_VERSION` — neither should hang.
- **Service worker caches stale builds.** `CACHE_NAME` includes a version stamp; bump it on every shipped change to schema, JS modules, or the shell.
- **`crypto.subtle` requires HTTPS or localhost.** Local dev via `vercel dev` on `localhost:3000` works; testing on a WSL IP does not.
- **Safari ITP wipes IndexedDB after 7 days no first-party interaction.** Drive `appdata` backup is the recovery path (Stage 8).
- **Some videos disable embedding.** IFrame Player throws `onError` 101/150 — show "Open on youtube.com" fallback.

## Sunset criteria

Documented at `~/plans/decisions/querycast/sunset-criteria.md`. Short version: shut down rather than absorb open-ended ops if quota issues recur monthly, scope is reclassified to restricted, RSS feeds are deprecated, app goes 30 consecutive days without an open, or Vercel free-tier limits are exceeded.
