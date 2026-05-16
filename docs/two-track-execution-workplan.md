# Two-Track Execution Workplan

> **Canonical planning path.** Start here when deciding what to do next. All new planning, hardening, feedback, release, map, UI, verification, and parity work must either fit into this queue or update this queue before implementation starts.

## Planning Rule

There is one active work queue: this file.

Supporting docs may explain a specific area, but they must not become separate task boards. If a task is discovered in a report, chat, test run, review, bug report, or support note, fold it into this file as a chunk before treating it as planned work.

Do not create new planning queues under other names. Do not revive the old hardening backlog as an active board. Historical reports are evidence only; this file decides the next task.

When a chunk is finished:

1. Update this file if the queue changed.
2. Update the relevant bead.
3. Update `handoff/HANDOFF.md` with only the current baton.
4. Update the operator manual if operator-facing behavior changed.
5. Run the relevant verification for the chunk.

Verification is not optional closeout ceremony. For any UI, map, workflow, runtime, hosted deployment, or operator-facing change, Codex should choose and run the appropriate browser-backed verification before recording final docs or closing the bead. The default ladder is:

- Inbuilt browser for quick manual sanity checks.
- Playwright for repeatable UI/workflow/regression checks.
- Chrome or Chrome DevTools MCP when the issue depends on the user's real browser profile, existing tabs, DevTools/network evidence, or browser-specific behavior.

The user should not need to repeat this in every prompt. The available browser tools are all acceptable when they are the right fit: `$browser:browser`, `$chrome:Chrome`, `$chrome-devtools-cli`, and `$playwright`. Each chunk's handoff/bead update must state the exact browser flow or deployed URL that was verified, or explicitly say why UI verification was not relevant.

## Operating Model

Run two delivery tracks in parallel, with shared-foundation work feeding both.

**Track A: Hosted team testing**

- Runtime: Vercel hosted browser testing mode.
- URL: `https://sartracker-web.vercel.app/?missionHarness=1`
- Purpose: let the team learn the app, find bugs, request UI changes, and test tracking/layers/workflows quickly.
- Release style: small, frequent Vercel deploys.
- Persistence expectation: session storage only; testing/training, not live incidents.

**Track B: Tauri operational readiness**

- Runtime: packaged Tauri desktop app.
- Purpose: prepare the operational release lane without waiting for all UI feedback to finish.
- Release style: quieter background work, then versioned beta packages when a coherent batch is ready.
- Persistence expectation: SQLite, filesystem adapters, recovery, diagnostics, and local map packages.

**Shared foundation**

- Runtime boot, mission lifecycle, tracking, layer visibility, map overlays, and verification hardening that affects both tracks.
- These chunks should be pulled forward when they reduce confusion, unblock UI changes, or lower operational risk.

## Decision Rule

When new work arrives, classify it before implementing:

| Work type | Route |
| --- | --- |
| Confusing UI, wording, control placement, layer visibility, tracking display | Track A |
| Bug visible in hosted browser testing mode | Track A first, then confirm whether Tauri is also affected |
| Runtime boot, startup failure visibility, shared mission/layer/tracking correctness | Shared foundation |
| Mission persistence, recovery, filesystem, GPX watch, diagnostics export, archive | Track B |
| High-definition mountain map integration | Track B / desktop-first |
| Browser IndexedDB, browser backups, browser file workflows | Defer until the browser-hardening decision |
| Security concern about public map hosting | Track B / local map package support; do not host proprietary maps |
| New hardening finding | Add it here as Shared, Track A, Track B, Verification, or Deferred |

## Current Priority

1. Keep hosted browser testing smooth enough for the team to give real feedback.
2. Fix the 2026-05-16 team feedback items that affect map trust before returning to broader foundation work.
3. Burn down shared foundation issues that make startup, mission control, tracking, layers, or map behavior ambiguous.
4. Prepare a repeatable Tauri beta release path in the background.
5. Avoid heavy browser hardening unless testing proves browser operational deployment is genuinely needed.
6. Treat high-definition mountain maps as local desktop map packages unless the map provider gives requirements that change this.

## Next Task Order

This is the default order when the user says “work on the next task.”

| Order | Chunk | Track | Bead | Status |
| --- | --- | --- | --- | --- |
| Done | S1: Runtime Boot/Fault Guard | Shared | `sartracker-web-3rl` | Done 2026-05-16 |
| Done | A2: Hosted Mode Guardrails | Track A | `sartracker-web-vpz.3` | Done 2026-05-15 |
| Done | Settings Save-Close UX | Track A | `sartracker-web-fnc` | Done 2026-05-15 |
| Done | Hosted Tracking History Quota + 48h Offset | Track A | `sartracker-web-vpz.4` | Done 2026-05-16 |
| Done | A1: Hosted Testing Instructions And Feedback Intake | Track A | `sartracker-web-vpz.1` | Done 2026-05-16 |
| Done | B1: Tauri Beta Packaging Recon | Track B | `sartracker-web-vpz.2` | Done 2026-05-16 |
| Done | S2: Autosave Lifecycle Hardening | Shared / Track B | `sartracker-web-vpz.5` | Done 2026-05-16 |
| Done | R1: Preserve Lifecycle Autosave Failure Visibility | Shared / Track B | `sartracker-web-dfx` | Done 2026-05-16 |
| Done | R2: Replace Autosave Wall-Clock Stale Detection | Shared / Track B | `sartracker-web-5ps` | Done 2026-05-16 |
| Done | R3: Make Hosted Browser System Status Honest | Track A / Shared | `sartracker-web-3dv` | Done 2026-05-16 |
| Done | R4: Surface Lifecycle Backup Failures Non-Dismissably | Shared / Track B | `sartracker-web-57m` | Done 2026-05-16 |
| Done | R5: Make Runtime Controller Swap Exception-Safe | Shared | `sartracker-web-qdh` | Done 2026-05-16 |
| Done | R6: Roll Back Core Runtimes When Initial Settings Reload Fails | Shared | `sartracker-web-10q` | Done 2026-05-16 |
| Done | R7: Harden Runtime Fault Reload Flow | Shared / Track A | `sartracker-web-syi` | Done 2026-05-16 |
| Done | Hosted Verification Follow-up Fixes | Track A / Shared | `sartracker-web-vpz` | Deployed and live-verified 2026-05-16 |
| Done | A3.1: Prevent Accidental Map Placement While Panning | Track A / Shared | `sartracker-web-6y3.1` | Done 2026-05-16 |
| Done | A3.2: Fix Drawing Rendering And Layer Visibility | Track A / Shared | `sartracker-web-6y3.2` | Done 2026-05-16 |
| Done | A3.8: Improve Drawing Labels, Styles, And Delete Flow | Track A | `sartracker-web-6y3.8` | Done 2026-05-16 |
| Done | A3.3: Simplify Map And Drawing Tool Chrome | Track A | `sartracker-web-6y3.3` | Done 2026-05-16 |
| Done | A3.7: Add Marker At Grid Reference Workflow | Track A / Parity | `sartracker-web-6y3.7` | Done 2026-05-16 |
| Done | R8: Add Tauri Beta Gatekeeper Guidance | Track B / Docs | `sartracker-web-977` | Done 2026-05-16 |
| 1 | A3.10: Investigate And Fix Irish Grid Conversion Accuracy | Track A / Shared | `sartracker-web-6y3.10` | Ready, urgent map-trust bug |
| 2 | A3.11: Stabilize Marker Placement From Coordinate Entry | Track A / Shared | `sartracker-web-6y3.11` | Ready, urgent map-trust bug |
| 3 | A3.12: Fix Roster Name Entry Spacing | Track A | `sartracker-web-6y3.12` | Ready |
| 4 | A3.13: Rework Coordinate Converter Formats And Naming | Track A / Coordinates | `sartracker-web-6y3.13` | Ready after A3.10 preferred |
| 5 | A3.14: Rename Drawing Tools To Map Tools And Add Measure | Track A / Map Tools | `sartracker-web-6y3.14` | Ready |
| Done | R9: Add Checked-In Boot/Fault/Autosave UI Regression Coverage | Verification | `sartracker-web-ahp` | Done 2026-05-16 |
| 7 | R10: Compress Handoff And Annotate Historical Docs | Process / Docs | `sartracker-web-419` | Ready |
| 8 | R11: Add Browser Harness Storage Non-Goals Note | Track A / Docs | `sartracker-web-mh5` | Ready |
| 9 | S3: Layer Visibility Service Extraction | Shared / Track A | Create/update bead before starting | Ready |
| 10 | A3.4: Clean Up Mission Mast And Right-Panel Duplication | Track A / Shared | `sartracker-web-6y3.4` | Best with S5 |
| 11 | B2: Tauri Beta Release Template | Track B | Create/update bead before starting | Ready |
| 12 | B3: First Internal Tauri Smoke Build | Track B | Create/update bead before starting | Ready after B2 |
| 13 | S4: Map Overlay Consolidation And Camera Race Fix | Shared / Track B | Create/update bead before starting | Ready after S3 preferred |
| 14 | S5: Mission Control View Model Extraction | Shared / Track A | Create/update bead before starting | Pair with A3.4 if selected |
| 15 | V1: Regression E2E Coverage | Verification | Create/update bead before starting | Ready |
| 16 | V2: Visual Review Automation | Verification | Create/update bead before starting | Ready |
| 17 | B4: GPX And Drawing Hit-Test Hardening | Track B | Create/update bead before starting | Ready |
| 18 | A3.5: Add Operational Contrast/Theme Pass | Track A / UI | `sartracker-web-6y3.5` | Planned, not urgent |
| 19 | A3.6: Move Static Operational Notes Out Of Primary Map Chrome | Track A / UI | `sartracker-web-6y3.6` | Planned, keep warnings visible |
| 20 | A3.9: Add Configurable Weather Links Menu | Track A / UI | `sartracker-web-6y3.9` | Planned, external links only |
| 21 | C1: Local Proprietary Map Package Requirements | Track B / Maps | Create/update bead before starting | Waiting for map facts |

## Ready Work Chunks

### R0: S1/S2 Review Remediation Gate

Source: multi-agent review of S1 Runtime Boot/Fault Guard, A1 Hosted Testing Instructions, B1 Tauri Beta Packaging Recon, S2 Autosave Lifecycle Hardening, plus adjacent code.

Verdict folded into this plan: R1-R9 are fixed. S3 can start when selected, while R10-R11 remain follow-up docs/verification-adjacent tasks.

Completed remediation:

- `sartracker-web-dfx` — R1: lifecycle autosave failures stay visible after unrelated successful syncs and clear after the matching lifecycle sync succeeds.
- `sartracker-web-5ps` — R2: autosave stale warnings use observed tick time instead of wall-clock subtraction.
- `sartracker-web-3dv` — R3: hosted browser mode reports browser-test/session-storage status, keeps warnings visible in Focus Mode, and fails visibly without the explicit harness.
- `sartracker-web-57m` — R4: lifecycle backup failures render as a persistent non-dismissible alert, and the backend contract confirms `sync_backup()` succeeds after non-active lifecycle transitions while backup audit events remain active-mission-only.
- `sartracker-web-qdh` — R5: app runtime controller replacement logs cleanup failures from the previous controller without blocking the next controller installation, and active disposal clears the registry even if underlying cleanup throws.
- `sartracker-web-10q` — R6: app runtime startup disposes core feature runtimes if initial settings reload fails after those runtimes start.
- `sartracker-web-syi` — R7: Harden runtime fault reload flow.
- `sartracker-web-977` — R8: Tauri beta docs and manual now include unsigned macOS app expectations, Gatekeeper warning language, quarantine removal guidance, and the internal-beta-only caveat.
- `sartracker-web-ahp` — R9: checked-in browser and visual regression coverage now pins runtime booting, startup fault, autosave stale, autosave failure, focus-mode autosave visibility, and autosave warning accessibility.

Follow-up remediation:

- `sartracker-web-419` — R10: Compress handoff and annotate historical docs.
- `sartracker-web-mh5` — R11: Add browser harness storage non-goals note.

Review finding files are under `tmp/review-s1-a1-b1-s2/` while being triaged and can be deleted once the remediation beads carry enough detail.

### A1: Hosted Testing Instructions And Feedback Intake

Bead: `sartracker-web-vpz.1`

Goal: make it easy for the team to test and report issues consistently.

Tasks:

- Add a concise team testing checklist to the manual or a linked doc.
- Make the URL/base-URL distinction impossible to miss:
  - app URL: `https://sartracker-web.vercel.app/?missionHarness=1`
  - Traccar provider base URL in hosted mode: `https://sartracker-web.vercel.app`
- Add a simple bug report template:
  - what they were trying to do
  - expected result
  - actual result
  - screenshot/video if possible
  - browser and machine
  - mission name/time if relevant
- Add a triage rule for each issue:
  - hosted-only
  - shared app bug
  - desktop-runtime candidate
  - UI/wording preference

Acceptance:

- A tester can find the hosted URL, start a mission, connect tracking, and report a bug without reading chat history.
- The docs clearly say hosted browser mode is for testing only.

Verification:

- Done 2026-05-16: manual and `docs/team-testing-feedback-loop.md` read-through.
- Done 2026-05-16: production hosted app/manual check after Vercel deploy.

### A2: Hosted Mode Guardrails

Bead: `sartracker-web-vpz.3`

Goal: reduce avoidable Traccar URL confusion during browser testing.

Tasks:

- Add hosted-mode copy near Settings/Data Sources explaining that direct HTTP Traccar URLs are blocked by browsers from HTTPS pages.
- In hosted mode, detect `http://` provider URLs and show a specific message directing operators to use `https://sartracker-web.vercel.app`.
- Consider a one-click hosted default for the known testing proxy.
- Keep Tauri desktop behavior unchanged; direct HTTP server URLs are valid there.

Acceptance:

- A tester who enters `http://kmrtsar.ddns.net:8082` in hosted mode gets a clear in-app explanation before chasing network failures.
- Desktop settings remain flexible for direct provider URLs.

Verification:

- Done 2026-05-15: unit coverage for hosted-mode URL validation/helper.
- Done 2026-05-15: hosted Settings UI guardrail and hosted-proxy action added.
- Done 2026-05-15: manual hosted settings check with the inbuilt browser.

### A3: Team Feedback Triage Pass

Parent bead: `sartracker-web-6y3`

Goal: convert raw feedback into actionable chunks and beads.

Latest sources:

- Ned/Eamonn email `Sartracker`, received 2026-05-16 12:48. The email screenshots were used for triage only and are not retained as source-of-truth artifacts.
- Ned/Eamonn email `Sartracker`, received 2026-05-16 13:33. Requests: Marker at GR, Weather links menu, line distance/bearing labels, range-ring clean rendering/layer hiding, drawing delete flow, and search-area styling/clean rendering/layer hiding. The email screenshots were used for triage only and are not retained as source-of-truth artifacts.
- Eamonn email pasted into chat on 2026-05-16. Requests: IG/TM65 conversion accuracy discrepancy against DD reference, intermittent marker placement/disappearing after pan, roster name spacing, coordinate converter order/naming (`IG` -> `DD` -> `DMS` -> `W3W`, no UTM), rename Drawing Tools to Map Tools, and move Measure into Map Tools. The pasted screenshots were used for triage only and are not retained as source-of-truth artifacts.

Tasks:

- Group incoming feedback by area:
  - mission start/control
  - tracking/devices
  - layers/map
  - drawings/markers
  - settings/connectivity
  - layout/UI preferences
  - desktop-only/runtime concerns
- Create or update beads for recurring issues.
- Route each item into this file as Track A, Track B, Shared, Verification, or Deferred.
- Mark quick fixes separately from design questions.
- Keep `handoff/HANDOFF.md` short: only current state, blockers, next actions.

Acceptance:

- No feedback remains only in Slack/chat/email.
- Each issue has a route: quick Vercel fix, planned UI/design pass, desktop beta validation, or deferred.

Verification:

- `bd list` shows new/updated work items.
- This file and the handoff agree on the current next task.

### A3.1: Prevent Accidental Map Placement While Panning

Bead: `sartracker-web-6y3.1`

Goal: make map panning and map placement unmistakably separate so testers do not accidentally create markers or drawings while moving the map.

Tasks:

- Distinguish click from drag/pan before map-placement handlers run.
- Prevent point-based drawing or marker placement when the pointer movement was a pan.
- Add crosshair cursor treatment only for intentional placement tools.
- Keep normal hand/pan affordance for navigation.
- Be cautious with double-click placement because double-click already overlaps map zoom and drawing completion behavior.

Acceptance:

- Panning with marker/drawing tools armed does not create or edit map objects.
- Intentional point placement still works.
- Placement mode visibly differs from panning mode.

Verification:

- Done 2026-05-16: unit coverage for click-vs-drag suppression in `tests/unit/map-interaction-guards.test.ts`.
- Done 2026-05-16: inbuilt-browser check at `http://127.0.0.1:1420/?missionHarness=1` confirmed map drag did not open marker/drawing dialogs, intentional clicks still opened them, and armed drawing tools showed a crosshair cursor.

### A3.2: Fix Drawing Rendering And Layer Visibility

Bead: `sartracker-web-6y3.2`

Goal: map objects must look like what the operator intended and hide reliably through layers.

Tasks:

- Fix text-label rendering so saved text labels do not appear as ordinary round marker dots.
- Keep text label text, color, size, and rotation visible/editable in a clear way.
- Fix search-sector and search-area rendering so outer arc/outline vertex points and spurious points are not visible unless deliberately part of edit/preview state.
- Fix range-ring rendering so LPB/manual rings can render as simple clean lines without persistent marker dots.
- Confirm text labels, search sectors, search areas, and range rings hide by type and by item through the layer panel.
- Capture before/after browser evidence for the same classes of examples described by Ned/Eamonn.

Acceptance:

- Text labels render as text, not marker dots.
- Search sectors, search areas, and range rings render as clean operational geometry.
- Layer visibility controls hide the affected drawing types predictably.

Verification:

- Done 2026-05-16: unit coverage in `tests/unit/drawing-geojson.test.ts` and `tests/unit/map-layer-filters.test.ts` confirms text labels are label-only, range rings render as line features, and drawing label/geometry filters respect type/item visibility.
- Done 2026-05-16: inbuilt-browser check at `http://127.0.0.1:1420/?missionHarness=1` created range rings and a text label, expanded the Layers workspace, and confirmed range-ring/text-label layer visibility toggles. Evidence screenshot: `test-results/a3-map-drawing-verification/drawing-layer-toggle-hidden.png`.

### A3.3: Simplify Map And Drawing Tool Chrome

Bead: `sartracker-web-6y3.3`

Goal: reduce map-surface clutter while preserving fast access to the tools testers need most.

Tasks:

- Replace the always-visible basemap row with a compact `Maps` control/menu.
- Replace the expanded drawing-toolbar mode/collapse pattern with one compact `Drawing Tools` open/close control.
- Remove redundant active-select/collapse controls if the simplified control makes them unnecessary.
- Move routine map-tile cache controls out of the primary map surface where safe.
- Keep operational warnings visible when they matter; do not hide hosted/runtime/autosave/tracking warnings merely to reduce clutter.

Acceptance:

- Map and drawing controls are easier to find and create less visual clutter.
- Tool selection remains explicit and reversible.
- Safety-critical warnings remain visible.

Verification:

- Done 2026-05-16: compact Maps menu replaces the always-visible basemap row, Drawing Tools uses one open/close control with the active mode in the header, and routine offline `Check View` moved into the Maps menu while the offline readiness warning remains visible.
- Done 2026-05-16: Chromium E2E covered desktop map controls, basemap persistence, viewport preservation, and a 900px narrow operator viewport.

### A3.4: Clean Up Mission Mast And Right-Panel Duplication

Bead: `sartracker-web-6y3.4`

Goal: make mission identity, phase, and timing scan-friendly without repeating the same information in multiple panels.

Tasks:

- Remove duplicate mission time display from the right panel if the mast remains the authoritative timer location.
- Place mission name/status near the SAR Tracker mast area in a calm, readable layout.
- Preserve mission lifecycle enablement rules.
- Prefer pairing this with `S5: Mission Control View Model Extraction` if implementation would otherwise tangle layout and lifecycle logic.

Acceptance:

- Mission time has one authoritative visible location.
- Mission name/status remain easy to see.
- The right panel gains useful space without changing mission lifecycle behavior.

Verification:

- Browser-backed active and paused mission checks.
- Existing mission lifecycle tests remain green.

### A3.5: Add Operational Contrast/Theme Pass

Bead: `sartracker-web-6y3.5`

Goal: address the team's concern that the current colour scheme is not suitable for all testers without turning this into an open-ended redesign.

Tasks:

- Decide whether the right first move is one improved high-contrast operational theme or a small theme toggle.
- Use the QGIS plugin style as a contrast/readability reference, not as a requirement to copy the old UI.
- Preserve distinct meanings for critical/amber/disabled/online/offline states.

Acceptance:

- The main shell, map overlays, settings, and drawing controls are more readable.
- Status colors remain semantically clear.

Verification:

- Browser-backed visual check across the main operator surfaces.
- Update visual tests/screenshots if this changes expected appearance.

### A3.6: Move Static Operational Notes Out Of Primary Map Chrome

Bead: `sartracker-web-6y3.6`

Goal: reduce map clutter by moving static reference notes out of the primary map surface while keeping live risk signals visible.

Tasks:

- Move static operational notes to Settings/manual or another non-primary surface.
- Keep hosted browser, persistence, autosave, runtime, tracking, and map-readiness warnings visible when relevant.
- Confirm Focus Mode still surfaces warnings that operators must not miss.

Acceptance:

- Static notes no longer take map/sidebar space during normal operation.
- Safety-critical warnings are still visible and hard to miss.

Verification:

- Browser-backed hosted-mode and Focus Mode checks.

### A3.7: Add Marker At Grid Reference Workflow

Bead: `sartracker-web-6y3.7`

Goal: add the QGIS-style marker entry path where an operator can place a marker from a TM65 Irish Grid reference instead of clicking the map.

Tasks:

- Add a `Marker at GR` entry path near the normal marker workflow.
- Let the operator choose marker type before or during the grid-reference entry.
- Validate TM65 Irish Grid references with clear errors.
- Convert the grid reference using the existing coordinate utilities and continue into the normal marker form with coordinates prefilled.
- Keep coordinate semantics explicit: TM65 is display/input support; ITM remains the working CRS and WGS84 remains map display/GPS.

Acceptance:

- A valid TM65 grid reference opens the normal marker form with the converted coordinates prefilled.
- Invalid references fail visibly and do not create a marker.
- The flow is covered by tests at the coordinate/validation seam and browser-backed UI verification.

Verification:

- Done 2026-05-16: unit coverage in `tests/unit/marker-draft.test.ts` covers accepted and rejected TM65 grid-reference inputs.
- Done 2026-05-16: Chromium E2E in `tests/e2e/marker.spec.ts` covers Marker At GR success, prefilled marker form coordinates/type, saved hazard marker persistence, and invalid-input rejection without opening the marker dialog.

### A3.8: Improve Drawing Labels, Styles, And Delete Flow

Bead: `sartracker-web-6y3.8`

Goal: make saved drawings more informative and easier to correct when placed in the wrong location.

Tasks:

- Add distance and bearing information to line drawings where useful.
- Show a clear indication of where a line is drawn to.
- Add useful search-area label font-size and fill-colour controls without overloading the form.
- Provide an obvious delete flow for user-created drawings/layer items such as misplaced range rings.
- Keep destructive actions confirmed and auditable where they mutate mission data.

Acceptance:

- Line drawings can show distance and bearing.
- Search areas have useful style controls.
- Misplaced user-created drawings can be deleted through an obvious edit/layer flow.
- Drawing persistence and mission mutability rules remain intact.

Verification:

- Done 2026-05-16: unit coverage in `tests/unit/drawing-builders.test.ts` and `tests/unit/drawing-geojson.test.ts` covers line distance/bearing metadata, search-area fill/label styling persistence, and styled map feature shaping.
- Done 2026-05-16: Chromium E2E in `tests/e2e/drawing-tools.spec.ts` covers line distance/bearing/endpoint readouts, styled search-area persistence, LPB range rings, layer-panel edit entry, and confirmed drawing deletion.

### A3.9: Add Configurable Weather Links Menu

Bead: `sartracker-web-6y3.9`

Goal: give operators quick access to external weather resources without pretending the app has a built-in weather integration.

Tasks:

- Add Settings support for a small list of named weather URLs.
- Add a compact `Weather` control in a sensible top-panel location.
- Open selected weather links safely.
- Reject invalid URLs with clear copy.
- Treat this as external links for now; do not fetch/weather-normalize data inside the app unless a later bead expands the requirement.

Acceptance:

- Operators can configure and open named weather links such as `https://www.met.ie/`.
- Empty state is clear when no weather links are configured.
- Invalid URLs are rejected before save/use.

Verification:

- Unit coverage for URL validation/config shaping.
- Browser-backed configured, empty, and invalid states.

### A3.10: Investigate And Fix Irish Grid Conversion Accuracy

Bead: `sartracker-web-6y3.10`

Goal: resolve the reported difference between a DD marker and an IG/TM65 marker for the same physical location.

Reported reference:

- DD: `52.179337, -9.464944`
- IG/TM65: `Q 99842 04015`
- Source context: Outdoor Active screenshot from Eamonn; Eamonn says the same discrepancy existed in the QGIS plugin.

Tasks:

- Add the Outdoor Active reference as a golden coordinate test case.
- Compare DD, IG/TM65, ITM/display, and marker placement outputs for the same point.
- Determine whether the discrepancy is caused by parser precision, datum/projection transform, grid-reference semantics, rounding, or a mismatch in the supplied reference data.
- Decide and document the acceptable operational tolerance before closing.
- If the app is wrong, fix conversion/marker placement. If the source/plugin reference is wrong, surface that clearly in docs/bead notes.

Acceptance:

- The reported point has deterministic tests.
- DD and IG/TM65 placement either agree within an explicitly accepted tolerance or the discrepancy is documented as unsafe/unresolved.
- Marker At GR and coordinate converter behavior are verified against the reference point.

Verification:

- Coordinate unit/golden tests.
- Browser-backed Marker At GR and coordinate-converter check at the reported point.

### A3.11: Stabilize Marker Placement From Coordinate Entry

Bead: `sartracker-web-6y3.11`

Goal: coordinate-created markers must never appear intermittently or disappear after map movement.

Tasks:

- Reproduce marker placement from lat/long and converted coordinates repeatedly.
- Check create/save ordering, overlay source updates, layer visibility filters, basemap/style reload behavior, and map pan/zoom refresh behavior.
- Make success/failure explicit: no ghost marker, no disappearing saved marker, and no silent failure.

Acceptance:

- Markers created from lat/long or converted coordinates persist before the dialog closes.
- Saved markers remain visible after pan, zoom, and basemap/style changes.
- Failed placement shows an actionable error and does not leave a temporary marker behind.

Verification:

- Unit/integration coverage where the bug is found.
- Browser-backed repeated marker placement, pan/zoom, and layer-refresh checks.

### A3.12: Fix Roster Name Entry Spacing

Bead: `sartracker-web-6y3.12`

Goal: coordinator/admin roster entry should support normal person names while typing.

Tasks:

- Fix roster input/tokenization so internal spaces are allowed.
- Preserve comma/newline-separated roster entries.
- Trim accidental boundary whitespace without removing intended internal spaces.
- Confirm coordinator and admin rosters persist and reload correctly.

Acceptance:

- Names such as `Cathal Cudden, Tim Murphy, John Cronin` can be entered naturally.
- Spaces are not stripped while typing.
- Saved rosters reload without mangling names.

Verification:

- Unit coverage for roster parsing/serialization if applicable.
- Browser-backed Settings roster entry check.

### A3.13: Rework Coordinate Converter Formats And Naming

Bead: `sartracker-web-6y3.13`

Goal: align the converter with the formats the coordinators actually use.

Tasks:

- Rename/reorder converter modes as `IG`, `DD`, `DMS`, `W3W`.
- Remove UTM from the primary operator converter.
- Keep DD and IG as the most prominent workflows.
- Treat W3W as decision-gated unless API, licensing, offline behavior, and operational accuracy requirements are settled.

Acceptance:

- The converter presents `IG`, `DD`, `DMS`, `W3W` in that order.
- UTM is not part of the primary operator converter flow.
- DD/IG/DMS work with deterministic tests.
- W3W is either implemented behind a documented integration decision or clearly marked unavailable/deferred.

Verification:

- Unit tests for supported conversions.
- Browser-backed converter flow check.

### A3.14: Rename Drawing Tools To Map Tools And Add Measure

Bead: `sartracker-web-6y3.14`

Goal: make measurement easier to find and align tool naming with the team's language.

Tasks:

- Rename the primary `Drawing Tools` chrome to `Map Tools`.
- Keep drawing tools available under that grouping.
- Move or duplicate Measure into Map Tools.
- Keep the measure output simple: distance and map bearing only, e.g. `1.3 km 230°`.

Acceptance:

- Operators can open Map Tools and find Measure there.
- Measurement mode outputs distance and map bearing clearly.
- Exiting Measure returns to the normal pan/select behavior without accidental drawing placement.

Verification:

- Browser-backed Map Tools/Measure workflow check.

### B1: Tauri Beta Packaging Recon

Bead: `sartracker-web-vpz.2`

Goal: find the shortest reliable path to a first desktop beta artifact.

Tasks:

- Identify current Tauri build command and output artifacts.
- Run a local package build if prerequisites are present.
- Record artifact paths and package formats.
- Note signing/notarization warnings without solving them yet.
- Write down the expected install path for macOS/Windows.

Acceptance:

- We know exactly how to build a local beta package on the current machine.
- Unknowns are explicit, especially target OS and signing.

Verification:

- Done 2026-05-16: `npm run tauri build` compiled the release binary and `.app`, then failed reproducibly during DMG bundling at `bundle_dmg.sh`.
- Done 2026-05-16: `npm run tauri build -- --bundles app` succeeded and produced `src-tauri/target/release/bundle/macos/sartracker-web.app`.
- Done 2026-05-16: zipped the `.app` locally with `ditto` to prove a first-shareable macOS artifact path.
- Done 2026-05-16: results recorded in `docs/tauri-beta-release-plan.md`.

### B2: Tauri Beta Release Template

Goal: make desktop beta drops repeatable.

Tasks:

- Create a release note template with:
  - build/version
  - install instructions
  - what changed
  - what to test
  - known limitations
  - rollback/reinstall guidance
- Define minimum verification before sharing a beta:
  - `npm run lint`
  - `npm run build`
  - `npm run test`
  - `npm run test:backend`
  - packaged app smoke test
- Decide where beta artifacts will live initially.

Acceptance:

- A future agent can create a Tauri beta with release notes without inventing the process.

Verification:

- Dry-run release notes from the current version.

### B3: First Internal Tauri Smoke Build

Goal: prove the desktop runtime can launch and execute the core path before involving the team.

Tasks:

- Build the app.
- Install/open locally.
- Start a mission.
- Configure Traccar directly or through the appropriate desktop settings path.
- Confirm mission persistence across app restart.
- Confirm diagnostics/version visibility.
- Confirm post-finish `sync_backup` writes the backup mirror without logging a misleading backup audit row when no active mission remains.
- Note the teardown edge case: forced lifecycle sync requests that arrive after autosave has stopped currently no-op; treat as acceptable unless desktop smoke testing shows operator-visible loss.

Acceptance:

- Desktop beta is either smoke-tested locally or blocked by a specific packaging/runtime issue.

Verification:

- Screenshot or notes in handoff.
- Build artifact path recorded.
- Backend/audit note confirming post-finish backup behavior.

### B4: GPX And Drawing Hit-Test Hardening

Former hardening item: T11.

Goal: reduce map-interaction ambiguity around GPX and drawing hit-testing before field-oriented map work.

Tasks:

- Review GPX and drawing hit-test boundaries.
- Make hit-test decisions explicit and testable.
- Avoid silent ambiguity when overlapping map features are selectable.
- Keep operator behavior calm and predictable under dense map state.

Acceptance:

- GPX/drawing selection rules are explicit in code and covered by tests.
- Ambiguous interactions fail visibly or choose the documented priority order.

Verification:

- Unit tests for the hit-test rules.
- Targeted map interaction check with the inbuilt browser.

### C1: Local Proprietary Map Package Requirements

Goal: prepare for team-provided high-definition mountain maps without creating a hosting/security problem.

Tasks:

- Ask/record map package facts:
  - format
  - file/folder structure
  - size
  - CRS/projection
  - raster vs vector
  - tile scheme
  - expected update cadence
  - sample/test file availability
- Confirm the plan:
  - app is distributed separately
  - map is installed locally by trusted team members
  - map is never hosted by Vercel/GitHub
- Draft the app workflow:
  - Settings -> Maps -> Add Local Map Package
  - validate map
  - store local path/checksum/version
  - show map readiness

Acceptance:

- We know enough about the map format to design the local map adapter.
- The security model is clear: local side-load, no public hosting.

Verification:

- Requirements captured in `docs/local-map-package-plan.md` when enough details exist.

## Shared Foundation Chunks

### S1: Runtime Boot/Fault Guard

Former hardening item: T06.

Goal: startup must be observable. The app should never render a broken console with disabled controls and no explanation.

Tasks:

- Add a small runtime boot-state store with phases `booting`, `ready`, and `failed`.
- Transition to `ready` only after app or browser-harness runtime startup succeeds.
- Transition to `failed` with a clear error string if startup fails.
- Gate the app shell:
  - booting: show a minimal preparing message
  - failed: show a clear fault banner and Reload action
  - ready: show the normal app
- Make `applyAppRuntimeController` dispose the previous controller before replacing it.
- Ensure runtime controller disposal is idempotent and releases autosave/tracking resources.

Acceptance:

- Startup failure is visible to the operator.
- Double runtime initialization cannot leak the previous controller.
- Normal hosted and Tauri startup behavior remains unchanged apart from the brief boot state.

Verification:

- Done 2026-05-16: unit tests for boot-state transitions, boot/fault shell rendering, startup orchestration, dispose-before-replace, and idempotent disposal.
- Done 2026-05-16: `npm run lint`, `npm run test -- --run`, `npm run build`, and `npm run test:backend` passed.
- Done 2026-05-16: targeted app-start check with the inbuilt browser at `http://127.0.0.1:5173/?missionHarness=1` showed the normal app shell and hosted-testing banner with no boot/fault gate left visible.

### S2: Autosave Lifecycle Hardening

Bead: `sartracker-web-vpz.5`

Former hardening item: T10.

Goal: mission lifecycle transitions should request an immediate durable sync, and autosave failures should not be invisible.

Tasks:

- Add or expose an autosave `requestSync()` path.
- Trigger autosave on important mission lifecycle transitions such as start, pause, resume, finish/finalize, and unlock where appropriate.
- Track autosave status and last failure.
- Surface a subtle but visible command-mast warning when autosave is stale or failing.
- Preserve known backup-audit behavior: backup sync events only exist when an active mission exists.

Acceptance:

- Lifecycle transitions no longer wait only for interval/visibility/pagehide autosave.
- Operators get a visible signal when autosave is failing or stale.
- Finished/finalized mission semantics remain intact.

Verification:

- Done 2026-05-16: unit coverage added for forced `requestSync()`, queued lifecycle sync behind in-flight interval sync, stale/failing autosave status, mission lifecycle sync calls, and finalize/unlock sync calls.
- Done 2026-05-16: command mast warning rendering covered by unit test and inbuilt-browser validation at `http://127.0.0.1:1420/?missionHarness=1`.
- Done 2026-05-16: `npm run lint`, `npm run test -- --run`, `npm run build`, `npm run test:backend`, and `npm run test:e2e -- --project=chromium` passed.

### S3: Layer Visibility Service Extraction

Former hardening item: T07.

Goal: make layer visibility rules independent of the React layer panel before UI relocation or redesign work.

Tasks:

- Extract visibility patch logic from `src/components/layer-filter-panel.tsx` into `src/features/layers/layer-visibility-service.ts`.
- Use `src/features/layers/layer-catalog-ids.ts` as the single node-ID/entity translator.
- Keep the service pure; apply Zustand/store updates through a thin adapter.
- Remove duplicate layer-catalog visibility hydration so there is one authoritative call site.
- Preserve existing layer panel behavior and visual output.

Acceptance:

- The layer panel no longer owns domain visibility logic.
- New entity types cannot silently no-op visibility updates.
- Future UI movement can reuse the service without copying logic.

Verification:

- Unit tests for device, marker, drawing, branch, leaf, and unknown-node visibility behavior.
- Existing layer visibility tests remain green.
- Manual/inbuilt-browser layer hide/show check.

### S4: Map Overlay Consolidation And Camera Race Fix

Former hardening item: T12.

Goal: reduce duplicated MapLibre overlay primitives and fix the basemap camera-preservation race.

Tasks:

- Create shared overlay helpers for:
  - ensure GeoJSON source
  - ensure layer
  - combine map filters
  - load SVG icon
- Refactor drawing, marker, measurement, GPX, helicopter, and tracking sync modules to use the shared helpers.
- Fix basemap style switching so camera restoration is applied exactly once at the safe style event point, not immediately and again later.
- Prefer doing this after S3 so layer visibility and overlay changes do not collide.

Acceptance:

- Overlay modules share primitives without losing per-feature clarity.
- Basemap switching does not fight operator camera movement.

Verification:

- Unit tests for shared overlay helpers.
- Unit test for style-switch camera preservation.
- Existing sync module tests remain green.
- Targeted basemap/map interaction check.

### S5: Mission Control View Model Extraction

Former hardening item: T08.

Goal: make mission-control behavior easier to change once team UI feedback starts landing.

Tasks:

- Extract mission timer logic into `useMissionTimer`.
- Extract mission-control state/actions into `useMissionControlViewModel`.
- Keep rendering components thin and predictable.
- Preserve current control enablement rules.
- Do this after S1 where practical, and after S3 if layer/mast UI changes are happening nearby.

Acceptance:

- Mission control rendering is separated from lifecycle/timer orchestration.
- Future UI repositioning does not require reworking mission rules.

Verification:

- Unit tests for timer/view-model behavior where practical.
- Existing mission lifecycle tests remain green.
- Manual/inbuilt-browser mission start/pause/resume/finish check.

## Verification Chunks

### V1: Regression E2E Coverage

Former hardening item: T13.

Goal: add integration-level guards for previously live regressions and cold-start-offline behavior.

Tasks:

- Add E2E coverage for tracking layer visibility filters.
- Add E2E coverage for stale layer-catalog refresh not overwriting a just-clicked visibility toggle.
- Add E2E or mock-server coverage that a healthy poll does not flip to transport failure.
- Add unit and E2E coverage for cold-start-offline showing cached positions with an unambiguous warning.
- Replace brittle fixed waits in parity visibility specs with state-based waits.

Acceptance:

- The known regressions fail red if their fixes are reverted.
- Cold-start-offline is covered at a meaningful seam.
- Visibility specs avoid fixed propagation waits.

Verification:

- Targeted new specs.
- `npm run test`.
- Playwright E2E for any user-visible regression coverage added by this chunk.

### V2: Visual Review Automation

Former hardening item: T09.

Goal: make the existing visual verification workflow less manual and easier to repeat.

Tasks:

- Automate or script the second-layer visual review pass for screenshots in `test-results/visual-verification/`.
- Keep the manifest prompts and evidence trail understandable.
- Do not add new visual specs in this chunk; this is workflow automation.

Acceptance:

- A future verification run has a repeatable way to collect AI visual review outcomes.
- Visual review failures are recorded clearly enough to act on.

Verification:

- Dry run against a small visual manifest set.
- Document the exact command or agent workflow in this file or the visual test docs.

## Deferred / Decision-Gated Work

### Browser Operational Hardening

Do not start this until the team has tested the hosted app and we decide the browser should be more than a testing/training lane.

Possible future work:

- IndexedDB-backed mission store.
- Browser mission export/import.
- Browser-compatible diagnostics export.
- Browser file import and attachment handling.
- Browser secret handling design.
- Browser offline map strategy.

### Stable Desktop Release

Do not start this until at least one beta path is repeatable and tested.

Possible future work:

- Signing/notarization.
- Auto-update.
- Release promotion checklist.
- Team install/update guide.

## Supporting Docs

These docs support this queue but do not define a separate queue:

- `docs/hosted-browser-testing-plan.md` — deployment/product strategy.
- `docs/team-testing-feedback-loop.md` — tester instructions and feedback template.
- `docs/tauri-beta-release-plan.md` — beta packaging/release details.
- `docs/reports/deep-hardening-investigation-2026-05-13.md` — historical evidence for the former T01-T13 hardening items.
- `docs/plugin-parity-matrix.md` — canonical parity evidence.
- `docs/bead-readiness.md` — readiness notes for larger beads.
