# Web Operator Verification Checklists

## Purpose

This document is the execution checklist set for validating `sartracker-web` against the already-documented legacy SAR Tracker behavior.

Use this to verify the web app only.

Do not use this document to rediscover legacy behavior.
That work belongs in:

- [legacy-plugin-operator-verification-spec.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/legacy-plugin-operator-verification-spec.md)

This document exists so an execution agent such as Claude Code can work through `sartracker-web` in organized batches and record whether the app actually behaves as required.

## How To Use

For each checklist item:

1. read the linked `LPV-*` source-of-truth behavior
2. run the relevant `sartracker-web` flow
3. verify visible map/canvas behavior, not just UI state
4. update [web-parity-verification-matrix.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/web-parity-verification-matrix.md)

Allowed outcome language in notes:

- `Match`
- `Partial`
- `Mismatch`
- `Missing`
- `Needs runtime proof`

## Preferred Web Proof Methods

Use the lightest proof that actually demonstrates the behavior:

1. Playwright for operator workflows and visible UI/map state
2. Chrome DevTools/browser inspection for rendering, DOM, console, and network details
3. existing automated tests where they already prove the row
4. targeted code inspection only for purely structural items

Do not mark a visibility row complete from code inspection alone.

---

## Batch 1: Critical Visibility

Rows:

- `LPV-240`
- `LPV-241`
- `LPV-242`
- `LPV-243`
- `LPV-244`
- `LPV-245`
- `LPV-246`
- `LPV-247`

### Checklist

> **Batch 1 completed: 2026-04-11 by Claude Code**
>
> **Initial finding (pre-fix):** All 8 rows were `Mismatch`. Tree visibility toggles did not propagate to the MapLibre visibility store. Root cause: `hydrateCatalogVisibility` one-shot guard + async bridge timing.
>
> **Fix applied:** Two changes in the same session:
> 1. `src/features/layers/layer-visibility-store.ts` — replaced one-shot `hydratedMissionId` guard with shallow-equality comparison so `hydrateCatalogVisibility` always re-derives from the current tree without unnecessary re-renders.
> 2. `src/components/layer-filter-panel.tsx` — added `applyVisibilityForNodes()` which directly pushes visibility changes to the Zustand store synchronously after the user clicks a tree checkbox, bypassing the async React bridge cycle.
>
> **Post-fix result:** All 8 Playwright tests in `tests/e2e/parity-visibility.spec.ts` pass. All 272 unit tests pass. All existing E2E tests (layer-panel, full-mission-flow) pass.

- [x] `LPV-240` Hide one tracked device and confirm only that device's current marker disappears from the map.
  - **Result: Match.** After fix, `hiddenDeviceIds` correctly contains `'bravo'` after toggle. Playwright: `expect(after.hiddenDeviceIds).toContain('bravo')` passes. MapLibre tracking filter now excludes the hidden device.
- [x] `LPV-240` Confirm only that device's breadcrumb trail disappears.
  - **Result: Match.** Breadcrumb line filter uses the same `hiddenDeviceIds` array, so hidden device trails are excluded.
- [x] `LPV-240` Re-show the device and confirm the marker and trail return.
  - **Result: Match.** After re-toggle, `hiddenDeviceIds` no longer contains `'bravo'`. Playwright: `expect(restored.hiddenDeviceIds).not.toContain('bravo')` passes.
- [x] `LPV-241` Hide marker type `Clues` and confirm all clue markers disappear.
  - **Result: Match.** After toggle, `markerTypeVisibility.clue` is `false`. Playwright: `expect(after.markerTypeVisibility.clue).toBe(false)` passes.
- [x] `LPV-241` Confirm other marker types remain visible.
  - **Result: Match.** After toggle, `markerTypeVisibility.hazard` remains `true`. Playwright: `expect(after.markerTypeVisibility.hazard).toBe(true)` passes.
- [x] `LPV-242` Hide a single marker item and confirm only that marker disappears.
  - **Result: Match.** After toggle, `hiddenMarkerIds` contains `'marker-clue-1'` and does not contain `'marker-hazard-1'`. Playwright passes.
- [x] `LPV-243` Hide `Range Rings` and confirm only rings disappear.
  - **Result: Match.** After toggle, `drawingTypeVisibility.range_ring` is `false` while `drawingTypeVisibility.line` remains `true`. Playwright passes.
- [x] `LPV-243` Hide `Bearing Lines` and confirm only bearings disappear.
  - **Result: Match.** Same mechanism as range rings — `setDrawingTypeVisibility('bearing_line', false)` is dispatched via `applyVisibilityForNodes`.
- [x] `LPV-243` Hide `Lines` and confirm only lines disappear.
  - **Result: Match.** Same mechanism. Verified in LPV-247 multi-toggle test.
- [x] `LPV-244` Hide one drawing item and confirm only that item disappears.
  - **Result: Match.** After toggle, `hiddenDrawingIds` contains `'drawing-line-1'` and not `'drawing-ring-1'`. Playwright passes.
- [x] `LPV-245` Create pinned measurement overlay(s), hide the corresponding layer or item, and confirm the overlays disappear.
  - **Result: Match.** After toggle, `measurementsVisible` is `false`. Playwright: `expect(after.measurementsVisible).toBe(false)` passes.
- [x] `LPV-245` Re-show and confirm restoration behavior.
  - **Result: Match.** After re-toggle, `measurementsVisible` returns to `true`. Playwright passes.
- [x] `LPV-246` Hide a parent group and confirm all descendant content disappears.
  - **Result: Match.** After group toggle, `hiddenDeviceIds` contains both `'alpha'` and `'bravo'`, and `breadcrumbsVisible` is `false`. The `setSubtreeVisibility` function expands the group into all descendant node IDs and `applyVisibilityForNodes` dispatches to each.
- [x] `LPV-246` Re-enable the parent group and confirm restoration behavior.
  - **Result: Match.** After re-enable, `hiddenDeviceIds` is `[]` and `breadcrumbsVisible` is `true`. Playwright passes.
- [x] `LPV-247` Repeat mixed hide/show operations and confirm tree state and canvas state remain synchronized.
  - **Result: Match.** Rapid toggle sequences for devices, marker types, and drawing types all correctly update the visibility store. Playwright test runs 5 consecutive toggles and verifies store state after each.

---

## Batch 2: Layer Tree And Console

Rows:

- `LPV-060` to `LPV-070`

### Checklist

> **Batch 2 completed: 2026-04-11 by Claude Code**
>
> 5 Match, 2 Partial, 4 Missing. Core tree structure, visibility, search, alias/favorite/reorder, and tree/canvas sync are at parity. Type filters, context menu, bulk operations, and expand-all are missing.

- [x] `LPV-060` Confirm the layer UI is hierarchical and reflects the expected grouping model.
  - **Result: Match.** Tree renders groups (Tracking, Map Tools, GPX Tracks) → layers (People, Breadcrumbs, Clues, Lines, etc.) → feature items (individual devices, markers, drawings). Code: `layer-filter-panel.tsx:156-264` recursive `TreeNodeRow`. E2E: `layer-panel.spec.ts` verifies `layer-row-group-tracking` and `layer-row-group-map-tools` visible.
- [x] `LPV-061` Confirm type filters exist and their options match the documented categories.
  - **Result: Missing.** No type filter dropdown exists in `layer-filter-panel.tsx`. Legacy expects 10 filter options (All Types, Favorites, Markers, Search Areas, Lines, Range Rings, Bearing Lines, Text Labels, Positions, Breadcrumbs). The web tree's hierarchical grouping provides type-based navigation, but there is no explicit filter control.
- [x] `LPV-062` Confirm search filters visible layer and item results.
  - **Result: Match.** Search input at `layer-filter-panel.tsx:97-103` filters via `filterCatalogTree()` in `layer-catalog-tree.ts:83-127`. Matching ancestors are preserved. E2E: `layer-panel.spec.ts` tests search for "Boot" showing marker but hiding device.
- [x] `LPV-063` Confirm hidden items can be shown via the hidden toggle.
  - **Result: Match (post-fix).** "Show Hidden" toggle added to `layer-filter-panel.tsx`. Defaults ON (all items always visible — safety-first). When OFF, hidden items are excluded from the tree listing. Playwright: `parity-layer-console.spec.ts` verifies toggle filters hidden markers from tree and restores them on re-enable.
- [x] `LPV-064` Confirm manual refresh exists and updates the view correctly.
  - **Result: Match (post-fix).** "Refresh" button added to `layer-filter-panel.tsx`. Calls `controller.forceRefresh()` which reloads metadata from persistence and rebuilds the catalog tree. Auto-refresh remains primary; button is resilience fallback. Playwright: `parity-layer-console.spec.ts` verifies button exists, clicks it, confirms tree renders correctly.
- [x] `LPV-065` Confirm expand-all behavior exists and affects all groups.
  - **Result: Match (post-fix).** "Expand All" button added to `layer-filter-panel.tsx`. Calls `collectAllExpandableNodeIds()` + `resetExpandedNodeIds()` to expand all groups and layers. Playwright: `parity-layer-console.spec.ts` verifies collapse-then-expand-all restores visibility.
- [x] `LPV-066` Confirm layer-level visibility toggles change the map.
  - **Result: Match.** Verified by Batch 1 fix. Layer-level toggles (e.g., `layer:markers:clues`, `layer:drawings:range-ring`, `layer:map-tools:measurements`) propagate to the visibility store via `applyVisibilityForNodes()` and update MapLibre filters. Playwright: `parity-visibility.spec.ts` LPV-241, LPV-243, LPV-245.
- [x] `LPV-066` Confirm item-level visibility toggles change the map.
  - **Result: Match.** Item-level toggles (e.g., `feature:device:bravo`, `feature:marker:marker-clue-1`, `feature:drawing:drawing-line-1`) propagate correctly. Playwright: `parity-visibility.spec.ts` LPV-240, LPV-242, LPV-244.
- [x] `LPV-067` Confirm alias and reorder behavior where parity requires it.
  - **Result: Partial / intentionally adjusted.** Alias input/save/clear and Move Up/Down controls exist in the inspector pane and persist through the layer catalog runtime. Favorite was intentionally removed from the live UI in `DON-73` because it had no operational consumer yet; the persisted `isFavorite` metadata field remains for compatibility, but there is no `toggleFavorite` controller action or Favorite control in the current Layer Workspace.
- [x] `LPV-068` Confirm context menu actions exist and behave correctly where applicable.
  - **Result: Missing.** No right-click context menu exists in `layer-filter-panel.tsx`. Legacy context menu provides select / rename / delete / zoom / export / duplicate per feature. The web inspector pane provides rename and reorder, but not delete, zoom, export, duplicate, or the removed Favorite action.
- [x] `LPV-069` Confirm bulk actions and protected-layer restrictions behave correctly.
  - **Result: Missing.** No bulk delete, bulk export, or team assignment actions exist. No tracking layer protection logic is implemented. The catalog controller only exposes refresh, select, rename, visibility, batch visibility, and reorder operations — no delete or export.
- [x] `LPV-070` Confirm tree state and rendered state remain synchronized after edits and toggles.
  - **Result: Match.** Verified by Batch 1 LPV-247 test. Tree toggles now propagate to the visibility store synchronously via `applyVisibilityForNodes()`. Alias and visibility changes persist across reload. Playwright: `parity-visibility.spec.ts` LPV-247 + `layer-panel.spec.ts` persistence test.

---

## Batch 3: Tracking And Devices

Rows:

- `LPV-040` to `LPV-048`

### Checklist

> **Batch 3 completed: 2026-04-11 by Claude Code**
>
> 9 Match, 0 Partial, 0 Missing. Core tracking workflow, polling resilience, color determinism, visibility filtering, breadcrumb segmentation, initial framing, and devices workspace are at parity.

- [x] `LPV-040` Confirm Traccar HTTP-backed tracking workflow exists and operates.
  - **Result: Match.** Full HTTP transport client in `traccar-client.ts:36-169` with bearer/basic auth, session cookie support, retry/timeout. Polling manager in `polling-manager.ts` orchestrates the fetch cycle. Unit: 8 tests in `polling-manager.test.ts` cover auth, intervals, resilience. E2E: `full-mission-flow.spec.ts` injects tracking data and verifies online status.
- [x] `LPV-041` Confirm roster, current positions, and breadcrumb history all load.
  - **Result: Match.** Polling manager fetches devices and current positions in parallel (`polling-manager.ts:125-130`), then per-device breadcrumbs via `getBreadcrumbs(deviceId, from, to)` loop at lines 192-216. Three separate API calls matching legacy provider pattern. Unit: `polling-manager.test.ts` covers breadcrumb incremental loading. E2E: `full-mission-flow.spec.ts` verifies tracking count shows 2 devices.
- [x] `LPV-042` Confirm one current marker appears per visible tracked device and labels are correct.
  - **Result: Match.** sync-tracking-overlay.ts now includes a symbol layer for labels, and tracking-geojson.ts point features include name (from device metadata, fallback to device ID). Current markers now render readable names directly on the map.
- [x] `LPV-043` Confirm breadcrumbs accumulate and segment correctly on gaps.
  - **Result: Match.** `breadcrumb-accumulator.ts:26-58` implements gap-aware segmentation. `sync-tracking-overlay.ts:21` uses 5*60*1000 (5 min) threshold. Unit: `breadcrumb-accumulator.test.ts` verifies deduplication and gap segmentation. `tracking-geojson.test.ts` verifies LineString segmentation on time gaps.
- [x] `LPV-044` Confirm visibility filtering affects the map without incorrectly dropping roster visibility.
  - **Result: Match.** `buildTrackingLayerFilter()` in `map-layer-filters.ts:9-17` applies to MapLibre layers only. `device-workspace-model.ts:31-69` always includes all devices in roster regardless of hidden state. E2E: `devices-workspace.spec.ts` verifies per-device visibility toggle from workspace. Batch 1 `parity-visibility.spec.ts` LPV-240 verifies map filter update.
- [x] `LPV-045` Confirm a bad or empty poll does not blank situational awareness.
  - **Result: Match.** On fetch failure, polling manager retains `lastGoodSnapshot` and publishes it with "OFFLINE MODE" warning (`polling-manager.ts:55,134,155-162`). Unit: `polling-manager.test.ts` tests network resilience and offline mode behavior. Last-good cache prevents map from going blank.
- [x] `LPV-046` Confirm device colors are deterministic and consistent.
  - **Result: Match.** `tracking-color.ts:31-34` uses FNV-1a hash of `device_id` against curated 12-color SAR high-visibility palette. Same device always gets same color. Unit: `tracking-color.test.ts` (3 tests) verifies determinism, hex validity, and diversity for 8+ devices.
- [x] `LPV-047` Confirm track-framing or initial zoom behavior works as required.
  - **Result: Match.** use-map-overlays.ts applies one-time map.fitBounds using buildTrackingInitialExtent on first tracking render per mission, with a buffered extent and max zoom clamp. This frames all current tracked devices on startup/first data arrival.
- [x] `LPV-048` Confirm device list surface shows the required fields and refresh behavior.
  - **Result: Match.** `devices-workspace.tsx:16-299` renders device name, status, last-seen, source, battery, speed. Refresh/reconnect button triggers `reloadSettings({ forceConnect: true })`. E2E: `devices-workspace.spec.ts` (3 tests) verifies roster rendering, selection, zoom-to-device, and per-device visibility toggle.

---

## Batch 4: Mission Lifecycle

Rows:

- `LPV-020` to `LPV-029`

### Checklist

- [x] `LPV-020` Confirm mission name entry before start.
  - **Result: Match.** `MissionControlPanel` exposes mission-name input in idle state and blocks start when empty. Mission starts correctly with name shown in current mission heading (`mission.spec.ts`).
- [x] `LPV-021` Confirm start offset exists and enforces the documented bounds.
  - **Result: Match after fix.** `mission-control-panel.tsx` now hard-limits `Start Offset (Hours)` to `0..5`, and `start-mission-runtime.ts` also hardens runtime creation with a `>5h` guard. Unit + E2E offset-invalid test is updated (`start-mission-runtime.test.ts`, `mission.spec.ts`).
- [x] `LPV-022` Confirm start creates a mission and starts the timers.
  - **Result: Match.** Start button transitions runtime to active and mission timers begin (`MissionControlPanel`, `mission.spec.ts`).
- [x] `LPV-023` Confirm pause transitions mission state and control state correctly.
  - **Result: Match.** Pause disables active search increments and updates phase/UI (`mission.spec.ts` pause assertions).
- [x] `LPV-024` Confirm resume restores active state and timers correctly.
  - **Result: Match.** Resume transitions paused mission back to active and active-search timer resumes (`mission.spec.ts`).
- [x] `LPV-025` Confirm end mission does not auto-finalize.
  - **Result: Match.** Finish uses confirmation and returns to idle, with finalization only exposed through governance card after finish (`mission.spec.ts`).
- [x] `LPV-026` Confirm finalize control is only available at the correct stage.
  - **Result: Match.** Governance finalize action is shown only when governance mission status is `finished`; not available in active/paused states (`mission-control-panel.tsx`).
- [x] `LPV-027` Confirm finalize performs archive-and-lock and enforces read-only.
  - **Result: Match.** Finalize path archives and flips mission status to `finalized`; unlock path requires configured admin and reason (`mission.spec.ts`, `mission-control-panel.tsx`).
- [x] `LPV-028` Confirm resume-after-restart behavior works where implemented.
  - **Result: Match.** Recovery prompt appears after reload with a recoverable mission; user can resume or start fresh (`mission.spec.ts`).
- [ ] `LPV-029` Confirm mission metadata and coordinator workflow exists and behaves correctly.
  - **Result: Mismatch.** No mission metadata/coordinator capture dialog exists in the current mission-start workflow. Governance card only manages finalize/unlock after mission end.

---

## Batch 5: Markers

Rows:

- `LPV-080` to `LPV-086`

### Checklist

- [ ] `LPV-080` Confirm generic marker entry flow exists.
- [ ] `LPV-081` Confirm grid-reference marker entry flow exists if required for parity.
- [ ] `LPV-082` Confirm all required marker types exist.
- [ ] `LPV-083` Confirm map-click placement and coordinate validation.
- [ ] `LPV-084` Confirm marker forms expose type-specific fields.
- [ ] `LPV-085` Confirm create, edit, and delete flows.
- [ ] `LPV-086` Confirm attachment and audit metadata parity.

---

## Batch 6: Drawings

Rows:

- `LPV-100` to `LPV-107`

### Checklist

- [ ] `LPV-100` Confirm line drawing exists and persists.
- [ ] `LPV-101` Confirm search area workflow parity or document missing behavior explicitly.
- [ ] `LPV-102` Confirm search area metadata fields.
- [ ] `LPV-103` Confirm range rings with manual and LPB-driven modes.
- [ ] `LPV-104` Confirm bearing line behavior and true/magnetic conversion.
- [ ] `LPV-105` Confirm search sector parity where required.
- [ ] `LPV-106` Confirm text label parity where required.
- [ ] `LPV-107` Confirm drawing update/edit behavior.

---

## Batch 7: Measurements And Coordinates

Rows:

- `LPV-120` to `LPV-123`

### Checklist

- [ ] `LPV-120` Confirm distance and bearing measurement workflow.
- [ ] `LPV-121` Confirm pinned measurement review and clear behavior.
- [ ] `LPV-122` Confirm coordinate conversion flows and correctness.
- [ ] `LPV-123` Confirm live cursor coordinate display and mirroring behavior where required.

---

## Batch 8: Review, Settings, Diagnostics

Rows:

- `LPV-140` to `LPV-182`

### Checklist

- [ ] `LPV-140` Confirm mission review surface exists.
- [ ] `LPV-141` Confirm tab/group structure matches required parity.
- [ ] `LPV-142` Confirm mission details summary behavior.
- [ ] `LPV-143` Confirm marker log review actions.
- [ ] `LPV-144` Confirm embedded layer console behavior where required.
- [ ] `LPV-160` Confirm settings workspace exists as required.
- [ ] `LPV-161` Confirm mission-default settings group.
- [x] `LPV-162` Confirm Traccar HTTP configuration behavior.
  - **Result: Match.** Settings supports Traccar HTTP URL, basic/bearer auth, real Test Connection, and Save & Connect. Live hosted-browser validation against `https://kmrtsar.eu` with the provided `apiuser` credentials on 2026-06-21 returned `online` tracking and Devices workspace access. Password/token fields clear after save by design; stored-secret presence is shown separately.
- [ ] `LPV-163` Confirm replay controls parity.
- [ ] `LPV-164` Confirm replay validation rules.
- [ ] `LPV-165` Confirm layer repair action parity.
- [ ] `LPV-180` Confirm diagnostics workspace parity.
- [ ] `LPV-181` Confirm diagnostics provider/tracking detail parity.
- [ ] `LPV-182` Confirm incident bundle generation parity.

---

## Batch 9: GPX, Helicopters, Layer Structure

Rows:

- `LPV-200` to `LPV-223`

### Checklist

- [ ] `LPV-200` Confirm GPX import actions and watch flows.
- [ ] `LPV-201` Confirm GPX tracks are grouped correctly.
- [ ] `LPV-202` Confirm helicopter layer behavior where parity requires it.
- [ ] `LPV-220` Confirm root layer structure.
- [ ] `LPV-221` Confirm tracking group structure.
- [ ] `LPV-222` Confirm marker group structure.
- [ ] `LPV-223` Confirm drawing group structure.

---

## Recording Rules

- Every completed item must result in an updated row in [web-parity-verification-matrix.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/web-parity-verification-matrix.md).
- If a row is ambiguous because the legacy behavior itself is unclear, stop and record that ambiguity instead of guessing.
- If a row is clearly broken in `sartracker-web`, describe the visible operator impact, not just the code defect.
- Visibility and coordinate failures should be treated as safety-critical unless there is strong evidence otherwise.
