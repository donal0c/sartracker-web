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

- 2026-05-13 by Codex (reconciled UI branch back onto master; master is canonical)
- 2026-05-13 by Codex (build stamp + visible version in mast)
- 2026-05-13 by Codex (tracking visual readability + visibility regression hardening)
- 2026-05-13 by Codex (HTTP tracking mock-server Chrome validation + per-device map filter fix)
- 2026-05-12 by Codex (operator manual added and linked from app Help)

## Current State

- `master` is the canonical working branch. The prior UI/UX audit branch has been reconciled back onto `master` and should not be used for new work.
- Daily runtime hardening from `master` is retained: tracking side effects no longer turn a healthy poll into a transport failure, drawing deletion exposes explicit saving/error state, and runtime-managed service startup now receives the tracking cache adapter from the application startup boundary.
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

## Last Work Done

**HTTP tracking mock-server validation**

- Re-read the tracking runtime, Traccar client, polling manager, breadcrumb accumulation, map overlay sync, layer catalog, devices workspace, and mock Traccar server.
- Ran the repo-local mock Traccar server against the real browser harness tracking runtime using Chrome at `http://127.0.0.1:1420/?missionHarness=1&liveTracking=1`.
- Validated a two-hour Glenagenty scenario with 8 roster devices, 7 current fixes, 1 offline device, ~1,000 breadcrumb points, stale/unknown device states, device workspace health, and layer tree counts.
- Found and fixed a tracking layer visibility bug: individual device and People-layer hides updated UI state but did not remove tracking point/label overlays from the map. `buildTrackingLayerFilter` now emits the MapLibre layer-filter form honored by `setFilter`.
- Hardened multi-team map readability: numeric device ids now get distinct high-visibility colors, breadcrumb trails render with a dark casing under the colored route, current-location dots render with a dark halo, and labels use each device color with a stronger dark halo.
- Fresh Chrome screenshots are in `tmp/tracking-visual-fix-proof/`: main dots/trails proof, layer counts, devices workspace, Team Alpha hidden, and People layer hidden.
- Mock-server validation note: accelerated playback is useful for current-position progression, but realistic historical breadcrumb validation should use `--start-offset` with mission backdating so the app's `from/to=now` breadcrumb query window includes the simulated history.

**Operator manual + Help link**

- Added a self-contained static operator manual at `public/manual/index.html`.
- Captured Chrome browser-harness screenshots into `public/manual/assets/`.
- Added a command mast `Help` link that opens `./manual/index.html` in a new tab/window.
- Tightened the command mast layout after manual testing showed Help clipping off-screen on narrower desktop widths.
- Updated `README.md` so it no longer says drawing and measurement tools are missing.
- Beads warning persists: `bd list` still reports the repo-ID mismatch, so no bead write was attempted.

**Verification gate + layer panel model seam**

- Added `npm run test:backend` and wired it into `npm run test:all`, so backend persistence/governance tests are part of the ordinary full test path.
- Added unit coverage that prevents the verification scripts from drifting back to JS-only full tests.
- Extracted layer inspection rows, row count labels, and stable tree test-id normalization from `src/components/layer-filter-panel.tsx` into `src/features/layers/layer-panel-model.ts`.
- Added focused model tests for tracking/device, measurement, marker inspection rows, count labels, and test-id normalization.
- Updated `README.md` and `CLAUDE.md` testing docs to name `lint`, `build`, JS unit, Playwright, and backend Cargo verification explicitly.
- Chrome validation in harness mode:
  - loaded `http://127.0.0.1:1420/?missionHarness=1`
  - started `Chrome validation mission`
  - opened Layers, confirmed the layer tree populated
  - selected the People tracking layer and confirmed inspector rows showed `Tracking Devices 0` / `Visible Yes`
  - browser console errors: none
- Beads warning: `bd list/show` reported a repo-ID mismatch before reading issues. I did not run migration or daemon repair in this batch.

**Ireland-wide map navigation bounds**

- Replaced the Kerry-only `KERRY_MAX_BOUNDS` with `IRELAND_MAX_BOUNDS` in the MapLibre instance.
- Set Ireland-wide bounds to `[-10.85, 51.25]` southwest and `[-5.25, 55.55]` northeast so operators can pan across the island while avoiding accidental global drift.
- Added Playwright regression coverage that jumps to southwest, northwest, and east-coast Ireland and confirms MapLibre is not clamping back to the old Kerry mission area.
- Updated offline map docs to distinguish Ireland-wide online navigation from not-yet-implemented packaged offline map bundles.

**Mountain Rescue branding pass**

- Removed Kerry Mountain Rescue organization branding from the app mast, browser metadata, README, Tauri package description, visual verification prompts, mock Traccar seed label, and repo instruction copy.
- Replaced the app mast acronym with `MR` and the visible brand text with `Mountain Rescue`.
- Left geographic/test-terrain references such as Kerry bounds and Kerry mountains in place where they describe coordinate fixtures or map validation area rather than product ownership.

**Mockup-led SAR command-console UI redesign**

- Captured current Playwright screenshots for idle, active tracking, layers, tools, coordinate converter, settings, diagnostics, offline coverage, constrained shell, and drawing toolbar states.
- Generated multiple AI visual directions from those screenshots and adopted the practical common direction: map-first, rectangular tactile controls, integrated right command rail, compact telemetry blocks, matte graphite surfaces, amber active affordances, green readiness, red destructive actions.
- Added/refined shared SAR UI primitives in `src/index.css` for modules, readouts, command docks, tactile action buttons, inline alerts, and tree rows.
- Reworked the operational shell in `src/App.tsx` with a stronger Mountain Rescue mast, integrated status block, rectangular action controls, denser mission rail, and less generic tab/notes treatment.
- Added a full-width command mast with mission, elapsed/active timing, device/fix count, system readiness, and operational actions so the app moves structurally toward the generated mockups instead of only polishing the old right-sidebar layout.
- Reworked the bottom coordinate display into a taller instrument strip with separate Coordinates, Irish Grid, Map CRS, Work CRS, and Convert cells.
- Reworked map chrome and high-frequency operator controls:
  - basemap dock
  - coordinate instrument strip
  - map/offline status badges
  - expanded drawing toolbar as a compact vertical tool dock
- Reworked key right-rail panels:
  - Mission Control
  - Tracking System
  - Layer Workspace
- Reworked shared dialog/workspace surfaces used by Settings, Diagnostics, and Coordinate Converter to match the matte command-console treatment while preserving focus trapping and Escape behavior.
- Playwright iteration screenshots are in `tmp/redesign-2026-05-07/iteration-1/` through `tmp/redesign-2026-05-07/iteration-6-instrument-strip/`.

**Phase 1: accessible modal/workspace platform**

- Added shared focus-management helpers and a reusable centered `DialogOverlay`.
- Hardened Settings, Diagnostics, Devices, Mission Review, and Coordinate Converter overlays with dialog semantics, labelled headings, focus trapping, Escape close behavior, and focus return.
- Migrated marker and drawing dialogs to the shared dialog primitive with matching semantics, focus trapping, Escape cancellation, and viewport-safe scrolling.
- Hardened mission finish/finalize/unlock decision prompts as keyboard-contained `alertdialog` surfaces.
- Added unit coverage for focus-management behavior and E2E coverage for Settings, Diagnostics, Coordinate Converter, marker, drawing, and mission finish confirmation keyboard behavior.
- Added a timeout fallback to workspace-overlay close cleanup so mounted state and focus return do not depend solely on CSS transition-end delivery.
- Stabilized the LPV-246a parity test by polling map filter propagation on hide as well as restore, matching the asynchronous MapLibre style/update path.

**M24 focus mode + visual direction**

- Added explicit persisted Focus Mode Plus state in `src/features/focus-mode/focus-mode-store.ts`.
- Added `FocusModeToggle`, `FocusModeSidebar`, and `FocusModeCoordinateMirror` so focus mode reduces chrome while preserving mission control, tracking status, layer controls, drawing tools, map health, and coordinates.
- Added E2E coverage for focus-mode layout, reload persistence, recovery resume, tracking awareness, mission pause/resume/finish, and drawing creation.
- Added visual coverage for the focus-mode app shell.
- Captured in-app browser screenshots for idle, active, layers, settings, diagnostics, coordinate converter, and drawing-toolbar states.
- Generated visual inspiration mockups, rejected unsafe decorative ideas, and implemented the first restrained token/shell polish slice.

**Workspace polish tranche**

- Applied the visual-direction brief to:
  - `src/App.tsx`
  - `src/components/settings-workspace.tsx`
  - `src/components/diagnostics-workspace.tsx`
  - `src/components/coordinate-converter-dialog.tsx`
  - `src/components/layer-filter-panel.tsx`
  - `src/components/workspace-overlay.tsx`
  - `src/components/dialog-overlay.tsx`
  - `src/index.css`
- Added shared SAR styling primitives for workspace headers/footers, inputs, toggles, status rows, and matte raised panels.
- Browser-validated the polished Settings, Diagnostics, Coordinate Converter, and Layers surfaces in the in-app browser at `http://127.0.0.1:1420/?missionHarness=1`.
- Fixed the constrained-viewport sidebar issue found during browser validation: Layer Workspace content now starts visibly below the tab control instead of being pushed below the lower edge by pinned Mission Control.

**Layer visibility + parity hardening**

- Root cause fixed: the layer catalog was persisting and rebuilding correctly, but the visibility store was not being hydrated reliably from that runtime. That allowed the layer tree to look right while the map still rendered stale overlay state.
- Hardened files:
  - `src/features/layers/layer-catalog-store.ts`
  - `src/features/layers/layer-visibility-store.ts`
  - `src/features/layers/start-layer-catalog-runtime.ts`
  - `src/features/layers/effective-overlay-visibility.ts`
  - `src/features/map/use-map-overlays.ts`
  - `src/features/map/use-map-drawing-overlays.ts`
  - `src/features/map/use-map-measurement-overlays.ts`
  - `src/features/map/use-map-gpx-overlays.ts`
  - `src/features/map/use-map-helicopter-overlays.ts`
- Test hardening added:
  - new unit coverage for visibility derivation and store hydration
  - new runtime race test for stale layer-catalog refresh suppression
  - expanded Playwright parity assertions for `Map Tools` cascade and map filter propagation
  - multiple E2E helpers hardened to click the real MapLibre canvas instead of the shell container
- UI audit changes from Claude were reviewed and retained:
  - sidebar tabs
  - shared workspace overlay/header
  - mission control visual hierarchy
  - coordinate bar improvements
  - empty-state copy/panel polish

## Active Work

- Quality-to-9.5 goal is active.
- Current branch is `master`.
- Current scores after mockup-led UI redesign slice: code/architecture 9.1, UX 9.0, UI roughly 9.2 pending a fresh independent scoring pass.
- Next recommended phase: either continue obvious model/component extraction around `layer-filter-panel`, `mission-control-panel`, or `settings-workspace`, or start replay / training mode parity (`sartracker-web-2jk.2`) after a short design pass. Packaged offline map bundles / saved coverage manifests remain the other major parity gap in `sartracker-web-2jk.14`.

## Open Beads That Matter Now

- `sartracker-web-2jk.14` — offline map resilience parity
- `sartracker-web-2jk.2` — replay / training mode parity
- `sartracker-web-2jk.15` — final parity acceptance sweep
- `sartracker-web-bsl` — sections 13-16 not triple-verified in deep UI validation

## Known Parity Gaps

- `LPV-029` — mission metadata/coordinator dialog missing in mission-start flow
- `LPV-061` — layer tree type filter missing
- `LPV-068` — layer tree context menu actions missing
- `LPV-069` — bulk layer actions / tracking protections missing

## Next Actions

1. Decide whether to continue architecture-risk reduction in one of the remaining large UI modules or start replay / training mode (`sartracker-web-2jk.2`).
2. If starting replay, do a short design pass first around replay/live isolation, provider gating, historical position derivation, and unmistakable replay state.
3. Resolve the `bd` repo-ID mismatch before relying on bead writes/sync from this checkout.
4. Keep Playwright workers at `2` unless the harness/runtime model changes enough to justify re-raising concurrency.

## Verification Snapshot

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
- Verified parity batches:
  - Batch 1 visibility ✅
  - Batch 2 layer tree/console ✅
  - Batch 3 tracking/devices ✅
  - Batch 4 mission lifecycle ✅

## Archive

- Older detailed handoff history: [handoff/archive/HANDOFF-history-2026-04-11.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/handoff/archive/HANDOFF-history-2026-04-11.md)
