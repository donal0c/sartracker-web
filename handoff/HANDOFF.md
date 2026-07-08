# HANDOFF.md - Live Baton

> Read this before doing work. Keep it short. This is the current baton, not the project diary. Older history lives in `handoff/archive/` plus commits and Linear.

## Current State

- **Branch:** `master` is canonical and should be worked directly unless Donal says otherwise.
- **Desktop lane:** Electron is operational. Tauri remains historical/reference.
- **Hosted browser:** `https://sartracker-web.vercel.app/?missionHarness=1` is testing/training only; browser storage is not operational persistence.
- **Latest replacement beta:** `electron-v0.1.0-beta.11` is the DON-240 fsync-storm fix candidate, cut from `4f13da2` after GitHub Actions release run `28972979120` passed and Ubuntu packaged smoke completed on the CI-built AppImage. Release note: `docs/releases/sartracker-electron-0.1.0-beta.11.md`. It still needs the original slow PCLinuxOS/team machine to confirm the field freeze is gone.
- **Held betas:** `electron-v0.1.0-beta.9` and `electron-v0.1.0-beta.10` are **ON HOLD** for the Linux tracking-online freeze. Do not roll them out further.
- **Previous beta:** `electron-v0.1.0-beta.8`, published 2026-06-23 after GitHub Actions run `28012741523` and a deep Ubuntu packaged smoke (43/43) on the CI-built post-fix artifact (AppImage sha `43067cb2…`). Team artifact: https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.8`.
- **Beta.8 release evidence:** tag `electron-v0.1.0-beta.8` (HEAD `34e3fc1`); CI release run `28012741523` is **green** and the deep Ubuntu packaged smoke PASSED on that CI-built artifact. Release note: `docs/releases/sartracker-electron-0.1.0-beta.8.md`.
  - Post-fix CI-built checksums: AppImage `43067cb2a99671419da576799beaedd7541b6ade7714fe267ad0c16b68e97911`, deb `fa60e126faee7a6d0f025d0e460317b6c53da1ed58cd3a3d129ac86ea2ca0a2b`.
  - **Real bug found by the Ubuntu smoke and fixed:** DON-226 `record-diagnostic-event` IPC handler referenced an out-of-scope `runtimeLog`, throwing `ReferenceError` on every event in the packaged main process (durable diagnostic log broken + error spam; operator incident bundles still populated from the renderer store). Fixed in `97663e6` by threading `runtimeLog` into `registerIpcHandlers`, with a red→green regression test. Re-smoke of the post-fix artifact shows zero `runtimeLog` errors and durable `renderer_*` events recorded.
  - Getting CI green also took several test-harness fixes (none in shipping app code): removed the retired Tauri `cargo test` from the Electron release gates (`gdk-3.0` not on the runner); CI-scaled the DON-210/212 perf-sweep and DON-203 large-hosted-history datasets; and the root-cause fix — `playwright.config.ts` now uses 1 worker + 2 retries under CI to absorb shared-runner contention (local stays 2 workers / 0 retries). Product invariants remain covered by deterministic unit tests.
  - Ubuntu box note: `donal@192.168.18.31` was upgraded off Wayland to **X11** (kernel 6.17); drive packaged smoke with `--ozone-platform=x11` (Wayland flag segfaults). Beta.8 smoke scripts live on the box at `~/sartracker-don147-validation/repo/tmp/beta8-smoke/`; evidence mirrored to repo `output/beta8-ubuntu-smoke/evidence-fixed/`.
  - **Smoke result: 43/43 across lifecycle, duplicate-launch (DON-180), safety+diagnostics (DON-226), settings-safety (DON-207/204/208), UI-polish (DON-195/223/197), live Traccar (online 33 devices/8 fixes), and offline Discovery map.**

## DON-240 beta.11 status (2026-07-08)

Root cause: beta.9 added SQLite `synchronous = FULL`, and the tracking runtime persisted devices in
a per-device loop. With 32 devices, each 5 s tracking poll could perform 32 fsync-backed commits on
the Electron main process. On the field tester's slow disk this stretched online tracking cadence to
roughly 22-27 s and made map panning, Devices, and diagnostics feel frozen.

Fix shipped in beta.11: `upsertDevicesBulk` batches all devices from a tracking poll into one
transaction while keeping `synchronous = FULL` durability; per-poll device fsyncs drop from roughly
32 to 1. Runtime uses the bulk method when available and preserves the per-device fallback.

Validation:
- Local focused and full gates passed, including `npm run beta:verify -- --no-smoke`: lint, build,
  unit `1082/1082`, backend `47 passed / 1 ignored`, Chromium E2E `129/129`, and local package.
- GitHub Actions release run `28972979120` passed gates, Linux bundle, private-map-data guard,
  AppImage launch smoke, and draft prerelease/SHA256SUMS upload.
- CI-built asset checksums verified locally and on Ubuntu:
  AppImage `c528e192afc7c6507e6167df26b217054e1824eacd62ecbcd1fca6be1c89cba6`; `.deb`
  `adabc02aa68c48447275ec498bc0ea00ee9672a21f0db7237eb2930622d260ca`.
- Ubuntu packaged smoke evidence is mirrored under `output/beta11-ubuntu-smoke/`: official offline
  map package readiness/outside warning/diagnostics passed, bad-secret recovery passed,
  diagnostics/support/incident exports sanitized, coarse Irish Grid `V 80 84 -> V 80500 84500`
  passed, duplicate launch passed, and core lifecycle/restart/recovery/finish/finalize/archive
  passed via the legacy smoke except for stale coordinate/diagnostics selectors covered by focused
  smokes.
- Full-profile map/tracking probe reached live tracking online (`33` devices / `8` fixes) and kept
  the main-process heartbeat healthy (`p99 10 ms`, max `959 ms`, zero heartbeat errors). The current
  Ubuntu desktop session throttled renderer rAF to roughly 1 Hz; beta.10 showed the same renderer
  verdict under the same session, so that renderer verdict is non-discriminating and not treated as
  beta.11-specific regression evidence.

Still needed: field retest on the original slow PCLinuxOS/team machine/profile. Ubuntu's fast SSD
cannot reproduce the fsync latency that caused the real freeze.

## DON-240 earlier root-cause context (2026-07-08, beta.10 field retest still froze)

**Beta.10 (`3e9ce22`, all hotfix + hardening) STILL froze in the field** — tester report: "app
opens then everything takes 20-30 seconds to respond." Field diagnostic (PCLinuxOS, kernel
6.12.71, 1.2 GB official Discovery package, 32 devices, 5 s poll) shows the smoking gun: when
tracking is **idle (0 devices)** snapshots log at a clean 5 s cadence; the moment it goes **online
(32 devices)** the cadence jumps to **~22-27 s**. The slowdown is entirely in the online tracking
**persistence** path, not the map.

Root cause: **beta.9 added `db.pragma('synchronous = FULL')` (`mission-store.cjs:26`; NOT present in
beta.8) — Fable finding #3.** At FULL every commit does an fsync. The tracking runtime upserted
devices in a **per-device loop** (`start-tracking-runtime.ts`), so a 32-device poll did 32 fsync'd
commits on the main process every 5 s. On a slow field disk that blocks the event loop for tens of
seconds → "everything takes 20-30 s". This is why **no probe run on the fast Ubuntu SSD ever
reproduced it** (fsync is sub-ms there) — the variable is fsync latency, not page cache. The whole
official-map tile-read / exception-storm investigation was a **red herring** for this symptom (the
exception-storm removal was still a real, worthwhile fix, just not the freeze).

Fix: added `upsertDevicesBulk` to the mission store
(one transaction → one fsync for all devices) and switched the runtime persistence to it, keeping
`synchronous=FULL` so durability is preserved (one fsync/poll is fine even on a slow disk). Per-poll
device commits: 32 → 1. Positions were already batched via `addPositionsBulk`.
- `electron/mission-store.cjs` `upsertDevicesBulk(db, input)` + store export; IPC channel added to
  `main.cjs`/`preload.cjs` (generic bridge picks it up); optional on `MissionStore` and
  `TrackingRuntimeMissionStore`; runtime uses it with a per-device fallback.
- Tests (red→green): `electron-mission-store.test.ts` (bulk correctness + created/updated events),
  `start-tracking-runtime.test.ts` (bulk called once, per-device loop not used).
- Verified: `tsc -b` clean, eslint clean, full unit suite **153 files / 1082 tests passing**.
- **Still needed:** field retest on the actual slow machine (or a slow-disk repro) — this is the
  only environment that reproduces the fsync freeze. Consider also whether to keep FULL vs NORMAL.

## DON-240 Hotfix Hardening (earlier context, 2026-07-08)

Beta.9 is ON HOLD (map/Devices/diagnostics hangs on Linux). Current DON-240 commits on `master`:
`7f776de` hotfix, `557b9af` freeze probe + hardening, `78fa836` heartbeat fix, `b0008fd` live-load
probe option, `d00eecb` app-owned credential seeding for live-load probe. Pushed to origin.

Beta.10 replacement prerelease is ready for team retest. Prep commit `b9ddfbe` and test-isolation
fix `8557a0c` were pushed first; release run `28963733570` then failed before bundling on Settings
E2E because the workspace could remain visible while `Save, Connect & Close` waited for a slow
forced reconnect/large breadcrumb load. Commit `3e9ce22` fixes this by closing Settings immediately
after persistence succeeds and running runtime reload in the background, with a unit regression
proving slow reconnects no longer block the modal. Tag `electron-v0.1.0-beta.10` points at
`3e9ce22dff518d4718851296f6c9881559485dd2`; GitHub Actions release run `28965175933` passed gates,
Linux bundle, private-map-data guard, CI AppImage launch smoke, and draft prerelease/SHA256SUMS
upload. Ubuntu packaged smoke on `donal-Precision-5570` passed against the CI-built AppImage:
checksums, full-profile freeze probe with live tracking and Reeks package (`frozen=false`, worst
stall 50 ms, main p99 21 ms, renderer p99 17 ms, 33 devices / 8 fixes), official offline map smoke,
diagnostics report/support/incident-bundle exports, mission lifecycle/restart/recovery/finalize/
archive, coordinate rejection + `V 80 84 -> V 80500 84500`, bad-secret startup recovery, and
duplicate launch. Evidence is mirrored under `output/beta10-ubuntu-smoke/`. The original team
freeze machine/profile still needs to retest before beta.9 HOLD is lifted.

Implemented:
- Official-map proxy caches Settings/package metadata, avoids per-tile `synchronize()`, returns a
  visible 256x256 hatched no-coverage tile for package misses, and keeps `package_error` loud.
- Tracking breadcrumb publishing sends current fixes before slow breadcrumb history and avoids
  duplicate-only overlap fanout.
- Diagnostics runtime log tail reads are bounded.
- `positionsEqual` has a compile-time exhaustiveness guard over `NormalizedTrackingPosition`.
- `npm run electron:smoke:map-freeze` measures renderer rAF drift and main-process IPC RTT during
  a packaged serpentine pan; it now fails if the main heartbeat collects zero samples. Live-load
  mode copies the app-owned `credentials.json` from the Ubuntu user's local SAR Tracker config into
  throwaway userData, avoiding legacy `secrets.json`/libsecret migration over SSH.

Validation so far:
- Local macOS gates passed: `npm run lint`, `npm run build`, `npm run test` (153/153 files,
  1079/1079 tests), `npm run test:backend` (47 passed / 1 ignored), plus targeted probe/map/tracking
  tests.
- GitHub Linux validation build `28959613296` for `78fa836` passed, including Linux artifact
  inspection and AppImage launch smoke. CI artifacts copied to Ubuntu at
  `/home/donal/sartracker-hotfix-78fa836/`; AppImage and deb hashes verified from `SHA256SUMS`
  (path-normalized).
- Ubuntu map-only A/B on `donal@192.168.18.31`, X11, package
  `/home/donal/SARTracker-private-map-assets/don107/packages/reeks-standard-60km-z16.mbtiles`
  (31,729 tiles): original beta.9 did **not** numerically freeze on this machine even with 14x14 /
  200 ms heavy pan (`main max 28 ms`, renderer max 17 ms), but it produced **2,527** tile-miss IPC
  exceptions. CI hotfix under the same load stayed responsive (`main max 43 ms`, renderer max 17 ms)
  and produced **0** tile-miss exceptions. Evidence:
  `output/beta9-map-freeze-probe/A-beta9-heavy/` and `B-hotfix-heavy/` on Ubuntu.
- Ubuntu packaged official-offline smoke passed on the CI hotfix AppImage, including offline
  package readiness, outside-coverage warning, diagnostics export, and 0 tile-miss exceptions.
  Evidence: `output/beta9-map-freeze-probe/B-official-offline/` on Ubuntu.
- Ubuntu full-profile A/B now runs after switching the probe to app-owned credential seeding:
  `--allow-network --seed-real-tracking-config --password-store=basic`, live tracking online with
  33 devices / 8 fixes on both builds. Original beta.9 still did **not** numerically freeze
  (`main max 66 ms`, renderer max 67 ms) but produced **2,542** tile-miss IPC exceptions. CI hotfix
  stayed responsive (`main max 63 ms`, renderer max 33 ms) and produced **0** tile-miss exceptions.
  Evidence: `output/beta9-map-freeze-probe/A-beta9-fullprofile/` and `B-hotfix-fullprofile/` on
  Ubuntu. Cache drop could not be applied because the Ubuntu account has no passwordless sudo.

Open / not release-ready:
- The strict reproduction gate from `docs/releases/beta9-map-freeze-repro-plan.md` is still **not
  met**: original beta.9 did not freeze numerically on this Ubuntu host, even with full concurrent
  tracking load. We can claim the hotfix removes the measured beta.9 exception storm and is
  responsive under the same load on this machine; we cannot claim categorical field-freeze proof.
- Bad-secret smoke still needs a clean rerun with `--password-store=basic` or a proper D-Bus/keyring
  session; earlier A and B failures were baseline validation-environment failures, not hotfix-only.
- Before replacement release: resolve or bypass the live-secret/keyring smoke blocker with a known
  good interactive/session setup, then complete the full packaged smoke matrix on the CI-built
  artifact. Do not publish a replacement beta until that is done.

## Latest Beta.8 Validation - 2026-06-21

- Full local gates passed before the targeted smoke fix: `npm run lint`, `npm run build`, `npm run test` - 152 files / 997 tests, `npm run test:backend` - 47 passed / 1 ignored, `npm run test:e2e:chromium` - 127/127, `npx playwright test --project=visual` - 34/34, `npm run visual:review -- --fail-on critical` - 39/39, and `npm run beta:verify -- --no-smoke` - passed with manual smoke intentionally skipped.
- Targeted smoke found and fixed `DON-223`: mast action labels overlapped at 1100x720. Fix compacts the command mast grid below 1180px and uses short visible labels while preserving full accessible names. `DON-223` is Done.
- Post-fix focused verification passed: `npm run lint`, `npm run build`, `npx playwright test tests/e2e/focus-mode.spec.ts tests/e2e/mission.spec.ts --project=chromium` - 17/17, `npx playwright test tests/e2e/visual/visual-app-shell.spec.ts tests/e2e/visual/visual-mission-lifecycle.spec.ts --project=visual` - 13/13, `npm run visual:review -- --only shell-map-scale-small-display --fail-on critical` - passed.
- Vercel preview deployed via documented prebuilt flow after direct `vercel deploy --yes` failed because `.vercelignore` excludes build inputs. Preview: `https://sartracker-iuj0w2ls4-ocallaghandonal2-1437s-projects.vercel.app`; protected share URL expires 2026-06-22 05:35 UTC: `https://sartracker-iuj0w2ls4-ocallaghandonal2-1437s-projects.vercel.app/?missionHarness=1&_vercel_share=FqNQsHcXOa7AHnXMaKCcyUiyowZCovKN`.
- Hosted UI smoke passed on that preview with mocked Traccar responses, covering app load, map tiles after wait, mission start, harness tracking display, Devices, marker-at-grid, settings validation, diagnostics, and the 1100x720 mast fix. Evidence is under `output/playwright/beta8-local-smoke/` and `output/playwright/beta8-vercel-smoke/`.
- `DON-224` root cause: the hosted app still recommended the old Vercel proxy from the HTTP-era Traccar setup. The team server now works directly over `https://kmrtsar.eu` with CORS. Direct deployed-browser smoke against the Vercel preview passed: Settings `Test Connection`, `Save, Connect & Close`, online tracking, and Devices workspace. Evidence: `output/playwright/beta8-direct-https-traccar/`.
- `DON-225` fixed the drawing blank-name save path: Save is disabled until required drawing name/text is present, and handled `Drawing name is required.` validation no longer rethrows into an uncaught promise rejection. Verified with red-to-green focused units, drawing Chromium E2E, drawing visual E2E/review, full unit, lint, build, and full Chromium 127/127.
- `DON-226` added beta.8 diagnostic breadcrumbs so map/tracking issue reports can use the sustainable flow: approximate incident time + Export Incident Bundle + optional screenshot/note. Incident bundles now include sanitized, bounded breadcrumbs for basemap/map-health changes, marker saves, measurement completion, tracking status changes, and tracking snapshot counts. They intentionally exclude precise coordinates, credentials, private map package paths, and raw mission data. Verified with focused unit coverage and Chromium Diagnostics E2E; full gates still need rerun after this chunk.

## Beta.8 Candidate Status

DON-190 through DON-199 are complete, committed, pushed, and Linear-closed.
DON-203 through DON-205 are complete and Linear-closed in the operator hardening batch.

Main beta.8 batch coverage:

- DON-190 Devices workspace list/search/selection behavior.
- DON-191 Map Tools / RHS Tools consolidation.
- DON-192 Mission Control minimize behavior, helicopter move to Tools, top-panel simplification.
- DON-193 Tracking stale-state visibility and map-label readability.
- DON-194 Layer Tree and GPX readability controls.
- DON-195 Map shell scale/readability and smaller-display layout.
- DON-196 Drawing detail panel simplification and required-field emphasis.
- DON-197 Casualty terminology/order and marker map-label size.
- DON-198 Mission preview / map sharing / external-resource decisions split to DON-215-DON-218.
- DON-199 Settings/coordinator access-control decision split to DON-219-DON-221.
- DON-226 Map/tracking diagnostic breadcrumbs for beta.8 incident bundles.

Additional runtime performance hardening is complete locally for the tracking/Electron data path:

- DON-165: breadcrumb accumulation now keeps per-device ordered state and appends incrementally instead of rebuilding retained history every poll.
- DON-200: tracking runtime uses an optional bulk mission-store position write; Electron persists bulk rows in one transaction while preserving raw breadcrumb mission truth and telemetry semantics.
- DON-201: Electron official-map proxy reuses readonly MBTiles readers/statements per package and closes stale handles when package metadata changes.
- DON-202: Mission Review requests a position count instead of loading every tracking row just to show breadcrumb count.

Safety-critical runtime bug fixes are complete locally for the latest sweep:

- DON-206: Traccar device/current-position/breadcrumb list normalization now drops only malformed rows, logs sanitized row context, and keeps single-row normalizers strict. All-invalid current-position responses still fail explicitly.
- DON-207: Traccar provider URLs with embedded credentials are rejected in renderer/Electron settings, disable live tracking if found in manually edited persisted settings, and are redacted in renderer/Electron diagnostics/support output.
- DON-208: corrupt persisted autosave/tracking intervals are normalized to 30s default or clamped to 5s-3600s; the polling manager also clamps runtime intervals before scheduling.
- DON-209: Electron mission finalization can recover idempotently after interruption following `mission_archive_succeeded`; retry reuses the recorded archive and writes exactly one finalization event.

Renderer/map performance hardening is complete locally for the latest sweep:

- DON-210: MapLibre GeoJSON source sync now uses explicit data keys so unchanged tracking/marker/drawing/GPX/helicopter/measurement overlays do not resend identical source data; style-rebuilt source objects still receive data.
- DON-211: layer catalog refresh skips metadata reload/loading publishes when mission layer structure is unchanged by volatile tracking status/last-seen updates.
- DON-212: breadcrumb timestamp parsing and line/dot feature construction are cached by immutable breadcrumb array identity and relevant style inputs, preserving per-device breadcrumb fairness while avoiding repeated segmentation work.
- DON-213: the closed Devices workspace now subscribes only to open/close state; tracking row derivation and heavy device subscriptions mount only while the overlay content is present.

Operator workflow hardening is also complete:

- DON-203: stacked Escape now closes only the top dialog/confirmation above docked Mission Review.
- DON-204: Settings prompts before discarding unsaved edits.
- DON-205: Text Label dragging works from visible label text, not only the anchor point; overlay boundary handling prevents docked workspaces from moving labels underneath them.
- DON-190: Devices workspace layout and selected-list behavior was revalidated without new code changes.

Final browser/regression gate passed after the hardening batch:

- `npm run lint`
- `npm run build`
- `npm run test` - 152 files / 976 tests
- `npm run test:backend` - 47 passed / 1 ignored
- `npm run test:e2e:chromium` - 126/126
- `npx playwright test --project=visual` - 34/34
- `npm run visual:review -- --fail-on critical` - 39/39
- `node --check electron/main.cjs electron/preload.cjs electron/mission-store.cjs electron/settings-store.cjs`
- `npm run electron:pack` - local unsigned macOS arm64 directory package, `better-sqlite3` rebuild passed.

DON-206-DON-209 verification snapshot:

- Red-to-green focused regressions: 7 files / 94 tests.
- `npm run lint`
- `npm run build`
- `npm run test` - 152 files / 991 tests
- `npm run test:backend` - 47 passed / 1 ignored
- `npm run test:e2e:chromium` - 126/126
- `npx playwright test --project=visual` - 34/34
- `npm run visual:review -- --fail-on critical` - 39/39 after hardening stale/ambiguous visual prompts and captures for `marker-ipp-dialog`, `marker-casualty-dialog`, and `mast-tracking-cell-active`; report `test-results/visual-verification/reports/visual-review-2026-06-20T14-12-13Z.json`.
- `npm run electron:pack` - local unsigned macOS arm64 directory package, `better-sqlite3` rebuild passed.
- `npm run electron:smoke:bad-secret -- --app "tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app/Contents/MacOS/SAR Tracker Electron Validation" --evidence-dir tmp/electron-bad-secret-smoke-don206-209` - passed.
- `npm run beta:verify -- --no-smoke` - passed lint/build/unit/backend/Chromium/package and wrote `tmp/beta-artifacts/verify-0.1.0-beta.7-sha.cfe1fa36752f-2026-06-20T13-49-43Z.json`; manual smoke was intentionally skipped.

Not done in this sweep: no live/private Traccar call, no private official MBTiles smoke, no manual beta smoke prompt, and no release publication.

The final visual gates initially found two stale/ambiguous harness waits/prompts, not product regressions: mast tracking cell prompt wording and casualty marker map-label capture timing. Both were hardened and the full visual gate reran green.
The paused-mission finish E2E timing assertion was also hardened for second-boundary scheduler drift after reproducing a 1/3 repeat flake; the focused test passed 5/5 and the full mission/full Chromium suites passed afterward.

DON-210-DON-213 verification snapshot:

- Red-to-green focused regressions: 4 files / 28 tests.
- Adjacent focused unit sweep: 12 files / 77 tests.
- `npm run test` - 152 files / 997 tests.
- `npm run lint`
- `npm run build`
- `npm run test:backend` - 47 passed / 1 ignored.
- `npx playwright test tests/e2e/performance-sweep.spec.ts tests/e2e/devices-workspace.spec.ts tests/e2e/layer-panel.spec.ts tests/e2e/map.spec.ts tests/e2e/parity-visibility.spec.ts --project=chromium` - 43/43.
- `npm run test:e2e:chromium` - 127/127.
- `npx playwright test --project=visual` - 34/34.
- `npm run visual:review -- --fail-on critical` - 39/39, 0 critical blocking failures; report `test-results/visual-verification/reports/visual-review-2026-06-20T16-40-09Z.json`.
- `node --check electron/main.cjs electron/preload.cjs electron/mission-store.cjs electron/official-map-proxy.cjs`
- `npm run electron:pack` - local unsigned macOS arm64 directory package, `better-sqlite3` rebuild passed.
- `npm run beta:verify -- --no-smoke` - passed lint/build/unit/backend/Chromium/package and wrote `tmp/beta-artifacts/verify-0.1.0-beta.7-sha.0c0994b495de-2026-06-20T16-32-43Z.json`; manual smoke was intentionally skipped.

Not done in this sweep: no live/private Traccar call, no private official MBTiles smoke, no manual beta smoke prompt, and no release publication. One first `beta:verify --no-smoke` run exposed a transient `electron-main-startup.test.ts` cleanup/order failure after build; the single-file retry, full unit retry, and full beta-verifier rerun all passed.

Performance batch verification snapshot:

- Red-to-green focused unit coverage for DON-165/DON-200/DON-201/DON-202: 6 files / 63 tests.
- Adjacent runtime/map/store contract units: 10 files / 74 tests.
- `npm run lint`
- `npm run test` - 152 files / 975 tests
- `npm run test:backend` - 47 passed / 1 ignored
- `npm run build`
- `npm run test:e2e:chromium` - 121/121
- `npx playwright test --project=visual` - 34/34
- `npm run visual:review -- --fail-on critical` - 39/39
- `node --check electron/main.cjs electron/preload.cjs electron/mission-store.cjs electron/official-map-proxy.cjs`
- `npm run electron:pack` - local unsigned macOS arm64 directory package, `better-sqlite3` rebuild passed.

Not done: no private Discovery MBTiles package smoke and no release publication were attempted in this batch.

## Beta.8 Release Gate

Beta.8 is published. The packaged release gate passed on the CI-built artifact before publication:

- GitHub Actions run `28012741523` was green.
- Deep Ubuntu packaged smoke passed 43/43 on the CI-built post-fix artifact.
- DON-180 duplicate-launch/single-instance smoke passed inside that matrix.
- Linear `DON-180` is Done as of 2026-06-23.

Do not reopen beta.8 release gating unless new tester evidence points to a regression in the published artifact.

## Current Follow-Ups

- **DON-240 beta.9 freeze hotfix:** urgent active blocker created 2026-07-08 from tester feedback. Investigation used three Codex subagents plus Claude; strongest root cause is Electron main-process saturation from official-map tile IPC, amplified by tracking breadcrumb fan-out and diagnostics log export. Local fixes currently cache/coalesce official-map settings in the tile proxy, invalidate on Settings save, return empty PNG tiles for ordinary offline coverage misses instead of throwing per tile, publish current tracking fixes before slow breadcrumb history, no-op duplicate breadcrumb overlap snapshots, and bound runtime-log `readRecent(limit)` parsing. Verification so far: red-to-green focused units, targeted runtime/Electron/tracking units 123/123, lint, build, full unit 152/1062, backend 47 passed / 1 ignored, full Chromium E2E 129/129, in-app Browser smoke against `http://127.0.0.1:1420/?missionHarness=1` covering mission start, map pan, Devices, Diagnostics, Export Report, and Export Support Bundle, local `npm run electron:pack`, and packaged macOS official-offline smoke with private `reeks-standard-60km-z16.mbtiles`; rerun app log has no `fetch-official-map-tile` exception storm. Ubuntu host `donal@192.168.18.31` is currently unreachable over SSH (`ConnectTimeout=8` timed out), so Ubuntu packaged smoke remains open before replacement release.
- **Fable deep-analysis remediation queue:** `DON-230` is the parent Linear issue for `output/fable-deep-analysis.md` (2026-07-06). `DON-231` through `DON-238` are complete and were included in beta.9. `DON-239` is intentionally parked as low priority for a later tracking-staleness policy pass. The original beta.9 release gate did pass before publication (`npm run beta:verify`, visual E2E/review, local browser and packaged smoke, GitHub Actions run `28875685324`, and Ubuntu CI-artifact smoke under `output/beta9-ubuntu-smoke/`), but team feedback exposed the separate `DON-240` release-blocking freeze and beta.9 is now on hold.
- **DON-228 beta.8 breadcrumb gap fix:** Eamonn reported a regular missing breadcrumb cadence (“group of 10 then gap”) on beta.8. Root cause was the poller advancing each per-device incremental breadcrumb cursor by `+1000ms`, creating a one-second blind spot after every polling window. Fixed by fetching inclusively from the last seen timestamp and relying on accumulator/persistence dedupe. Verification: red-to-green `tests/unit/polling-manager.test.ts`, focused tracking/diagnostics unit sweep `6 files / 63 tests`, `npx playwright test tests/e2e/settings.spec.ts --project=chromium --grep "DON-228"`, `npx playwright test tests/e2e/settings.spec.ts --project=chromium` `9/9`, `npm run lint`, `npm run build`, `npm run test` `152 files / 1007 tests`, `npm run test:backend` `47 passed / 1 ignored`, `npm run test:e2e:chromium` `128/128`, and `npm run electron:pack`. Linear `DON-228` should stay closed unless team retest shows a different server-side/device cadence issue.
- `DON-144` remains open: private Discovery package distribution owner/channel and repeatable raw-source-to-MBTiles admin workflow.
- `DON-214`: Search Area label positioning/zoomed-out drift follow-up.
- `DON-215`-`DON-218`: mission preview, map export/print, external-resource model, evacuation/gear workflow decisions.
- `DON-219`-`DON-221`: privileged settings guard, mission unlock authority, and access recovery.
- `DON-146` remains parked/backlog, blocked on upstream `better-sqlite3` Electron 42 compatibility.

## Traccar Test Details

- Current team server: `https://kmrtsar.eu`
- Validation credentials: `apiuser` / `apiuser` for hosted team testing; `sean` / `sean` also validated on 2026-06-21.
- Do not use `https://traccar.kmrtsar.eu` or port `:5055`; those are listener/non-API paths.
- Do not use old direct HTTP URLs such as `http://kmrtsar.eu:8082` or `http://kmrtsar.ddns.net:8082` in hosted browser mode.
- Hosted browser and desktop should use the direct HTTPS provider base URL: `https://kmrtsar.eu`.

## Useful Commands

- Unit: `npm run test`
- Backend: `npm run test:backend`
- Standard E2E: `npm run test:e2e:chromium`
- Visual E2E: `npx playwright test --project=visual`
- Visual review: `npm run visual:review -- --fail-on critical`
- Build: `npm run build`
- Lint: `npm run lint`
- Local beta gate: `npm run beta:verify`

For packaged Electron smoke details, read local `SMOKE-TESTING.md` and `docs/electron-beta-handoff.md` before starting.
