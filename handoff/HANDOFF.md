# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Last Updated

- 2026-05-16 by Codex — R3 hosted browser system status fixed; R4-R7 still block S3 unless explicitly accepted.

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
- Settings successful save actions now close the workspace after persistence/reload completes. Failed saves keep the workspace open and show the error.
- Startup now has an explicit boot/fault guard. The app shell stays gated while runtime services prepare, startup failures show a fault panel with Reload, and runtime controller replacement disposes the previous controller before installing the next one.
- Hosted tester instructions now have a concise quick-start run sheet, URL/base-URL rules, bug-report template fields, and triage buckets. The operator manual has a hosted testing and feedback section.
- Tauri packaging recon found a working macOS arm64 `.app` path: `npm run tauri build -- --bundles app` -> `src-tauri/target/release/bundle/macos/sartracker-web.app`. Full `npm run tauri build` currently fails at DMG bundling; unsigned/ad-hoc app is rejected by `spctl`, so first beta notes must call out Gatekeeper limitations.
- Autosave now has an explicit forced `requestSync()` path. Mission start, pause, resume, finish, recover-resume, start-fresh, finalize, and unlock request immediate backup sync after the lifecycle database write. Lifecycle-forced autosave failures remain visible after unrelated successful syncs and clear only when the matching lifecycle sync succeeds. Autosave stale warnings use observed command-mast tick time rather than wall-clock subtraction, so clock jumps or laptop sleep do not create immediate false stale warnings.
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

1. `R4: Surface Lifecycle Backup Failures Non-Dismissably` in `docs/two-track-execution-workplan.md`
2. Bead: `sartracker-web-57m`
3. Goal: make lifecycle backup failures unavoidable enough that operators cannot miss or accidentally dismiss a failed mission-transition backup.
4. Do not start `S3: Layer Visibility Service Extraction` until R4-R7 are fixed or explicitly accepted.

## Open Beads That Matter Now

- `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.
- `sartracker-web-57m` — R4 surface lifecycle backup failures non-dismissably.
- `sartracker-web-qdh` — R5 make runtime controller swap exception-safe.
- `sartracker-web-10q` — R6 roll back core runtimes when initial settings reload fails.
- `sartracker-web-syi` — R7 harden runtime fault reload flow.

Older parity/UI beads still exist, but new work should be selected through the two-track workplan unless the user explicitly asks for a specific bead.

## Known Limits

- Browser mode is not durable enough for live incidents.
- Browser mode does not yet have IndexedDB mission persistence, browser backup/export/import, or browser-native filesystem parity.
- Desktop/Tauri is the intended operational lane for SQLite persistence, filesystem workflows, diagnostics, GPX watch/import, archives, and proprietary HD map packages.
- High-definition mountain maps should be local desktop map packages unless requirements change.

## Verification Snapshot

Most recent completed verification:

- R3 unit coverage proves hosted browser mode shows `Browser test` / `Session storage only`, and the no-controller non-harness runtime path fails visibly.
- `npm run lint` passed.
- `npm run test -- --run tests/unit/runtime-boot-gate.test.ts tests/unit/bootstrap-app-runtime.test.ts` passed: 2 files, 8 tests.
- `npm run test:e2e -- --project=chromium tests/e2e/map.spec.ts tests/e2e/layer-panel.spec.ts tests/e2e/focus-mode.spec.ts` passed: 13 browser workflow tests.
- `npm run test -- --run` passed: 86 files, 406 tests.
- `npm run build` passed.
- `npm run test:backend` passed: 37 Rust tests.
- `npm run test:e2e -- --project=chromium` passed: 69 browser workflow tests.
