# HANDOFF.md — Current Project State

> **Read this before doing ANY work. Update this after EVERY chunk of work.**

## Last Updated
2026-04-10 13:25 by Codex

## Current State
**Phase: Phase 1 operational core complete — M1 through M10 complete; tactical UI modernization pass merged; parity program beads queued**

`HANDOFF.md` is the authoritative continuity log for active repo work across Donal, Codex, and Claude Code. Update it after every meaningful chunk so the next agent can resume without re-discovery.

## What's Been Done

### 2026-04-10 M10 integration flow completed
- Implemented M10 as a true full-mission Playwright integration pass instead of another narrow feature test
- Extended the browser validation harness so it now persists and rehydrates:
  - missions
  - tracking devices + positions
  - markers
  - drawings
- Added a typed browser-only harness API in `src/features/browser-validation/browser-harness-api.ts` so Playwright can:
  - inject mocked tracking snapshots cleanly
  - hydrate tracking state after reload/recovery
  - inspect persisted harness state without raw ad hoc storage parsing
- Updated `src/features/mission/mission-browser-harness.ts` to install the browser harness API and rehydrate tracking on startup
- Added focused unit coverage in `tests/unit/browser-harness-store.test.ts` for the new tracking-aware browser harness persistence
- Added `tests/e2e/full-mission-flow.spec.ts` covering the complete simulated SAR mission:
  - app load
  - mission start
  - mocked tracking arrival
  - IPP marker creation
  - clue marker creation
  - search-area drawing + team assignment
  - range ring creation
  - bearing line creation
  - device visibility toggle
  - measurement flow
  - pause/resume
  - crash-style reload + recovery prompt
  - mission finish
  - persisted-state verification
- Important implementation notes:
  - mocked tracking data is now treated as real mission persistence in the browser harness, so reload recovery validates device/position continuity instead of only UI state
  - measurements remain temporary operational aids and are not part of the persisted mission-record checks after reload
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅

### 2026-04-10 parity clarification pass against legacy plugin
- Reviewed `docs/parity-clarifications.md` against the actual legacy plugin code in `~/Documents/Qgis/sartracker` to replace open questions with plugin-grounded answers wherever possible
- Clarified from plugin code/tests/UI:
  - M12 settings workspace shape:
    - sections are `Mission Defaults`, `Data Sources`, and `Advanced Settings`
    - coordinator/admin rosters are simple identity lists
    - credentials are intentionally split into secure storage rather than normal settings
  - M13 replay/training mode:
    - plugin replay is a simple replay-window flow, not a scrubber/playback console
    - controls are enable + start datetime + duration hours
    - replay is provider-gated to `traccar_http`
    - replay uses isolated temp storage and auto-disables when a mission is active
  - M14 finalize/archive/unlock:
    - finalize is explicitly `Archive & Lock`
    - archive success is required before finalized state is set
    - archive includes `.qgz`, `.gpkg`, and attachments
    - admin unlock is name-based against the admin roster
  - M15 mission logs workspace:
    - plugin surface is a three-tab review workspace: `Layer Console`, `Marker Log`, `Mission Details`
    - attachment opening uses OS default app with missing-file warnings
  - M16 layer catalog:
    - canonical group/layer structure confirmed from plugin schema
    - group/layer/feature-item distinction confirmed from catalog code
    - presentation state vs mission metadata is a mixed persistence model
  - M18 coordinate converter:
    - modal dialog
    - supports WGS84, ITM, and TM65 inputs
    - go-to action zooms to a local extent and shows a temporary crosshair target
  - M19 devices workspace:
    - standalone window, not a docked mini-panel
    - click/refresh behavior confirmed
    - zoom-to-device is not required for plugin parity
  - M20 marker evidence/audit:
    - attachments are copied into mission-managed `attachments/`
    - attachment paths become mission-relative
    - attachments are mirrored to backup and included in archive
    - audit fields confirmed from plugin schema/UI
  - M21 diagnostics/repair:
    - diagnostics bundle format confirmed from code
    - repair scope is intentionally narrow: layer structure recreation/repair, not broad data mutation
  - M22 GPX:
    - one-off import, folder import, and watched-folder auto-import are all real plugin features
    - GPX imports create one layer per GPX file under `GPX Tracks`
    - duplicate suppression is file-path based
  - M23 helicopters:
    - placeholder-first canonical helicopter layers are real
    - four fixed slots/colors and field set confirmed
  - M24 focus mode:
    - hides menu/status/toolbars and most docks while preserving SAR panel + Layers panel
    - focus-mode active state is persisted for crash recovery, but full binary layout state is not
- Updated `docs/parity-clarifications.md` to reflect those findings and reduce remaining ambiguity
- Follow-up text-label pass:
  - confirmed the plugin text-label data model and CRUD path are fully implemented in layer/controller code
  - confirmed text-label fields are `text`, `lat`, `lon`, `font_size`, `color`, `rotation`, `created`, `display_order`
  - confirmed validation/defaults:
    - non-empty text
    - max length `255`
    - validated font size
    - validated hex color
    - finite rotation
    - defaults `font_size=12`, `color=#000000`, `rotation=0`
  - important parity nuance: the old SAR panel `Text Label` button is still disabled, so plugin parity here means the capability definitely exists, but the frontline operator entrypoint was not fully surfaced in the panel
- Updated:
  - `docs/parity-clarifications.md`
  - `docs/bead-readiness.md`
- Remaining major unknown:
  - M25 offline map resilience still looks like genuine research rather than hidden plugin behavior
- Scope note:
  - this was a documentation/research pass only
  - no production code changed
  - no tests were run because only docs were updated

### 2026-04-10 mini-spec pass for M12 / M14 / M16
- Drafted a compact implementation-shaping spec note for the three beads that still warranted a short design pass before coding:
  - [parity-mini-specs-m12-m14-m16.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/parity-mini-specs-m12-m14-m16.md)
- Locked decisions captured there:
  - M12 settings
    - preserve plugin section structure: `Mission Defaults`, `Data Sources`, `Advanced Settings`
    - split desktop app-global settings from user-local UI preferences
    - keep secrets out of mission SQLite and behind a Tauri-side `SecretStore`
  - M14 finalize/archive/unlock
    - finalize is `Archive & Lock` from `finished`
    - `finalized` is strictly read-only
    - unlock moves mission back to editable state via explicit admin action
    - unlock reason is required
    - read-only enforcement must exist in domain/runtime logic, not just the UI
  - M16 layer catalog
    - canonical tree locked, including `GPX Tracks`
    - node taxonomy locked: root / group / layer / feature-item
    - mission-scoped metadata vs local UI preference split locked
- Updated `docs/bead-readiness.md` to mark:
  - `sartracker-web-2jk.1` as `5/5`
  - `sartracker-web-2jk.3` as `5/5`
  - `sartracker-web-2jk.5` as `5/5`
- Next implementation guidance:
  - M12, M14, and M16 should now be treated as implementation-ready
  - M25 remains the major unresolved research bead
- Scope note:
  - docs/bead/spec work only
  - no production code changed
  - no tests were run

### 2026-04-10 QGIS replacement roadmap + parity beads created
- Performed a second-pass plugin dive to tighten the parity audit before planning:
  - confirmed the plugin settings workspace includes coordinator/admin rosters, secure provider config, replay-window config, and layer-repair tooling
  - confirmed the mission-logs workspace includes mission details, searchable marker log, attachment opening, and a richer layer-console workflow
  - confirmed the plugin layer catalog persists alias/favorite/expanded/order metadata beyond simple visibility toggles
  - confirmed dedicated devices-window and coordinate-converter utilities are real plugin surfaces, not just doc mentions
- Created the QGIS replacement program epic:
  - `sartracker-web-2jk` — `M11: QGIS replacement parity program`
- Created the child parity beads:
  - `sartracker-web-2jk.1` — `M12: Settings workspace parity`
  - `sartracker-web-2jk.2` — `M13: Replay / training mode parity`
  - `sartracker-web-2jk.3` — `M14: Mission finalization, archive, and admin unlock`
  - `sartracker-web-2jk.4` — `M15: Mission logs and audit review workspace`
  - `sartracker-web-2jk.5` — `M16: Layer catalog domain and grouped layer model`
  - `sartracker-web-2jk.6` — `M17: Layer tree and feature inspection UI`
  - `sartracker-web-2jk.7` — `M18: Text labels and coordinate tool parity`
  - `sartracker-web-2jk.8` — `M19: Devices workspace parity`
  - `sartracker-web-2jk.9` — `M20: Marker evidence and audit metadata parity`
  - `sartracker-web-2jk.10` — `M21: Diagnostics workspace and repair tooling`
  - `sartracker-web-2jk.11` — `M22: GPX import and watch parity`
  - `sartracker-web-2jk.12` — `M23: Helicopter layer parity`
  - `sartracker-web-2jk.13` — `M24: Focus mode parity`
  - `sartracker-web-2jk.14` — `M25: Offline map resilience parity`
  - `sartracker-web-2jk.15` — `M26: QGIS replacement parity acceptance sweep`
- Added planning docs:
  - `docs/qgis-replacement-roadmap.md`
  - expanded `docs/plugin-parity-matrix.md` with second-pass specificity from plugin code
  - updated `docs/bead-readiness.md` with readiness/ordering for the new parity program
- Scope note:
  - this was a planning/documentation/issue-tracker pass only
  - no production code changed
  - no tests were run because no executable behaviour changed

### 2026-04-10 plugin replacement parity audit documented
- Created `docs/plugin-parity-matrix.md` as a code-grounded replacement audit against the legacy QGIS plugin
- The matrix compares:
  - plugin functionality
  - relevant QGIS operational layer behaviour
  - current `sartracker-web` implementation state
  - explicit status buckets: `Complete`, `Partial`, `Backend only`, `Missing`
- Important findings captured in the matrix:
  - core live-operation parity is now strong across mission lifecycle, tracking, markers, drawings, measurements, visibility filtering, and persistence
  - archive/finalize support exists in backend/persistence but is not yet exposed as a full operator workflow
  - replay/testing mode, diagnostics, mission-log UI, GPX import/watch, helicopter support, and full QGIS-style layer-tree behaviour remain meaningful gaps
  - `text_label` exists in storage/style plumbing but is not yet exposed as an operator drawing tool
- Scope note:
  - this was a documentation/audit pass only
  - no production behaviour changed
  - no tests were run because only docs were updated

### 2026-04-10 M9 measurement implementation completed
- Implemented M9 as a separate measurement subsystem rather than folding it into drawings, so the post-M8 drawing cleanup remains intact
- Added a dedicated measurement runtime in `src/features/measurements/`:
  - `measurement-types.ts`
    - explicit runtime model for completed measurements, armed mode, and in-progress draft state
  - `start-measurement-runtime.ts`
    - pure controller for mission refresh, arm/cancel, point registration, hover preview, and clear-all
    - locked M9 defaults in implementation:
      - permanent label on the measurement line
      - temporary operational aids cleared on mission finish / mission change
  - `measurement-geojson.ts`
    - line + label feature generation
    - preview feature generation for the live first-point/second-point workflow
  - `sync-measurement-overlay.ts`
    - dedicated MapLibre source/layers for completed measurement lines + labels
    - dedicated preview source/layers for the in-progress measurement
  - `measurement-store.ts`
  - `measurement-runtime-bridge.tsx`
- Added explicit map wiring without bloating the existing generic hooks:
  - `src/features/map/use-map-measurement-overlays.ts`
  - `src/features/map/use-map-measurement-interactions.ts`
  - `src/features/map/use-map-controller.ts` now composes measurement overlays/interactions alongside markers and drawings
- Added operator-facing sidebar controls in `src/components/measurement-panel.tsx`:
  - Measure / Cancel Measure
  - Clear Measurements
  - active measurement count
  - persistent measurement summaries matching the map label content
- Hardened map mode arbitration:
  - measurement mode now blocks marker creation/edit clicks while armed
  - drawing interactions now stand down while measurement mode is armed
  - switching from drawing tools to measurement cancels the active drawing tool first
  - switching from measurement back to drawing tools cancels measurement mode first
- Added focused tests:
  - `tests/unit/start-measurement-runtime.test.ts`
  - `tests/unit/measurement-geojson.test.ts`
  - `tests/e2e/measurement.spec.ts`
    - multiple measurements can coexist
    - clear-all flow
    - escape cancel flow
    - automatic clear on mission finish
    - clean handoff between measurement mode and drawing tools
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅

### 2026-04-10 tactical UI modernization pass (local changes under review)
- Gemini produced a restrained UI overhaul aimed at making the shell more map-first and operational without changing core mission, marker, drawing, or tracking behavior
- Current local UI changes include:
  - `src/App.tsx`
    - switched from the centered `max-w-6xl` dashboard shell to a full-viewport split layout
    - map now takes the full remaining viewport width
    - fixed right operational sidebar (`380px`) now owns mission control, tracking status, and layer filters
  - `src/components/map-view.tsx`
    - map shell now uses full available height/width instead of the former fixed-height card container
    - removed the extra “cached tiles available offline after viewing” badge from the map chrome
  - `src/components/mission-control-panel.tsx`
    - setup inputs are hidden once a mission is active/paused/recovery
    - elapsed/active timers were visually promoted
    - action buttons were changed from outlined controls to solid semantic buttons
    - recovery/finish dialogs were visually tightened and button labels simplified
  - `src/components/tracking-status-panel.tsx`
    - tracking counts moved into a denser telemetry grid
    - timestamps now render with local time formatting instead of raw persisted strings
  - `src/components/layer-filter-panel.tsx`
    - sidebar visuals tightened for the new operational layout
    - people / marker / drawing rows were restyled for denser scanning
- Important review note:
  - the initial Gemini handoff edit incorrectly replaced most of this file with a placeholder summary
  - Codex restored the full continuity log and is validating the UI changes before any commit/push decision
- Verification at review time:
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test` ✅
  - `npm run test:e2e` ✅
- Codex review result:
  - restored `HANDOFF.md` after Gemini replaced most of it with a placeholder summary
  - completed a browser validation pass against the running Vite app plus the full automated suite
  - no functional blocker found in the UI overhaul itself; current decision is down to product/operational preference rather than correctness
- Final result:
  - user accepted the UI pass
  - changes were committed and pushed as `c90e16a`

### 2026-04-09 pre-M9 drawing architecture hardening pass
- Performed a bounded structural refactor on the drawings subsystem before M9 measurement work
- Split the former `src/features/drawings/drawing-builders.ts` hotspot into explicit concerns:
  - `src/features/drawings/drawing-draft-factories.ts`
    - default draft creation for line/search-area/range-ring/bearing-line/search-sector flows
  - `src/features/drawings/drawing-persistence/`
    - thin shared persistence/parsing helpers in `shared.ts`
    - one type-specific persistence module per editable drawing type
    - shared contract entrypoint in `index.ts`
  - `src/features/drawings/drawing-builders.ts`
    - now a stable facade only, preserving existing imports while delegating to the extracted modules
- Split the former `src/features/drawings/start-drawing-runtime.ts` orchestration blob into clearer ownership:
  - `src/features/drawings/drawing-runtime-state.ts`
    - mutable runtime state container + immutable snapshot boundary
  - `src/features/drawings/drawing-runtime-editor.ts`
    - tool/sketch/dialog/edit-selection transitions
  - `src/features/drawings/drawing-runtime-session.ts`
    - mission refresh state, save/delete session updates, display-order logic
  - `src/features/drawings/start-drawing-runtime.ts`
    - now a thinner async coordinator over the extracted pure state helpers
- Reduced map interaction drift by extracting shared guard logic into:
  - `src/features/map/map-interaction-guards.ts`
    - active-mission / recovery-mode ignore rules
    - shared map-container bounds hit testing
  - marker and drawing interaction helper modules now wrap that shared guard layer instead of re-implementing it separately
- Added focused unit coverage for the new seams:
  - `tests/unit/map-interaction-guards.test.ts`
  - `tests/unit/drawing-runtime-editor.test.ts`
  - `tests/unit/drawing-runtime-session.test.ts`
- Important scope note:
  - no product behavior was intentionally changed
  - no M9 functionality was introduced
  - no browser-harness redesign was attempted
  - existing marker, drawing, map, and mission behavior stayed intact
- Verification completed on the final tree:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- M9 readiness note:
  - the drawings subsystem now has cleaner landing zones for measurement-related overlap:
    - type-specific persistence instead of one builder dump file
    - pure runtime editor/session seams instead of a single imperative controller blob
    - shared map interaction guards so measurement does not need a third copy of click-ignore/bounds logic

### 2026-04-09 pre-M8 map controller refactor
- Performed a bounded structural hardening pass on the map controller before M8 drawing work
- Split the former `src/features/map/use-map-controller.ts` hotspot into explicit concerns:
  - `src/features/map/use-map-instance.ts`
    - MapLibre instance lifecycle
    - basemap/style management
    - hover coordinate state
    - map health state
  - `src/features/map/use-map-overlays.ts`
    - tracking overlay synchronization
    - marker overlay synchronization
  - `src/features/map/use-map-marker-interactions.ts`
    - click-driven marker edit/create orchestration
  - `src/features/map/map-marker-interactions.ts`
    - small pure interaction helpers extracted so click behavior is easier to reason about and test
- Kept `src/features/map/use-map-controller.ts` as the stable public facade consumed by the map view, so no component/API churn was introduced
- Added focused regression coverage in `tests/unit/map-marker-interactions.test.ts` for:
  - click-ignore rules
  - map-bounds hit testing
  - interactive marker layer selection
  - rendered-marker-id vs nearest-marker fallback behavior
- Important scope note:
  - no product behavior was intentionally changed
  - no drawing/measurement functionality was introduced
  - no offline map scope changed
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Post-implementation headed browser validation:
  - confirmed the map renders visually in a real browser session (not black/blank)
  - confirmed tile requests were succeeding and browser console stayed clear
  - visually validated line + LPB range-ring overlays on the live map canvas
  - found and fixed a real UI issue where the drawing toolbar could intercept basemap button clicks
  - re-verified basemap switching + M2/M8 Playwright coverage after the layout hardening

### 2026-04-09 map render regression fix
- Investigated a user-reported blank/black map using isolated Playwright only
- Root cause:
  - the live MapLibre container could collapse to zero layout height even though the inner canvas still existed
  - this was caused by the map shell relying on an absolutely positioned ref target inside a wrapper that only guaranteed `min-height`
- Fixed the map shell in `src/components/map-view.tsx` by:
  - giving the outer map frame a real fixed height (`h-[560px]`)
  - making the ref target participate in layout with `h-full w-full` instead of `absolute inset-0`
- Added a regression Playwright test in `tests/e2e/map.spec.ts` that asserts the live map container keeps a non-zero height
- Verification completed:
  - targeted red/green Playwright regression test ✅
  - `npx playwright test tests/e2e/map.spec.ts` ✅
  - `npm run build` ✅

### 2026-04-09 documentation alignment pass
- Updated `README.md` to reflect the actual implementation line instead of planned functionality:
  - explicitly states that M1-M7 are complete and M8-M10 remain open
  - distinguishes current tile-caching support from true bundled offline maps
  - adds the browser validation harness workflow for manual testing
- Updated `OVERVIEW.md` so it no longer describes the standalone app as pre-build:
  - current execution state now reflects the implemented milestone line
  - added explicit sections for what already works in the standalone app vs what is still missing
- No production code changed in this pass

### 2026-04-09 M7 layer/filter panel implementation completed
- Implemented the M7 visibility subsystem behind explicit boundaries in:
  - `src/features/layers/`
  - `src/features/drawings/`
  - `src/components/layer-filter-panel.tsx`
- Added a dedicated shared visibility store for:
  - panel expanded/collapsed state
  - per-device visibility
  - per-marker-type visibility
  - per-drawing-type visibility
  - per-drawing-item visibility
- Locked M7 UI decisions in implementation:
  - panel location: right sidebar
  - default state: expanded
- Hardened map overlay architecture to align more closely with the S6 hybrid model:
  - tracking overlay now uses a single mixed-geometry `tracking` source with point/line layers filtered by geometry type
  - marker overlay now uses one source plus per-type symbol/label layers and a shared hitbox layer
  - visibility is applied through explicit map filter expressions rather than ad hoc UI-only state
- Added read-only drawing runtime support so the panel can already understand drawings before M8 editing tools exist:
  - mission-scoped drawing store
  - drawing runtime loader
  - drawing runtime bridge
  - browser harness support for seeded drawings
- Added the operator-facing right-sidebar panel with:
  - People section: search, per-device toggle, All On / All Off, colour and last-seen info
  - Markers section: per-type toggles, All On / All Off
  - Drawings section: per-type toggles, per-item toggles, All On / All Off, visible-count summary
- Hardened validation/harness quality:
  - browser harness now honors caller-provided ids when seeding markers/drawings
  - marker Playwright tests were tightened to scope actions to the modal after the new sidebar introduced duplicate visible labels
- Added focused test coverage for:
  - visibility store behavior
  - map layer filter helper logic
  - drawing runtime loading
  - app runtime startup wiring for drawing runtime
  - browser-visible layer panel flows
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅

### 2026-04-09 M6 markers implementation completed
- Implemented the marker subsystem behind explicit boundaries in `src/features/markers/`
- Added:
  - marker definitions for fixed dropdown values and visual/icon metadata
  - marker draft helpers for coordinate derivation, type switching, and persistence payload shaping
  - marker runtime/store layer for mission-scoped load, create, edit, save, and delete flows
  - marker GeoJSON shaping and MapLibre overlay sync with custom SVG icons and always-visible labels
  - marker runtime bridge so mission changes refresh marker state automatically
  - operator-facing modal dialog with:
    - type selector
    - read-only WGS84, ITM, and TM65 grid reference display
    - type-specific fields for IPP/LKP, clue, hazard, and casualty markers
    - create/edit/delete flows
- Extended runtime/browser validation support:
  - generalized the browser harness storage to support both mission and marker state
  - wired marker runtime into `start-app-runtime.ts` so production and harness paths use the same store boundary
- Hardened map interaction for reliability:
  - added a dedicated invisible marker hitbox layer for robust selection
  - added nearest-marker projected-distance fallback so edit/reopen still works if rendered-feature picking is temporarily stale
- Hardened marker data correctness:
  - ITM conversion now uses the dedicated `wgs84ToITM` helper
  - clue confidence is stored as the numeric persistence score the Rust layer expects while the UI still shows human-readable labels
- Added focused test coverage for:
  - draft conversion and type-specific field stripping
  - runtime load/create/edit/delete behavior
  - marker GeoJSON shaping
  - projected hit-testing fallback
  - app runtime wiring for the marker subsystem
  - browser-visible create/edit/delete marker workflows
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅

### 2026-04-09 frontend validation and runtime hardening pass
- Added a browser-only mission validation harness in `src/features/mission/mission-browser-harness.ts`
  - enabled only in dev with `?missionHarness=1`
  - reuses the real mission runtime/store flow instead of a fake UI-only state machine
  - persists mission state in `sessionStorage` so reload/recovery flows can be tested headlessly
- Added `tests/e2e/mission.spec.ts` for serious Playwright headless workflow coverage:
  - back-dated start
  - pause/resume timer behaviour
  - finish flow
  - finish-from-paused timing invariant
  - duplicate mission-name warning
  - invalid start offset guardrail
  - recovery on reload with Resume / Start Fresh
- Fixed a real mission UI timing issue:
  - timer display could remain stale for up to one tick after pause/resume/finish/recovery actions
  - mission action handlers now force an immediate `now` refresh after successful transitions
- Hardened tracking orchestration in two important places:
  - `createPollingManager` now distinguishes `idle` from `paused` instead of collapsing both into a boolean “don’t poll” state
  - idle tracking now reports `Waiting for an active mission.` rather than the paused-mission warning
  - corrupted tracking cache payloads are now ignored safely instead of aborting tracking runtime startup
- Added/expanded test coverage for the above:
  - `tests/unit/start-mission-runtime.test.ts`
  - `tests/unit/polling-manager.test.ts`
  - `tests/unit/start-tracking-runtime.test.ts`
- Web shell cleanup completed as part of the validation pass:
  - `index.html` now has the correct app title and meta description
  - added `public/robots.txt`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅

### 2026-04-09 M5 mission UI implementation completed
- Implemented the mission lifecycle subsystem behind explicit boundaries in `src/features/mission/`
- Added:
  - pure timer calculation/formatting module for elapsed vs active-search time
  - mission runtime/store layer for startup recovery, mission transitions, duplicate-name checks, and controller registration
  - operator-facing mission control panel with:
    - mission name input
    - 0-48 hour back-dated start offset
    - Start / Pause / Resume / Finish controls
    - finish confirmation dialog
    - resume/start-fresh recovery prompt
    - dual timer display
- Extended the mission persistence boundary:
  - `create_mission` now accepts an optional explicit `start_time`
  - recoverable mission lookup now includes persisted `active` missions so restart can treat them as paused
  - paused duration is accumulated correctly on resume and on finish-from-paused
- Hardened M4/M5 integration:
  - tracking refresh now only polls while mission phase is `active`
  - paused missions keep the polling timer alive but suppress fetches
  - breadcrumb history resets cleanly on a new mission and first breadcrumb fetch uses the mission start time
- Important implementation note:
  - `Start Fresh` currently resolves the recoverable mission by finishing it, which clears pause state, preserves data on disk, and returns the UI to idle
- Added focused test coverage for:
  - timer math
  - mission runtime recovery/start/pause/resume/finish behavior
  - duplicate-name warning logic
  - polling suppression and breadcrumb reset across mission boundaries
  - updated mission store adapter contract
  - browser-visible mission panel shell
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Follow-up note:
  - Playwright coverage exercises the browser shell only; live Tauri/operator validation of the interactive mission controls should still happen in the desktop runtime

### 2026-04-09 M4 tracking implementation completed
- Implemented the full Traccar tracking runtime behind explicit boundaries in `src/features/tracking/`
- Added:
  - transport client with session/basic/bearer auth handling
  - polling manager with retry/backoff, incremental breadcrumbs, and last-good snapshot behavior
  - cache payload codec plus Tauri-backed transport cache with atomic temp+rename writes
  - runtime orchestrator that hydrates from cache, starts polling, writes cache updates, and persists positions/devices into the active mission store
  - map overlay sync for tracked devices and breadcrumb trails
  - operator-facing tracking status panel in the shell
- Hardened degraded-mode behavior:
  - stale device marking after the 1 hour threshold
  - cached snapshot health annotation with 5 minute cache TTL and 4 hour max cache age
  - OFFLINE MODE warning while serving the last known positions
  - CONNECTION RESTORED signal on recovery
  - stale device map indicator via yellow circle stroke
- Refined startup architecture:
  - `start-app-runtime.ts` now owns tracking startup alongside autosave
  - runtime config loading is isolated
  - map overlay resync now survives basemap style swaps
- Added canonical Traccar fixtures:
  - `tests/fixtures/traccar-devices.json`
  - `tests/fixtures/traccar-positions.json`
  - `tests/fixtures/traccar-breadcrumbs.json`
- Added focused test coverage for:
  - color derivation
  - payload normalization
  - breadcrumb accumulation/segmentation
  - polling/retry/offline/recovery behavior
  - cache parsing and cache health rules
  - tracking runtime orchestration
  - Tauri tracking cache adapter/commands
  - tracking GeoJSON shaping
  - browser-visible tracking panel
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Follow-up note:
  - M4 is implementation-complete for the current bead, but live field validation against real KMRT Traccar credentials should still happen once those credentials are available

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

### 2026-04-09 M5 research checklist added
- Added a focused research follow-up comment to bead `sartracker-web-4wh` so Claude Code/the planning side can resolve the remaining M5 lifecycle ambiguity before implementation
- The checklist now explicitly asks for:
  - canonical mission lifecycle model
  - finalize scope
  - exact persisted status set
  - finish/pause tracking behavior
  - Start Fresh semantics
  - admin unlock approach
  - timer formulas
  - locked operator-facing confirmation/recovery copy
- Current recommendation remains unchanged:
  - do not start M5 implementation until the bead body is rewritten to reflect the resolved lifecycle model

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
1. **Choose the first parity bead** — strongest implementation-ready options now are M12, M14, M16, M18, M19, and M24
2. **Keep browser-validation boundaries strict** — future end-to-end work should continue using the typed browser harness API rather than raw storage poking
3. **Keep map interaction boundaries strict** — preserve the separate marker / drawing / measurement map seams
4. **Keep the MissionStore boundary strict** — renderer should not accumulate raw SQL access
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
