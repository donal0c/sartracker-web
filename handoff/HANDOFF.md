# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Last Updated

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

Default next chunks come from `docs/two-track-execution-workplan.md`: S5 Mission Control View Model Extraction, then V1 Regression E2E Coverage. Desktop beta distribution is deliberately deferred until `sartracker-web-y6a` sets up a Windows/Linux-capable release path and tester instructions.

## Open Beads That Matter Now

- `sartracker-web-y6a` — B4: set up cross-platform Tauri beta distribution for Windows/Linux testers; deferred until after the next app/foundation chunks.
- `sartracker-web-qmr` — P2: route renderer Traccar fetch through Rust `reqwest` to remove the ATS `NSAllowsArbitraryLoads` blanket. Internal-beta scope is acceptable as-is; this lands before any signed/notarised distribution.
- `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.
- `sartracker-web-6y3` — A3 team feedback remediation batch; should be closed/reframed once A3.9 verification/deploy is complete.
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
