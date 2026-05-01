# QueryCast — Project Context

A user-controlled YouTube subscription-feed curation **Windows desktop app** (Tauri 2.x). Built on YouTube's official APIs (read-only). No algorithm, no machine learning — every score is a deterministic linear combination of weighted signals visible to the user.

> Mental model: "Gmail or RSS reader for YouTube subscriptions" — not a YouTube alternative. The product replaces *discovery*, not playback.

## Stack

- **Front-end:** Vanilla JS (ES2020+, ES modules) + hand-written CSS. No frameworks, no build tools, no transpilation.
- **Shell:** Tauri 2.x (Rust). Renders the front-end inside Microsoft Edge WebView2.
- **Auth:** OAuth 2.0 PKCE auth code flow with refresh tokens (RFC 8252 native-app pattern). Localhost loopback redirect handled by the Rust shell.
- **Persistence:** IndexedDB (native API only — no idb/Dexie). Lives inside WebView2.
- **API:** YouTube Data API v3 (read-only) + Drive API (`appdata` scope for backups). Each user uses their own Google Cloud OAuth credentials (BYO model).
- **Playback:** YouTube IFrame Player API (the only ToS-compliant embed path).
- **Build target:** Windows x86_64 (`.msi` installer + portable `.exe`). macOS/Linux/iOS/Android out of scope for v1.

**Hard prohibitions** (see plan's Stack Lock section): no React/Vue/TypeScript/Tailwind, no bundlers, no front-end npm dependencies, no shared OAuth client, no public hosting, no video file caching, no autoplay-on-hover, no telemetry to a server, no ML.

## File structure

```
querycast/
├── index.html              # App shell, loaded by WebView2
├── preview.html            # Static preview entry (Stage 7a) — opens in any browser via local HTTP
├── style.css               # All front-end styles
├── favicon-32.png          # Browser tab favicon (also used as window icon)
├── icon-192.png            # Source icon
├── icon-512.png            # Source icon (used to derive Tauri icons)
├── js/
│   ├── main.js             # Entry — boot → openDb → check creds → setup or main
│   ├── config.js           # Scopes, OAuth endpoints, daily quota cap, DB version
│   ├── defaults.js         # Default profile, store-name constants, pin boost
│   ├── storage.js          # IndexedDB wrapper (9 stores, multi-tab safe)
│   ├── setup-screen.js     # First-run BYO credentials entry
│   ├── auth.js             # PKCE flow, token refresh
│   ├── youtube-api.js      # subs (paginated) + videos.list (batched 50)
│   ├── rss-fetcher.js      # invoke fetch_rss + parse Atom feed
│   ├── concurrency.js      # promise queue, RSS_CONCURRENCY=3
│   ├── feed.js             # refreshFeed + getRenderableFeed (filter + score + sort)
│   ├── quota.js            # daily usage tracker, 200u/day cap
│   ├── scoring.js          # pure filter + score functions (Stage 5, ADR-007)
│   ├── player.js           # YouTube IFrame Player modal (Stage 6b)
│   ├── video-actions.js    # mark watched / save / not-interested + undo helpers
│   ├── settings-drawer.js  # Settings drawer (Stage 7b–d) — profile CRUD + filters + weights + channels + groups + hidden + Drive backup
│   ├── drive-backup.js     # Drive appdata JSON backup (Stage 7d)
│   ├── theme.js            # Light/dark theme toggle + persistence (Stage 8a)
│   └── preview/            # Static preview stubs (Stage 7a) — same exports as production peers
│       ├── mock-data.js          # deterministic 15-video seed, default profile w/ pin + suppressed channel
│       ├── storage-stub.js       # in-memory IDB replacement
│       ├── auth-stub.js          # always-signed-in
│       ├── player-stub.js        # mock modal player; auto-watched fires at 5s
│       ├── youtube-api-stub.js   # no-op (preview never refreshes)
│       ├── rss-fetcher-stub.js   # no-op
│       └── drive-backup-stub.js  # sessionStorage-backed fake Drive (Stage 7d)
└── src-tauri/
    ├── Cargo.toml          # Rust dependencies
    ├── tauri.conf.json     # Bundle config, window settings, icon list
    ├── build.rs            # Tauri build script
    ├── capabilities/
    │   └── default.json    # Permissions for shell-open + core APIs
    ├── icons/              # 32/128/256 PNG + multi-res .ico
    │   ├── 32x32.png
    │   ├── 128x128.png
    │   ├── 128x128@2x.png  # 256×256
    │   ├── icon.ico
    │   └── icon.png
    └── src/
        ├── main.rs         # Entry point — calls querycast_lib::run()
        ├── lib.rs          # Tauri builder + command registration
        └── auth.rs         # OAuth localhost loopback listener (~80 LOC)
```

## Plan + ADRs

The full implementation plan, decisions, and mockups live in:

- `~/plans/querycast.html` — v3 plan (post-Tauri-pivot, post-pre-mortem, post-ADR-007)
- `~/plans/querycast-final-design.html` — locked Stage 6 design mockup
- `~/plans/querycast-ui-mockups.html` — exploratory layout/preview/playback options
- `~/plans/decisions/querycast/` — seven ADRs + sunset criteria

**Reading order:** ADR-005 (name) → ADR-001 (auth, native PKCE) → ADR-003 (persistence) → ADR-007 (controls) → ADR-006 (UI) → ADR-004 (Tauri distribution) → ADR-002 (verification N/A).

## Toolchain prerequisites

Install once, before any `cargo tauri dev` or build:

1. **Rust** (stable, ≥1.77): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` (Linux/macOS) or [winget install Rustlang.Rustup](https://winget.run/pkg/Rustlang/Rustup) (Windows). Restart shell after install.
2. **Tauri CLI**: `cargo install tauri-cli --version "^2"`
3. **WebView2 runtime**: pre-installed on Windows 11. Windows 10 users: Tauri's bundled Evergreen Bootstrapper auto-downloads on first install of the `.msi`.
4. **Build prerequisites for Windows builds**: Visual Studio Build Tools 2022 (C++ toolchain). On WSL, only `cargo tauri dev` works — Windows installer builds (`cargo tauri build`) need to run from a Windows terminal.

## Running locally

From a Windows terminal (PowerShell or cmd) inside the project directory:

```bash
cargo tauri dev      # development run with hot reload of the JS front-end
cargo tauri build    # produces src-tauri/target/release/bundle/msi/QueryCast_0.1.0_x64_en-US.msi + portable .exe
```

From WSL: `cargo tauri dev` works (with WSLg for the GUI) but `cargo tauri build` should be run from Windows for clean Windows binaries.

## Static preview (Stage 7a)

`preview.html` renders the full UI in a regular browser without Tauri or IndexedDB — for fast iteration on layout/hover/modal/action UX. Every external dependency is swapped with a stub via an HTML import map, and a deterministic mock data set is seeded at load time.

```bash
# From the project directory:
python -m http.server 8765
# Then open http://localhost:8765/preview.html
```

The viewport toggle in the top bar simulates wide / narrow widths (1280, 1000, 880, 720) for breakpoint testing — the layout collapses to inbox rows below 900px. The mock player auto-fires "watched" at 5 seconds (vs 30 in production) so the auto-watch + undo flow is verifiable without a long wait.

**When to use it:** after every CSS / template change, before declaring UI work done. Stage 6a's `overflow: hidden` clip bug and the sibling-card stacking bug both shipped because there was no preview path; the fix is structural.

**State:** seeded fresh on every page load. Reload to reset. State is in-memory only — no IDB persistence.

## Stages

Per the v3 plan (Tauri pivot):

- **Stage 0 (✅ done):** decisions + ADRs + name (QueryCast TESS-clean) + sunset criteria + icons
- **Stage 1 (✅ done):** Tauri scaffold + BYO setup screen + IndexedDB contract
- **Stage 2 (✅ done):** PKCE auth flow via localhost loopback. Token persistence + refresh.
- **Stage 3 (✅ done):** Subscriptions + direct RSS fetch + first feed render (no proxy needed; WebView2 fetches RSS directly)
- **Stage 4 (✅ done):** Metadata enrichment + tombstones + client quota cap (200 units/day)
- **Stage 5 (✅ done):** Filter + ranking engine (`js/scoring.js` — hard filters, channel-weight resolution, Gaussian length-fit, pin boost). `getRenderableFeed()` sorts by score; UI shows score pill + PINNED badge.
- **Stage 6 (✅ done):** UI per ADR-006 + per-video actions + Saved view + profile switcher.
  - **6a:** Hybrid layout (featured-row 2fr 1fr 1fr + 3-col grid), rank badges (#1 purple, rest blue), hover info card with score breakdown (per-signal contributions; negative channel in orange). Narrow viewport (<900px) collapses to inbox rows.
  - **6b:** Modal IFrame Player (`js/player.js` — loads `https://www.youtube.com/iframe_api`, mounts `YT.Player`, focus trap, Esc/click-outside/✕ close, body scroll lock). Auto-marks watched after 30s of accumulated PLAYING state. `onError` 101/150 surfaces an "Open on youtube.com" fallback that defers to `open_url`. Per-video actions in info card (`js/video-actions.js` — watch/save/skip + undo helpers) with a 5s undo toast. Card click opens the modal instead of redirecting.
  - **6c:** Toolbar with Today / Saved nav tabs and a profile dropdown. `getSavedFeed()` joins `STORES.saved` against the videos cache, sorts by savedAt desc, drops the featured-row hierarchy in Saved view. Profile dropdown lists profiles from IDB with active marked; "Manage profiles…" is the Stage 7 hook.
- **Stage 7 (✅ done):** Settings UI + Drive backup, sliced into 7a/7b/7c/7d. (Plus a "See less" interlude after 7c — see below.)
  - **7a (✅ done):** Static preview path — `preview.html` + `js/preview/*` stubs (storage, auth, player, youtube-api, rss-fetcher) + deterministic `mock-data.js`. Uses an HTML import map to redirect production module URLs to stubs at load time, so `main.js` runs unmodified. Includes a viewport toggle (1280/1000/880/720) for testing the 900px narrow-layout breakpoint without resizing the window.
  - **7b (✅ done):** Settings drawer chassis (`js/settings-drawer.js` + drawer markup + CSS slide-in panel) hosting three collapsible sections in v1: Profile (rename, add, duplicate, delete, set-active), Discovery filters (block/require keyword chip editors, duration/age/views numeric inputs, hide-shorts/live/podcasts toggles), Scoring weights (4 sliders 0–1 with live value display, sweet-spot center/width inputs, Reset to defaults). Drawer trigger: ⚙ button in toolbar + the now-enabled "Manage profiles…" entry (jumps directly to the profile section). Every input writes to IDB on change, then notifies main.js to re-render the feed + profile dropdown.
  - **7c (✅ done):** Three more drawer sections: **Channels** (alphabetical list of subscribed channels with pin-toggle ★ and per-channel weight override input from -2 to +2; live filter search), **Channel groups** (collapsible group cards each with name, weight slider -2..+2, member checkboxes against the full channel list; +New / Delete buttons), **Hidden videos** (separate lists for "Hidden by you" / "Already watched" with per-row Un-hide / Un-mark buttons, count pills in section headers). Channel list source: `STORES.subscriptions` first, falls back to deriving from `STORES.videos`. Override removal: leave the weight input blank to fall back to group sums.
  - **"See less from this channel" interlude (✅ done, between 7c and 7d):** The 5s undo toast on `✕ Hide` now carries an optional secondary purple button reading "See less from \[channel]". Click it → subtract 0.5 from the channel's *resolved* weight (`resolveChannelWeight` from scoring.js), clamp to [-2, +2], write to `profile.channelOverrides[channelId]`. The undo callback reverts both the hide AND the weight change atomically (capturing the prior override state in a closure). One-shot per hide — secondary button auto-hides after the first click so weight can't compound on the same hide.
  - **7d (✅ done):** Drive `appdata` backup (`js/drive-backup.js`). Single file `querycast-backup.json` in the per-app `appDataFolder` — created on first backup, replaced via Drive multipart `PATCH` on subsequent backups. Backs up `profiles + watched + saved + not_interested` (no videos, subscriptions, quota, or credentials). Restore wipes target stores then writes from the backup; refuses on schema mismatch. UI is the seventh drawer section: blurb + last-backup status row + Backup-now / Restore buttons + ok/error message. Preview path uses `js/preview/drive-backup-stub.js` (sessionStorage-backed) so the button states + status messages can be exercised without real Drive auth.

- **Stage 8 (in progress — Polish + branding), sliced into 8a/8b/8c (+ optional 8d):**
  - **8a (✅ done):** Theme system + toggle. Two themes (`dark` default, `light`) applied via `[data-theme]` on `<html>`. Hardcoded shadow / chip-tint / backdrop colors promoted to CSS variables (`--shadow-pop`, `--shadow-modal`, `--shadow-drawer`, `--drawer-backdrop`, `--badge-{orange,red,blue,purple}-bg`, `--pin-active-bg`, `--danger-hover-bg`, `--secondary-hover-bg`) so light theme can override them in one block. Light palette borrowed from GitHub's light tokens (proven contrast). Persistence via `localStorage` (UI preference, not user data). Inline pre-stylesheet `<script>` in `<head>` of both index.html and preview.html applies the persisted theme synchronously so there's no flash-of-wrong-theme on cold load. Toolbar gains a sun/moon button next to ⚙. Modal player overlay + thumbnail-badge overlays + video-player background stay dark in both themes — they're "media chrome", not theme-dependent.
  - **8b (✅ done):** Transition timing tokens (`--t-base: 0.15s`, `--t-slow: 0.22s`) replace 19 scattered hardcoded values across the file. Logo gains a theme-aware blue→purple gradient via `background-clip: text` — the diamond is `--blue`, the wordmark transitions to `--purple` at 135°. Both stops resolve from theme tokens so the gradient adapts automatically when toggling. (Welcome heading kept as solid `--blue` — repeating the gradient everywhere would feel busy.)
  - **8c:** Accessibility + copy — keyboard nav audit (focus traps, tab order), ARIA labels, contrast verification on both themes, empty-state + status copy review.
  - **(optional) 8d:** First-run onboarding after BYO setup. Likely deferrable to v1.1.
- **Stage 9 (was Stage 8) — Soft launch + kill criterion check:** invite testers, daily journal, kill criterion check.
- **Stage 7:** Settings UI (profiles, channel groups, hidden videos) + Drive backup
- **Stage 8:** Soft launch + kill criterion check

## Gotchas

(Add new ones here as discovered. See plan's Risk Register for pre-identified items.)

- **Native PKCE returns refresh tokens; browser PKCE does not.** Google issues refresh tokens to "Desktop app" OAuth Client IDs but not to "Web app" public PKCE clients. This is why the auth model fundamentally differs from the original PWA plan (ADR-001).
- **BYO credentials, not shared.** Each user creates their own Google Cloud project + OAuth Client ID. Setup screen enforces this. Never embed a shared Client ID in the binary.
- **WSL2 + Windows line endings.** `.gitattributes` enforces `eol=lf`. Tauri build picks up source files via Cargo, so CRLF in `.toml` or `.json` would break.
- **`videos.list` silently drops region-locked / deleted / private items.** Tombstone every requested-but-not-returned ID with a 7-day TTL. See ADR-003.
- **IndexedDB schema bump hangs without `onblocked`/`onversionchange` handlers.** Already wired in `js/storage.js`. Tauri typically opens one window so multi-tab race is rare, but the handlers exist for defense in depth.
- **OAuth localhost listener port conflicts.** The Rust shell binds to `127.0.0.1:0` (OS-assigned random port). If a port has been taken between bind and browser redirect, the redirect fails. Mitigation: short window between port assignment and redirect; rebind on failure.
- **Refresh token revocation.** If the user revokes access in Google account settings, the next refresh attempt returns `invalid_grant`. Detect and route back to sign-in.
- **WebView2 not pre-installed on older Windows 10.** Tauri's `webviewInstallMode: downloadBootstrapper` handles this — first-run downloads ~120MB. Document this in README.
- **Some videos disable embedding.** IFrame Player throws `onError` 101/150 — show "Open on youtube.com" fallback.
- **DevTools in production WebView2.** Disabled by default in release builds. Use `cargo tauri dev` for inspection.
- **YouTube IFrame API is loaded dynamically (Stage 6b).** First call to `loadIframeApi()` injects `<script src="https://www.youtube.com/iframe_api">`; subsequent calls await the same promise. CSP is null in `tauri.conf.json` so this isn't blocked. If the script fails (offline), the promise rejects and `apiReadyPromise` is reset so a future open can retry.
- **Auto-watched timer is *accumulated* PLAYING time, not wall-clock.** Pause/seek cycles preserve the count; the 30s threshold fires once per modal open.

## Sunset criteria

Documented at `~/plans/decisions/querycast/sunset-criteria.md`. Short version: shut down rather than absorb open-ended ops if Google reclassifies `youtube.readonly` to require CASA assessment, RSS feeds are deprecated, IFrame Player is discontinued, Tauri 2.x is abandoned, app goes 30 consecutive days without an open, or maintenance burden exceeds 2h/month sustained.
