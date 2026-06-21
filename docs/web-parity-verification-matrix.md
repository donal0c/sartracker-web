# Web Parity Verification Matrix

> **Retrospective compilation pending.** This matrix was left in `Pending` state during Phase 2 while the parity program was executed. The live sources are `docs/plugin-parity-matrix.md` (canonical per-capability status) and `handoff/HANDOFF.md` (batch-level verification evidence — batches 1–4 verified). Do not treat this file as blocking truth.

## Purpose

This matrix exists to compare `sartracker-web` against the legacy QGIS plugin behavior item by item.

Legacy source of truth:

- [legacy-plugin-operator-verification-spec.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/legacy-plugin-operator-verification-spec.md)

Runtime execution source for legacy validation:

- [legacy-plugin-runtime-checklist.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/legacy-plugin-runtime-checklist.md)

## How To Use

For each `LPV-*` item:

1. confirm the legacy behavior
2. inspect or test `sartracker-web`
3. record the result without hand-waving

Recommended parity result values:

- `Match`
- `Partial`
- `Mismatch`
- `Missing`
- `Legacy disabled in UI`
- `Needs runtime proof`

Recommended severity values:

- `Critical`
- `High`
- `Medium`
- `Low`

## Column Definitions

- `LPV ID`: legacy verification item identifier
- `Area`: feature area
- `Legacy Behavior`: short statement of expected legacy behavior
- `Legacy Status`: `Confirmed`, `Needs runtime confirmation`, `Disabled in UI`, etc.
- `Legacy Evidence`: legacy file/test/runtime note
- `Web Status`: current `sartracker-web` result
- `Web Evidence`: file/test/manual note
- `Gap Summary`: plain-English description of mismatch
- `Severity`: operational importance
- `Issue / Follow-up`: linked Linear issue or explicit action

---

## Matrix

| LPV ID | Area | Legacy Behavior | Legacy Status | Legacy Evidence | Web Status | Web Evidence | Gap Summary | Severity | Issue / Follow-up |
|---|---|---|---|---|---|---|---|---|---|
| LPV-001 | Primary surfaces | SAR panel exists as docked ops surface | Pending | `ui/sar_panel.py` | Pending |  |  | High |  |
| LPV-002 | Primary surfaces | Focus Mode Plus toggle exists with coordinate mirroring | Pending | `ui/sar_panel.py`, focus tests | Pending |  |  | Medium |  |
| LPV-003 | Mission surface | Mission section shows name, status, timers, storage, auto badges | Pending | `ui/sar_panel.py` | Pending |  |  | High |  |
| LPV-004 | Provider status | SAR panel provider section is read-only display | Pending | `ui/sar_panel.py` | Pending |  |  | Medium |  |
| LPV-005 | Review surfaces | Layer Console and Marker Log live in Mission Logs window, not panel | Pending | `ui/sar_panel.py`, `ui/mission_logs_window.py` | Pending |  |  | Medium |  |
| LPV-006 | Devices | Devices are in standalone window, not main panel | Pending | `ui/sar_panel.py`, `ui/devices_window.py` | Pending |  |  | Medium |  |
| LPV-020 | Mission lifecycle | Mission name editable before mission start | Confirmed in legacy | `ui/sar_panel.py` | Match | `MissionControlPanel` shows name input only in idle state; empty name is blocked by validation. E2E: `mission.spec.ts` verifies name is provided before start and appears in active mission header. | Mission name must be entered in idle state and is sent to runtime start API. | Low | — |
| LPV-021 | Mission lifecycle | Start offset exists and is bounded `0-5h` | Confirmed in legacy | `ui/sar_panel.py` | Intentional extension | `mission-control-panel.tsx` and `start-mission-runtime.ts` now validate `0..48` so hosted testing can request older Traccar breadcrumb windows when recent movement is sparse. Unit and E2E coverage verifies 48h is valid and 49h is rejected. | Start offset remains bounded, with the web app deliberately extending the legacy 5h ceiling to support hosted tracking-history validation. | Medium | Web extension documented for hosted testing. |
| LPV-022 | Mission lifecycle | Start Mission creates mission and starts timers | Confirmed in legacy | mission controller/tests | Match | Start flow in `mission-control-panel.tsx` transitions `phase` to active and shows both timers; `mission.spec.ts` test “starts a mission with a back-dated offset” verifies immediate active state and elapsed timer progression. | Active mission starts with timers running on start. | Critical | — |
| LPV-023 | Mission lifecycle | Pause enters paused state and changes control state | Confirmed in legacy | mission controller/tests | Match | `mission-control-panel.tsx` pause button state is tied to `phase`; pause action sets phase to paused. `mission.spec.ts` validates phase and button label change on pause. | Pause immediately updates control state and mission phase. | Critical | — |
| LPV-024 | Mission lifecycle | Resume returns paused mission to active | Confirmed in legacy | mission controller/tests | Match | Resume path in `mission-control-panel.tsx` toggles from paused to active via `handlePauseOrResume`; `mission.spec.ts` verifies resume path and active-search timer behavior. | Paused mission transitions correctly to active. | Critical | — |
| LPV-025 | Mission lifecycle | End Mission finishes without auto-finalize | Confirmed in legacy | mission lifecycle code | Match | `mission-control-panel.tsx` routes finish through confirmation dialog only. `mission.spec.ts` verifies finish returns to idle and only shows finalize from governance flow later. | Finish confirms and ends mission state only. | High | — |
| LPV-026 | Mission lifecycle | Finalize Mission button appears only after mission end | Confirmed in legacy | `ui/sar_panel.py` | Match | Governance card/button in `mission-control-panel.tsx` shows `Archive & Lock` when `governanceMission.status === 'finished'`; not shown during active/paused lifecycle states. E2E flow validates this by finishing then finalizing. | Finalize path gated behind finished mission governance state. | High | — |
| LPV-027 | Mission lifecycle | Finalize means archive and lock read-only | Confirmed in legacy | mission lifecycle/storage code | Match | `mission-control-panel.tsx` finalize path uses governance controller; `mission.spec.ts` confirms finalized status and text path after confirm; unlock test confirms finished missions can only be edited after explicit admin unlock. | Finalization persists archived result and final locked state with undo restricted to unlock flow. | Critical | — |
| LPV-028 | Mission lifecycle | Resume mission prompt exists on restart/reopen | Confirmed in legacy | lifecycle controller/tests | Match | Recovery state preserved in mission store; `MissionControlPanel` shows recovery dialog when phase `recovery`; `mission.spec.ts` includes resume and start-fresh recovery flows. | Resume prompt is surfaced after reload when a recoverable mission exists. | High | — |
| LPV-029 | Governance | Mission metadata/coordinator dialog exists | Confirmed in legacy | metadata dialog | Mismatch | Plugin has `mission_metadata_dialog.py`; web mission start currently provides no metadata/coordinator capture dialog in start flow. Metadata is managed post-finish in governance card only. | Missing mission-level coordinator workflow dialog for mission creation and metadata capture. | Medium | Feature gap (`mission_metadata_dialog`-equivalent not implemented). |
| LPV-040 | Tracking | Traccar HTTP is primary live provider | Confirmed in legacy | `traccar_http.py`, `tasks.py`, `provider_controller.py` | Match | `traccar-client.ts:36-169` HTTP client with auth/retry/timeout; `polling-manager.ts` orchestration; 8 unit tests; E2E `full-mission-flow.spec.ts` | Full Traccar HTTP provider workflow | Critical | — |
| LPV-041 | Tracking | Tracking uses roster + current positions + breadcrumbs | Confirmed in legacy | `traccar_http.py` | Match | `polling-manager.ts:125-130` parallel device+position fetch; `polling-manager.ts:192-216` per-device breadcrumb fetch; unit tests cover incremental loading | Three separate fetch paths matching legacy provider pattern | Critical | — |
| LPV-042 | Tracking | One labeled current marker per visible device | Confirmed in legacy | `tracking_manager.py`, `test_per_device_tracking.py` | Match | `sync-tracking-overlay.ts` renders both symbol text and circle layers for current positions. `tracking-geojson.ts` now includes `name` from device metadata (fallback to `device_id`). | Current-position markers include readable map labels tied to devices. | Critical | — |
| LPV-043 | Tracking | Breadcrumbs accumulate per device and segment on gaps | Confirmed in legacy | `tracking_manager.py:3087`, `tracking_segments.py`, `test_tracking_segments.py` | Match | `breadcrumb-accumulator.ts:26-58` gap-aware segmentation; `sync-tracking-overlay.ts:21` uses 5min threshold; 2 unit tests verify dedup and gap splitting | Breadcrumb segmentation matches legacy >5min gap behavior | Critical | — |
| LPV-044 | Tracking | Device filtering affects map visibility, not full roster visibility | Confirmed in legacy | `device_filtering.py`, `test_device_filtering.py` | Match | `map-layer-filters.ts:9-17` MapLibre filter; `device-workspace-model.ts:31-69` roster shows all devices; E2E `devices-workspace.spec.ts` + Batch 1 `parity-visibility.spec.ts` LPV-240 | Filtering correctly separated between map and roster | Critical | — |
| LPV-045 | Tracking resilience | Bad/empty poll should not blank situational awareness | Confirmed in legacy | `provider_controller.py`, `traccar_http.py`, `test_provider_controller_refresh.py` | Match | `polling-manager.ts:55,134,155-162` retains `lastGoodSnapshot` on failure with OFFLINE MODE warning; unit tests verify resilience | Last-good cache prevents map blank on failures | Critical | — |
| LPV-046 | Tracking visuals | Device colors are deterministic | Confirmed in legacy | `test_device_colors.py` | Match | `tracking-color.ts:31-34` FNV-1a hash of device_id against 12-color SAR palette; 3 unit tests verify determinism/validity/diversity | Same device always gets same high-visibility color | Medium | — |
| LPV-047 | Tracking visuals | Initial zoom can frame tracked devices | Confirmed in legacy | `test_initial_zoom_buffering.py` | Match | `use-map-overlays.ts` now calls `buildTrackingInitialExtent` and applies `map.fitBounds` once per mission when current tracking positions first become available. | Map initially frames all current tracked devices with buffered extent and max zoom cap on first render. | Medium | — |
| LPV-048 | Devices | Devices window shows name/status/last update and refreshes on show | Confirmed in legacy | `devices_window.py`, `devices_controller.py`, `test_devices_window.py` | Match | `devices-workspace.tsx:16-299` renders name/status/last-seen/source/battery/speed; refresh button triggers reconnect; E2E `devices-workspace.spec.ts` 3 tests | Full devices workspace with all required fields | High | — |
| LPV-060 | Layer tree | Layer Console is hierarchical | Confirmed in legacy | `layer_console_widget.py`, `layer_catalog.py`, `test_layer_catalog.py` | Match | `layer-filter-panel.tsx:156-264` recursive TreeNodeRow; E2E `layer-panel.spec.ts` confirms group/layer structure | Web tree renders groups → layers → feature items with correct nesting | Critical | — |
| LPV-061 | Layer tree | Type filters exist and match expected categories | Confirmed in legacy | `layer_console_widget.py:189` | Missing | No type filter dropdown in `layer-filter-panel.tsx`. Full code inspection confirms absence. | Legacy has 10-option type filter (All Types, Favorites, Markers, etc.). Web has no equivalent — tree grouping provides type navigation but no explicit filter control. | Medium | Feature gap — needs implementation if parity required |
| LPV-062 | Layer tree | Search filters layers/features | Confirmed in legacy | `layer_console_widget.py:209` | Match | `layer-filter-panel.tsx:97-103` search input; `layer-catalog-tree.ts:83-127` filterCatalogTree; E2E `layer-panel.spec.ts` tests search filtering | Search input filters tree; matching ancestors preserved. Reactive rather than debounced, but operator behavior equivalent. | Medium | — |
| LPV-063 | Layer tree | Show hidden toggle exists | Confirmed in legacy | `layer_console_widget.py:232` | Match | `layer-filter-panel.tsx` "Show Hidden" checkbox; `layer-tree-ui-store.ts` `showHidden` state; `filterHiddenNodes()` in `layer-catalog-tree.ts`. Playwright: `parity-layer-console.spec.ts` LPV-063 | Toggle defaults ON (safety-first: all items visible). When OFF, hidden items (unchecked visibility) are excluded from tree listing for declutter. | Medium | — |
| LPV-064 | Layer tree | Manual refresh exists | Confirmed in legacy | `layer_console_widget.py:238` | Match | `layer-filter-panel.tsx` "Refresh" button; `forceRefresh()` on `LayerCatalogController` in `start-layer-catalog-runtime.ts`. Playwright: `parity-layer-console.spec.ts` LPV-064 | Refresh button reloads metadata from persistence and rebuilds the catalog tree. Auto-refresh remains the primary path; button is resilience fallback. | Low | — |
| LPV-065 | Layer tree | Expand All exists | Confirmed in legacy | `layer_console_widget.py:246` | Match | `layer-filter-panel.tsx` "Expand All" button; `collectAllExpandableNodeIds()` in `layer-catalog-tree.ts`; `resetExpandedNodeIds()` in `layer-tree-ui-store.ts`. Playwright: `parity-layer-console.spec.ts` LPV-065 | Button expands all groups and layers in the tree. | Low | — |
| LPV-066 | Layer visibility | Layer and feature visibility toggles exist and work | Confirmed in legacy | `layer_console_widget.py`, `test_layer_tree_canvas_sync.py`, `test_per_item_layer_factory_visibility.py` | Match | `layer-filter-panel.tsx:199-214` visibility checkbox; `applyVisibilityForNodes()` for store sync; Playwright `parity-visibility.spec.ts` LPV-240..LPV-247 | Toggles at group, layer, and feature item levels. Batch 1 fix ensures MapLibre filters update synchronously. | Critical | — |
| LPV-067 | Layer metadata | Alias, favorite, reorder actions exist | Confirmed in legacy | `layer_console_widget.py`, `mission_logs_controller.py:527` | Partial | Alias and Move Up/Down exist in `layer-filter-panel.tsx`; Favorite was intentionally removed from the live UI in `DON-73` because it had no operational consumer yet. The persisted `isFavorite` metadata field remains for compatibility, but there is no current Favorite control or `toggleFavorite` controller action. | Alias and reorder are implemented and persisted. Favorite is preserved only as dormant metadata, not as an operator-facing action. | Medium | Decide whether legacy Favorite parity still matters; if yes, define the operational consumer before reintroducing UI. |
| LPV-068 | Layer actions | Context menu supports rename/delete/zoom/export etc. | Confirmed in legacy | `layer_console_widget.py:1230`, `test_edit_marker_context_menu.py` | Missing | No `onContextMenu` handler in `layer-filter-panel.tsx`. Inspector pane provides rename/reorder, but not delete/zoom/export/duplicate or the removed Favorite action. | Legacy right-click menu provides select/rename/delete/zoom/export/duplicate per feature. Web has partial equivalents in the inspector, but delete/zoom/export/duplicate are absent from the tree surface. | Medium | Feature gap — at minimum, delete and zoom-to-feature are operator-important |
| LPV-069 | Layer actions | Bulk operations exist with tracking-layer protections | Confirmed in legacy | `layer_console_widget.py:1532`, `layer_console_widget.py:1560` | Missing | Catalog controller exposes refresh/select/rename/visibility/batch visibility/reorder. No delete, export, or bulk actions. No tracking layer protection. | Legacy provides bulk delete, bulk export, team assignment, and tracking layer protection. None of these exist in the web app. | Medium | Feature gap — needs implementation for operational completeness |
| LPV-070 | Layer sync | Tree and canvas stay synchronized | Confirmed in legacy | `test_layer_tree_canvas_sync.py`, `test_layer_console_filters.py` | Match | Playwright `parity-visibility.spec.ts` LPV-247 + `layer-panel.spec.ts` persistence test. `applyVisibilityForNodes()` ensures synchronous store updates. | Tree toggles propagate immediately to MapLibre via Batch 1 fix. Alias and visibility persist across reload. | Critical | — |
| LPV-080 | Markers | Generic marker/clue entry point exists | Pending | SAR panel | Pending |  |  | Medium |  |
| LPV-081 | Markers | Marker-at-grid flow exists | Pending | SAR panel + grid dialog | Pending |  |  | Medium |  |
| LPV-082 | Markers | Marker types include IPP/LKP, Clue, Hazard, Casualty | Pending | marker manager/schema | Pending |  |  | Critical |  |
| LPV-083 | Markers | Marker placement is map-click driven and coordinate-validated | Pending | marker tool/controller | Pending |  |  | Critical |  |
| LPV-084 | Markers | Marker dialog shows type-specific fields | Pending | marker dialog | Pending |  |  | High |  |
| LPV-085 | Markers | Marker CRUD exists | Pending | marker controller/manager | Pending |  |  | Critical |  |
| LPV-086 | Markers | Marker attachments and audit metadata exist | Pending | marker manager | Pending |  |  | High |  |
| LPV-100 | Drawings | Line tool exists and persists lines | Pending | line tool/drawing manager | Pending |  |  | High |  |
| LPV-101 | Drawings | Search Area exists, but may be disabled in this legacy UI branch | Pending | panel + polygon tool | Pending |  |  | High |  |
| LPV-102 | Drawings | Search Area metadata supports team/status/priority/POA/etc. | Pending | polygon tool | Pending |  |  | High |  |
| LPV-103 | Drawings | Range Rings tool exists with manual and LPB modes | Pending | range ring tool | Pending |  |  | High |  |
| LPV-104 | Drawings | Bearing Line tool exists with true/magnetic conversion | Pending | bearing tool | Pending |  |  | High |  |
| LPV-105 | Drawings | Search Sector exists in code, may be disabled in main panel | Pending | sector tool/panel | Pending |  |  | Medium |  |
| LPV-106 | Drawings | Text Label exists in code, may be disabled in main panel | Pending | text label code/panel | Pending |  |  | Medium |  |
| LPV-107 | Drawings | Drawing items support update flows | Pending | drawing manager | Pending |  |  | High |  |
| LPV-120 | Measurement | Measure Distance & Bearing exists and pins overlays | Pending | measure tool | Pending |  |  | High |  |
| LPV-121 | Measurement | Pinned measurement indicator and clear action exist | Pending | SAR panel | Pending |  |  | Medium |  |
| LPV-122 | Coordinates | Coordinate Converter supports WGS84/ITM/TM65 flows | Pending | coord dialog/tests | Pending |  |  | Critical |  |
| LPV-123 | Coordinates | Live cursor coordinates and focus-mode mirroring exist | Pending | coord controller + panel | Pending |  |  | Medium |  |
| LPV-140 | Review | Mission Logs opens as non-modal window | Pending | mission logs window | Pending |  |  | Medium |  |
| LPV-141 | Review | Mission Logs tabs are Mission Details / Marker Log / Layer Console | Pending | mission logs window | Pending |  |  | Medium |  |
| LPV-142 | Review | Mission Details shows mission metadata and counts | Pending | mission logs window | Pending |  |  | Medium |  |
| LPV-143 | Review | Marker Log supports search/review/open/zoom/edit/delete | Pending | marker log widget | Pending |  |  | High |  |
| LPV-144 | Review | Layer Console inside Mission Logs is operational | Pending | mission logs window/controller | Pending |  |  | High |  |
| LPV-160 | Settings | Settings is dedicated workspace/dock | Pending | settings panel | Pending |  |  | Medium |  |
| LPV-161 | Settings | Mission Defaults section covers auto-refresh/save, roots, rosters | Pending | settings panel | Pending |  |  | High |  |
| LPV-162 | Settings | Traccar HTTP configuration exists | Confirmed in legacy | settings + provider controller | Match | `settings-workspace.tsx`, `tauri-settings-store.ts`, `settings.spec.ts`; live hosted-browser validation against `https://kmrtsar.eu` on 2026-06-21 returned online tracking and Devices workspace access | Settings supports provider URL, basic/bearer auth, real Test Connection, and Save & Connect | Critical | Password/token field clears after save by design; stored-secret presence is shown separately |
| LPV-163 | Settings | Replay controls exist only for Traccar HTTP | Pending | settings panel/tests | Pending |  |  | High |  |
| LPV-164 | Settings | Replay validation enforces past-bounded valid windows | Pending | replay tests | Pending |  |  | High |  |
| LPV-165 | Settings | Layer repair action exists | Pending | settings panel | Pending |  |  | Medium |  |
| LPV-180 | Diagnostics | Diagnostics panel is operator-facing and multi-sectioned | Pending | diagnostics panel | Pending |  |  | Medium |  |
| LPV-181 | Diagnostics | Diagnostics includes provider/tracking details | Pending | diagnostics panel/tests | Pending |  |  | Medium |  |
| LPV-182 | Diagnostics | Incident bundle generation exists | Pending | diagnostics panel/tests | Pending |  |  | High |  |
| LPV-200 | GPX | GPX import menu exists with file/folder/watch actions | Pending | SAR panel + map tools controller | Pending |  |  | Medium |  |
| LPV-201 | GPX | GPX tracks have their own group | Pending | drawing manager | Pending |  |  | Medium |  |
| LPV-202 | Helicopters | Helicopter layer subsystem exists optionally | Pending | layers controller + helicopter manager | Pending |  |  | Low |  |
| LPV-220 | Layer structure | `SAR Tracker` root exists | Pending | schema/catalog | Pending |  |  | Medium |  |
| LPV-221 | Layer structure | Tracking is grouped as current positions / tracking trails | Pending | schema/catalog/tracking manager | Pending |  |  | High |  |
| LPV-222 | Layer structure | Markers grouped by marker type | Pending | schema | Pending |  |  | Medium |  |
| LPV-223 | Layer structure | Drawings grouped by drawing type | Pending | schema/drawing manager | Pending |  |  | Medium |  |
| LPV-240 | Critical visibility | Per-device tracking visibility toggle hides only that device’s marker/trail | Confirmed in legacy | `test_per_item_layer_factory_visibility.py`, `test_layer_tree_canvas_sync.py` | Match | `tests/e2e/parity-visibility.spec.ts` — `hiddenDeviceIds` correctly contains `’bravo’` after toggle, empty after re-toggle | Tree toggle hides device marker and trail via MapLibre filter, re-toggle restores | Critical | — |
| LPV-241 | Critical visibility | Marker-type visibility toggle hides only that type | Confirmed in legacy | `test_per_item_layer_factory_visibility.py` | Match | `tests/e2e/parity-visibility.spec.ts` — `markerTypeVisibility.clue=false` after toggle, `hazard` stays `true` | Type toggle hides all markers of that type; other types unaffected | Critical | — |
| LPV-242 | Critical visibility | Individual marker visibility toggle hides only that marker | Confirmed in legacy | `test_per_item_layer_factory_visibility.py` | Match | `tests/e2e/parity-visibility.spec.ts` — `hiddenMarkerIds` contains target, not other markers | Individual marker hidden via MapLibre filter while others remain visible | Critical | — |
| LPV-243 | Critical visibility | Drawing-type visibility toggle hides only that drawing type | Confirmed in legacy | `test_layer_tree_canvas_sync.py` | Match | `tests/e2e/parity-visibility.spec.ts` — `drawingTypeVisibility.range_ring=false` after toggle, `line` stays `true` | Type toggle hides all drawings of that type; other types unaffected | Critical | — |
| LPV-244 | Critical visibility | Individual drawing visibility toggle hides only that item | Confirmed in legacy | `test_per_item_layer_factory_visibility.py` | Match | `tests/e2e/parity-visibility.spec.ts` — `hiddenDrawingIds` contains target, not other drawings | Individual drawing hidden while others remain visible | Critical | — |
| LPV-245 | Critical visibility | Measurement visibility toggle hides pinned measurements | Confirmed in legacy | `test_layer_tree_canvas_sync.py` | Match | `tests/e2e/parity-visibility.spec.ts` — `measurementsVisible=false` after toggle, `true` after re-toggle | Measurement overlay data source emptied when hidden; restored when re-shown | High | — |
| LPV-246 | Critical visibility | Group visibility cascade behaves correctly | Confirmed in legacy | `test_layer_tree_canvas_sync.py` | Match | `tests/e2e/parity-visibility.spec.ts` — `hiddenDeviceIds` contains all devices + `breadcrumbsVisible=false` after group toggle; restored after re-enable | Group toggle cascades to all descendants via `setSubtreeVisibility` + `applyVisibilityForNodes` | Critical | — |
| LPV-247 | Critical visibility | Tree/canvas synchronization survives repeated changes | Confirmed in legacy | `test_layer_tree_canvas_sync.py` | Match | `tests/e2e/parity-visibility.spec.ts` — 5 consecutive toggles across device/marker/drawing types all correctly update store | Tree and canvas stay synchronized across rapid toggle sequences | Critical | — |

---

## Notes

- Do not collapse `Partial` and `Mismatch` into one bucket.
- If the legacy behavior is itself disabled in UI but implemented in code, record that explicitly.
- If the web app works differently on purpose, the justification must be written down; otherwise treat it as a parity gap.
- Visibility failures should usually be treated as `Critical` or `High` because operators rely on the layer tree to control what is actually shown.
