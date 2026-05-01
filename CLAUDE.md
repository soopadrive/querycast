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
│   └── scoring.js          # pure filter + score functions (Stage 5, ADR-007)
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

## Stages

Per the v3 plan (Tauri pivot):

- **Stage 0 (✅ done):** decisions + ADRs + name (QueryCast TESS-clean) + sunset criteria + icons
- **Stage 1 (✅ done):** Tauri scaffold + BYO setup screen + IndexedDB contract
- **Stage 2 (✅ done):** PKCE auth flow via localhost loopback. Token persistence + refresh.
- **Stage 3 (✅ done):** Subscriptions + direct RSS fetch + first feed render (no proxy needed; WebView2 fetches RSS directly)
- **Stage 4 (✅ done):** Metadata enrichment + tombstones + client quota cap (200 units/day)
- **Stage 5 (✅ done):** Filter + ranking engine (`js/scoring.js` — hard filters, channel-weight resolution, Gaussian length-fit, pin boost). `getRenderableFeed()` sorts by score; UI shows score pill + PINNED badge.
- **Stage 6 (in progress):** UI per ADR-006 + per-video actions + Saved view + profile switcher. Sliced into 6a/6b/6c.
  - **6a (✅ done):** Hybrid layout (featured-row 2fr 1fr 1fr + 3-col grid), rank badges (#1 purple, rest blue), hover info card with score breakdown (per-signal contributions; negative channel in orange). Narrow viewport (<900px) collapses to inbox rows. No behavior changes — click still opens YouTube.
  - **6b:** Modal IFrame Player + per-video actions + 5s undo banner.
  - **6c:** Saved view + profile switcher.
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

## Sunset criteria

Documented at `~/plans/decisions/querycast/sunset-criteria.md`. Short version: shut down rather than absorb open-ended ops if Google reclassifies `youtube.readonly` to require CASA assessment, RSS feeds are deprecated, IFrame Player is discontinued, Tauri 2.x is abandoned, app goes 30 consecutive days without an open, or maintenance burden exceeds 2h/month sustained.
