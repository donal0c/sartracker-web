# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Last Updated

- 2026-05-17 by Claude — B3 First Internal Tauri Smoke Build (`sartracker-web-ppr`) executed against build `0.1.0+sha.e7ead2eb093a`. Automated portion (lint/build/test/test:backend/package) all PASS. Manual smoke surfaced two desktop-only blockers and the artifact was NOT promoted: P0 `sartracker-web-zl4` (active mission transitions to `finished` on app quit — direct SQLite confirms `mission_finished` row at the quit timestamp with no preceding user lifecycle event) and P1 `sartracker-web-el9` (runtime tracking shows "not configured" while Traccar provider is saved with auto-connect on). Beta draft retained at `docs/releases/sartracker-web-0.1.0-beta-DRAFT.md` as the worked example of how to document a smoke-blocked draft. Evidence under `tmp/beta-artifacts/smoke/`.

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
- S3 extracted subtree visibility patching into `src/features/layers/layer-visibility-service.ts`, with `layer-filter-panel` now acting as a thin adapter for catalog persistence + service invocation. Follow-up review added immediate group, helicopter, and GPX overlay-store patching so those nodes do not rely only on async catalog hydration.
- S3 added explicit layer-visibility service tests and kept parity visibility E2E coverage green.
- Tauri packaging recon found a working macOS arm64 `.app` path: `npm run tauri build -- --bundles app` -> `src-tauri/target/release/bundle/macos/sartracker-web.app`. Full `npm run tauri build` still fails at DMG bundling; unsigned/ad-hoc app is rejected by Gatekeeper as expected for the current internal-beta lane.
- B2 (`sartracker-web-xhz`) made desktop beta drops repeatable. Future beta cuts must run `npm run beta:verify` (no `--steps` filters), copy `docs/releases/TEMPLATE.md` into a `sartracker-web-<version>-beta-DRAFT.md`, attach the JSON report path from `tmp/beta-artifacts/`, then drop the `-DRAFT` suffix once the artifact is uploaded and the smoke checklist is signed off. Distribution channel is GitHub Releases draft/prerelease on `donal0c/sartracker-web` with the "internal beta" tag in the title.
- B3 (`sartracker-web-ppr`) ran the gate against `0.1.0+sha.e7ead2eb093a`. Automated steps PASS; smoke surfaced two desktop-only blockers and the artifact was NOT promoted: P0 `sartracker-web-zl4` (active mission becomes `finished` on app quit; reproduced by direct SQLite query against `mission-store.sqlite` showing `mission_finished` row at the quit timestamp with no preceding user lifecycle event) and P1 `sartracker-web-el9` (runtime tracking warns "not configured" while Traccar provider is saved with auto-connect on). Beta draft retained at `docs/releases/sartracker-web-0.1.0-beta-DRAFT.md` as the worked example of a smoke-blocked draft. Evidence under `tmp/beta-artifacts/smoke/`.

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

Default next chunk is `sartracker-web-zl4` (active-mission-finished-on-quit, P0). Triage entry points listed in the bead: shutdown / before_quit hooks in `src-tauri/src/lib.rs` and `src-tauri/src/main.rs`, `finish_mission` callers in `src-tauri/src/persistence/`, renderer-side teardown in `src/lib/app-runtime-controller.ts` and `src/features/mission/**`. Add a regression test in the Rust persistence suite covering "quitting an app with an active mission must not transition the mission to finished" before fixing. After Z1 lands, fix `sartracker-web-el9` (runtime tracking false-warning), then rerun `sartracker-web-ppr` (B3) end-to-end against the next packaged build.

## Open Beads That Matter Now

- `sartracker-web-zl4` — P0: active mission transitions to `finished` on app quit (desktop). Blocks `sartracker-web-ppr`.
- `sartracker-web-el9` — P1: runtime tracking warns "not configured" while Traccar provider is saved with auto-connect on (desktop). Blocks `sartracker-web-ppr`.
- `sartracker-web-ppr` — B3 First Internal Tauri Smoke Build, blocked on the two beads above.
- `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.
- `sartracker-web-6y3` — A3 team feedback remediation batch; should be closed/reframed once A3.9 verification/deploy is complete.
- `sartracker-web-4a1` — S3 Layer Visibility Service Extraction (completed 2026-05-17; ready to close if no follow-up findings).
- `sartracker-web-xhz` — B2 Tauri Beta Release Template (completed 2026-05-17; ready to close if no follow-up findings).

Older parity/UI beads still exist, but new work should be selected through the two-track workplan unless the user explicitly asks for a specific bead.

## Known Limits

- Browser mode is not durable enough for live incidents.
- Browser mode does not have IndexedDB mission persistence, browser backup/export/import, or browser-native filesystem parity.
- Desktop/Tauri is the intended operational lane for SQLite persistence, filesystem workflows, diagnostics, GPX watch/import, archives, and proprietary HD map packages.
- High-definition mountain maps should be local desktop map packages unless requirements change.

## Verification Snapshot

Most recent local verification in this turn (B3):

- Passed: `npm run beta:verify -- --no-smoke` end-to-end (lint, build, test 460/460, test-backend 39/39, package). Report at `tmp/beta-artifacts/verify-0.1.0-sha.e7ead2eb093a-2026-05-17T06-55-19Z.json`.
- Packaged `.app` produced at `src-tauri/target/release/bundle/macos/sartracker-web.app` (25 MB) and zipped via `ditto` to `tmp/beta-artifacts/sartracker-web_0.1.0_aarch64.app.zip` (15.3 MB, SHA-256 `a809e9865cba89561058dd32677749b24859805118b79aae8c63ac5da30753c3`).
- Manual smoke (driven via `open` + `osascript` + `screencapture` from this session, with operator confirmation for click-required items): items 1, 2, 3, 6 PASS; item 4 FAIL (`sartracker-web-zl4`); item 5 PARTIAL FAIL (`sartracker-web-el9`).
- Direct evidence: `tmp/beta-artifacts/smoke/{01-initial-launch.png,01d-mast-full.png,02-mission-started-tracking-warnings.png,03-before-quit.png,04b-after-restart.png,04c-after-restart-front.png,diagnostics-report-2026-05-17T07-05-55-676Z.txt,mission-events-fdsfdsf.tsv}`.
- Beta artifact NOT promoted; `docs/releases/sartracker-web-0.1.0-beta-DRAFT.md` retained as the worked example of a smoke-blocked draft.

Earlier B2 verification (kept for context):

- Red-then-green: `npm run test -- tests/unit/beta-verify-lib.test.ts` failed first against the missing `build/beta-verify-lib.js`, then passed 15/15 after implementing the helpers.
- Passed: `npm run beta:verify -- --steps lint --no-smoke --report-dir tmp/beta-artifacts` end-to-end through the new runner; report written to `tmp/beta-artifacts/verify-0.1.0-sha.5d3ba8ad7603-2026-05-17T06-34-52Z.json`.
- Passed: `npm run lint`, `npm run build`, `npm run test`.

Earlier S3 verification (kept for context):

- Passed: `npm run test -- tests/unit/layer-visibility-service.test.ts tests/unit/layer-catalog-store.test.ts tests/unit/layer-visibility-store.test.ts`
- Passed: `npm run test:e2e -- tests/e2e/layer-panel.spec.ts tests/e2e/parity-visibility.spec.ts --project=chromium`
- Passed after rereview fix: `npm run test -- tests/unit/layer-visibility-service.test.ts tests/unit/layer-visibility-store.test.ts`
- Passed after rereview fix: `npm run test:e2e -- tests/e2e/layer-panel.spec.ts tests/e2e/parity-visibility.spec.ts tests/e2e/helicopter-panel.spec.ts tests/e2e/gpx-import.spec.ts --project=chromium`
- Passed: `npm run lint`
- Passed: `npm run build`
- Passed after rereview fix: `npm run test:all` — 89 unit files / 445 tests, 110 browser + visual E2E tests, 39 backend tests

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
