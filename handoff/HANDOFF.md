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

- 2026-05-07 by Codex (offline map readiness tranche complete and validated in the in-app browser)

## Current State

- UI/UX audit work is present locally on `feat/ui-ux-audit-critical`.
- Phase 1 of the quality-to-9.5 push is complete: shared dialog/workspace focus management is now in place for major operator overlays, marker/drawing forms, and mission decision prompts.
- M24 focus mode parity is implemented locally: explicit Focus Mode Plus state, persisted reload behavior, map-first layout, preserved mission/tracking/layer awareness, and mirrored focus coordinates.
- Visual direction pass is captured in `tmp/visual-direction/`: in-app screenshots, generated inspiration mockups, and a short design brief. The adopted direction is restrained matte graphite mission software with warm amber affordances, not decorative HUD/glass/neon styling.
- The follow-on workspace polish tranche is complete: Settings, Diagnostics, Coordinate Converter, Layer Workspace, shared workspace chrome, and shared dialog chrome now use the SAR matte/tactile token system. The sidebar mission-control block now scrolls internally on constrained viewports so layer/tools content stays reachable.
- A first offline map resilience slice is complete: operators now get explicit viewed-tile cache readiness in the map chrome, with field workflow documentation and parity evidence updated. Full packaged offline map bundles remain a parity gap.
- The layer tree/catalog and the live map overlays now share an authoritative visibility path again.
- The specific `Map Tools` failure reported in live use is fixed:
  - group visibility now gates drawing, marker, measurement, helicopter, GPX, and tracking overlay channels correctly
  - stale layer-catalog refreshes can no longer overwrite a just-clicked visibility change
  - layer-catalog runtime now hydrates the visibility store at the store/runtime boundary instead of relying on a fragile React bridge effect
- Playwright concurrency is intentionally reduced to `2` workers for deterministic local validation. This is slower, but it makes the harness reliable under full-suite load.

## Last Work Done

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
- Current branch is `feat/ui-ux-audit-critical`.
- Current scores after offline map readiness slice: code/architecture 9.0, UX 8.9, UI 8.6.
- Next recommended phase: replay / training mode parity (`sartracker-web-2jk.2`) or the remaining packaged/offline map bundle gap in `sartracker-web-2jk.14`, depending whether the next agent wants operational workflow parity or field deployment resilience first.

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

1. Commit and push the offline map readiness slice after final verification.
2. Start the next parity tranche: replay / training mode (`sartracker-web-2jk.2`) or packaged offline map bundle planning/implementation (`sartracker-web-2jk.14` remainder).
3. Keep Playwright workers at `2` unless the harness/runtime model changes enough to justify re-raising concurrency.

## Verification Snapshot

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
