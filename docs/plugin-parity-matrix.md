# QGIS Plugin Replacement Parity Matrix

## Purpose

This document compares the legacy QGIS SAR Tracker plugin in
`/Users/donalocallaghan/Documents/Qgis/sartracker`
against the current `sartracker-web` application.

The goal is not just "plugin feature parity", but operational replacement parity:

- everything the plugin explicitly enabled
- the QGIS layer behaviours operators relied on for SAR work
- the mission lifecycle, tracking, drawing, coordinate, and persistence affordances that made the plugin usable in live incidents

This matrix is based on:

- plugin code and docs
- `sartracker-web` code, tests, and `handoff/HANDOFF.md`
- code/tests over stale planning docs when they disagree

## Status Legend

- `Complete`: implemented and operator-usable in `sartracker-web`
- `Partial`: some meaningful coverage exists, but behaviour/surface differs from the plugin baseline
- `Backend only`: persistence/backend support exists, but no complete operator workflow is exposed yet
- `Missing`: not implemented in a meaningful way yet

## Important Baseline Notes

- The plugin is more than a tracker. It is a SAR mission console inside QGIS.
- The plugin baseline includes some QGIS-native affordances operators depended on:
  - grouped layers in a layer tree
  - visibility toggles
  - persistent labels/symbology
  - item selection/editing through the map and layer panel
- Working CRS remains `ITM / EPSG:2157`.
- `TM65` is display/input support, not the working persisted CRS.
- Magnetic declination baseline is `-4.5°` for Ireland.
- `sartracker-web` status below is based on the current codebase, not older README wording.

## Parity Matrix

| Domain | Capability | Plugin / QGIS Baseline | `sartracker-web` Status | Evidence in `sartracker-web` | Gap / Notes |
| --- | --- | --- | --- | --- | --- |
| Mission lifecycle | Start mission | Plugin supports mission start with named mission and coordinator workflow | Complete | `src/features/mission/start-mission-runtime.ts`, `src/components/mission-control-panel.tsx`, `tests/e2e/mission.spec.ts` | Core start flow is present |
| Mission lifecycle | Pause mission | Plugin persists paused state and supports later resume | Complete | `src/features/mission/start-mission-runtime.ts`, `tests/e2e/mission.spec.ts` | Present |
| Mission lifecycle | Resume mission | Plugin resumes paused mission with timer continuity | Complete | `src/features/mission/start-mission-runtime.ts`, `tests/e2e/mission.spec.ts` | Present |
| Mission lifecycle | Finish mission | Plugin supports mission finish before archive/finalize | Complete | `src/features/mission/start-mission-runtime.ts`, `src/components/mission-control-panel.tsx`, `tests/e2e/mission.spec.ts` | Present |
| Mission lifecycle | Crash-safe recovery prompt | Plugin resumes paused/active mission after restart | Complete | `src/features/mission/start-mission-runtime.ts`, `src/components/mission-control-panel.tsx`, `tests/e2e/mission.spec.ts` | Recovery phase is implemented |
| Mission lifecycle | Start fresh instead of resume | Plugin lets operator abandon recoverable session and start clean | Complete | `src/features/mission/start-mission-runtime.ts`, `tests/e2e/mission.spec.ts` | Present |
| Mission lifecycle | Duplicate mission-name warning | Plugin warns on reuse/collision risks | Complete | `start-mission-runtime.ts`, `mission-control-panel.tsx`, `tests/e2e/mission.spec.ts` | Present |
| Mission lifecycle | Elapsed mission timer | Plugin tracks full elapsed time | Complete | `src/components/mission-control-panel.tsx`, mission runtime/timer usage, `tests/e2e/mission.spec.ts` | Present |
| Mission lifecycle | Active-search timer excluding paused time | Plugin tracks active search time separately | Complete | `src/components/mission-control-panel.tsx`, mission timer wiring, `tests/e2e/mission.spec.ts` | Present |
| Mission lifecycle | Custom start/resume timestamp entry | Plugin can accept operator-specified time values for mission/resume control | Partial | start flow accepts `startTime` in `src/features/mission/start-mission-runtime.ts` | Start-time input exists; plugin’s richer coordinator/resume timestamp workflow is not fully mirrored |
| Mission lifecycle | Coordinator identity capture | Plugin stores mission coordinator metadata | Missing | No coordinator roster or coordinator field surfaced in current UI/runtime searches | Important operational metadata gap |
| Mission lifecycle | Mission notes at lifecycle level | Plugin stores mission-level notes/summary data | Partial | persistence model includes `notes` on mission in `src/infrastructure/mission-store/tauri-mission-store.ts` | Not clearly exposed as a live operator workflow in current UI |
| Mission lifecycle | Finalize mission | Plugin has explicit finish then finalize/archive/lock flow | Backend only | `MissionStatus` includes `finalized`; `createMissionArchive` exists in `src/infrastructure/mission-store/tauri-mission-store.ts`; backend archive code exists in `src-tauri/src/persistence.rs` | No complete operator-facing finalize/archive workflow found in frontend |
| Mission lifecycle | Archive mission package | Plugin produces archiveable mission output | Backend only | `createMissionArchive` surface and Rust implementation | Backend is ready; UI/workflow still absent |
| Mission lifecycle | Locked post-finalization mission state | Plugin locks finalized missions | Backend only | persisted status includes `finalized` | Frontend does not yet expose archive/finalize governance |
| Mission lifecycle | Admin unlock finalized mission | Plugin supports privileged unlock workflow | Missing | `docs/bead-readiness.md` explicitly says admin unlock deferred to Phase 3 | Known deferred gap |
| Mission lifecycle | Autosave mission state | Plugin autosaves project state during operations | Complete | `src/features/persistence/mission-autosave.ts`, handoff M3/M5 notes, tests | Present |
| Mission lifecycle | Backup mirror sync | Plugin persists crash-safe backup copy | Complete | `syncBackup` surface in `tauri-mission-store.ts`, Rust persistence backup implementation | Present at persistence layer |
| Mission lifecycle | Mission audit events | Plugin records mission lifecycle/audit events | Backend only | `MissionEvent`, `listMissionEvents` in `tauri-mission-store.ts`, Rust audit/event support | Audit trail exists, but there is no operator-facing mission log UI yet |
| Tracking | Poll Traccar over HTTP | Plugin uses HTTP polling for v1 tracking | Complete | `src/features/tracking/traccar-client.ts`, `start-tracking-runtime.ts`, `tests/unit/traccar-client.test.ts`, `tests/unit/polling-manager.test.ts` | Present |
| Tracking | Current positions | Plugin shows latest position per device | Complete | tracking runtime/store, map tracking overlay, `tests/unit/start-tracking-runtime.test.ts` | Present |
| Tracking | Breadcrumb trails | Plugin shows per-device breadcrumb history from mission start | Complete | breadcrumb accumulator/tests, tracking overlay sync, `tests/unit/breadcrumb-accumulator.test.ts`, `tests/unit/tracking-geojson.test.ts` | Present |
| Tracking | Device deduplication to latest fix | Plugin deduplicates latest current point from raw positions | Complete | `tests/unit/start-tracking-runtime.test.ts`, `latestPositions` persistence usage | Present |
| Tracking | Persist tracked devices into mission store | Plugin persists device roster into mission data | Complete | `upsertDevice`, `listDevices`, `tests/unit/start-tracking-runtime.test.ts`, Rust device schema | Present |
| Tracking | Persist live/cache positions into mission store | Plugin persists position history for mission replay/review | Complete | `addPosition`, `listPositions`, `tests/unit/start-tracking-runtime.test.ts` | Present |
| Tracking | Online/offline/degraded state | Plugin surfaces tracking health and stale connectivity | Complete | tracking status panel, health logic, `docs/bead-readiness.md`, `tests/unit/tracking-snapshot-health.test.ts` | Present |
| Tracking | Last-good cache when Traccar unreachable | Plugin never clears map just because server is unreachable | Complete | tracking cache payload/runtime tests, `tests/unit/start-tracking-runtime.test.ts`, `tests/unit/tracking-cache-payload.test.ts` | Present |
| Tracking | Data-origin distinction (`live` vs `cache`) | Plugin differentiates stale cached data from live updates | Complete | `Position.data_origin` in mission store types; normalization/runtime tests | Present |
| Tracking | Stale device detection | Plugin marks stale/offline devices when no update arrives | Complete | device status and tracking health tests | Present |
| Tracking | Device list management window | Plugin has dedicated device visibility/admin window | Partial | Layer panel has People section with per-device toggles and search in `src/components/layer-filter-panel.tsx` | Functional replacement for visibility exists, but no dedicated devices window equivalent |
| Tracking | Replay / testing window | Plugin has replay/testing mode and historical playback safeguards | Missing | No replay/playback operator workflow found; only future design doc for WebSocket exists | High-value operational gap |
| Tracking | Operator-configurable Traccar settings | Plugin exposes settings dialog/config workflow | Missing | current config is env-only in `src/features/tracking/tracking-runtime-config.ts` | Web app currently requires build/runtime env setup, not operator setup |
| Tracking | Authentication variants for Traccar | Plugin supports real deployment auth/session shape | Partial | env config supports email/password/token in `tracking-runtime-config.ts` | Needs validation against production KMRT Traccar and likely a settings UI |
| Tracking | Connection restored messaging | Plugin surfaces offline then restored state | Partial | health/cached behaviour exists in runtime and docs | Need confirmation the full operator messaging matches plugin expectations |
| Map | Map canvas with SAR basemap support | Plugin piggybacks on QGIS map canvas and OSI base layers | Complete | `src/components/map-view.tsx`, basemap controls, map controller, e2e map coverage | Present inside MapLibre-based shell |
| Map | Basemap switching | QGIS/plugin baseline provides map layer switching | Complete | `map-view.tsx`, `use-map-controller.ts`, `tests/e2e/map.spec.ts` | Present |
| Map | Coordinate hover/readout | Plugin/QGIS exposes cursor coordinate display | Complete | `src/components/map-view.tsx`, coordinate display support | Present |
| Map | Offline-after-view tile caching | Web replacement supports viewed tile reuse | Complete | existing map implementation and docs/handoff notes | Present |
| Map | Packaged/offline topo map bundles | QGIS can operate with local data/offline sources more deeply than viewed-tile cache | Partial | `docs/offline-map-resilience.md`, offline map readiness badge/model | Field-ready viewed-tile workflow is explicit and tested; packaged regional bundles remain a gap if full offline parity is required |
| Coordinates | WGS84 display | Plugin shows lat/lon on markers and map | Complete | marker dialog coordinate readouts, map coordinate bar | Present |
| Coordinates | ITM working grid support | Plugin uses ITM as working CRS | Complete | marker persistence includes `irish_grid_e/n`; coordinate utilities and dialogs support ITM | Present |
| Coordinates | TM65 display support | Plugin supports TM65 display/input for operators | Complete | marker dialog shows `TM65 Grid Ref` | Display support present |
| Coordinates | Coordinate validation | Plugin validates coordinates on critical paths | Complete | coordinate library/tests plus strict normalized tracking parsing | Present |
| Coordinates | Magnetic / true bearing conversion | Plugin uses Ireland declination `-4.5°` | Complete | `src/components/drawing-dialog.tsx`, `src/features/drawings/drawing-math.ts`, `tests/unit/drawing-math.test.ts` | Present |
| Markers | IPP/LKP markers | Plugin supports IPP/LKP marker type | Complete | marker types in store/UI, `src/components/marker-dialog.tsx`, `tests/e2e/marker.spec.ts` | Present |
| Markers | Clue markers | Plugin supports clue marker type | Complete | same | Present |
| Markers | Hazard markers | Plugin supports hazard marker type | Complete | same | Present |
| Markers | Casualty markers | Plugin supports casualty marker type | Complete | same | Present |
| Markers | Marker create/edit/delete from map | Plugin supports map-driven create/edit/delete | Complete | marker runtime, map interactions, dialog, `tests/e2e/marker.spec.ts` | Present |
| Markers | Marker name/description | Plugin supports editable free-text details | Complete | `marker-dialog.tsx` | Present |
| Markers | Subject category on IPP/LKP | Plugin supports subject categorization | Complete | `marker-dialog.tsx`, marker definitions | Present |
| Markers | Clue type/confidence/found-by | Plugin supports structured clue metadata | Complete | `marker-dialog.tsx` | Present |
| Markers | Hazard type/severity | Plugin supports structured hazard metadata | Complete | `marker-dialog.tsx` | Present |
| Markers | Casualty condition/treatment/evac priority/found-by | Plugin supports casualty-specific metadata | Complete | `marker-dialog.tsx` | Present |
| Markers | Marker display order | QGIS/plugin ordering matters for list/render stability | Complete | `display_order` in store and marker runtime tests | Present |
| Markers | Marker attachments/photos | Plugin supports richer field evidence/attachments in some marker workflows | Missing | No attachment/file support in marker schema or UI | Significant gap if attachments are operationally required |
| Markers | Marker audit fields such as updater/coordinator attribution | Plugin stores richer audit metadata on some items | Missing | no such marker fields in current mission store type or dialog | Gap |
| Drawings | Line tool | Plugin supports free line drawing | Complete | toolbar, drawing runtime, dialog, `tests/e2e/drawing-tools.spec.ts` | Present |
| Drawings | Search area polygon tool | Plugin supports search polygons with metadata | Complete | `search_area` drawing type, dialog, e2e tests | Present |
| Drawings | Search area metadata: team | Plugin supports assignment/team tagging | Complete | `drawing-dialog.tsx` | Present |
| Drawings | Search area metadata: status | Plugin supports area status workflow | Partial | `SEARCH_AREA_STATUSES` in `drawing-types.ts` | Implemented values do not exactly match plugin/QGIS values; semantic mapping needs validation |
| Drawings | Search area metadata: POA | Plugin supports probability-of-area entry | Complete | `drawing-dialog.tsx` and persistence metadata | Present |
| Drawings | Search area metadata: terrain | Plugin supports terrain notes | Complete | `drawing-dialog.tsx` | Present |
| Drawings | Search area metadata: notes | Plugin supports area notes | Complete | `drawing-dialog.tsx` | Present |
| Drawings | Search area area calculation | Plugin calculates/search-area geometry metrics | Complete | geodesic area in `drawing-dialog.tsx` | Present |
| Drawings | Range rings manual mode | Plugin supports operator-defined ring radius/count | Complete | `range_ring` draft/dialog/runtime/tests | Present |
| Drawings | Range rings LPB mode | Plugin supports LPB-derived percentile rings | Complete | `range_ring` LPB mode in dialog/runtime/tests | Present |
| Drawings | Bearing line tool | Plugin supports origin + bearing + distance workflow | Complete | `bearing_line` runtime/dialog/tests | Present |
| Drawings | Bearing line true/magnetic input handling | Plugin supports true/magnetic operator entry | Complete | `drawing-dialog.tsx`, drawing math tests | Present |
| Drawings | Search sector tool | Plugin supports sector geometry | Complete | `search_sector` tool/runtime/dialog/tests | Present |
| Drawings | Text label drawing | Plugin/QGIS baseline supports text labels on map | Partial | `text_label` exists in persistence types, visibility labels, drawing GeoJSON styling | No operator tool or dialog for creating/editing text labels is exposed |
| Drawings | Drawings editable after creation | Plugin supports selecting/editing/deleting created items | Complete | select tool, dialog edit/delete flows, drawing runtime | Present for implemented drawing types |
| Drawings | Drawings display order | Plugin/QGIS ordering matters for list/render stability | Complete | `display_order` in store/runtime tests | Present |
| Drawings | Temporary measurement-like drawings | Plugin historically had measurement-like map aids | Partial | `temporary_measure` exists in drawing schema | Web app implemented measurements as a separate subsystem instead of drawing records |
| Measurements | Quick two-point distance + bearing measurement | Plugin supports temporary measure tool | Complete | `src/features/measurements/`, `src/components/measurement-panel.tsx`, `tests/e2e/measurement.spec.ts` | Present |
| Measurements | Persistent labels on measurements | Plugin/QGIS measure aids show readable outputs | Complete | measurement overlay/label generation | Present |
| Measurements | Clear all measurements | Plugin/QGIS allow clearing temp aids | Complete | `measurement-panel.tsx`, e2e tests | Present |
| Measurements | Clear on mission finish | Plugin clears temporary aids when mission ends | Complete | handoff M9 note, measurement runtime tests/e2e | Present |
| Layers / visibility | Per-device visibility toggles | QGIS layer visibility and plugin device filtering are operationally important | Complete | People section in `layer-filter-panel.tsx`, visibility store, filter tests | Present |
| Layers / visibility | Search/filter within people list | Plugin device management includes practical roster filtering | Complete | `peopleSearch` in visibility store and panel | Present |
| Layers / visibility | Per-marker-type visibility toggles | Plugin/QGIS supports marker-type visibility | Complete | marker type visibility in panel/store/filter logic | Present |
| Layers / visibility | Per-drawing-type visibility toggles | Plugin/QGIS supports drawing-type visibility | Complete | drawing type visibility in panel/store/filter logic | Present |
| Layers / visibility | Per-drawing-item visibility toggles | QGIS layer tree/item visibility equivalent | Complete | `hiddenDrawingIds` in visibility store and panel | Present |
| Layers / visibility | All On / All Off controls | Plugin/QGIS operational convenience for fast decluttering | Complete | panel actions for people, markers, drawings | Present |
| Layers / visibility | Visibility applied at actual map layer filter level | Replacement should hide on-map features, not just UI rows | Complete | `src/features/layers/map-layer-filters.ts`, map overlay sync, unit tests | Present |
| Layers / visibility | Grouped operational sections | QGIS has grouped layer tree; plugin grouped tracking/markers/drawings conceptually | Partial | right sidebar sections: People, Markers, Drawings | Present as simplified groups, but not a full tree/catalog |
| Layers / visibility | Nested layer tree | QGIS baseline gives nested tree of groups/layers | Missing | current panel is flat sections with item rows | Important QGIS parity gap |
| Layers / visibility | Reorder layers/groups by operator | QGIS baseline supports manual layer ordering | Missing | no drag reorder UI found | Current ordering is app-defined, not operator-managed |
| Layers / visibility | Rename layer/group labels | QGIS baseline supports layer naming flexibility | Missing | no layer/group rename affordance found | Gap |
| Layers / visibility | Expand/collapse nested subgroups | QGIS baseline supports hierarchical expansion | Missing | only entire panel collapse/expand exists | Gap |
| Layers / visibility | Layer tree reflects tracking + markers + drawings together | Plugin/QGIS present one operational layer model | Partial | panel centralizes sections, but overlays remain source-specific under the hood | Works functionally, but not a full QGIS-style unified layer tree |
| Layers / visibility | Label visibility/symbology customization by operator | QGIS baseline allows deep styling control | Missing | no operator styling panel found | Current app uses fixed operational styling |
| Layers / visibility | Attribute-table style inspection of layers/items | QGIS baseline allows browsing feature attributes in table form | Missing | no attribute table UI found | Gap for deep inspection/audit workflows |
| Layers / visibility | Direct map selection of existing items | Plugin/QGIS lets operator click existing items to edit/inspect | Complete | marker and drawing interaction hooks | Present |
| Layers / visibility | Separate helicopter layer/category | Plugin has helicopter layer support | Missing | no helicopter layer/runtime found | Gap if aviation coordination matters |
| Persistence | SQLite mission store | Plugin evolved to structured mission persistence; web app targets SQLite behind Tauri | Complete | Rust persistence implementation and mission store interface | Present |
| Persistence | Schema migrations/versioning | Plugin and web app both require durable schema evolution | Complete | Rust persistence schema/versioning, docs/handoff | Present |
| Persistence | Crash-safe backup writes | Plugin baseline requires no partial-write loss | Complete | WAL + backup mirror design/implementation | Present |
| Persistence | Marker persistence | Plugin persists markers | Complete | mission store CRUD + runtime/tests | Present |
| Persistence | Drawing persistence | Plugin persists drawings | Complete | mission store CRUD + runtime/tests | Present |
| Persistence | Position history persistence | Plugin persists breadcrumbs/history | Complete | positions tables/runtime/tests | Present |
| Persistence | Mission archive ZIP export | Plugin final archive package | Backend only | archive implementation in Rust | UI still absent |
| Operator tooling | Focus mode / simplified ops shell | Plugin offers focus mode to strip QGIS clutter | Missing | no focus mode found in app search | Current shell is already simplified, but there is no explicit focus-mode control |
| Operator tooling | Diagnostics panel | Plugin includes diagnostics/support tooling | Missing | no diagnostics UI found | Gap |
| Operator tooling | Mission log viewer | Plugin has operational logs/audit visibility | Missing | audit events backend exists, but no viewer | Gap |
| Operator tooling | GPX import/watch | Plugin docs/code mention GPX support workflows | Missing | no GPX import/watch surface found | Gap |
| Operator tooling | Browser/E2E validation harness | Not a plugin feature, but valuable replacement quality tooling | Complete | `src/features/browser-validation/`, Playwright coverage | Strong internal quality support, though not operator-facing |

## Summary By Domain

### Areas that are already strong replacements

- Mission start/pause/resume/finish and recovery
- Traccar HTTP polling, current positions, breadcrumbs, stale/offline handling, cached fallback
- Marker CRUD for the four operational marker classes
- Core drawing toolset: line, search area, range rings, bearing lines, search sectors
- Measurement tool as a dedicated subsystem
- Basemap switching, coordinate display, viewed-tile caching
- Per-device, per-marker-type, per-drawing-type, and per-drawing-item visibility
- SQLite-backed persistence for missions, markers, drawings, positions, and backups

### Areas that are only partial replacements

- Search-area status vocabulary and workflow mapping
- Device-management parity beyond simple visibility/search
- Grouped layer behaviour: conceptually present, but much flatter than QGIS
- Text labels: persisted/styled in schema, but not operator-creatable
- Traccar configuration: technically supported, but env-driven rather than operator-managed
- Mission notes/coordinator/admin metadata parity

### Major remaining replacement gaps

- Finalize/archive/unlock operator workflow
- Replay/testing mode
- Full QGIS-like layer tree behaviour
- Mission log / audit viewer
- Diagnostics panel
- GPX import/watch
- Helicopter layer support
- Marker attachments / richer evidence fields
- Focus mode toggle
- Packaged offline basemap strategy, if true field-offline parity is required

### Second-Pass Specificity Confirmed In Plugin Code

- The plugin settings workspace is broader than just provider credentials:
  - coordinator roster
  - admin roster for unlock authority
  - secure credential storage
  - provider test/save/connect flows
  - replay-window configuration
  - layer-repair tooling
- The plugin mission-logs workspace is broader than a simple event log:
  - mission details summary
  - searchable marker log
  - hierarchical layer console
  - attachment opening
  - rename/alias/favorite/reorder/visibility operations initiated from the review UI
- The plugin layer catalog stores richer metadata than the current web filter panel:
  - aliases
  - favorites
  - expanded/collapsed state
  - display order
- The plugin has two operator utilities that are clearly first-class and still absent in the web app:
  - dedicated devices window
  - coordinate converter dialog


## Highest-Value Next Gaps

If the target is "the team can leave QGIS behind without losing critical operator capability", the most important gaps look like this:

1. Finalization workflow
2. Replay/testing workflow
3. Mission log/audit visibility
4. Operator-configurable Traccar settings
5. Text-label tool
6. QGIS layer-tree parity for grouping and operator control
7. GPX import/watch if it is still operationally used
8. Richer marker evidence/attachments if used in current missions

## Practical Interpretation

`sartracker-web` is already beyond "prototype" for core live SAR operations:

- mission control works
- tracking works
- markers work
- drawings work
- measurement works
- persistence works

The remaining gap is less about basic mapping and more about the operational edges that make the QGIS plugin a full incident tool:

- post-mission governance
- richer operator admin/diagnostics workflows
- replay/review tooling
- some QGIS-native layer-management affordances
