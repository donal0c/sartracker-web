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

1. Fix the S1/S2 review remediation items that affect operator trust signals before starting S3.
2. Keep hosted browser testing smooth enough for the team to give real feedback.
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
| 1 | R6: Roll Back Core Runtimes When Initial Settings Reload Fails | Shared | `sartracker-web-10q` | Blocks S3 |
| 2 | R7: Harden Runtime Fault Reload Flow | Shared / Track A | `sartracker-web-syi` | Blocks S3 |
| 3 | R8: Add Tauri Beta Gatekeeper Guidance | Track B / Docs | `sartracker-web-977` | Before beta artifact sharing |
| 4 | R9: Add Checked-In Boot/Fault/Autosave UI Regression Coverage | Verification | `sartracker-web-ahp` | Ready |
| 5 | R10: Compress Handoff And Annotate Historical Docs | Process / Docs | `sartracker-web-419` | Ready |
| 6 | R11: Add Browser Harness Storage Non-Goals Note | Track A / Docs | `sartracker-web-mh5` | Ready |
| 7 | S3: Layer Visibility Service Extraction | Shared / Track A | Create/update bead before starting | Ready after R6-R7, or explicit acceptance |
| 8 | A3: Team Feedback Triage Pass | Track A | Create/update beads from feedback | As feedback arrives |
| 9 | B2: Tauri Beta Release Template | Track B | Create/update bead before starting | Ready |
| 10 | B3: First Internal Tauri Smoke Build | Track B | Create/update bead before starting | Ready after B2 |
| 11 | S4: Map Overlay Consolidation And Camera Race Fix | Shared / Track B | Create/update bead before starting | Ready after S3 preferred |
| 12 | S5: Mission Control View Model Extraction | Shared / Track A | Create/update bead before starting | Best after real UI feedback |
| 13 | V1: Regression E2E Coverage | Verification | Create/update bead before starting | Ready |
| 14 | V2: Visual Review Automation | Verification | Create/update bead before starting | Ready |
| 15 | B4: GPX And Drawing Hit-Test Hardening | Track B | Create/update bead before starting | Ready |
| 16 | C1: Local Proprietary Map Package Requirements | Track B / Maps | Create/update bead before starting | Waiting for map facts |

## Ready Work Chunks

### R0: S1/S2 Review Remediation Gate

Source: multi-agent review of S1 Runtime Boot/Fault Guard, A1 Hosted Testing Instructions, B1 Tauri Beta Packaging Recon, S2 Autosave Lifecycle Hardening, plus adjacent code.

Verdict folded into this plan: do not start S3 until R6-R7 are fixed or explicitly accepted. The review found that the S1/S2 architecture is directionally sound, but several operator-trust signals can currently mislead the user about autosave, hosted-mode persistence, startup failure, or lifecycle backup state.

Completed remediation:

- `sartracker-web-dfx` — R1: lifecycle autosave failures stay visible after unrelated successful syncs and clear after the matching lifecycle sync succeeds.
- `sartracker-web-5ps` — R2: autosave stale warnings use observed tick time instead of wall-clock subtraction.
- `sartracker-web-3dv` — R3: hosted browser mode reports browser-test/session-storage status, keeps warnings visible in Focus Mode, and fails visibly without the explicit harness.
- `sartracker-web-57m` — R4: lifecycle backup failures render as a persistent non-dismissible alert, and the backend contract confirms `sync_backup()` succeeds after non-active lifecycle transitions while backup audit events remain active-mission-only.
- `sartracker-web-qdh` — R5: app runtime controller replacement logs cleanup failures from the previous controller without blocking the next controller installation, and active disposal clears the registry even if underlying cleanup throws.

Blocking remediation:

- `sartracker-web-10q` — R6: Roll back core runtimes when initial settings reload fails.
- `sartracker-web-syi` — R7: Harden runtime fault reload flow.

Follow-up remediation:

- `sartracker-web-977` — R8: Add Tauri beta Gatekeeper guidance.
- `sartracker-web-ahp` — R9: Add checked-in boot/fault/autosave UI regression coverage.
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

Goal: convert raw feedback into actionable chunks and beads.

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

Acceptance:

- Desktop beta is either smoke-tested locally or blocked by a specific packaging/runtime issue.

Verification:

- Screenshot or notes in handoff.
- Build artifact path recorded.

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
