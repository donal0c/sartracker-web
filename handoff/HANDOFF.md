# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 151 unit files / 844 tests; 106 standard Playwright E2E; 47 backend tests.

## Last Work Done

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

## What's Next

Immediate correction: send the team both the app link and the prepared `.mbtiles` package through private storage. Do not ask them to select `Discovery_National.zip`, `Discovery_RGB_95pct_C70_high30.1953.tif`, `relief_byte.tif`, `Slope_30plus.tif`, or `mountainrescue_org.txt` in the app. Next non-feedback chunks are `DON-144` (map package distribution/raw-source packaging workflow) and `DON-143` (Electron GitHub release workflow).

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
- **Electron handoff:** see `docs/electron-beta-handoff.md`; current team prerelease is `https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.3`. The automated GitHub release workflow is still Tauri-era until migrated under `DON-143`.

## Latest Verification

- macOS DON-115: `npm run electron:pack -- --mac --arm64` passed; `npm run electron:smoke:official-offline -- --app tmp/electron-dist/mac-arm64/SAR\ Tracker\ Electron\ Validation.app/Contents/MacOS/SAR\ Tracker\ Electron\ Validation --package <private Reeks MBTiles> --evidence-dir tmp/don115-macos-official-map-offline --platform darwin` passed.
- Ubuntu DON-115: synced current repo to `donal@192.168.18.31:~/sartracker-don115-validation/repo`, ran `npm ci`, `npm run electron:dist:linux`, focused readiness unit tests, and `npm run electron:smoke:official-offline -- --app tmp/electron-dist/linux-unpacked/sartracker-web --package <private Reeks MBTiles> --evidence-dir tmp/don115-linux-official-map-offline --platform linux --app-arg --no-sandbox --app-arg --ozone-platform=wayland --app-arg --ignore-gpu-blocklist`.
- Ubuntu focused tests: `npm run test -- tests/unit/field-readiness-checklist.test.ts tests/unit/basemap-switcher.test.ts` — 24 passed.
- DON-142 artifact bundle: `tmp/don142-electron-handoff/SHA256SUMS` generated for Linux AppImage, Linux `.deb`, and macOS arm64 zip.
- Ubuntu release-asset smoke: downloaded GitHub prerelease `.deb` and `SHA256SUMS` from `electron-v0.1.0-beta.3` to `donal@192.168.18.31:~/sartracker-release-smoke/electron-v0.1.0-beta.3`, verified checksum `OK`, ran the real `sudo apt install` path, confirmed `dpkg -s sartracker-web` reports `install ok installed` version `0.1.0~beta.3`, and ran `npm run electron:smoke:official-offline` against the installed binary at `/opt/SAR Tracker Electron Validation/sartracker-web` with the private Reeks package. Smoke passed with renderer network blocked, local Discovery tile read, inside field-ready verdict, outside warning, Settings ready status, and sanitized diagnostics. Evidence: `~/sartracker-release-smoke/electron-v0.1.0-beta.3/installed-smoke-evidence`.

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
