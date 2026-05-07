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

- 2026-05-07 by Codex (M24 focus mode plus first visual-direction polish slice complete and fully revalidated)

## Current State

- UI/UX audit work is present locally on `feat/ui-ux-audit-critical`.
- Phase 1 of the quality-to-9.5 push is complete: shared dialog/workspace focus management is now in place for major operator overlays, marker/drawing forms, and mission decision prompts.
- M24 focus mode parity is implemented locally: explicit Focus Mode Plus state, persisted reload behavior, map-first layout, preserved mission/tracking/layer awareness, and mirrored focus coordinates.
- Visual direction pass is captured in `tmp/visual-direction/`: in-app screenshots, generated inspiration mockups, and a short design brief. The adopted direction is restrained matte graphite mission software with warm amber affordances, not decorative HUD/glass/neon styling.
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
- Next recommended phase: continue the visual polish roadmap on workspaces/forms/layer tree, then re-score before moving to offline map resilience.

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

1. Apply the visual-direction brief to Settings, Diagnostics, Coordinate Converter, and Layer Workspace surfaces.
2. Re-score code/architecture, UI, and UX after that polish tranche.
3. Keep Playwright workers at `2` unless the harness/runtime model changes enough to justify re-raising concurrency.

## Verification Snapshot

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
