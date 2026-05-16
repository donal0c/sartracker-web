# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Last Updated

- 2026-05-16 by Codex — A3 closeout batch is complete: A3.9 Weather links, R10 handoff compression, R11 browser harness storage non-goals note, full verification, commit/push, and Vercel production deployment via DEPLOY.md.

## Operating Rule

The single active planning path is `docs/two-track-execution-workplan.md`.

All new work must be routed there before implementation:

- Track A: hosted team testing
- Track B: Tauri operational readiness
- Shared foundation
- Verification
- Deferred / decision-gated

Supporting docs may explain details, but they must not become separate queues.

## Current State

- `master` is the canonical working branch.
- Hosted team testing runs at `https://sartracker-web.vercel.app/?missionHarness=1`.
- Hosted browser mode is testing/training only. It uses browser session storage and is not operational mission persistence.
- Hosted Traccar testing uses the Vercel same-origin proxy:
  - app URL: `https://sartracker-web.vercel.app/?missionHarness=1`
  - hosted provider base URL: `https://sartracker-web.vercel.app`
  - direct `http://kmrtsar.ddns.net:8082` is valid for desktop/Tauri, but browsers block it from the HTTPS hosted app.
- The A3 team-feedback remediation batch is complete locally, pending final verification/deploy for this closeout turn. Completed A3 surfaces include map placement guardrails, drawing rendering/layers, compact Maps/Map Tools, Marker At GR, coordinate conversion accuracy, roster spacing, converter naming/order, Measure in Map Tools, mission mast cleanup, contrast/theme, static operational notes relocation, and A3.9 Weather links.
- A3.9 adds Settings-managed named weather URLs and a compact Weather mast menu. This is external-link navigation only; SAR Tracker does not fetch, parse, or forecast weather.
- R10 compressed this handoff back to a current-state baton. Historical investigation/supporting docs already point to `docs/two-track-execution-workplan.md` as the active queue.
- R11 added a module-level non-goals note to the browser harness store clarifying that sessionStorage is for hosted validation only, not a browser substitute for Tauri/SQLite persistence.
- Tauri packaging recon found a working macOS arm64 `.app` path: `npm run tauri build -- --bundles app` -> `src-tauri/target/release/bundle/macos/sartracker-web.app`. Full `npm run tauri build` still fails at DMG bundling; unsigned/ad-hoc app is rejected by Gatekeeper as expected for the current internal-beta lane.

## Traccar Test Details

Use these only for team testing, not as a production secret model.

- Upstream team Traccar server: `http://kmrtsar.ddns.net:8082`
- Hosted browser provider base URL: `https://sartracker-web.vercel.app`
- Hosted proxy endpoints: `/api/session`, `/api/devices`, `/api/positions`
- Auth mode: `Basic`
- Email/username: `apiuser`
- Password: `apiuser`
- Hosted browser rule: do not enter the direct HTTP upstream URL in the hosted app; use the Vercel provider base URL above.
- Desktop/Tauri rule: the direct HTTP upstream URL is acceptable because browser mixed-content blocking does not apply.

## Active Planning Docs

- `docs/two-track-execution-workplan.md` — canonical queue and next-task order.
- `docs/hosted-browser-testing-plan.md` — product/deployment strategy.
- `docs/team-testing-feedback-loop.md` — tester instructions and bug template.
- `docs/tauri-beta-release-plan.md` — supporting desktop beta release detail.
- `docs/reports/deep-hardening-investigation-2026-05-13.md` — historical evidence only; not an active backlog.

## Next Task

Default next chunk after this closeout is `S3: Layer Visibility Service Extraction` from `docs/two-track-execution-workplan.md`.

Create or update the S3 bead before starting if one does not already exist. The intent is to move layer visibility shaping out of UI-heavy surfaces before more map/layer work lands.

## Open Beads That Matter Now

- `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.
- `sartracker-web-6y3` — A3 team feedback remediation batch; should be closed/reframed once A3.9 verification/deploy is complete.
- S3 Layer Visibility Service Extraction — next shared-foundation chunk; bead creation/update still needed before implementation.

Older parity/UI beads still exist, but new work should be selected through the two-track workplan unless the user explicitly asks for a specific bead.

## Known Limits

- Browser mode is not durable enough for live incidents.
- Browser mode does not have IndexedDB mission persistence, browser backup/export/import, or browser-native filesystem parity.
- Desktop/Tauri is the intended operational lane for SQLite persistence, filesystem workflows, diagnostics, GPX watch/import, archives, and proprietary HD map packages.
- High-definition mountain maps should be local desktop map packages unless requirements change.

## Verification Snapshot

Most recent local verification in this turn:

- Focused A3.9 red checks failed before implementation for the missing weather settings model and Weather menu; the same focused checks passed after implementation.
- Passed: `npm run test -- tests/unit/settings-validation.test.ts tests/unit/browser-settings-store.test.ts`
- Passed: `npm run test:backend -- settings`
- Passed: `npx tsc --noEmit`
- Passed: `npm run test:e2e -- tests/e2e/weather.spec.ts --project=chromium`
- Passed: `npm run lint`
- Passed: `npm run build`
- Passed: `npm run test` — 88 files / 439 tests
- Passed: `npm run test:e2e` — 110 Chromium + visual tests
- Passed: `npm run test:backend` — 39 Rust tests
- Passed: `npm run test:all` — 88 unit files / 439 tests, 110 browser + visual E2E tests, 39 backend tests
- Passed after bead/doc updates: `npm run lint && npm run build`
- Passed: `git diff --check`
- Inbuilt-browser sanity check at `http://127.0.0.1:1420/?missionHarness=1` confirmed the Weather mast control and Settings Weather Links section rendered. Direct manual clicking in the inbuilt browser was unreliable because of element coordinate/runtime issues, so the full configure/open flow is covered by the checked-in Chromium E2E instead.
- Deploy status: completed via the documented Vercel production prebuilt flow; production alias is `https://sartracker-web.vercel.app`.
