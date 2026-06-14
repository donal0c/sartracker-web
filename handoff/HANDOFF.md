# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron is the operational desktop lane (MapLibre + direct HTTPS Traccar, SQLite, filesystem, diagnostics, official map packages). Tauri remains historical/reference.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 149 unit files / 847 tests; 106 standard Playwright E2E; 47 backend tests.

## Last Work Done

DON-143 (S2 Electron, Feature) — Electron GitHub release workflow; Tauri release lane retired. DONE & CI-verified & on-device smoked.
- New `.github/workflows/electron-release.yml`: `electron-v*` tag trigger (distinct from legacy Tauri `v*`). Jobs: gates (version-match + release-notes + lint/test/build) → bundle-linux (native AppImage+.deb, asserts packaged `better_sqlite3.node` is ELF x86-64, guards against `.mbtiles`/licensed data) → launch-smoke-linux (Xvfb window + non-black + no fault shell) → release (downloads built artifacts, generates `SHA256SUMS`, creates the draft prerelease — only after a green smoke) → summary. Artifacts pass between jobs via the workflow-artifact store, not the draft-release-by-tag API (which excludes drafts).
- Windows NSIS scaffolded (`electron-builder.json` win/nsis + `electron:dist:win`) but gated OFF behind `enable_windows` dispatch input pending DON-141. macOS arm64 stays local/manual. Deleted `release.yml`. Docs updated: `docs/releases/README.md`, `docs/electron-beta-handoff.md`, `docs/releases/TEMPLATE.md`; superseded banner on `docs/tauri-beta-release-plan.md`. New release-note naming: `sartracker-electron-<version>.md`.
- Found + fixed a pre-existing **timezone-dependent test bug** the CI surfaced: `marker-draft` / `marker-dialog-treatment-log` treatment-log tests used a hardcoded `+01:00` Date and asserted fixed local-time output, so they passed only on UTC+1 machines (green locally in Dublin, red in CI's UTC). Now built from local-time components; verified under TZ=UTC/Dublin/New_York. Production formatter (local-time rendering) was correct and unchanged. (Lesson: `npm run test` locally can false-green on TZ; CI runs UTC.)
- CI: `electron-v0.1.0-beta.4` run **green end-to-end** (run #3 `27367822502`); prerelease published with Linux AppImage + `.deb` + `SHA256SUMS`, no map data: `https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.4`.
- On-device smoke (Ubuntu 24.04.2 / kernel 6.14, `192.168.18.31`, real Wayland display, CI-built artifact, checksum OK): all 6 highest-risk areas pass. (1) AppImage launches, real window, no SIGTRAP. (2) **Mission persists across full restart** — recovery prompt shows the created mission name + start time (SQLite schema v3 + backup mirror). (3) Live Traccar **"Connection successful."** over `https://kmrtsar.eu` (note: box network blocks plain-HTTP `:8082`; HTTPS works). (4) Discovery offline tiles read from SQLite (verified PNG bytes, network blocked), inside=Field ready / outside=warning, real GPU. (5) Coordinate readout (DD/Irish Grid/DMS) renders correctly + 847 golden-dataset unit tests. (6) Diagnostics export sanitized, `secret present: no`. Evidence on box: `~/sartracker-don143-smoke/{offline-evidence,persist-evidence}`.
- Verified locally: actionlint clean, unit 847/847 (under UTC), lint, build, local electron-builder `--dir` pack.

DON-151 (S2 Electron, Urgent Bug) — Electron launch slowed after tracking history accumulated on Ubuntu beta. Root cause was launch/poll-cycle tracking work, distinct from DON-148 Mission Review:
- On restart, the UI could hydrate cached breadcrumbs, but the live poller fetched breadcrumbs from mission start for every device because its per-device cursors were not seeded from persisted mission positions. With 33 devices / 4.5k breadcrumbs / 5s polling this rebuilt history and the map overlay unnecessarily.
- Each tracking snapshot also reloaded every persisted position from SQLite and re-deduped the full breadcrumb history, creating repeated main-process work during active tracking.
- Fix: poller now accepts validated active-mission persisted breadcrumbs before first live history fetch, preserves the visible trail, and resumes per-device Traccar history from latest persisted timestamps. Runtime persistence now keeps a mission-scoped `device_id:timestamp` key cache and serializes snapshot persistence, so repeated snapshots do not re-query all positions.
- Verified before release: `npm run test` (149/847), `npm run lint`, `npm run build`. Included in published `electron-v0.1.0-beta.4`, whose CI build and Ubuntu on-device smoke passed. Linear issue `DON-151` remains In Review pending team retest of the original Ubuntu slowdown scenario.

DON-159 (S2 Electron / Shared Tracking, Urgent Bug) — Implemented locally; awaiting team retest in next Electron beta. New beta.4 field report showed Traccar has complete routes but SAR Tracker can display partial/missing breadcrumb trails in long multi-device missions:
- Evidence from `~/Downloads/diagnostics-report-2026-06-13T21-48-51-654Z.txt`: beta.4, tracking online, 33 devices, 6 current positions, exactly 20,000 breadcrumbs. Current `breadcrumb-accumulator.ts` applies one global last-20k cap after merging all device history, so a high-frequency tracker can evict another rescuer's trail.
- Live Traccar checks for the team report showed Eamonn/device 2 had ~39.9k points across the likely active mission window while Richard/device 25 had 3.3k Saturday points; Donal later clarified Eamonn is the point of contact and frequently tracks himself outside tests, so the fix preserves full-window route coverage per device rather than keeping only each device's latest points.
- Fix: live breadcrumb accumulation now uses a per-device 5,000-point render budget sampled across the full retained time window, preserving first/last points so one noisy tracker cannot evict another device and cannot erase its own older route just because later non-mission movement exists. Poller snapshots carry per-device breadcrumb metadata; diagnostics/support reports include retained/observed/truncated counts; Electron mission persistence remains uncapped by default with a guard against future global persistence caps.
- Verified: focused DON-159 unit set (5 files / 48 tests), full `npm run test` (149 files / 854 tests), `npm run lint`, `npm run build`, `npx playwright test tests/e2e/diagnostics.spec.ts --project=chromium` (3 passed), full `npx playwright test --project=chromium` (107 passed), and `npm run test:backend` (47 passed / 1 ignored). Manual updated for the new diagnostics report content.

DON-147 — DONE & on-device verified (HEAD `4ad6673`). Crash capture, runtime logging, support-bundle export.
- On-device verification on the Dell Ubuntu box (`192.168.18.31`, **24.04.2**, not 26.04): built packaged `.deb`/AppImage, confirmed `crashReporter` writes a real native minidump on main-process SIGSEGV (`Crashpad/pending/*.dmp`), JS `uncaughtException` writes a structured `crash-log.json`, unclean-shutdown flag sets/clears correctly, and `exportSupportBundle` assembles env+crash+log sections. Live-renderer crash not drivable headless (GPU process won't start over SSH) — renderer-fault logic is unit-tested instead.
- Two fixes found during testing: (`4ad6673`) `render-process-gone` was recording `clean-exit` as a crash → now gated by `isRendererFaultReason()`; (`c448021`) **DON-148 had broken `npm run build`** — runtime-bridge error-catch missed the new state fields; `tsc -b` caught it, `tsc --noEmit` didn't. **Lesson: verify with `npm run build`, not `tsc --noEmit`.**
- Box note: `~/sartracker-don147-validation` (1.7G) left on the machine per prior convention; temp `/tmp/don147-*` cleaned.
- Remaining out-of-scope follow-up: confirm against real Ubuntu 26.04 (folds into DON-146).

(original scope notes:) Shipped the fully-verifiable core (per agreed "testable slice first" scope):
- New `electron/runtime-log.cjs` (bounded JSON-line ring buffer, rotates to one `.1` backup, sanitizes secrets + home-path usernames) and `electron/crash-log.cjs` (capped structured crash log + clean-exit marker for unclean-shutdown detection). Both fully unit-tested.
- `main.cjs` wires `crashReporter.start` (uploadToServer:false), `uncaughtException`/`unhandledRejection`/`render-process-gone` capture, logs `app_start`, and marks clean exit on `before-quit`.
- `runtime-files.cjs` gained `exportSupportBundle` (environment snapshot + crash history + recent runtime log) + new IPC channels (`export-support-bundle`, `read-crash-recovery-state`) wired through `preload.cjs`.
- Renderer: support-report store gained `exportSupportBundle`/`readCrashRecoveryState` (fall back to plain report in Tauri/browser); diagnostics runtime + UI gained an "Export Support Bundle" button and a dismissible unclean-shutdown banner. Manual documents the feature + per-platform crash/log file locations.
- Verified: unit 843 (+12), chromium E2E 106 (incl. new diagnostics bundle assertion), lint+tsc clean, Playwright screenshot of the new button/feedback read & confirmed. No Rust touched (backend unchanged at 47).
- **Follow-up not done:** real native minidump capture can only be confirmed by crashing a packaged build (same constraint as DON-146, ideally the Ubuntu box). JS-level crash capture + rotation/recovery logic are tested; the `crashReporter` minidump path is wired but unverified on a packaged build.

DON-148 (S3 Web App, Bug) — Mission Review froze the UI on missions with large event counts (93k–193k events in the field; `device_updated` heartbeats from 33 devices polling every 10s dominated). Fixed at the query layer so the unbounded set never crosses IPC:
- New `listAuditEvents(missionId, { includeTelemetry, limit })` on all three stores (Rust `persistence.rs`, Electron `mission-store.cjs`, browser harness) + Tauri command `list_audit_events` + auto-wired Electron channel. Telemetry (`device_updated`/`position_recorded`) excluded by default; newest-first, capped (default 500 / max 5000). `listMissionEvents` kept for export/archive.
- Shared classification: `src/features/mission-review/audit-events.ts` (the `.cjs`/Rust copies mirror it, covered by tests).
- Review runtime exposes `includeTelemetry`/`auditLogTruncated` + `setIncludeTelemetry`; UI added a "Show tracking telemetry" toggle and truncation notice. Manual updated.
- Verified: unit 831, backend 47, chromium E2E 106 (incl. new telemetry-toggle test), lint+tsc clean, Playwright screenshots read & confirmed. DON-148 closed; DON-149 was a duplicate (cancelled).

DON-142 (S2 Electron/S1 maps) — Electron beta handoff release and Discovery map loading instructions:
- Added `docs/electron-beta-handoff.md` as the active runbook for the current Electron app handoff, Discovery package loading, offline confidence checks, diagnostics, and private-data rules.
- Updated `docs/releases/README.md` and `docs/releases/TEMPLATE.md` so future agents do not follow the obsolete Tauri beta path for Electron handoff.
- Published GitHub prerelease `electron-v0.1.0-beta.3` with Linux `.deb`, Linux AppImage, macOS arm64 zip, and `SHA256SUMS`. Discovery maps are not included.
- Tidy-up: `DON-142` closed; `DON-143` reparented to `DON-25`; `DON-115`, `DON-141`, and `DON-113` moved to Backlog while waiting for Windows/team feedback/admin-prep priority.
- Team map handoff correction: the beta does not load raw USB/source files directly. Testers need the prepared private package `reeks-standard-60km-z16.mbtiles` (SHA256 `e317fd016b02d88f0fdc0e4f97653a2c4758acc46779bad7ffb55ac2807b6589`). `DON-144` owns private map-package distribution plus the future raw-source packaging workflow.

DON-144 partial independent progress — beta wrong-file guardrail:
- Electron official-map package import now gives specific operator/admin guidance for raw Discovery `.tif`/`.tiff` and `.zip` selections: beta packages must be prepared `.mbtiles`, such as `reeks-standard-60km-z16.mbtiles`, or prepared by a map admin from the licensed source.
- Operator manual and `docs/electron-beta-handoff.md` now distinguish **Choose MapGenie File** (`mountainrescue_org.txt` / source metadata) from **Add Discovery Package** (`.mbtiles` only). The larger DON-144 workflow decision remains open: private distribution owner/channel and repeatable admin raw-source-to-package process.
- Verified focused regression: `npm run test -- tests/unit/electron-file-system.test.ts`.

## What's Next

Next: ship a new Electron beta containing `DON-159`, then have the team retest the Saturday breadcrumb scenario and the separate DON-151 launch/panning slowdown. In parallel, continue `DON-144`: choose the private Discovery package distribution owner/channel and lock the repeatable admin raw-source-to-package workflow. `DON-143` is closed in Linear.

DON-146 (Electron 40→42) is parked in Backlog, **blocked on upstream `better-sqlite3` PR #1475** (does not compile against Electron 42's V8; no published fix). See the DON-146 comment for the decision + resume checklist.

## Traccar Test Details

- Upstream team server: `http://kmrtsar.eu:8082`
- HTTPS server: `https://kmrtsar.eu`
- Validation credentials: `sean` / `sean`
- Do NOT use `https://traccar.kmrtsar.eu` (device listener, returns 400)
- Do NOT use port `:5055` (listener port, not API)
- Fallback: `http://kmrtsar.ddns.net:8082`
- **Hosted browser proxy:** provider base URL = `https://sartracker-web.vercel.app`, endpoints `/api/session`, `/api/devices`, `/api/positions`, auth `Basic` / `apiuser` / `apiuser`
- **Desktop rule:** direct HTTP upstream URL is fine (no mixed-content blocking)
- **Browser rule:** use the Vercel proxy URL, not direct HTTP

## Verification & Deploy

- **Unit tests:** `npm run test`
- **E2E (standard):** `npx playwright test --project=chromium`
- **E2E (visual AI):** `npx playwright test --project=visual` then `npm run visual:review`
- **Backend/Tauri:** `npm run test:backend`
- **All:** `npm run test:all`
- **Build:** `npm run build`
- **Lint:** `npm run lint`
- **Type check:** `npx tsc --noEmit`
- **Deploy:** push to `master` → Vercel auto-deploys to production
- **Electron handoff:** see `docs/electron-beta-handoff.md`; current Linux team prerelease is `https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.4`. The Electron GitHub release workflow is implemented under `DON-143`; Windows remains gated by `DON-141`.

## Latest Verification

- macOS DON-115: `npm run electron:pack -- --mac --arm64` passed; `npm run electron:smoke:official-offline -- --app tmp/electron-dist/mac-arm64/SAR\ Tracker\ Electron\ Validation.app/Contents/MacOS/SAR\ Tracker\ Electron\ Validation --package <private Reeks MBTiles> --evidence-dir tmp/don115-macos-official-map-offline --platform darwin` passed.
- Ubuntu DON-115: synced current repo to `donal@192.168.18.31:~/sartracker-don115-validation/repo`, ran `npm ci`, `npm run electron:dist:linux`, focused readiness unit tests, and `npm run electron:smoke:official-offline -- --app tmp/electron-dist/linux-unpacked/sartracker-web --package <private Reeks MBTiles> --evidence-dir tmp/don115-linux-official-map-offline --platform linux --app-arg --no-sandbox --app-arg --ozone-platform=wayland --app-arg --ignore-gpu-blocklist`.
- Ubuntu focused tests: `npm run test -- tests/unit/field-readiness-checklist.test.ts tests/unit/basemap-switcher.test.ts` — 24 passed.
- DON-142 artifact bundle: `tmp/don142-electron-handoff/SHA256SUMS` generated for Linux AppImage, Linux `.deb`, and macOS arm64 zip.
- Ubuntu release-asset smoke: downloaded GitHub prerelease `.deb` and `SHA256SUMS` from `electron-v0.1.0-beta.3` to `donal@192.168.18.31:~/sartracker-release-smoke/electron-v0.1.0-beta.3`, verified checksum `OK`, ran the real `sudo apt install` path, confirmed `dpkg -s sartracker-web` reports `install ok installed` version `0.1.0~beta.3`, and ran `npm run electron:smoke:official-offline` against the installed binary at `/opt/SAR Tracker Electron Validation/sartracker-web` with the private Reeks package. Smoke passed with renderer network blocked, local Discovery tile read, inside field-ready verdict, outside warning, Settings ready status, and sanitized diagnostics. Evidence: `~/sartracker-release-smoke/electron-v0.1.0-beta.3/installed-smoke-evidence`.
- Ubuntu beta.4 on-device smoke: CI-built AppImage from `electron-v0.1.0-beta.4`, checksum OK, launched on Ubuntu 24.04.2 / kernel 6.14 real Wayland display, mission persistence across restart passed, live HTTPS Traccar connection passed, Discovery offline tile reads from SQLite passed with renderer network blocked, coordinates rendered, diagnostics sanitized. Evidence on box: `~/sartracker-don143-smoke/{offline-evidence,persist-evidence}`.

## Known Limits

- Browser mode is not durable for live incidents (no IndexedDB persistence, no filesystem).
- Electron desktop is the operational lane (SQLite, filesystem, diagnostics, GPX, offline maps).
- High-definition maps are local desktop packages only.
- Pre-existing flake: `devices-workspace.spec.ts` breadcrumb trail mode test intermittently fails on map layer state assertions.

## Active Linear Parents

`DON-5` (parity), `DON-7` (S1 maps), `DON-25` (S2 Electron), `DON-76` (official maps).

## Planning Docs

- `docs/two-track-execution-workplan.md` — canonical queue
- `docs/electron-beta-handoff.md` — active Electron app handoff and Discovery map loading runbook
- `docs/desktop-runtime-support-policy.md` — Electron runtime support, update cadence, release channels, diagnostics, rollback (DON-30)
- `docs/hosted-browser-testing-plan.md` — deployment strategy
- `docs/team-testing-feedback-loop.md` — tester instructions
