# HANDOFF.md — Current Project State

> **Read this before doing ANY work. Update this after EVERY chunk of work.**

## Operating Rule

- This is the single handoff file for the repo.
- `AGENTS.md` is a symlink to `CLAUDE.md`; there is only one instruction file.
- Beads are the task tracker.
- If parity evidence changes, update the parity docs, but keep the current status and next action here.
- Do not use separate Codex/Claude packet files or baton-passing message files.

## Last Updated
2026-04-11 19:06 by Codex

### 2026-04-11 19:20 by Codex

- Retired the old multi-file Codex/Claude packet handoff system.
- Consolidated the active baton state into this file so future agents only need:
  - `CLAUDE.md`
  - `handoff/HANDOFF.md`
  - the relevant bead(s)
- The current project state carried forward from the removed packet files is:
  - Batch 4 is **done-with-gap**
  - `LPV-020`..`LPV-028` are verified `Match`
  - `LPV-029` remains an unresolved parity gap
  - next verification target is **Batch 5** (`LPV-080` to `LPV-086`, Markers)

### 2026-04-11 19:06 by Codex

- Batch 4 is now closed as **done-with-gap**:
  - `LPV-020`..`LPV-028` are fully verified as Match.
  - `LPV-029` is explicitly held as an unresolved gap: mission metadata/coordinator dialog is still missing in the web mission-start lifecycle.
- Updated operating state for next execution:
  - Next target is **Batch 5** (`LPV-080` to `LPV-086`, Markers).
  - Batch 4 remains blocked for final parity until LPV-029 is either implemented or explicitly deferred.

### 2026-04-11 18:56 by Codex

- Batch 4 is partially completed (`LPV-020` to `LPV-029`): `LPV-020`..`LPV-028` are now marked Match with evidence.
- Implemented hard guard for start offset bounds end-to-end:
  - UI (`src/components/mission-control-panel.tsx`) now constrains `Start Offset (Hours)` to `0..5` and validates with matching error text.
  - Runtime (`src/features/mission/start-mission-runtime.ts`) now rejects start times older than 5 hours from current time.
  - Tests added/updated in:
    - `tests/unit/start-mission-runtime.test.ts`
      - added explicit 5-hour boundary pass test
    - `tests/unit/start-mission-runtime.test.ts`
      - added rejection test for >5-hour past start
    - `tests/e2e/mission.spec.ts`
      - invalid offset test uses `6` and expects `0 to 5` message
- `docs/web-parity-verification-matrix.md` rows `LPV-020`..`LPV-028` set to Match and `LPV-029` set to Mismatch with evidence/gap summary.
- `docs/web-operator-verification-checklists.md` Batch 4 checklist now captures verification details:
  - `LPV-020`..`LPV-028` marked Match
  - `LPV-029` marked Mismatch (mission metadata/coordinator dialog still missing in web mission-start flow).
- Next step: continue from this file into the open gap or proceed into Batch 5.

### 2026-04-11 18:26 by Codex

- Updated `CLAUDE.md` with explicit Claude-involvement criteria for batch handoff.
- New rule: Claude validates all batches that are life-safety critical, final before complete, ambiguous vs legacy behavior, or still high-risk.
- Added required post-completion steps: update handoff, run verification, and record the exact checks to validate next.

### 2026-04-11 18:20 by Codex

- Closed remaining Batch 3 gaps:
  - LPV-042 now Match — map shows `name` label text on current-position symbols.
  - LPV-047 now Match — one-time initial fit-to-bounds added on first tracked position render.
- Updated `tests/unit/tracking-viewport.test.ts` with tolerant assertions for single-point buffering.
- Updated and re-ran targeted verification:
  - `npm test -- tests/unit/tracking-geojson.test.ts tests/unit/tracking-viewport.test.ts`
  - `npx playwright test tests/e2e/parity-visibility.spec.ts`
- Status: Batch 3 (LPV-040 to LPV-048) can now transition to "complete and match-only."
- Next verification target was `LPV-020` to `LPV-029` (Mission lifecycle).

### 2026-04-11 18:05 by Codex

- Codex summary:
  - `LPV-040`, `LPV-041`, `LPV-043`, `LPV-044`, `LPV-045`, `LPV-046`, `LPV-048` = Match.
  - `LPV-042` = Partial (critical): map markers lack name labels.
  - `LPV-047` = Missing (medium): no auto frame/fitBounds on first tracking render.
- Next action at that point was to make an explicit decision for LPV-042 and LPV-047, then implement and re-verify.

### 2026-04-11 18:00 Parity Batch 3 completed: Tracking and devices (LPV-040 to LPV-048)

Batch completed: LPV-040 to LPV-048

Completed:
- LPV-040: Match — Traccar HTTP provider with auth/retry/timeout
- LPV-041: Match — separate fetches for roster, positions, breadcrumbs
- LPV-042: Partial — one marker per device renders, but name labels absent from map
- LPV-043: Match — >5min gap segmentation for breadcrumbs
- LPV-044: Match — filtering affects map only, not roster
- LPV-045: Match — last-good cache prevents blank on poll failure
- LPV-046: Match — FNV-1a hash deterministic color assignment
- LPV-047: Missing — no initial zoom framing of all tracked devices
- LPV-048: Match — full devices workspace with all fields

Blocked:
- None

Critical gaps:
- LPV-042 (Partial, Critical): Device name labels missing from map markers. Circle markers render correctly per device but have no text overlay. Legacy renders device `name` as label on each position marker. Devices workspace shows names in roster but map canvas does not.

Medium gaps:
- LPV-047 (Missing, Medium): No fitBounds/zoom-to-extent on first tracking data arrival. Per-device zoom works from devices workspace but no auto-frame-all.

Needs decision:
- LPV-042: Should device name labels be added to tracking markers on the map canvas?
- LPV-047: Should initial zoom framing be implemented for the tracking layer?

Evidence method:
- 26 unit tests across 7 tracking test files (all pass)
- 3 E2E tests in devices-workspace.spec.ts (all pass)
- 1 E2E test in full-mission-flow.spec.ts (passes)
- Code inspection of traccar-client.ts, polling-manager.ts, sync-tracking-overlay.ts, tracking-geojson.ts, tracking-color.ts, breadcrumb-accumulator.ts, devices-workspace.tsx, device-workspace-model.ts

Ready for tests:
- Yes for Match items. LPV-042 needs label implementation, LPV-047 needs fitBounds implementation before parity tests.

### 2026-04-11 17:31 by Codex

- Current state clarified: **Batch 2 complete, Batch 3 active**.
- Remaining known gaps unchanged: `LPV-061`, `LPV-068`, `LPV-069` remain deferred.
- Next expected action at that point was to begin Batch 3 tracking/devices verification.

### 2026-04-11 17:30 Batch 2 follow-up: LPV-063, LPV-064, LPV-065 implemented

- Per Codex decisions, added three UI controls to `layer-filter-panel.tsx`:
  1. **Show Hidden toggle** (LPV-063): Checkbox defaults ON (safety-first — all items visible). When OFF, `filterHiddenNodes()` strips hidden items from the tree listing. State persisted in `layer-tree-ui-store.ts`.
  2. **Refresh button** (LPV-064): Calls `controller.forceRefresh()` which reloads catalog metadata from persistence and rebuilds the tree. Added `forceRefresh` to `LayerCatalogController` in `start-layer-catalog-runtime.ts`.
  3. **Expand All button** (LPV-065): Calls `collectAllExpandableNodeIds()` + `resetExpandedNodeIds()` to expand all groups and layers.
- Added `filterHiddenNodes()` and `collectAllExpandableNodeIds()` to `layer-catalog-tree.ts`
- Added Playwright tests: `tests/e2e/parity-layer-console.spec.ts` — 3 tests, all pass
- Updated matrix: LPV-063, LPV-064, LPV-065 → `Match`
- Verification: 272 unit tests pass, 14 E2E tests pass (3 layer-panel + 8 parity-visibility + 3 new), 0 regressions
- **Batch 2 final tally**: 8 Match, 3 Missing (LPV-061, LPV-068, LPV-069 — deferred per Codex)

### 2026-04-11 17:10 by Codex

- Batch 2 operator-decisions finalized:
  - LPV-063: keep layer items always visible in tree; add explicit Show hidden control for declutter.
  - LPV-064: keep reactive auto-refresh as primary; add manual refresh as resilience fallback.
  - LPV-065: add Expand All control.
  - LPV-061/068/069 kept as explicit follow-up gaps (deferred to later bead).
- Current state: **Batch 2.1 follow-up implementation is active; scope limited to LPV-063, LPV-064, LPV-065.**

### 2026-04-11 17:00 Parity Batch 2 completed: Layer tree and console (LPV-060 to LPV-070)

Batch completed: LPV-060 to LPV-070

Completed:
- LPV-060: Match — hierarchical tree with groups → layers → feature items
- LPV-061: Missing — no type filter dropdown (legacy has 10 options)
- LPV-062: Match — search input filters tree reactively
- LPV-063: Partial — no show-hidden toggle, but web always shows all items
- LPV-064: Partial — no manual refresh button, but reactive auto-refresh works
- LPV-065: Missing — no Expand All button
- LPV-066: Match — visibility toggles at all levels (verified by Batch 1 fix)
- LPV-067: Match — alias, favorite, reorder all in inspector pane
- LPV-068: Missing — no right-click context menu
- LPV-069: Missing — no bulk operations or tracking layer protection
- LPV-070: Match — tree/canvas sync verified (Batch 1 LPV-247)

Blocked:
- None

Critical mismatches:
- None critical. All Critical-severity items (LPV-060, LPV-066, LPV-070) are Match.

Medium-severity gaps:
- LPV-061 (Missing): Type filter dropdown — the tree's hierarchical grouping provides navigation by type, but no explicit filter control exists
- LPV-068 (Missing): Context menu — no delete/zoom/export/duplicate from the tree surface. The inspector provides rename/favorite only.
- LPV-069 (Missing): Bulk operations — no bulk delete, export, or team assignment. No tracking layer protection.

Needs decision:
- LPV-063: Is always-showing-hidden-items acceptable, or does the operator need a toggle to declutter?
- LPV-064: Is reactive auto-refresh sufficient, or does the operator need a manual refresh fallback?

Ready for tests:
- Yes for Match items. Missing items need implementation before tests can be written.

### 2026-04-11 16:20 by Codex

- Clarified handoff loop state after Batch 1 completion.
- `handoff/messages/TO_CLAUDE_FROM_CODEX.md` updated to Batch 2 execution packet.
- Active state: `LPV-060` to `LPV-070` pending verification.

## Process Rule
For hands-off operation:
- read `CLAUDE.md`
- read `handoff/HANDOFF.md`
- read the relevant bead(s)
- continue from the latest state recorded here

## Current State
**Phase: Batch 3 verified, pending LPV-042/LPV-047 decisions before moving to Batch 4.**

### 2026-04-11 01:45 Standardized Hands-Off Prompts

- Earlier multi-file packet prompts were introduced here.
- That system has now been retired in favor of this single handoff file plus beads.

`HANDOFF.md` is the authoritative continuity log for active repo work across Donal, Codex, and Claude Code. Update it after every meaningful chunk so the next agent can resume without re-discovery.

## What's Been Done

### 2026-04-11 Parity Batch 1 visibility fix applied and verified

- **Bug found**: Layer tree visibility toggles did not propagate to the MapLibre map. All 8 rows (LPV-240 to LPV-247) were `Mismatch`.
- **Root cause**: Two-part failure:
  1. `hydrateCatalogVisibility` in `layer-visibility-store.ts` had a one-shot guard that blocked re-derivation for the same mission after initial hydration
  2. The tree UI (`layer-filter-panel.tsx`) only called `controller.setNodeVisibility` (async catalog persistence) without also updating the Zustand visibility store that drives MapLibre
- **Fix applied (2 files)**:
  1. `src/features/layers/layer-visibility-store.ts` — replaced one-shot `hydratedMissionId` guard with shallow-equality comparison. `hydrateCatalogVisibility` now always re-derives from the current tree but preserves array/record references when unchanged to avoid unnecessary overlay re-renders.
  2. `src/components/layer-filter-panel.tsx` — added `applyVisibilityForNodes()` function that maps tree node IDs to the appropriate visibility store actions and calls them synchronously after the user clicks a tree checkbox. This provides immediate map response without depending on the async React bridge effect cycle.
- **Tests**:
  - 3 new unit tests in `tests/unit/layer-visibility-store.test.ts`:
    - `re-derives visibility from the catalog tree on every hydration call`
    - `propagates tree visibility changes to the store on same-mission hydration`
    - `preserves references when hydrating unchanged tree for performance`
  - 8 Playwright tests in `tests/e2e/parity-visibility.spec.ts` — all pass
  - 272 unit tests pass, 0 regressions
  - Existing E2E tests (layer-panel, full-mission-flow) pass, 0 regressions
- **Post-fix result**: All 8 LPV rows are `Match`
- **Cleanup note**: `tests/e2e/diag-visibility.spec.ts` and `tests/e2e/diag2.spec.ts` are diagnostic files that should be deleted

Batch completed: LPV-240 to LPV-247

Completed:
- LPV-240: Match — per-device tracking visibility toggle hides only that device
- LPV-241: Match — marker-type visibility toggle hides only that type
- LPV-242: Match — individual marker visibility toggle hides only that marker
- LPV-243: Match — drawing-type visibility toggle hides only that type
- LPV-244: Match — individual drawing visibility toggle hides only that item
- LPV-245: Match — measurement visibility toggle hides pinned measurements
- LPV-246: Match — group visibility cascade hides all descendants
- LPV-247: Match — tree/canvas synchronization survives repeated changes

Blocked:
- None

Critical mismatches:
- None (all fixed)

Needs decision:
- None

Ready for tests:
- Yes — `tests/e2e/parity-visibility.spec.ts` serves as the locked regression suite

### 2026-04-11 Parity Batch 1 initial verification: Critical visibility (LPV-240 to LPV-247)

Initial verification pass — all 8 rows identified as Mismatch before fix.

Batch completed: LPV-240 to LPV-247 (initial pass)

Completed:
- LPV-240: Mismatch — per-device tracking visibility toggle does not propagate to map
- LPV-241: Mismatch — marker-type visibility toggle does not propagate to map
- LPV-242: Mismatch — individual marker visibility toggle does not propagate to map
- LPV-243: Mismatch — drawing-type visibility toggle does not propagate to map
- LPV-244: Mismatch — individual drawing visibility toggle does not propagate to map
- LPV-245: Mismatch — measurement visibility toggle does not propagate to map
- LPV-246: Mismatch — group visibility cascade does not propagate to map
- LPV-247: Mismatch — tree/canvas desynchronized; tree shows toggled state while map shows initial state

Blocked:
- None blocked for verification; all 8 rows were verified and all failed

Critical mismatches:
- **All 8 rows share a single root cause**: `hydrateCatalogVisibility` in `src/features/layers/layer-visibility-store.ts:133` has a guard `if (state.hydratedMissionId === missionId && missionId !== null) { return state }` that blocks all visibility store updates after initial mission load
- The layer tree UI (`src/components/layer-filter-panel.tsx`) toggles visibility via `controller.setNodeVisibility()` which persists catalog metadata and rebuilds the tree, but this path does NOT update the Zustand visibility store (`useLayerVisibilityStore`) that drives MapLibre filters
- The tree checkbox correctly reflects the catalog node's `isVisible` property, so the **UI appears correct** while the **map is unchanged**
- This is especially dangerous because manual visual inspection of the tree suggests everything is working

Needs decision:
- None — the fix path is clear (see below)

Ready for tests:
- No. Parity tests cannot pass until the architecture fix is applied. The Playwright tests in `tests/e2e/parity-visibility.spec.ts` serve as the regression suite and will pass once the fix is in place.

#### Root Cause Detail

Two visibility paths exist in the codebase:

1. **Catalog metadata persistence** (`controller.setNodeVisibility` → catalog rebuild → `node.isVisible` in tree): Works correctly for persisting visibility state and displaying it in the tree UI. Used by the layer-filter-panel.
2. **Visibility store** (`useLayerVisibilityStore` → `hiddenDeviceIds`, `markerTypeVisibility`, `drawingTypeVisibility`, `hiddenDrawingIds`, `measurementsVisible`): Drives all MapLibre overlay hooks (`use-map-overlays`, `use-map-drawing-overlays`, `use-map-measurement-overlays`).

The bridge (`layer-catalog-runtime-bridge.tsx:63-65`) calls `hydrateCatalogVisibility(missionId, root)` whenever `root` changes. This correctly populates the visibility store on initial mission load. But after that, the guard at line 133 blocks all subsequent updates for the same mission.

The `devices-workspace.tsx` has a separate toggle that calls `toggleDeviceVisibility` directly on the visibility store — this works but only for devices from that specific workspace.

#### Recommended Fix

Remove the early-return guard from `hydrateCatalogVisibility` (or make it always re-derive from the current tree), so that every catalog rebuild correctly propagates to the visibility store. Alternatively, have the tree UI call both `controller.setNodeVisibility` (for persistence) AND the appropriate visibility store action (for immediate map update).

The fix should then be verified by running `npx playwright test tests/e2e/parity-visibility.spec.ts` — all 8 tests should pass.

#### Evidence

- Code analysis of `src/features/layers/layer-visibility-store.ts`, `src/features/layers/layer-catalog-runtime-bridge.tsx`, `src/features/layers/start-layer-catalog-runtime.ts`, `src/components/layer-filter-panel.tsx`
- All overlay hooks confirmed to read exclusively from the visibility store: `src/features/map/use-map-overlays.ts`, `src/features/map/use-map-drawing-overlays.ts`, `src/features/map/use-map-measurement-overlays.ts`
- Playwright test suite: `tests/e2e/parity-visibility.spec.ts` — 8 tests, all 8 fail with visibility store remaining at initial values after tree toggles
- Existing layer-panel E2E test (`tests/e2e/layer-panel.spec.ts`) does NOT verify map state after toggles — it only checks checkbox state, which is why this bug was previously undetected

### 2026-04-11 parity execution protocol added for Claude Code

- Added a dedicated orchestration document for the legacy-to-web parity program:
  - `docs/parity-execution-protocol.md`
- Added a dedicated web-only execution checklist pack:
  - `docs/web-operator-verification-checklists.md`
- These files are intended to be the single entrypoint package to hand to Claude Code so it can start work without repeated human context transfer.
- It locks:
  - source of truth order:
    - legacy runtime first
    - legacy code/tests second
    - README prose lower priority
  - canonical working files for Claude execution:
    - `docs/legacy-plugin-operator-verification-spec.md`
    - `docs/web-operator-verification-checklists.md`
    - `docs/web-parity-verification-matrix.md`
    - `handoff/HANDOFF.md`
  - Codex role vs Claude Code role:
    - Codex documents and tightens legacy behavior from the old plugin
    - Claude Code verifies only `sartracker-web` against that documented behavior
  - required evidence standard
  - allowed status vocabulary
  - mandatory update discipline
  - batch order for execution
- Most important execution decision:
  - Claude Code should start with Batch 1 only:
    - `LPV-240` through `LPV-247`
    - the critical visibility tests
  - Reason:
    - if layer visibility cannot be trusted, the operator cannot trust the map
- Practical result:
  - we now have a self-contained “read this and go” protocol document plus web verification checklist pack, instead of relying on conversational handoff
  - the next agent should not need Donal to restate the plan
- Verification:
  - no automated tests run; this was a documentation/orchestration pass only
- Recommended next step:
  - point Claude Code at `docs/parity-execution-protocol.md`
  - instruct it to execute Batch 1 and update the checklist, matrix, and handoff with evidence

### 2026-04-11 legacy-first operator verification spec started

- Restarted the parity/review effort from the correct source of truth:
  - the legacy QGIS plugin at `/Users/donalocallaghan/Documents/Qgis/sartracker`
- For this pass, treated `sartracker-web` as secondary only; the goal was to lock legacy behavior before any web comparison.
- Mapped the legacy operator surface from code/tests across:
  - main plugin entrypoint and mission lifecycle
  - SAR panel
  - layer console / catalog
  - devices window
  - mission logs window
  - settings workspace
  - diagnostics panel
  - coordinate converter
  - tracking provider/controller/layer managers
  - marker manager
  - drawing manager and map tools
  - legacy test suite inventory
- Added a new ground-truth document:
  - `docs/legacy-plugin-operator-verification-spec.md`
- Added two follow-on execution artifacts derived from that spec:
  - `docs/legacy-plugin-runtime-checklist.md`
  - `docs/web-parity-verification-matrix.md`
- The new spec is intentionally legacy-only and includes:
  - source-of-truth rules
  - evidence references back to legacy files/tests
  - explicit `LPV-*` verification items for:
    - primary operator surfaces
    - mission lifecycle
    - tracking/device visibility
    - layer tree and visibility behavior
    - marker workflows
    - drawing tool workflows
    - measurement/coordinates
    - mission logs
    - settings
    - diagnostics
    - GPX/helicopters
    - critical visibility tests to carry forward
- Practical result:
  - we now have a concrete legacy-first checklist to compare against the web app instead of relying on vague parity summaries
  - especially important: it calls out the exact layer-visibility checks that must be validated rather than assumed
- The runtime checklist is intended for literal use while operating the legacy plugin in QGIS:
  - screen-by-screen
  - workflow-by-workflow
  - with explicit pass/fail/blocked tracking
- The parity matrix is intended for the next phase:
  - one row per `LPV-*`
  - legacy evidence column
  - web result column
  - severity and bead follow-up columns
- Verification:
  - no automated tests run; this was a research/documentation pass only
- Recommended next step:
  - start actually executing the legacy runtime checklist and fill the parity matrix row by row against `sartracker-web`, beginning with the critical visibility items (`LPV-240` through `LPV-247`)

### 2026-04-11 M20 hardening pass completed

- Tightened marker runtime async safety in:
  - `src/features/markers/start-marker-runtime.ts`
  - mission refresh now uses last-request-wins guards so stale loads cannot overwrite the current mission context
  - marker delete now has the same saving/error discipline as save flows
  - dialog mutation actions are blocked while save/attachment work is in flight, reducing race-prone UI states
- Hardened the marker authoring surface in:
  - `src/components/marker-dialog.tsx`
  - inputs, type toggles, attachment clear/upload, and close/cancel actions now respect the saving state instead of allowing mid-flight edits
- Eliminated a real evidence-storage debt source in:
  - `src-tauri/src/persistence.rs`
  - when a managed marker attachment is replaced or the marker is deleted, the superseded primary attachment file is now cleaned up instead of silently accumulating orphaned evidence files
- Added regression coverage for the new hardening:
  - `tests/unit/start-marker-runtime.test.ts`
  - `src-tauri/src/persistence.rs` now includes a test that verifies managed marker attachments are removed when superseded/deleted
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Assessment:
  - M20 is in a materially better place after this pass
  - the biggest remaining headroom is now polish-level rather than structural: richer attachment UX/policy and another manual evidence-heavy browser validation pass
  - next logical bead remains `sartracker-web-2jk.10` (M21 diagnostics workspace)

### 2026-04-10 Basemap viewport hardening + M20 marker evidence parity completed

- Fixed the safety-critical basemap switch regression in the actual lifecycle boundary instead of patching around it in UI code:
  - root cause was `src/features/map/use-map-instance.ts` recreating the entire MapLibre instance on basemap changes because the mount effect was keyed to style/basemap state
  - corrected this by making the map instance mount exactly once and keeping style swaps on the long-lived instance
  - kept a small camera-preservation helper in:
    - `src/features/map/apply-map-style-preserving-camera.ts`
  - added focused regression coverage:
    - `tests/unit/apply-map-style-preserving-camera.test.ts`
    - `tests/e2e/map.spec.ts` now asserts the viewport is preserved across basemap switches
- Implemented M20 marker evidence and audit metadata parity end to end:
  - expanded marker schema/types across frontend + Rust persistence with:
    - `updated_by`
    - `coordinator_ids`
    - `attachment_path`
  - added attachment ingestion boundary:
    - `src/infrastructure/marker-attachment-store/tauri-marker-attachment-store.ts`
  - added Tauri-side attachment ingest + mission-managed storage handling in:
    - `src-tauri/src/persistence.rs`
    - `src-tauri/src/lib.rs`
    - `src-tauri/Cargo.toml`
  - attachment ingestion now:
    - accepts browser-selected files
    - validates non-empty payloads
    - enforces a 25 MB max file size
    - writes atomically into mission attachment storage
    - mirrors to configured backup mission root when present
    - includes marker attachments in mission archive ZIP output
  - expanded marker authoring UI in:
    - `src/components/marker-dialog.tsx`
    - added Updated By, Coordinator IDs, and Evidence Attachment flows
    - hardened the dialog layout so long forms remain scrollable and operable in real browser runs
  - wired attachment ingestion through the marker runtime in:
    - `src/features/markers/marker-draft.ts`
    - `src/features/markers/start-marker-runtime.ts`
    - `src/features/runtime/start-app-runtime.ts`
    - `src/features/mission/mission-browser-harness.ts`
  - upgraded mission review so operators can review marker audit/evidence context, not just latest marker state:
    - `src/features/mission-review/mission-review-model.ts`
    - `src/components/mission-review-workspace.tsx`
    - marker detail now shows audit fields, attachment path, and per-marker history derived from mission events
  - kept browser harness parity aligned in:
    - `src/features/browser-validation/browser-harness-store.ts`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - `npm run test:e2e` ✅
- Result:
  - `sartracker-web-seq` should be treated as fixed
  - `sartracker-web-2jk.9` should be treated as implemented
  - next logical parity bead is `sartracker-web-2jk.10` (M21 diagnostics workspace), unless you want to divert first into the remaining non-blocking UI validation follow-ups (`sartracker-web-awm`, `sartracker-web-bsl`, `sartracker-web-lo6`)

### 2026-04-10 Deep UI Validation — CRITICAL tracking visibility fix

**Context**: Executed the full `docs/deep-ui-validation-checklist.md` against the app running with the mock Traccar server. Used a triple-verification methodology where every visual claim was independently verified by 3 sub-agents examining screenshots.

**CRITICAL BUG FOUND AND FIXED**: Device markers and breadcrumb trails were rendered with dark earth-tone colors (`#4E593E`, `#875D3E`, `#95543E`, etc.) at 5px circle radius and 1.5px dashed line width. These were **functionally invisible** on both satellite and topographic basemaps of Irish terrain. 15 independent verification agents unanimously confirmed 0 markers and 0 trails were visually identifiable before the fix.

**Fix applied** (3 files changed, all 205 tests pass):
- `src/features/tracking/tracking-color.ts` — Replaced hash-to-RGB color generator with a curated 12-color high-visibility SAR palette (red, green, blue, orange, purple, cyan, magenta, lime, pink, lavender, brown, gold)
- `src/features/tracking/sync-tracking-overlay.ts` — Device circles: 5px→7px radius, stroke dark→white for contrast, stroke width 1.5→2px. Breadcrumb lines: 1.5px dashed→3px solid, added 0.85 opacity
- `tests/unit/tracking-color.test.ts` — Updated to match new palette approach

**Post-fix verification**: 3/3 agents confirmed 5 bright markers clearly visible on satellite (rated 7-8/10). 3/3 agents confirmed 2 device markers + 2 breadcrumb trail lines clearly visible on topo (trails rated 7-8/10). Total: 15 agents used across 5 batches.

**Remaining issues (beads created)**:
- `sartracker-web-seq` (P1): Basemap switch resets map viewport to default center — operators lose tracking view when switching basemaps
- `sartracker-web-awm` (P2): Device markers rated only 4-6/10 on topo basemap — may need larger radius or labels
- `sartracker-web-lo6` (P4): OpenTopoMap tile degradation message appears intermittently
- `sartracker-web-bsl` (P3): Sections 13-16 not triple-verified — Review, Settings, Governance, Recovery need rigorous re-test

**Sections verified clean** (Playwright + Chrome DevTools): Boot, basemap switching, mission lifecycle (start/pause/resume/finish), tracking system status, device markers on map, breadcrumb trails, devices workspace, layer tree, marker creation dialog, drawing tool arm/cancel, measurement tool, coordinate converter structure.

**Decision**: The tracking visibility fix is the most important safety-critical change in this session. The basemap viewport reset (sartracker-web-seq) is the highest priority remaining bug.

### 2026-04-10 mock Traccar server fitness review
- Performed a source-level review of the new mock Traccar server in:
  - `tools/mock-traccar/README.md`
  - `tools/mock-traccar/src/server.ts`
  - `tools/mock-traccar/src/router.ts`
  - `tools/mock-traccar/src/auth.ts`
  - `tools/mock-traccar/src/playback-engine.ts`
  - `tools/mock-traccar/src/device-roster.ts`
  - `tools/mock-traccar/src/position-store.ts`
  - `tools/mock-traccar/src/route-generator.ts`
  - `tools/mock-traccar/src/csv-parser.ts`
- Verdict:
  - good foundation and directionally correct for manual map/roster demos
  - not yet fit as a full parity-confidence simulator for tracking behavior
- Important confirmed gaps/mismatches:
  - `/health` is documented as unauthenticated in `README.md`, but the router currently puts the auth gate in front of it, so it returns `401` without credentials
  - `GET /api/positions` claims to return one current position per online device, but `position-store.ts` currently returns the last visible point for every routed device, including devices whose roster status has become `offline`
  - this means the mock can surface a fully offline device as a current map position, which is opposite to the legacy plugin's active-device filtering model
  - playback timestamp compression at speeds >1x is a real limitation, not just a minor caveat:
    - breadcrumb-gap segmentation
    - stale/unknown transitions
    - any time-threshold-driven behavior
    are not faithfully exercised at the default `10x`
  - route generation uses `Math.random()` for EOC and Medic jitter/speeds, so server output is not deterministic across runs; that weakens regression confidence and screenshot/test repeatability
  - Team Delta's `goUnknownAfterMs` intent is not modeled cleanly: the special branch depends on `lastPoint.scenarioOffsetMs >= goUnknownAfterMs`, but Delta's generated route ends just before the configured cutoff, so normal stale logic is effectively doing the work instead
- Practical conclusion:
  - use the current mock for exploratory manual testing only
  - do not treat it yet as a trusted parity harness for acceptance, automated regression, or life-safety behavior signoff
- Recommended next fixes before relying on it heavily:
  - make `/health` truly unauthenticated
  - ensure current-position responses respect roster visibility/status rules
  - make route generation deterministic via seeded randomness or fixed fixtures
  - split visual-speed playback from threshold-accurate playback more explicitly
  - tighten Team Delta state-transition modeling so the scenario matches the README and intended failure case
- Verification:
  - manual endpoint probing only
  - confirmed `/health` currently returns `401`
  - confirmed a late-start probe (`--speed 1 --start-offset 90`) returns Team Delta in `/api/positions` while `/api/devices` reports it as `offline`

### 2026-04-10 legacy Traccar tracking deep-dive + mock-server spec
- Performed a fresh deep dive into the legacy QGIS plugin's HTTP tracking stack to support a realistic mock tracking server for `sartracker-web`.
- Investigated the actual behavior in:
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/providers/traccar_http.py`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/providers/tasks.py`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/controllers/provider_controller.py`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/controllers/layer_managers/tracking_manager.py`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/controllers/layer_managers/tracking_segments.py`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/controllers/devices_controller.py`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/utils/device_filtering.py`
- Important clarified legacy behavior:
  - provider uses `GET /api/devices`, `GET /api/positions`, and per-device `GET /api/positions?deviceId&from&to`
  - provider prefers bulk breadcrumb fetch first but falls back to per-device fetch when Traccar only returns latest points in bulk mode
  - map-visible tracking is filtered to active devices only:
    - `online` => visible
    - `offline` => hidden from tracking layers
    - `unknown` => visible only if recent enough
  - current positions are labeled with device `name`, not special initials logic
  - breadcrumb trails are segmented on gaps greater than 5 minutes
  - empty/bad poll responses intentionally do not clear live map tracking immediately
  - last-good tracking cache is part of the operational safety model, not an incidental optimization
- Investigated legacy sample/mock route inputs:
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/From_Eamon/Glenagenty.csv`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/From_Eamon/mock_team_alpha.csv`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/From_Eamon/mock_team_bravo.csv`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/From_Eamon/mock_team_charlie.csv`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/dev_tools/traccar_stub.py`
  - `/Users/donalocallaghan/Documents/Qgis/sartracker/dev_tools/csv_to_fixtures.py`
- Added a new design note:
  - `docs/mock-traccar-server-spec.md`
- Added a new child bead under the parity epic:
  - `sartracker-web-2jk.16` — Mock Traccar server and Glenagenty scenario fixtures
- The new note captures:
  - exact legacy HTTP tracking behavior worth preserving
  - required mock API contract
  - realistic multi-device simulation model
  - suggested Glenagenty-area device roles and staggered starts
  - failure-mode scenarios for stale, offline, and breadcrumb-gap testing
  - recommendation to build a standalone mock server under `tools/mock-traccar/`
- Why this matters:
  - the existing legacy stub is useful but too thin for full parity testing in the new app
  - we now have a documented path for exercising real client polling, current positions, breadcrumbs, device visibility, and resilience behavior without live Traccar
- Verification:
  - no automated tests run; this was a research/documentation pass only
- Suggested next step:
  - create a dedicated implementation bead for the mock Traccar server and fixture generator, then build Scenario A/B first before adding stale/offline/outage scenarios

### 2026-04-10 M15 mission review workspace completed
- Implemented a dedicated non-modal mission review workspace instead of spreading audit/review across ad hoc panels:
  - `src/components/mission-review-workspace.tsx`
  - opened from `src/components/mission-control-panel.tsx`
  - mounted in `src/App.tsx`
- Added a separate mission-review feature slice so review logic does not pollute mission lifecycle runtime:
  - `src/features/mission-review/mission-review-model.ts`
  - `src/features/mission-review/start-mission-review-runtime.ts`
  - `src/features/mission-review/mission-review-store.ts`
  - `src/features/mission-review/mission-review-workspace-store.ts`
  - `src/features/mission-review/mission-review-runtime-bridge.tsx`
- Important architectural choices:
  - mission review loads through explicit store boundaries (`MissionStore` + `LayerCatalogStore`) rather than scraping live React state
  - refresh safety is handled in the review runtime via token-based last-request-wins behavior
  - the review surface is split into:
    - `Mission Details` — mission summary, storage-path review, audit/event log
    - `Marker Log` — searchable marker review with detail pane and zoom
    - `Layer Console` — read-only grouped catalog summary that stays single-sourced with the main layer workspace
  - layer statistics are derived from the canonical layer-catalog builder so review counts match the live catalog model
- Extended browser-validation support so the review workspace is backed by real persisted-like audit data instead of stubs:
  - `src/features/browser-validation/browser-harness-store.ts`
  - browser harness now records mission events, exposes store info, and records opened external paths for validation
- Added a real cross-platform external path opener boundary for archive/evidence-style file opening:
  - `src/infrastructure/file-launcher/tauri-file-launcher.ts`
  - `src-tauri/src/opener.rs`
  - wired in `src-tauri/src/lib.rs`
- Verification hardening uncovered and fixed a real M8 interaction weakness:
  - point-based drawings, especially text labels, were still too dependent on perfect rendered-feature picking
  - added point-drawing hitboxes and projected-distance fallback selection in:
    - `src/features/drawings/sync-drawing-overlay.ts`
    - `src/features/drawings/drawing-hit-testing.ts`
    - `src/features/map/map-drawing-interactions.ts`
    - `src/features/map/use-map-drawing-interactions.ts`
- Added / updated coverage:
  - `tests/unit/mission-review-model.test.ts`
  - `tests/unit/start-mission-review-runtime.test.ts`
  - `tests/unit/browser-harness-store.test.ts`
  - `tests/unit/drawing-hit-testing.test.ts`
  - `tests/e2e/mission-review.spec.ts`
  - existing text-label edit Playwright flow now passes reliably after the hit-testing hardening
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Result:
  - operators now have a real in-app review console for mission details, audit history, marker review, and storage-path inspection
  - M20 now has the review surface it depends on for future marker evidence/audit parity
  - map selection for point-based drawings is more robust than before this bead started
  - M20 remains the next logical bead

### 2026-04-10 M19 devices workspace completed
- Implemented a dedicated tracking devices workspace instead of stretching the sidebar panel further:
  - `src/components/devices-workspace.tsx`
  - opened from `src/components/tracking-status-panel.tsx`
  - mounted in `src/App.tsx`
- Important architectural choices:
  - the workspace reads directly from the existing tracking snapshot + tracking status stores instead of maintaining a second device truth
  - open/selection state is isolated in:
    - `src/features/tracking/device-workspace-store.ts`
  - roster/view-model shaping is isolated in:
    - `src/features/tracking/device-workspace-model.ts`
  - map zoom/selection uses the shared map-target boundary rather than a device-specific map shortcut
- Small but worthwhile refactor:
  - extracted the generic map target flow out of the coordinate tool into:
    - `src/features/map/map-target-store.ts`
  - both M18 coordinate conversion and M19 device zoom now go through the same target marker path
  - updated:
    - `src/features/map/use-map-location-target.ts`
    - `src/components/coordinate-converter-dialog.tsx`
    - `src/components/coordinate-bar.tsx`
- New operator-facing capabilities now present:
  - dedicated device roster/workspace
  - status, last-seen, source, battery, and speed visibility at roster scale
  - offline/degraded status summary aligned with tracking runtime health
  - row selection and detail pane for active device inspection
  - per-device visibility toggles directly from the workspace
  - zoom-to-device action with temporary map target feedback
  - reconnect button wired through the app runtime reload boundary for desktop runtime
- Added / updated coverage:
  - `tests/unit/device-workspace-model.test.ts`
  - `tests/e2e/devices-workspace.spec.ts`
  - existing M18 coordinate converter coverage still passes after the shared map-target refactor
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Result:
  - the tracking surface now has a true operator-scale roster workspace instead of relying on a cramped sidebar summary
  - map-centric device workflows are cleaner and now share a better general map-target abstraction
  - M20 is now the next logical bead

### 2026-04-10 M18 text labels and coordinate converter completed
- Implemented `text_label` as a real drawing subtype instead of a side-channel annotation feature:
  - draft/type/runtime support in:
    - `src/features/drawings/drawing-types.ts`
    - `src/features/drawings/drawing-draft-factories.ts`
    - `src/features/drawings/drawing-runtime-editor.ts`
    - `src/features/drawings/start-drawing-runtime.ts`
  - type-specific persistence in:
    - `src/features/drawings/drawing-persistence/text-label-drawing-persistence.ts`
    - `src/features/drawings/drawing-persistence/index.ts`
- Important architectural choices:
  - text labels stay inside the existing drawings pipeline so selection, persistence, ordering, and layer-catalog visibility all work through the same mission-scoped boundary
  - text-label metadata is explicit and typed: text, font size, hex color, rotation, anchor point
  - text labels are editable through the same create/edit/delete runtime used by other drawing tools, rather than introducing a parallel label runtime
- Hardened drawing rendering for text labels in:
  - `src/features/drawings/drawing-geojson.ts`
  - `src/features/drawings/sync-drawing-overlay.ts`
  - label styling now honors stored font size / rotation / color
  - text labels render as proper symbol labels with an anchor point and remain selectable through the map overlay stack
- Added a dedicated coordinate conversion feature slice:
  - conversion logic in `src/features/coordinates/coordinate-tool.ts`
  - modal/control state in `src/features/coordinates/coordinate-tool-store.ts`
  - operator dialog in `src/components/coordinate-converter-dialog.tsx`
- Added coordinate-tool parity capabilities:
  - WGS84 input flow
  - ITM input flow
  - TM65 grid-reference input flow
  - operator-facing output for WGS84 / ITM / TM65
  - copy-to-clipboard actions
  - go-to-location action with temporary target marker feedback on the map
- Added map integration for go-to-location in:
  - `src/features/map/use-map-location-target.ts`
  - `src/features/map/use-map-controller.ts`
  - `src/components/coordinate-bar.tsx`
- Updated operator UI:
  - drawing toolbar now includes `Text Label`
  - drawing dialog includes a type-specific text-label editor
  - coordinate bar now opens the converter and shows a temporary target-active indicator after `Go To Location`
- Added / updated coverage:
  - `tests/unit/coordinates.test.ts`
  - `tests/unit/coordinate-tool.test.ts`
  - `tests/unit/drawing-builders.test.ts`
  - `tests/e2e/coordinate-converter.spec.ts`
  - `tests/e2e/drawing-tools.spec.ts`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Result:
  - the standalone app now has parity for both text labels and coordinate conversion workflows
  - the coordinate tool is cleanly separated from mission persistence while still integrating safely with the live map
  - M19 is now the next logical bead

### 2026-04-10 M17 layer tree and feature inspection UI completed
- Replaced the flat layer/filter panel with a real operator-facing tree workspace in:
  - `src/components/layer-filter-panel.tsx`
- Added dedicated local UI state for the tree surface in:
  - `src/features/layers/layer-tree-ui-store.ts`
- Added tree-domain helpers in:
  - `src/features/layers/layer-catalog-tree.ts`
- Important architectural choices:
  - M17 stays on top of the M16 catalog domain instead of rebuilding layer logic in the component
  - local tree state (panel collapse, search, expanded nodes) is separated from actual map visibility state
  - group/layer/item visibility actions cascade through the catalog and then hydrate back into map overlay state
  - alias/favorite/order mutations all continue to go through the catalog runtime / persisted metadata boundary
- New operator-facing capabilities now present:
  - nested grouped layer tree
  - per-group, per-layer, and per-feature visibility toggles
  - search across layers/features
  - feature/layer/group inspection pane
  - alias editing
  - favorite toggling
  - sibling move up/down reordering
- Extended map visibility support so the tree can control more than the old flat panel:
  - per-marker-item visibility
  - breadcrumb layer visibility
  - measurement layer visibility
- Updated overlay wiring in:
  - `src/features/map/use-map-overlays.ts`
  - `src/features/map/use-map-measurement-overlays.ts`
  - `src/features/tracking/sync-tracking-overlay.ts`
  - `src/features/markers/sync-marker-overlay.ts`
  - `src/features/layers/map-layer-filters.ts`
  - `src/features/layers/layer-visibility-store.ts`
- Added / updated coverage:
  - `tests/unit/layer-catalog-tree.test.ts`
  - `tests/unit/layer-visibility-store.test.ts`
  - `tests/unit/map-layer-filters.test.ts`
  - `tests/e2e/layer-panel.spec.ts`
  - `tests/e2e/full-mission-flow.spec.ts`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Result:
  - the layer workspace now behaves much more like the old operational layer tree
  - M18+ can build on a stronger review/navigation surface instead of a flat filter sidebar

### 2026-04-10 M16 layer catalog domain completed
- Implemented M16 as a proper domain/runtime/persistence foundation underneath the existing flat layer panel rather than jumping straight to the M17 tree UI
- Added the catalog model and ID helpers in:
  - `src/features/layers/layer-catalog-types.ts`
  - `src/features/layers/layer-catalog-ids.ts`
  - `src/features/layers/layer-catalog-builder.ts`
- Added a dedicated catalog runtime/store/bridge:
  - `src/features/layers/start-layer-catalog-runtime.ts`
  - `src/features/layers/layer-catalog-store.ts`
  - `src/features/layers/layer-catalog-runtime-bridge.tsx`
- Important architectural choices:
  - grouped tree model is canonical now: `Tracking`, `Helicopters`, `Map Tools`, `GPX Tracks`
  - stable IDs are explicit and not label-derived
  - metadata persistence is mission-scoped and backend-backed
  - current UI remains the M7 flat filter panel, but it now hydrates from catalog metadata instead of local-only state
  - expanded/collapsed/search remain local UI state, as planned
- Hardened the runtime so feature-item operations do not guess parent IDs from strings:
  - catalog runtime now builds a node index from the real tree
  - rename / favorite / visibility / reorder operations persist against real parent relationships
- Added a Tauri-backed layer catalog metadata adapter in:
  - `src/infrastructure/layer-catalog-store/tauri-layer-catalog-store.ts`
- Extended Rust persistence in `src-tauri/src/persistence.rs`:
  - schema version bumped to `2`
  - new `layer_catalog_entries` table
  - new Tauri commands:
    - `list_layer_catalog_entries`
    - `upsert_layer_catalog_entry`
  - finalized missions reject catalog writes via the same read-only boundary as other mission mutations
- Integrated the current layer panel so mission-scoped visibility now survives reload/recovery in browser validation mode and desktop runtime:
  - `src/components/layer-filter-panel.tsx`
  - `src/features/layers/layer-visibility-store.ts`
  - `src/App.tsx`
- Added / updated coverage:
  - `tests/unit/layer-catalog-builder.test.ts`
  - `tests/unit/start-layer-catalog-runtime.test.ts`
  - `tests/unit/tauri-layer-catalog-store.test.ts`
  - `tests/unit/layer-visibility-store.test.ts`
  - `tests/e2e/layer-panel.spec.ts`
  - Rust persistence tests for catalog entry persistence + finalized rejection
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- Result:
  - M16 is now a solid foundation bead, not a UI stub
  - M17 can build on a real persisted catalog model instead of recreating one in the view layer

### 2026-04-10 M14 finalize / archive / unlock completed
- Implemented M14 as a separate mission-governance slice rather than inflating the active mission runtime:
  - `src/features/mission/start-mission-governance-runtime.ts`
  - governance state/controller added to `src/features/mission/mission-store.ts`
- Added operator-facing governance UI to `src/components/mission-control-panel.tsx`:
  - idle-state governance card for the latest finished/finalized mission
  - explicit `Archive & Lock` confirmation flow
  - explicit admin unlock flow with configured admin roster selection + required reason
- Extended the Tauri mission-store boundary in `src/infrastructure/mission-store/tauri-mission-store.ts` with:
  - `finalizeMission`
  - `unlockFinalizedMission`
- Hardened the Rust persistence boundary in `src-tauri/src/persistence.rs`:
  - added finalize command/result and unlock command/input
  - finalize now records governance audit events:
    - `mission_finalize_requested`
    - `mission_archive_succeeded`
    - `mission_archive_failed`
    - `mission_finalized`
  - admin unlock now records:
    - `mission_unlock_requested`
    - `mission_unlocked`
    - `mission_unlock_denied`
  - added true read-only enforcement for finalized missions at the persistence layer:
    - device writes
    - position writes
    - marker create/update/delete
    - drawing create/update/delete
- Browser validation harness now mirrors the same governance rules:
  - supports finalize/unlock
  - enforces finalized read-only behavior
  - uses configured admin roster from browser settings fallback
- Added / updated coverage:
  - `tests/unit/start-mission-governance-runtime.test.ts`
  - `tests/unit/tauri-mission-store.test.ts`
  - `tests/unit/browser-harness-store.test.ts`
  - `tests/unit/start-app-runtime.test.ts`
  - `tests/e2e/mission.spec.ts`
  - Rust persistence tests for finalize/unlock/read-only
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅

### 2026-04-10 M12 settings workspace completed
- Implemented the standalone settings workspace needed for plugin parity in:
  - `src/components/settings-workspace.tsx`
  - `src/features/settings/`
  - `src/infrastructure/settings-store/tauri-settings-store.ts`
  - `src-tauri/src/settings.rs`
- Added a Tauri-backed desktop settings store with a dedicated secret boundary:
  - operational defaults persist in `settings.json`
  - Traccar secrets are kept in a Tauri-side `SecretStore` via OS keyring, not in mission SQLite or browser storage
- Added settings coverage for:
  - mission defaults
  - primary / backup mission roots
  - coordinator roster
  - admin roster
  - Traccar provider config
  - basic and bearer auth modes
  - auto-connect default
  - tracking cache default
  - replay defaults
  - coordinate display preference
- Added runtime reload plumbing so saving settings can immediately reconfigure:
  - autosave interval / enablement
  - tracking polling interval / enablement
  - tracking cache enablement
  - forced reconnect on `Save & Connect`
- Added migration hardening on the Rust settings schema:
  - persisted settings structs now tolerate partial / older JSON via serde defaults
  - legacy settings loads fall back safely instead of parse-failing
- Added provider-gated replay enforcement in both frontend and backend validation / normalization so non-Traccar modes cannot persist replay defaults accidentally
- Added focused coverage:
  - `tests/unit/settings-validation.test.ts`
  - `tests/unit/coordinate-preferences.test.ts`
  - `tests/unit/start-app-runtime.test.ts`
  - `tests/e2e/settings.spec.ts`
  - Rust settings tests in `src-tauri/src/settings.rs`
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅

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

### 2026-04-10 M21 diagnostics workspace completed
- Added a dedicated diagnostics feature slice and operator workspace:
  - `src/features/diagnostics/diagnostics-model.ts`
  - `src/features/diagnostics/diagnostics-store.ts`
  - `src/features/diagnostics/diagnostics-workspace-store.ts`
  - `src/features/diagnostics/start-diagnostics-runtime.ts`
  - `src/features/diagnostics/diagnostics-runtime-bridge.tsx`
  - `src/components/diagnostics-workspace.tsx`
- Added support report export plumbing:
  - `src/infrastructure/support-report/tauri-support-report-store.ts`
  - `src-tauri/src/diagnostics.rs`
  - `src/lib/app-version.ts`
  - `src/App.tsx`
  - `src-tauri/src/lib.rs`
- Added safe repair tooling for corrupted/stale layer catalog metadata:
  - `clear_layer_catalog_entries` in `src-tauri/src/persistence.rs`
  - mission-store adapter support in `src/infrastructure/layer-catalog-store/tauri-layer-catalog-store.ts`
  - repair action refreshes the active catalog after metadata reset
- Hardened drawing selection fallback:
  - `src/features/drawings/drawing-hit-testing.ts` now supports point, line-segment, and polygon hit testing
  - fixed select-mode edit/delete regression for non-point drawings
- Hardened browser harness tracking isolation:
  - `src/features/mission/mission-browser-harness.ts` now starts real HTTP polling only when both tracking env vars are present and `?liveTracking=1` is set
  - this prevents deterministic Playwright harness runs from being polluted by ambient mock/live Traccar config
  - live browser validation against mock Traccar should now use `?missionHarness=1&liveTracking=1`
- Tightened flaky timer/browser assertions without weakening behavioral intent:
  - `tests/e2e/mission.spec.ts`
  - `tests/e2e/full-mission-flow.spec.ts`
  - broad mission flow now has an explicit 45s budget because it is intentionally end-to-end and multi-surface
- Added/updated coverage:
  - `tests/unit/diagnostics-model.test.ts`
  - `tests/unit/start-diagnostics-runtime.test.ts`
  - `tests/unit/tauri-layer-catalog-store.test.ts`
  - `tests/unit/drawing-hit-testing.test.ts`
  - `tests/e2e/diagnostics.spec.ts`
- Verification completed:
  - `npm run lint` ✅
  - `npm run test` ✅
  - `npm run build` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - `npm run test:e2e` ✅
- Bead status:
  - `sartracker-web-2jk.10` ready to close as complete

### 2026-04-11 runtime lifecycle hardening pass
- Improved maintainability and runtime robustness in the app bootstrap/orchestration layer:
  - extracted runtime service startup/teardown into `src/features/runtime/runtime-managed-services.ts`
  - `src/features/runtime/start-app-runtime.ts` now treats autosave + tracking as managed lifecycle units instead of mutating stop handles inline
- Hardened `reloadSettings()` behavior:
  - healthy autosave/tracking services are no longer torn down before replacement services are confirmed
  - overlapping reload calls now use generation-based last-request-wins semantics
  - stale in-flight reloads clean up their own temporary services instead of overriding the latest configuration
- Added explicit runtime teardown support:
  - `AppRuntimeController` now exposes `dispose()`
  - startup/runtime ownership is now explicit instead of assuming process lifetime
- Added unit coverage for the new lifecycle guarantees:
  - keeps existing services alive when settings reload fails
  - applies only the latest overlapping settings reload
  - disposes active runtime services explicitly
- Verification completed:
  - `npm run lint` ✅
  - `npm run test` ✅
  - `npm run build` ✅
  - `npx playwright test tests/e2e/settings.spec.ts tests/e2e/diagnostics.spec.ts tests/e2e/full-mission-flow.spec.ts` ✅

### 2026-04-11 M22 GPX import/watch parity completed
- Added a first-class GPX feature slice instead of overloading drawings:
  - `src/features/gpx/gpx-parser.ts`
  - `src/features/gpx/start-gpx-runtime.ts`
  - `src/features/gpx/gpx-store.ts`
  - `src/features/gpx/gpx-runtime-bridge.tsx`
  - `src/features/gpx/gpx-geojson.ts`
  - `src/features/gpx/sync-gpx-overlay.ts`
- Added desktop GPX ingest infrastructure with native dialog support and thin file-system commands:
  - `src/infrastructure/gpx-import-source/tauri-gpx-import-source.ts`
  - `src-tauri/src/gpx.rs`
  - `@tauri-apps/plugin-dialog` / `tauri-plugin-dialog`
- Extended the mission store with persisted GPX imports and audit events:
  - `src/infrastructure/mission-store/tauri-mission-store.ts`
  - `src-tauri/src/persistence.rs`
  - `src-tauri/src/lib.rs`
- Delivered plugin-parity GPX workflows:
  - one-off GPX file import
  - folder import
  - watched-folder import with immediate initial ingest and rescan support
  - duplicate suppression by source path
  - one dynamic layer per GPX file under the top-level `GPX Tracks` group
- Wired GPX through operator-facing surfaces:
  - `src/components/gpx-import-panel.tsx`
  - `src/App.tsx`
  - layer catalog and visibility integration in `src/features/layers/*`
  - mission review summary/event support in `src/features/mission-review/*`
  - browser harness/runtime parity in `src/features/browser-validation/*` and `src/features/mission/mission-browser-harness.ts`
- Hardened map overlay startup timing:
  - added `src/features/map/map-style-sync.ts`
  - overlay hooks now retry until the style is actually ready so early-arriving mission data is not silently dropped during initial map boot
  - this fixed a real GPX rendering race and improves the shared overlay path beyond M22
- Added/updated coverage:
  - `tests/unit/gpx-parser.test.ts`
  - `tests/unit/start-gpx-runtime.test.ts`
  - `tests/unit/browser-harness-store.test.ts`
  - layer catalog runtime/tree tests updated for GPX-aware inputs
  - `tests/e2e/gpx-import.spec.ts`
- Verification completed:
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test -- tests/unit/gpx-parser.test.ts tests/unit/start-gpx-runtime.test.ts tests/unit/layer-catalog-builder.test.ts tests/unit/start-layer-catalog-runtime.test.ts tests/unit/layer-catalog-tree.test.ts tests/unit/browser-harness-store.test.ts` ✅
  - `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - `npx playwright test tests/e2e/map.spec.ts tests/e2e/layer-panel.spec.ts tests/e2e/mission-review.spec.ts tests/e2e/gpx-import.spec.ts` ✅
- Bead status:
  - `sartracker-web-2jk.11` ready to close as complete
