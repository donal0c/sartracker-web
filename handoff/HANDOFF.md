# HANDOFF.md — Current Project State

> **Read this before doing ANY work. Update this after EVERY chunk of work.**

## Last Updated
2026-04-08 09:04 by Codex

## Current State
**Phase: Phase 1 build in progress — M1, M2, and M3 complete**

`HANDOFF.md` is the authoritative continuity log for active repo work across Donal, Codex, and Claude Code. Update it after every meaningful chunk so the next agent can resume without re-discovery.

## What's Been Done

### 2026-04-08 daily code hardening
- Reviewed the current renderer/runtime structure against the repo standards in `CLAUDE.md` and selected only low-risk hardening changes
- Extracted non-React startup orchestration out of `src/main.tsx` into `src/features/runtime/start-app-runtime.ts`
- Added `tests/unit/start-app-runtime.test.ts` so service worker startup and Tauri-only autosave startup are now locked by explicit tests instead of remaining implicit entrypoint behavior
- Extracted browser lifecycle access behind `src/features/persistence/mission-autosave-runtime.ts`
- Hardened `startMissionAutosave` so it can no-op safely when browser lifecycle globals are unavailable and so timer/listener cleanup is exercised directly in tests
- Expanded `tests/unit/tauri-mission-store.test.ts` to cover the full frontend mission-store adapter surface, including mission lifecycle and fetch methods that previously had no explicit command-contract coverage
- Verification completed:
  - `npm ci` ✅
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
- Skipped on purpose:
  - deeper refactoring of `src/features/map/use-map-controller.ts` because that area now touches live map lifecycle and event wiring, so a “cleaner” split would carry more regression risk than this hardening pass allows
  - broader mission-store type/module breakup because the current adapter is large but still straightforward; stronger contract coverage was the safer high-value move for now

### 2026-04-08 code quality hardening follow-up
- Tightened coordinate formatting safety in `src/lib/coordinates.ts`
- `formatWGS84Degrees` now validates latitude/longitude ranges instead of formatting impossible values
- Added regression coverage in `tests/unit/coordinates.test.ts` for invalid WGS84 formatting inputs
- Added JSDoc comments to the main exported map, persistence, runtime, and coordinate helpers so the repo better matches its documented code standard
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
- Note:
  - This improves standards compliance and closes one concrete coordinate-safety gap, but broader mission workflow readiness is still limited by incomplete higher-level features rather than code hygiene

### 2026-04-07 M1 scaffold implementation
- Scaffolded the app with Vite + React + TypeScript in the repo root and initialized `src-tauri/`
- Installed locked core dependencies: MapLibre, Turf, proj4, Terra Draw, Zustand, Tauri SQL plugin, Tailwind, Vitest, Playwright
- Configured Tailwind, Vite fixed dev port (`1420`), TypeScript strict mode, ESLint, Vitest, and Playwright
- Replaced the stock Vite demo with a minimal SAR Tracker shell using Zustand-backed scaffold state
- Added smoke coverage:
  - `tests/unit/scaffold-smoke.test.ts` for dependency resolution
  - `tests/e2e/scaffold.spec.ts` for app shell render
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `npm run test:all` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
- `npm run tauri dev` starts correctly, launches Vite, and begins native Rust compilation; I stopped it after confirming startup path to avoid leaving long-running watchers in the workspace
- Cleaned up generated metadata defaults:
  - Rust crate renamed from generic `app` to `sartracker-web`
  - Tauri bundle identifier set to `ie.kmrt.sartrackerweb`

### 2026-04-07 M2 map implementation
- Implemented MapLibre map rendering via raw `useRef` in `src/components/map-view.tsx`
- Added locked v1 basemap catalogue in `src/lib/map-config.ts`
- Added coordinate conversion/formatting module in `src/lib/coordinates.ts`
- Added basemap switcher, coordinate bar, and service worker registration
- Persisted selected basemap to `localStorage`
- Added service worker tile caching for cache-as-viewed offline resilience in `public/sw.js`
- Added focused map tests first:
  - `tests/unit/map-config.test.ts`
  - `tests/unit/coordinates.test.ts`
  - `tests/e2e/map.spec.ts`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `npm run test:all` ✅
- Note: browser tests show expected console noise when third-party ESRI tiles fail to fetch in test runs; the app still renders and the acceptance criteria pass

### 2026-04-07 M2 hardening follow-up
- Extracted basemap preference persistence into `src/lib/map-preferences.ts`
- Hardened basemap preference reads/writes against locked-down or unavailable `localStorage`
- Hardened service worker registration to warn instead of throwing on registration failure
- Added focused browser-environment tests:
  - `tests/unit/map-preferences.test.ts`
  - `tests/unit/register-service-worker.test.ts`
- Lazy-loaded the map shell from `src/App.tsx` so the app shell no longer eagerly pays the full MapLibre bundle cost
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
- Note: the main map chunk is still large because MapLibre, proj4, and map UI code are intentionally grouped there; this is better than bloating the initial shell bundle and can be revisited later if startup performance becomes an issue

### 2026-04-08 M2 observability hardening
- Added explicit map health state in `src/lib/map-health.ts`
- Added visible operator-facing map status badge in `src/components/map-status-badge.tsx`
- The map now reports:
  - loading while a basemap is being applied
  - ready once the map reaches idle
  - degraded if MapLibre surfaces tile/source errors
  - degraded if the WebGL context is lost
- Added `tests/unit/map-health.test.ts`
- Extended `tests/e2e/map.spec.ts` to assert the map health badge is present
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
- Note: ESRI tile fetch noise may still appear in some environments, but it is no longer silent from an operator perspective because degraded map state is now surfaced in the UI

### 2026-04-08 M2 architectural cleanup
- Extracted map lifecycle/orchestration out of the view layer into `src/features/map/use-map-controller.ts`
- Extracted MapLibre style construction and bounds into `src/features/map/map-style.ts`
- Simplified `src/components/map-view.tsx` so it is now primarily a presentational shell around the controller output
- Added `tests/unit/map-style.test.ts` to lock the raster-style and Kerry-bounds contract
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
- Architectural note: this reduces the risk that `map-view.tsx` becomes a long-lived “smart blob” as later map, tracking, and drawing features are added

### 2026-04-08 M2 bundle hardening
- Refactored Vite output chunking so the lazy-loaded map route no longer collapses app code, React runtime, proj4, and MapLibre into one giant artifact
- Added explicit manual chunk strategy in `build/vite-manual-chunks.ts` and wired it into `vite.config.ts`
- Current build output now separates:
  - app shell chunk
  - map view chunk
  - `react-vendor`
  - `geodesy-vendor`
  - `map-vendor`
- Added explicit bundle budget policy:
  - `build/bundle-budgets.js`
  - `scripts/check-bundle-size.mjs`
  - build now fails if chunks exceed policy rather than relying on a vague global warning
- Added tests:
  - `tests/unit/vite-manual-chunks.test.ts`
  - `tests/unit/bundle-budgets.test.ts`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
- Important note:
  - the remaining large JS asset is the isolated `map-vendor` chunk from `maplibre-gl` itself
  - this is now an intentional, budgeted dependency artifact rather than accidental bundle sprawl in app-owned code

### 2026-04-08 Bead readiness tightening for M4/M5/M6
- Tightened `CLAUDE.md` so future sessions explicitly enforce:
  - refactor-before-done discipline
  - ambiguity escalation instead of coding through contradictions
  - a stricter definition of done for safety-critical work
- Added readiness review comments to the next feature beads:
  - M4 (`sartracker-web-rbg`): close to ready, but still needs confirmation on production Traccar auth/session shape, offline/degraded operator UX, paused-mission polling semantics, and cache retention/file policy
  - M5 (`sartracker-web-4wh`): not ready until one lifecycle contradiction is resolved; bead currently conflicts with the implemented M3 persistence model on whether finished missions persist as real states or auto-collapse to idle
  - M6 (`sartracker-web-ahy`): mostly ready, but still needs explicit decisions on marker icon set, edit UI location, label display rule, canonical per-type fields, and whether subject categories are controlled values
- Current recommendation:
  - M4 can proceed after a short design pass and targeted product clarifications
  - M5 should not start until the lifecycle model is locked
  - M6 can proceed once the UI/product choices above are answered

### 2026-04-08 M3 persistence started — first slice
- Added a real backend persistence boundary in `src-tauri/src/persistence.rs`
- Mission store now initializes SQLite with:
  - WAL mode
  - foreign keys enabled
  - synchronous `NORMAL`
  - schema metadata table
  - initial `missions` + `mission_events` schema
- Added backend mission lifecycle commands:
  - `mission_store_info`
  - `create_mission`
  - `get_mission`
  - `list_missions`
  - `get_active_mission`
  - `get_recoverable_mission`
  - `pause_mission`
  - `resume_mission`
  - `finish_mission`
  - `sync_mission_store_backup`
- Added atomic backup sync via SQLite `VACUUM INTO` temp file + rename
- Added frontend Tauri adapter in `src/infrastructure/mission-store/tauri-mission-store.ts`
- Added tests:
  - frontend adapter unit test in `tests/unit/tauri-mission-store.test.ts`
  - backend Rust tests for schema init, mission creation/listing, lifecycle transitions, and atomic backup
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:all` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Important architectural note:
  - This slice keeps the live mission store behind Rust/Tauri commands.
  - The renderer only talks through the typed mission store adapter.
  - SQLite is the live working store; archive/export remains separate work.

### 2026-04-08 M3 persistence extended — devices and positions
- Extended the mission store schema with `devices` and `positions`
- Added backend commands and store operations for:
  - device upsert
  - device fetch/list
  - position insert
  - position list
  - latest position per device
- Added validation for invalid position coordinates before insert
- Device `last_seen` and `status` are now updated when positions are recorded
- Extended the frontend Tauri mission store adapter to expose device and position operations
- Added Rust coverage for:
  - device upsert
  - latest-position queries
  - coordinate validation failures
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:all` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Remaining M3 work:
  - drawings
  - fuller event coverage
  - autosave orchestration
  - archive/export implementation

### 2026-04-08 M3 persistence extended — markers
- Added marker persistence schema with shared/common fields plus type-specific columns
- Added backend commands and store operations for:
  - marker upsert
  - marker fetch/list
  - marker delete
- Marker payloads now support:
  - `ipp_lkp`
  - `clue`
  - `hazard`
  - `casualty`
- Added validation for invalid marker coordinates before insert/update
- Extended the frontend Tauri mission store adapter to expose marker operations
- Added Rust coverage for marker upsert, update ordering, listing, and delete
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:all` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Remaining M3 work:
  - drawings
  - fuller event coverage
  - autosave orchestration
  - archive/export implementation

### 2026-04-08 M3 persistence extended — drawings
- Added drawing persistence schema with generic/common fields suitable for the later drawing-tool bead
- Added backend commands and store operations for:
  - drawing upsert
  - drawing fetch/list
  - drawing delete
- Drawing payloads now support:
  - `line`
  - `search_area`
  - `range_ring`
  - `bearing_line`
  - `search_sector`
  - `text_label`
- Extended the frontend Tauri mission store adapter to expose drawing operations
- Added Rust coverage for drawing upsert, update ordering, listing, and delete
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:all` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Remaining M3 work:
  - fuller mission event coverage
  - autosave orchestration
  - archive/export implementation

### 2026-04-08 M3 persistence completed — autosave + archive/export
- Added frontend autosave orchestration in:
  - `src/features/persistence/autosave-config.ts`
  - `src/features/persistence/mission-autosave.ts`
  - `src/lib/tauri-runtime.ts`
  - `src/main.tsx` (runtime-gated autosave startup)
- Added frontend autosave coverage in:
  - `tests/unit/mission-autosave.test.ts`
- Extended mission store adapter with mission archive support:
  - `createMissionArchive(missionId)` in `src/infrastructure/mission-store/tauri-mission-store.ts`
  - command forwarding coverage in `tests/unit/tauri-mission-store.test.ts`
- Added backend archive/export implementation in `src-tauri/src/persistence.rs`:
  - archive model `MissionArchiveInfo`
  - `create_mission_archive` command/store method
  - archive constraints: only `finished`/`finalized` missions
  - archive contents: `manifest.json`, `mission.json`, `mission-store.sqlite`
  - sync backup before archive creation
  - atomic finalize via temp+rename
  - mission event append: `mission_archived`
- Exposed `create_mission_archive` through Tauri invoke handler in `src-tauri/src/lib.rs`
- Added backend archive coverage:
  - `creates_zip_archive_for_finished_mission`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- M3 status: complete for current bead scope (mission store, schema/versioning, immediate persistence paths, backup sync, autosave orchestration, crash-recovery query, archive/export path)

### 2026-04-08 M3 persistence hardening follow-up
- Hardened persistence auditability:
  - added typed `MissionEvent` records and `list_mission_events`
  - extended the Tauri mission store adapter to expose mission event listing
  - state-changing store operations now append audit events for:
    - device create/update
    - position record
    - marker create/update/delete
    - drawing create/update/delete
    - mission lifecycle transitions
    - backup sync for active/paused missions
    - archive creation
- Hardened archive integrity:
  - temporary archive ZIP is now re-opened and validated before final rename
  - validation confirms `manifest.json`, `mission.json`, and non-empty `mission-store.sqlite`
  - validation confirms manifest/payload mission IDs match the requested mission
- Hardened autosave behavior:
  - autosave still runs on the configured timer
  - autosave also attempts a backup sync when the page is hidden or on `pagehide`
  - overlap protection remains in place so timer/lifecycle triggers cannot run concurrent syncs
- Added/expanded tests:
  - Rust tests for mission event ordering and persistence mutation audit coverage
  - TypeScript tests for lifecycle-triggered autosave and overlap protection
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Remaining known non-M3 polish item:
  - Vite still warns about the large lazy-loaded map chunk; this is a performance concern, not a persistence correctness issue

### 2026-04-06 Doc cleanup
- Aligned `README.md`, `OVERVIEW.md`, and supporting docs with the post-spike reality
- Marked older WebSocket/planning notes as deferred or historical where they no longer describe the active v1 plan
- Clarified that mission persistence is SQLite in WAL mode behind a backend store exposed through Tauri commands
- Clarified that this handoff file is the shared continuity document between coding agents

### Spikes (all passed ✅)
| Spike | Tests | Key Files |
|-------|-------|-----------|
| S1: OSI Maps | 29 (23 vitest + 6 Playwright) | spikes/S1-osi-maps/ |
| S2: Irish Grid | 201 vitest | spikes/S2-irish-grid/src/coordinates.ts, geodesic.ts |
| S3: Drawing Tools | 53 (31 vitest + 22 Playwright) | spikes/S3-drawing-tools/src/lib/ |
| S4: Tauri Distribution | Research only | spikes/S4-tauri-distribution/RESULTS.md |
| S5: Persistence | 35 vitest | spikes/S5-persistence/src/mission-store.ts |
| S6: Layer Architecture | 3 HTML prototypes | spikes/S6-layer-architecture/ |
| S7: Traccar Integration | 23 vitest | spikes/S7-traccar-integration/src/traccar-client.ts |

### Architecture Decisions Made
- Hybrid layer approach (3 sources, ~15 layers, filter-based toggling)
- SQLite WAL for persistence (not JSON)
- HTTP polling for Traccar v1 (not WebSocket)
- No code signing for v1 (team is Windows + Linux)
- proj4js with TOWGS84 for coordinates (NTv2 not needed)
- Strict TDD for all production code

### Waiting On
- **Eamonn:** KMRT_package.gpkg file (1.25GB GeoPackage with OSI Discovery maps)
- **Eamonn:** Traccar admin credentials for API testing (kmrtsar.ddns.net:8082)

## What's Next
1. **Continue M3** — implement autosave orchestration and finalize archive/export boundaries
2. **Keep the MissionStore boundary strict** — renderer should not accumulate raw SQL access
3. **Decide/archive implementation boundary explicitly** — live SQLite is now established; archive/export still needs its final concrete format implementation
4. **Make an explicit v1 magnetic declination decision** before implementing magnetic-bearing behaviour in later drawing work
5. **When GeoPackage arrives:** run the conversion pipeline, test in MapLibre

## Active Beads
```
bd list
```

## Blockers
- None for Phase 1 start
- GeoPackage file needed for offline map validation (non-blocking for initial dev)
- Traccar credentials needed for live API testing (can mock for now)

## Notes
- Spike code is REFERENCE ONLY — do not import directly
- All production code must be written TDD from scratch
- Spike golden datasets and test fixtures CAN be copied to tests/fixtures/
- If an older planning doc disagrees with the current implementation state, update the doc or defer to this handoff file plus `CODEX_START.md`
- `src-tauri/` is now initialized and the Tauri SQL plugin is wired in; persistence work should continue behind the MissionStore boundary only
- Use `docs/bead-readiness.md` to track how much background research each upcoming bead still needs before implementation
