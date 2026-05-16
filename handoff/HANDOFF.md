# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Last Updated

- 2026-05-16 by Codex — A3.8/A3.3/A3.7 shipped locally: drawing labels/styles/delete flow, compact map/tool chrome, and Marker At GR are implemented, verified, documented, and beads are closed.

## Operating Rule

The single active planning path is `docs/two-track-execution-workplan.md`.

All new work must be routed there before implementation:

- Track A: hosted team testing
- Track B: Tauri operational readiness
- Shared foundation
- Verification
- Deferred / decision-gated

Supporting docs may explain details, but they must not become separate queues. The old hardening backlog has been folded into the two-track workplan and removed as an active board.

## Current State

- `master` is the canonical working branch.
- The hosted Vercel test lane is live at `https://sartracker-web.vercel.app/?missionHarness=1`.
- Hosted browser mode is testing/training only. It uses browser session storage and should not be treated as operational mission persistence.
- Hosted Traccar testing uses the Vercel same-origin proxy:
  - app URL: `https://sartracker-web.vercel.app/?missionHarness=1`
  - Traccar provider base URL in hosted mode: `https://sartracker-web.vercel.app`
  - direct `http://kmrtsar.ddns.net:8082` is valid for desktop/Tauri, but browsers block it from the HTTPS hosted app.
- Hosted Settings now warns on direct `http://` Traccar provider URLs, blocks Test/Save through validation, offers a hosted-proxy action, and prevents browser tracking bootstrap from stale direct-HTTP settings.
- Hosted browser tracking history now caps persisted breadcrumb positions/events before writing to session storage, with an emergency quota fallback. Live map rendering still receives the loaded tracking snapshot in the current session.
- Mission Start Offset now accepts 0-48 hours, matching the planned tracking history window. Use larger offsets when the test Traccar server has no movement in the last few hours.
- The 48h offset is now aligned across the UI input, mission runtime validation, and browser E2E coverage. The older native-input max drift has been fixed locally.
- Tracking now publishes current fixes before long breadcrumb history completes, caps browser-harness mission persistence to avoid session-storage quota pressure, and keeps the live map snapshot uncapped in the current session.
- Mission finish/recovery now drives tracking to an honest idle state instead of leaving stale `ONLINE` telemetry visible after the mission is inactive. Hosted reloads with memory-only Traccar secrets now explain that the password must be re-entered before reconnecting.
- Marker dialogs keep Save/Cancel visible with a sticky footer, and mission recovery copy now explicitly explains the interrupted-session decision.
- Settings successful save actions now close the workspace after persistence/reload completes. Failed saves keep the workspace open and show the error.
- Startup now has an explicit boot/fault guard. The app shell stays gated while runtime services prepare, startup failures show a fault panel with Reload, and runtime controller replacement disposes the previous controller before installing the next one.
- Hosted tester instructions now have a concise quick-start run sheet, URL/base-URL rules, bug-report template fields, and triage buckets. The operator manual has a hosted testing and feedback section.
- Tauri packaging recon found a working macOS arm64 `.app` path: `npm run tauri build -- --bundles app` -> `src-tauri/target/release/bundle/macos/sartracker-web.app`. Full `npm run tauri build` currently fails at DMG bundling; unsigned/ad-hoc app is rejected by `spctl`, so first beta notes must call out Gatekeeper limitations.
- Autosave now has an explicit forced `requestSync()` path. Mission start, pause, resume, finish, recover-resume, start-fresh, finalize, and unlock request immediate backup sync after the lifecycle database write. Lifecycle-forced autosave failures remain visible after unrelated successful syncs and clear only when the matching lifecycle sync succeeds. Autosave stale warnings use observed command-mast tick time rather than wall-clock subtraction, so clock jumps or laptop sleep do not create immediate false stale warnings.
- Lifecycle backup failures after start, pause, resume, finish, finalize, or unlock now show a persistent non-dismissible alert below the mast. The chosen backend contract is that `sync_backup()` succeeds after non-active lifecycle transitions, but backup audit events remain active-mission-only.
- Runtime controller replacement now catches and logs failures from disposing the previous app runtime controller, so a new controller can still be installed during reload/replacement. Active controller disposal remains idempotent and clears the registry even if underlying cleanup throws.
- App runtime startup now disposes started core feature runtimes if the initial settings reload fails, so a boot fault panel does not leave mission/marker/drawing/helicopter/GPX subscriptions live behind it.
- Runtime boot state now uses generation tokens plus a 30s watchdog so stale/interleaved startup attempts cannot overwrite newer state and a stuck booting state surfaces as an operator-visible fault. The fault panel focuses the clean reload action, announces assertively, tells operators to copy/screenshot the fault, and reloads to a clean URL without harness query flags.
- Hosted browser mode now reports `Browser test` / `Session storage only` in the command mast, keeps the amber hosted warning visible in Focus Mode, uses hosted-specific operational notes, and fails visibly if a non-Tauri runtime starts without the explicit browser harness.
- A multi-agent review of S1/A1/B1/S2 found operator-trust issues around autosave visibility, hosted-mode honesty, lifecycle backup surfacing, runtime controller replacement, and startup rollback. The findings are now filed as remediation beads R1-R11 in `docs/two-track-execution-workplan.md`.
- Latest deployed production URL has command-line validation for proxy endpoints:
  - `/api/session` returned 200 for the team credentials
  - `/api/devices` returned the 18-device roster
  - `/api/positions` returned 14 positions
- Latest production deployment for hosted tracking quota fix:
  - deployment: `dpl_HvDGvhLedbYeBVQQsKwC5NQR5RyU`
  - alias: `https://sartracker-web.vercel.app`
  - validated at 48h offset with real Traccar credentials.
- Latest production deployment for A1 hosted testing docs:
  - deployment: `dpl_7Zk49528gSC3gpGdFCyvMF2sJCHG`
  - alias: `https://sartracker-web.vercel.app`
  - validated with production manual and hosted Settings checks.
- Latest production deployment for hosted verification follow-up fixes:
  - deployment: `dpl_36Tk4Rhdni4XtbsVc7t7EfbA53w3`
  - commit: `cda7af9`
  - alias: `https://sartracker-web.vercel.app`
  - live verification artifact: `test-results/live-verification-2026-05-16T12-18-59-773Z/evidence.json`
  - validated 48h hosted mission, Vercel Traccar proxy, 18 devices, 14 current fixes, 14,575 breadcrumb points, reload/reconnect honesty, finish-to-idle tracking state, and no quota failures.
- Ned/Eamonn's 2026-05-16 feedback emails are folded into the canonical workplan as A3. The email screenshots were used for triage only and deleted; the durable source of truth is the A3 workplan/beads. The urgent items are accidental placement while panning and drawing rendering/layer visibility across text labels, sectors, search areas, and range rings.
- A3.1/A3.2/A3.8/A3.3/A3.7 are complete locally. Map click-vs-drag suppression, clean drawing rendering/layer visibility, drawing distance/bearing/style/delete improvements, compact Maps/Drawing Tools chrome, and Marker At GR are covered by unit/E2E/visual verification. Operator manual screenshots for the app shell and tools map were refreshed locally.

## Traccar Test Details

Use these only for team testing, not as a production secret model.

- Upstream team Traccar server: `http://kmrtsar.ddns.net:8082`
- Hosted browser provider base URL: `https://sartracker-web.vercel.app`
- Hosted proxy endpoints: `/api/session`, `/api/devices`, `/api/positions`
- Auth mode: `Basic`
- Email/username: `apiuser`
- Password: `apiuser`
- Hosted browser rule: do not enter the direct HTTP upstream URL in the hosted app; use the Vercel provider base URL above.
- Desktop/Tauri rule: the direct HTTP upstream URL is acceptable because the browser mixed-content block does not apply.

## Active Planning Docs

- `docs/two-track-execution-workplan.md` — canonical queue and next-task order.
- `docs/hosted-browser-testing-plan.md` — product/deployment strategy.
- `docs/team-testing-feedback-loop.md` — tester instructions and bug template.
- `docs/tauri-beta-release-plan.md` — supporting desktop beta release detail.
- `docs/reports/deep-hardening-investigation-2026-05-13.md` — historical evidence only; not an active backlog.

## Next Task

Default next task when the user says “go” or “work on the next task”:

1. `R8: Add Tauri Beta Gatekeeper Guidance` in `docs/two-track-execution-workplan.md`
2. Bead: `sartracker-web-977`
3. Goal: document the current macOS beta-sharing path and Gatekeeper limitations before any internal desktop artifact is shared.
4. Then do `R9: Add Checked-In Boot/Fault/Autosave UI Regression Coverage` (`sartracker-web-ahp`) unless the user redirects to another A3 follow-up.

## Open Beads That Matter Now

- `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.
- `sartracker-web-6y3` — A3 team feedback remediation batch.
- `sartracker-web-977` — R8 add Tauri beta Gatekeeper guidance.
- `sartracker-web-ahp` — R9 add checked-in boot/fault/autosave UI regression coverage.

Older parity/UI beads still exist, but new work should be selected through the two-track workplan unless the user explicitly asks for a specific bead.

## Known Limits

- Browser mode is not durable enough for live incidents.
- Browser mode does not yet have IndexedDB mission persistence, browser backup/export/import, or browser-native filesystem parity.
- Desktop/Tauri is the intended operational lane for SQLite persistence, filesystem workflows, diagnostics, GPX watch/import, archives, and proprietary HD map packages.
- High-definition mountain maps should be local desktop map packages unless requirements change.

## Verification Snapshot

Most recent completed verification:

- Local A3.8/A3.3/A3.7 verification passed 2026-05-16: `npm run lint`, `npm run build`, and `npm run test:all`. Unit tests passed 87 files / 428 tests; Playwright passed 100 Chromium + visual tests; backend passed 38 Rust tests.
- Targeted browser verification covered line distance/bearing/endpoint readouts, styled search-area persistence, LPB range rings, layer-panel drawing edit entry, confirmed drawing deletion, compact Maps menu, compact Drawing Tools open/close, 900px narrow operator viewport, Marker At GR success, and invalid grid-reference rejection.
- Vercel production alias was redeployed and live-verified at `https://sartracker-web.vercel.app/?missionHarness=1` with mission `Live Fix Verification 2026-05-16T12-18-59-773Z`: 48h offset accepted, hosted mode/status honesty visible, `/api/session` and `/api/devices` returned 200, `/api/devices` returned 18 devices, `/api/positions` returned 14 current fixes, per-device breadcrumb requests returned 14,575 points, browser harness persisted 1,998 capped positions without quota errors, reload required re-entering the memory-only Traccar password, reconnect restored online tracking, and finish returned tracking to idle with zero visible counts.
- Local A3.1/A3.2 verification passed 2026-05-16: `npm run test` (87 files, 425 tests), `npm run lint`, `npm run build`, `npm run test:backend` (38 Rust tests), and inbuilt-browser checks at `http://127.0.0.1:1420/?missionHarness=1`. Browser evidence confirmed marker/drawing drag did not open placement dialogs, deliberate clicks still did, the drawing cursor changed to crosshair, range rings/text labels were created, and range-ring/text-label layer toggles were present and hideable. Screenshot: `test-results/a3-map-drawing-verification/drawing-layer-toggle-hidden.png`.
