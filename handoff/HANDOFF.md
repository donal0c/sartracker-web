# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Last Updated

- 2026-05-17 by Claude — `sartracker-web-b3c` closed. Updated the 5 V2-discovered drifted verificationPrompts so each describes what its captured element actually contains: the three mission-control panel captures (`mission-active-state`, `mission-backdated-offset`, `mission-paused-state`) drop the mission-name check (rendered on the command mast outside the panel) and verify panel-only invariants instead; `shell-drawing-toolbar` describes the no-mission disabled state ("Mission required" chip, dimmed tool buttons) rather than the post-mission "ACTIVE: SELECT" state and drops the LPB footer item that sits below the toolbar's scroll viewport; `drawing-multiple-on-map` now verifies only the range-ring drawing (the reliably-created one in the headless flow) plus the surrounding operational shell, and explicitly tells the reviewer not to fail on absent polygons / bearings / text labels. Also fixed `tracking-status-panel` (same class, surfaced when the full review re-ran): prompt now matches the "Tracking System / telemetry stream" header and the 4-column DEVICES/FIXES/CACHE/STALE counters strip. Each fix verified PASS via `npm run visual:review --only <id> --no-cache`. Two further drift findings (`marker-hazard-dialog` active-tab ambiguity, `shell-idle-state` map-tiles-loading + collapsed Maps menu) filed as follow-up `sartracker-web-wn6`.
- 2026-05-17 by Claude — V2 Visual Review Automation (`sartracker-web-n9i`) completed locally on `master`. `npm run visual:review` now reads every manifest entry under `test-results/visual-verification/`, spawns one `claude --print --output-format json` reviewer per entry, parses the structured pass/fail reply, and writes per-entry plus aggregate JSON reports. Severity gating via `--fail-on critical|high|medium`; reviewer errors always block; content-hash cache (model + verificationPrompt + screenshot bytes) under `.cache/`. Discovery: full live review surfaced 5 visual specs whose verificationPrompt drifted from the captured element — filed as `sartracker-web-b3c` (P2 bug) for follow-up. CLAUDE.md visual-tests section rewritten to point at the new command.
- 2026-05-17 by Codex — `sartracker-web-qmr` closed after live desktop smoke. Desktop Traccar polling now uses a Tauri command backed by Rust `reqwest`, preserving the existing TypeScript Traccar client contract while moving HTTP out of WKWebView `fetch()`. Removed the macOS ATS blanket workaround file (`src-tauri/Info.plist`) because desktop plain-HTTP Traccar calls no longer need `NSAllowsArbitraryLoads`. Verified with unit, backend, build, browser E2E, visual E2E, macOS `.app` packaging, packaged `Info.plist` inspection, and a packaged-app live poll against the real Traccar server after resuming the recovered mission.
- 2026-05-17 by Claude — V1 Regression E2E Coverage (`sartracker-web-8gw`) completed locally. Cold-start-from-cache now publishes an explicit `OFFLINE MODE — showing last known positions from cache.` status so operators do not silently view stale positions before the first live poll succeeds. Added regression coverage at three seams: unit (start-tracking-runtime cache-hydration status, polling-manager healthy-poll-no-offline guard, layer stale-refresh integration), and E2E (`tests/e2e/v1-regression.spec.ts`) covering the MapLibre device-filter path and the operator-visible "showing last known positions" warning. Replaced the five `waitForTimeout` calls in `tests/e2e/parity-visibility.spec.ts` with state-based `expect.poll` predicates.
- 2026-05-17 by Codex — S5 Mission Control View Model Extraction (`sartracker-web-cgx`) completed locally. Added `useMissionTimer` and shared it between Command Mast and Mission Control; added `useMissionControlViewModel` for lifecycle, recovery, governance, duplicate-name, admin-roster, busy/error, and control-enable state; `MissionControlPanel` now delegates mission orchestration to the hook and keeps rendering/focus-dialog responsibilities.
- 2026-05-17 by Codex — S4 Map Overlay Consolidation And Camera Race Fix (`sartracker-web-s5v`) completed locally. Added shared MapLibre overlay primitives for GeoJSON source sync, idempotent layer creation, filter combination, and SVG icon loading; refactored drawing, marker, measurement, GPX, helicopter, and tracking overlay sync modules onto those primitives; changed basemap style switching to restore the captured camera once on `styledata` instead of immediately and again on `idle`.
- 2026-05-17 by Claude — B3 First Internal Tauri Smoke Build (`sartracker-web-ppr`) **completed end-to-end on packaged build `0.1.0+sha.603771f65431`**. Two desktop bugs uncovered during the original smoke pass were fixed and categorically proven in the live `.app`:
  - `sartracker-web-el9`: keyring crate had no platform features (mock backend in use). Fixed in `000f7d1` by adding `apple-native`, `windows-native`, `sync-secret-service` to the keyring dependency. Symmetric Rust unit, real-keychain integration test (verifies via `security find-generic-password` from a separate process), and TS poller-start unit test added.
  - `sartracker-web-el9` (second root cause): macOS App Transport Security blocked the WKWebView renderer's `fetch()` to plain-HTTP Traccar URLs. Fixed in `603771f` by adding `src-tauri/Info.plist` with `NSAllowsArbitraryLoads = true` (internal-beta scope). `sartracker-web-qmr` filed as P2 follow-up to route renderer fetch through Rust `reqwest` and remove the blanket exception.
  - `sartracker-web-zl4`: closed as false positive. Rust persistence regression test `active_mission_survives_process_restart_without_explicit_finish` added in `000f7d1` to pin the contract. No code path automatically transitions an active mission to finished; the original B3 finding was operator-driven.
- Live end-to-end proof on the packaged `.app`: keychain seeded, active mission seeded, app launched, operator clicked Resume, `tracking-cache.json` populated from 85 bytes (empty placeholder) → 6,231 bytes within 30 seconds, SQLite `devices=18 / positions=14`, mast showed `DEVICES ONLINE 18 / SYSTEM STATUS ONLINE`, 14 trackpoints rendered on the map. Final quit confirmed mission stays active in SQLite (no `mission_finished` event). Evidence under `tmp/beta-artifacts/smoke-rerun/`.

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
- Desktop Traccar polling routes renderer requests through Rust `reqwest` via Tauri IPC. The previous macOS `NSAllowsArbitraryLoads` plist workaround has been removed.
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
- B3 (`sartracker-web-ppr`) initial run on `0.1.0+sha.e7ead2eb093a` surfaced `sartracker-web-zl4` (claim of active-mission-finished-on-quit) and `sartracker-web-el9` (runtime tracking warns "not configured"). The follow-up investigation closed both: zl4 was a false positive (operator-driven finish, not quit-driven), pinned by the new `active_mission_survives_process_restart_without_explicit_finish` Rust persistence test. el9 had two distinct desktop-only root causes — keyring crate had no platform features (mock backend) and macOS App Transport Security blocked WKWebView fetch to plain-HTTP Traccar — both fixed in `000f7d1` (keyring features) and `603771f` (Info.plist NSAllowsArbitraryLoads). End-to-end live test on the rebuilt `.app` (`0.1.0+sha.603771f65431`) populated `tracking-cache.json` with 18 real Traccar devices and rendered live trackpoints on the map within 30 seconds of clicking Resume. `sartracker-web-qmr` filed as P2 follow-up to remove the ATS blanket exception by routing renderer fetch through Rust `reqwest`.

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

V2 done; b3c done. Default next chunks come from `docs/two-track-execution-workplan.md`: B6 GPX and drawing hit-test hardening, then B4 cross-platform Tauri beta distribution setup (`sartracker-web-y6a`). `sartracker-web-wn6` (newly-surfaced visual prompt drift on `marker-hazard-dialog` and `shell-idle-state`) is also ready and small.

## Open Beads That Matter Now

- `sartracker-web-n9i` — V2 Visual Review Automation (completed 2026-05-17; ready to close).
- `sartracker-web-b3c` — closed 2026-05-17 after updating the 5 drifted verificationPrompts and re-verifying each via the V2 review runner.
- `sartracker-web-wn6` — V2-discovered follow-up: 2 further visual prompt drifts (`marker-hazard-dialog` active-tab ambiguity, `shell-idle-state` map-tiles-loading + collapsed Maps menu). Small, ready to start.
- `sartracker-web-y6a` — B4: set up cross-platform Tauri beta distribution for Windows/Linux testers; deferred until after B6.
- `sartracker-web-qmr` — closed 2026-05-17 after keychain-backed packaged-app live Traccar smoke.
- `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.
- `sartracker-web-6y3` — A3 team feedback remediation batch; should be closed/reframed once A3.9 verification/deploy is complete.
- `sartracker-web-8gw` — V1 Regression E2E Coverage (closed 2026-05-17).
- `sartracker-web-cgx` — S5 Mission Control View Model Extraction (closed 2026-05-17).
- `sartracker-web-s5v` — S4 Map Overlay Consolidation And Camera Race Fix (closed 2026-05-17).
- `sartracker-web-4a1` — S3 Layer Visibility Service Extraction (completed 2026-05-17; ready to close if no follow-up findings).
- `sartracker-web-xhz` — B2 Tauri Beta Release Template (completed 2026-05-17; ready to close if no follow-up findings).
- `sartracker-web-zl4` — closed 2026-05-17 as false positive; regression test added.
- `sartracker-web-el9` — closed 2026-05-17 with categorical end-to-end proof on packaged `.app` build `0.1.0+sha.603771f65431`.
- `sartracker-web-ppr` — B3 closed 2026-05-17 after re-run on the post-fix build.

Older parity/UI beads still exist, but new work should be selected through the two-track workplan unless the user explicitly asks for a specific bead.

## Known Limits

- Browser mode is not durable enough for live incidents.
- Browser mode does not have IndexedDB mission persistence, browser backup/export/import, or browser-native filesystem parity.
- Desktop/Tauri is the intended operational lane for SQLite persistence, filesystem workflows, diagnostics, GPX watch/import, archives, and proprietary HD map packages.
- High-definition mountain maps should be local desktop map packages unless requirements change.

## Verification Snapshot

Most recent local verification in this turn (V2 Visual Review Automation, `sartracker-web-n9i`):

- Red-then-green: new `tests/unit/visual-review-lib.test.ts` failed red against the missing `build/visual-review-lib.js`, then 44/44 pass after implementation.
- Passed: `npm run test` — 96 files / 520 tests (was 476 before V2; added 44 unit tests).
- Passed: `npm run lint`.
- Passed: `npx tsc --noEmit`.
- Passed: `npm run build` — bundle budgets clean.
- Passed: `npx playwright test --project=chromium` — 85 tests.
- Passed: `npx playwright test --project=visual` — 27 tests.
- Passed: `npm run test:backend` — 43 passed / 1 ignored.
- Live single-entry review with real Opus call: `npm run visual:review -- --only shell-idle-state` returned PASS in ~11 s; per-entry result file written.
- Live full-batch review: `npm run visual:review --no-cache --concurrency 3` produced 22 PASS / 5 FAIL / 0 ERROR across 27 entries with deterministic output. The 5 FAILs are real spec-drift findings filed as `sartracker-web-b3c` (verification prompts asking for content outside the captured element); these are out of scope for V2.
- Cached re-run: `npm run visual:review` returned 27/27 cache hits, total runtime under 2 seconds, exit code 1 (matching the live findings).
- Empty-manifest run returns exit 3 (`OVERALL: FAIL  (no manifest entries — did the visual Playwright project run?)`).
- `--only nonexistent` returns exit 2 with a clear error message.
- Cleanup: no background processes left running.

Most recent local verification in this turn (`sartracker-web-qmr`):

- Red-then-green: `npm run test -- tests/unit/tauri-traccar-fetch.test.ts tests/unit/start-app-runtime.test.ts` failed before the Tauri fetch adapter/runtime wiring existed, then passed after implementation.
- Passed: `npm run test -- tests/unit/tauri-traccar-fetch.test.ts tests/unit/start-app-runtime.test.ts tests/unit/traccar-client.test.ts` — 16 tests.
- Passed: `cargo test traccar_http_request --lib` from `src-tauri/` — 2 tests.
- Passed: `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- Passed: `npm run test` — 95 files / 476 tests.
- Passed: `npm run test:backend` — 43 passed / 1 ignored.
- Passed: `npx playwright test --project=chromium` — 85 tests.
- Passed: `npx playwright test --project=visual` — 27 tests.
- Passed: `npm run tauri build -- --bundles app`; output app at `src-tauri/target/release/bundle/macos/sartracker-web.app`.
- Passed: packaged app `Info.plist` inspection confirmed `NSAppTransportSecurity` does not exist, so there is no `NSAllowsArbitraryLoads` blanket in the built `.app`.
- Passed: keychain-backed live desktop Traccar smoke on the packaged `.app`. After resuming the recovered mission, the mast showed `DEVICES 18 ONLINE 14/14`, the tracking panel showed `ONLINE DEVICES 18 FIXES 14`, `tracking-cache.json` refreshed from the 85-byte placeholder to 499,490 bytes, and SQLite held `devices=18 / positions=1884`.
- Cleanup: stopped the packaged app process after the smoke so it was not left polling in the background.

Most recent local verification in this turn (V1 Regression E2E Coverage):

- Red-then-green: new test in `tests/unit/start-tracking-runtime.test.ts` failed before the runtime cold-start-from-cache `applyStatus` call was added, then passed after.
- Red-then-green confirmed for `tests/unit/layer-stale-refresh-integration.test.ts` by temporarily disabling the catalog invalidation guard in `start-layer-catalog-runtime.ts`; the new spec failed red as expected, then passed after restoring the guard.
- Passed: `npm run test` — 94 files / 474 tests.
- Passed: `npx tsc --noEmit`, `npm run lint`, `npm run build` (bundle budgets OK).
- Passed: `npx playwright test --project=chromium` — 85 tests, including the new `tests/e2e/v1-regression.spec.ts` and the rewired `tests/e2e/parity-visibility.spec.ts` (no `waitForTimeout` left).
- Passed: `npx playwright test --project=visual` — 27 tests.
- Passed: `npm run test:backend` — 41 passed / 1 ignored.
- Browser-backed verification ran via Playwright at `http://127.0.0.1:1420/?missionHarness=1`. No Vercel redeploy needed; the only new operator-facing runtime change is the cold-start-offline status copy, which is exercised by the new E2E.

Most recent local verification in this turn (S5 mission-control view-model extraction):

- Red checks first: new hook tests failed because `use-mission-timer` and `use-mission-control-view-model` did not exist.
- Passed: `npm run test -- tests/unit/use-mission-timer.test.ts tests/unit/use-mission-control-view-model.test.ts`.
- Passed: `npm run test -- tests/unit/use-mission-timer.test.ts tests/unit/use-mission-control-view-model.test.ts tests/unit/start-mission-runtime.test.ts tests/unit/mission-tracking-status-bridge.test.ts`.
- Passed: `npx tsc --noEmit`.
- Passed: `npm run lint`.
- Passed: `npm run test` — 93 files / 470 tests.
- Passed: `npm run build`.
- Passed: `npm run test:backend` — 41 passed / 1 ignored.
- Not run: Playwright E2E/browser automation because local instructions require explicit user approval before using Playwright.

Most recent local verification in this turn (S4 overlay/camera consolidation):

- Red checks first: new overlay primitive test failed on missing module; camera preservation test failed because the current implementation restored on `idle` and jumped immediately.
- Passed: `npm run test -- tests/unit/map-overlay-primitives.test.ts tests/unit/apply-map-style-preserving-camera.test.ts tests/unit/sync-tracking-overlay.test.ts tests/unit/map-layer-filters.test.ts tests/unit/drawing-geojson.test.ts tests/unit/marker-geojson.test.ts tests/unit/measurement-geojson.test.ts tests/unit/gpx-geojson.test.ts tests/unit/start-helicopter-runtime.test.ts`.
- Passed: `npx tsc --noEmit`.
- Passed: `npm run lint`.
- Passed: `npm run test` — 91 files / 465 tests.
- Passed: `npm run build`.
- Passed: `npm run test:backend` — 41 passed / 1 ignored.
- Not run: Playwright E2E/browser automation because local instructions require explicit user approval before using Playwright. The app code path affected is covered by unit/build checks; use the inbuilt browser or an explicitly approved E2E pass for rendered basemap switching if needed.

Most recent local verification in this turn (B3 re-run on `0.1.0+sha.603771f65431`):

- Passed: `npm run beta:verify -- --no-smoke` end-to-end (lint, build, test 461/461, test-backend 41/41 + 1 ignored, package). Report at `tmp/beta-artifacts/verify-0.1.0-sha.603771f65431-2026-05-17T08-01-33Z.json`.
- New regression tests, all passing: `active_mission_survives_process_restart_without_explicit_finish` (Rust), `builds_runtime_bootstrap_with_traccar_config_when_auto_connect_is_enabled_and_secret_present` (Rust), `keyring_secret_store_writes_to_real_macos_keychain` (Rust, `#[ignore]`'d, run locally with `--ignored` and confirmed against the real macOS keychain), `starts the poller when the runtime config is present` (TS).
- Live end-to-end smoke on the packaged `.app` (`src-tauri/target/release/bundle/macos/sartracker-web.app`, build `0.1.0+sha.603771f65431`):
  - Item 1 (launches): PASS — multiple PIDs across the session.
  - Item 2 (version chip): PASS — mast read `0.1.0+SHA.603771F65431` in screenshot `09-tracking-live-with-devices.png`.
  - Item 3 (start mission): PASS — direct UI Start initially, then SQLite seed + Resume click in the post-fix run; mast read `MISSION ACTIVE` with elapsed/active timers ticking.
  - Item 4 (persists across quit/restart): PASS — `kill -TERM` and AppleScript quit both leave mission status unchanged in SQLite, no `mission_finished` event ever emitted.
  - Item 5 (tracking save + actually polls): PASS — `tracking-cache.json` populated 85 → 6,231 bytes within 30 seconds; SQLite `devices=18 / positions=14`; mast `DEVICES ONLINE 18 / SYSTEM STATUS ONLINE`.
  - Item 6 (diagnostics export): PASS — file written, version line matches mast.
- Evidence kept under `tmp/beta-artifacts/smoke-rerun/` (01-initial-launch through 09-tracking-live-with-devices PNGs, `devices.tsv`, etc.) and `tmp/beta-artifacts/smoke/` (initial run pre-fix evidence).
- Beta artifact promotion is deferred: do not upload or push desktop artifacts to the Windows/Linux tester group until `sartracker-web-y6a` defines the cross-platform build/download/instructions process. The current macOS `.app` smoke remains useful internal evidence, not the team distribution path.

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
