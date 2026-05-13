# HANDOFF.md — Live Baton

> Read this before doing any work. Update it after every meaningful chunk of work.

## How To Use This File

- Keep this file short.
- This is the live baton, not the full project diary.
- Beads are the task tracker.
- `docs/areas-to-investigate.md` is the rolling improvement queue.
- If parity evidence changes, update the parity docs and summarize the outcome here.
- Put older detailed history in `handoff/archive/`, not here.

## Last Updated

<<<<<<< HEAD
- 2026-04-17 09:06 by Codex (daily code hardening pass; verification green)

## Current State

- Workflow is now simplified:
  - `AGENTS.md` -> `CLAUDE.md`
  - `handoff/HANDOFF.md` = single live handoff
  - `docs/areas-to-investigate.md` = improvement queue + fixed improvement prompt
  - beads = tracked feature/bug/hardening work
- Old multi-file Codex/Claude packet handoff system has been removed.
- **Visual verification E2E test suite now in place** (see below).
- **M23 helicopter layer parity is now complete** across Tauri persistence, browser harness, layer catalog, map overlay, operator panel, and Playwright validation.
=======
- 2026-05-13 by Codex (build stamp + visible version in mast)
- 2026-05-13 by Codex (tracking visual readability + visibility regression hardening)
- 2026-05-13 by Codex (HTTP tracking mock-server Chrome validation + per-device map filter fix)
- 2026-05-12 by Codex (operator manual added and linked from app Help)

## Current State

- UI/UX audit work is present locally on `feat/ui-ux-audit-critical`.
- Phase 1 of the quality-to-9.5 push is complete: shared dialog/workspace focus management is now in place for major operator overlays, marker/drawing forms, and mission decision prompts.
- M24 focus mode parity is implemented locally: explicit Focus Mode Plus state, persisted reload behavior, map-first layout, preserved mission/tracking/layer awareness, and mirrored focus coordinates.
- Visual direction pass is captured in `tmp/redesign-2026-05-07/`: Playwright screenshots, generated inspiration mockups, visual brief, and iteration screenshots. The adopted direction is restrained matte graphite mission software with warm amber affordances, not decorative HUD/glass/neon styling.
- Mockup-led UI redesign tranche is complete: the main shell now has a full-width command mast and bottom instrument strip, plus a denser right command rail, mission control, tracking status, layer workspace, map chrome, coordinate converter, settings/diagnostics workspaces, and expanded drawing toolbar following the generated command-console direction.
- The follow-on workspace polish tranche is complete: Settings, Diagnostics, Coordinate Converter, Layer Workspace, shared workspace chrome, and shared dialog chrome now use the SAR matte/tactile token system. The sidebar mission-control block now scrolls internally on constrained viewports so layer/tools content stays reachable.
- Offline map resilience has advanced from readiness-only to current-view preflight: operators now get explicit viewed-tile cache readiness and can check whether the current visible map tiles are actually cached. Online map navigation is no longer Kerry-bound and now allows Ireland-wide panning. Full packaged offline map bundles and saved coverage manifests remain parity gaps.
- The layer tree/catalog and the live map overlays now share an authoritative visibility path again.
- The normal full verification path now includes backend/Tauri Cargo tests via `npm run test:all`; `npm run test:backend` is the explicit backend-only gate.
- Build visibility is now tracked and shown in-app:
  - `npm run build` writes `src/lib/version.generated.ts` from the current package version and git build metadata.
  - the command mast shows the resolved `APP_VERSION` string.
  - diagnostics continues to surface the same build value in `summaryRows` and exported support text.
- Layer Workspace inspection/count/test-id derivation has started moving out of React into a tested feature model (`src/features/layers/layer-panel-model.ts`), reducing the largest layer panel component without changing operator behavior.
- A living operator manual now ships from `public/manual/index.html` and is linked from the command mast Help button. It includes current screenshots for the app shell, layer workspace, tools/map, settings, and diagnostics.
- The specific `Map Tools` failure reported in live use is fixed:
  - group visibility now gates drawing, marker, measurement, helicopter, GPX, and tracking overlay channels correctly
  - stale layer-catalog refreshes can no longer overwrite a just-clicked visibility change
  - layer-catalog runtime now hydrates the visibility store at the store/runtime boundary instead of relying on a fragile React bridge effect
- Playwright concurrency is intentionally reduced to `2` workers for deterministic local validation. This is slower, but it makes the harness reliable under full-suite load.
>>>>>>> eb94441 (feat(version): expose build-stamped app version in UI [sartracker-web-bsl])

## Last Work Done

**Daily code hardening pass (bounded runtime reliability cleanup)**

Implemented three low-risk improvements without changing intended operator behavior:

1. **Tracking side effects no longer flip a healthy poll into failure** — `startTrackingRuntime()` now keeps the live snapshot applied even if cache writes or mission persistence fail, and logs each failure path explicitly instead of letting the poller treat it as transport outage.
2. **Drawing deletion now follows the same explicit lifecycle as saves** — delete operations set `saving`, clear stale errors, surface delete failures back into runtime state, and always clear `saving` on exit.
3. **Runtime service startup boundary is cleaner and more testable** — `runtime-managed-services.ts` no longer reaches directly into Tauri infrastructure for tracking cache creation; the cache adapter is injected from `start-app-runtime.ts`, and the lifecycle helpers now have direct unit coverage.

Added/updated unit coverage:

- `tests/unit/start-tracking-runtime.test.ts`
- `tests/unit/start-drawing-runtime.test.ts`
- `tests/unit/runtime-managed-services.test.ts`

## Active Work

- M23 is complete and validated.
- Mock Traccar server hardened and committed (`sartracker-web-2jk.16`) — ready for integration testing.
- Daily hardening runtime cleanup is implemented locally and verified; not committed/pushed in this automation run.
- Next recommended implementation bead: **`sartracker-web-2jk.13` — M24 focus mode parity**
- Next parity verification target after that remains **Batch 5** markers (`LPV-080` to `LPV-086`)

## Open Beads That Matter Now

- `sartracker-web-2jk.14` — offline map resilience parity
- `sartracker-web-2jk.2` — replay / training mode parity
- `sartracker-web-2jk.13` — focus mode parity
- `sartracker-web-2jk.15` — final parity acceptance sweep
- `sartracker-web-2jk.16` — mock Traccar server + Glenagenty fixtures
- `sartracker-web-bsl` — sections 13-16 not triple-verified in deep UI validation

## Known Parity Gaps

- `LPV-029` — mission metadata/coordinator dialog missing in mission-start flow
- `LPV-061` — layer tree type filter missing
- `LPV-068` — layer tree context menu actions missing
- `LPV-069` — bulk layer actions / tracking protections missing

## Next Actions

Choose one path and update this file when done:

1. Start **M24 focus mode parity** as the next clean implementation bead.
2. Continue parity verification with Batch 5 markers.
3. Pick one bounded improvement from `docs/areas-to-investigate.md`:
   browser harness runtime duplication cleanup or browser harness store decomposition.

## Verification Snapshot

<<<<<<< HEAD
=======
- Current HTTP tracking validation batch:
  - Mock Traccar API ✅
    - `/health` public and reporting scenario time
    - `/api/devices` returned 8 roster devices with online/unknown/offline states
    - `/api/positions` returned 7 current fixes, excluding offline Team Echo
    - historical `/api/positions?deviceId=...&from=...&to=...` returned multi-hour breadcrumb histories for devices with tracks
  - Chrome harness validation ✅
    - loaded `http://127.0.0.1:1420/?missionHarness=1&liveTracking=1`
    - started a backdated 2-hour validation mission against the real HTTP tracking runtime
    - confirmed Tracking System showed online, 8 devices, 7 fixes, and 1 stale fix
    - confirmed Layer Workspace showed People 8 and Breadcrumbs around 1,000 points (`994` in the final visual-fix run)
    - confirmed Devices Workspace showed EOC/Team Alpha online, Team Echo offline/no fix, Team Delta stale, and other teams unknown/live
    - confirmed hiding a single device removes its map marker/label after the filter fix
    - confirmed hiding the People layer removes tracking markers and breadcrumb trails
    - captured final screenshots in `tmp/tracking-visual-fix-proof/`
  - Automated verification ✅
    - `npx vitest run tests/unit/mock-traccar-hardening.test.ts tests/unit/traccar-client.test.ts tests/unit/polling-manager.test.ts tests/unit/tracking-geojson.test.ts tests/unit/sync-tracking-overlay.test.ts tests/unit/tracking-viewport.test.ts tests/unit/map-layer-filters.test.ts tests/unit/effective-overlay-visibility.test.ts tests/unit/tracking-color.test.ts` → 9 files / 56 tests
    - `npm run lint`
    - `npm run build`

- Current operator manual batch:
  - Chrome harness validation ✅
    - verified `Help` link exists with `href="./manual/index.html"`
    - loaded `http://127.0.0.1:1420/manual/index.html`
    - confirmed page title `SAR Tracker Operator Manual`
    - confirmed screenshot asset reference renders in the manual DOM
  - `git diff --check` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - confirmed `dist/manual/index.html` and copied manual screenshots exist ✅
  - Follow-up mast spacing fix:
    - `git diff --check` ✅
    - `npm run lint` ✅
    - `npm run build` ✅
  - Build stamp + version chip batch:
    - `npm run build` ✅
    - `npm run test -- tests/unit/app-version.test.ts` ✅
    - `npm run lint` ✅

- Current verification-gate / layer-panel model batch:
  - Red tests confirmed before implementation:
    - `npx vitest run tests/unit/verification-scripts.test.ts` failed because `test:backend` was missing
    - `npx vitest run tests/unit/layer-panel-model.test.ts` failed because `layer-panel-model` did not exist
  - Targeted green tests:
    - `npx vitest run tests/unit/verification-scripts.test.ts` → 1/1 ✅
    - `npx vitest run tests/unit/layer-panel-model.test.ts` → 3/3 ✅
  - Required verification:
    - `npm run lint` ✅
    - `npm run build` ✅
    - `npm run test` → 75 files / 352 tests ✅
    - `cargo test --manifest-path src-tauri/Cargo.toml` → 26 backend tests + doctests ✅
    - `npm run test:e2e` → 89/89 passing with `workers: 2` ✅
    - `npm run test:all` → JS unit + Playwright + backend Cargo tests ✅
    - Chrome harness validation ✅

- Current mockup-led UI redesign tranche:
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test` → 73 files / 348 tests ✅
  - `npm run test:e2e` → 88/88 passing with `workers: 2` ✅
  - Targeted settings rerun after visual-token class fix → 3/3 passing ✅
  - Playwright visual iteration pass ✅
    - active mission shell: disabled Start no longer consumes active mission layout; Pause/Finish remain primary
    - layers workspace: right rail uses compact mission/status hierarchy with tactile layer rows and controls
    - settings/diagnostics: dense matte workspaces remain readable and keyboard-operable
    - coordinate converter: centered command dialog preserves clear modes and actions
    - drawing toolbar: expanded state now presents as compact vertical field tool dock
    - command mast: global mission/system/tracking strip added after user correctly called out that the prior pass still looked too unlike the mockups
    - coordinate strip: bottom chrome now reads as separated mission instruments instead of a thin app footer
    - final iteration console/page errors: none

- Current workspace polish tranche:
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test` → 71 files / 334 tests ✅
  - In-app browser visual pass ✅
    - idle shell: matte mission-control direction intact
    - Settings workspace: dense readable form layout with visible Close/Esc and footer actions
    - Diagnostics workspace: matte diagnostic rows with no console errors
    - Coordinate Converter: compact dialog, clear mode selector, readable inputs/actions
    - Layer Workspace: content reachable on constrained viewport after sidebar Mission Control scroll fix
    - browser console errors: none
- Current offline map readiness tranche:
  - Added `src/features/map/offline-map-readiness.ts`
  - Added `src/features/map/use-offline-map-readiness.ts`
  - Added `src/components/offline-map-readiness-badge.tsx`
  - Wired map chrome in `src/components/map-view.tsx`
  - Added `tests/unit/offline-map-readiness.test.ts`
  - Added `docs/offline-map-resilience.md`
  - Updated `docs/plugin-parity-matrix.md`
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test` → 72 files / 339 tests ✅
  - Targeted readiness test → 5 tests ✅
  - In-app browser visual pass ✅
    - readiness badge visible at `http://127.0.0.1:1420/?missionHarness=1`
    - badge text: `Viewed tiles cache ready` / `OpenTopoMap: tiles viewed now are available offline.`
    - first pass found top-control crowding in the constrained shell; badge stack moved to lower map chrome before validation
    - browser console errors: none
- Current offline map coverage preflight tranche:
  - Added `src/features/map/offline-map-coverage.ts`
  - Added `src/features/map/use-offline-map-coverage.ts`
  - Updated `src/components/offline-map-readiness-badge.tsx` with `Check View`
  - Exposed `mapRef` through `src/features/map/use-map-controller.ts`
  - Added `tests/unit/offline-map-coverage.test.ts`
  - Updated `docs/offline-map-resilience.md`
  - Updated `docs/plugin-parity-matrix.md`
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test` → 73 files / 348 tests ✅
  - Targeted coverage test → 9 tests ✅
  - `git diff --check` ✅
  - User-approved Playwright visual/interaction pass ✅
    - loaded `http://127.0.0.1:1420/?missionHarness=1`
    - preflight initially showed `Current view not checked`
    - clicked `Check View`
    - preflight changed to `Current view not cached` / `0/9 OpenTopoMap tiles cached for z12.`
    - first screenshot showed the badge was too translucent over bright topo tiles; fixed by switching the badge and inner coverage panel to high-opacity matte backgrounds
    - final screenshot: `test-results/offline-coverage-readable.png`
    - browser console/page errors: none
- Previous committed tranche:
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test` → 71 files / 334 tests ✅
  - `npm run test:e2e` → 88/88 passing with `workers: 2` ✅
  - In-app browser check on `http://127.0.0.1:1420/?missionHarness=1` ✅
    - Settings and Coordinate Converter expose dialog semantics
    - Marker and Drawing dialogs expose dialog semantics
    - mission finish confirmation exposes `alertdialog` semantics
    - Escape closes checked overlays/prompts/dialog forms
    - browser console errors: none
  - In-app browser visual-direction screenshots captured ✅
>>>>>>> eb94441 (feat(version): expose build-stamped app version in UI [sartracker-web-bsl])
- Verified parity batches:
  - Batch 1 visibility: complete
  - Batch 2 layer tree/console: complete with 3 known gaps
  - Batch 3 tracking/devices: complete
  - Batch 4 mission lifecycle: complete with 1 known gap
- Not yet parity-verified:
  - Batch 5 markers
  - Batch 6 drawings
  - Batch 7 measurements/coordinates
  - Batch 8 review/settings/diagnostics
  - Batch 9 GPX/helicopters/structure
- Visual E2E test suite:
  - 22 Playwright tests: all green
  - 55 existing E2E tests: all green (zero regression)
  - Opus visual verification: 11/11 passed
  - Coverage: app shell, mission lifecycle (6 states), tracking (panel + map + layers), markers (4 types), drawings (4 tools + multi-drawing)
- Mock Traccar server:
  - 16 unit tests covering all 5 hardening fixes
  - Manual curl verification: /health public, offline filtering, auth gates
- Daily hardening pass:
  - `npm run test` -> 68 files / 325 tests passed
  - `npm run build` -> passed
  - `npx eslint` on changed files -> passed

## Archive

- Older detailed handoff history: [handoff/archive/HANDOFF-history-2026-04-11.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/handoff/archive/HANDOFF-history-2026-04-11.md)
