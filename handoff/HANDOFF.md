# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron is the operational desktop lane (MapLibre + direct HTTPS Traccar, SQLite, filesystem, diagnostics, official map packages). Tauri remains historical/reference.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 150 unit files / 922 tests; 107 standard Playwright E2E; 47 backend tests.
- **Latest published Electron beta:** `0.1.0-beta.5` / `electron-v0.1.0-beta.5` — built by GitHub Actions (run `27570596320`, green), Ubuntu 24.04.2 on-device smoke passed, **published** at `https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.5` (Linux AppImage + `.deb` + `SHA256SUMS`). This supersedes beta.4 as the team artifact.

## Last Work Done

DON-175 (S2 Electron, Urgent Bug) — Linux keyring / undecryptable Traccar secret startup fault fixed locally; awaiting packaged Ubuntu bad-secret smoke before release/close.
- Root cause: `electron/settings-store.cjs` let `safeStorage.decryptString()` throw out of `loadRuntimeBootstrapSettings()` when `secrets.json` contained ciphertext the current Linux secret-store session could not decrypt (locked login keyring, stale/copied ciphertext, changed key). That blocked app startup with the runtime fault shell.
- Fix: decrypt failures now become a startup-safe disabled-tracking state with the operator warning `Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.` Mission runtime/autosave still starts; tracking stays idle until the operator re-enters the password/token. `runtime-managed-services` now treats explicit `trackingConfig: null` as authoritative instead of falling back through `??` to env config.
- Smoke hardening: added tracked `npm run electron:smoke:bad-secret` (seeds throwaway userData with invalid encrypted secret and verifies packaged app reaches normal shell + Settings recovery path), added it to `beta:verify`, updated `docs/electron-beta-handoff.md`, local `SMOKE-TESTING.md`, and the operator manual.
- Verified locally: red→green focused tests; `npm run test -- tests/unit/electron-settings-store.test.ts tests/unit/runtime-managed-services.test.ts tests/unit/verification-scripts.test.ts` (19), `node --check scripts/electron-bad-secret-smoke.mjs`, `npm run lint`, `npm run build`, full `npm run test` (150 files / 925 tests). **Not run:** packaged bad-secret smoke/Playwright UI drive pending explicit approval and CI-built artifact.

DON-176 opened (S3 Web App, High Bug): Review workspace still blocks active mission controls while open. This is separate from DON-148's fixed large-event render freeze; current hypothesis is the full-screen `WorkspaceOverlay` backdrop consuming clicks. Needs product/UX decision and browser-backed regression before changing.

DON-167 (B2 coordinate-safety adversarial sweep) — all 7 sub-issues fixed, each Opus-reviewed, on `master` (commits `c130511`, `73a2220`, `8671bf3`, `84261a7`).
- DON-169/170/173/174 (`drawing-math.ts`): radius>0 guards on sector/circle; full-circle `360→0` arc now returns 360 (was 0 → invisible search circle); `geodesicBearingEndpoint` rejects negative distance; `geodesicBearing` returns `number|null` for identical points (threaded through line-persistence, measurement runtime, drawing-dialog).
- DON-168/171 (`coordinates.ts`): Irish geographic + ITM bounds. Design = **warn-not-throw in hot path** (user-approved): transforms throw on offshore input, but live display uses non-throwing `isWithinIreland()` and shows "Outside Ireland"; commit paths (marker create, converter) surface a clear error; reopening a persisted out-of-bounds marker degrades gracefully. **Bounds derived from real Irish extremes, NOT the issue's literal constants** (those rejected Skellig Michael + Mizen Head). Verified invariant (dense sample, 0 violations): ITM box fully contains the proj4 image of the WGS84 box, so no point that passes `isWithinIreland` can fail ITM validation. Documented residual: a bbox can't exclude near-coast sea (B2-C1).
- DON-172 (`coordinate-tool.ts`): ambiguous sign-vs-direction DD input (e.g. `-6.0E`) now throws instead of silently inverting hemisphere.
- Verified: unit 922 (+49 TDD cases), `tsc --noEmit`, full `eslint`, `npm run build`, `test:backend` 47 — all clean. Chromium E2E for drawings/coords/markers/measurement 25/25 incl. new full-circle sector regression; casualty/multi-drawing visual failures confirmed **pre-existing on baseline `79a2605`** (disabled-save-btn timeout + multi-drawing timing), not regressions. AI visual review of casualty dialog (shows ITM/TM65) PASS. Manual updated (Irish bounds safety paragraph).
- **Remaining:** broader visual E2E sweep was deferred (heavy; two known pre-existing flakes in that suite). No code follow-ups.

DON-160 children — B1 persistence-parity drift, all four Electron findings fixed (In Review, awaiting packaged on-device repro for the two criticals). Commits `b6eec80` + `f2d8db3` on `master`.
- DON-161 (critical) + DON-163 (high ×8) + DON-164 (medium) closed with one helper-level change to `electron/mission-store.cjs`: `upsertById`/`deleteById` (and `upsertHelicopter`, `upsertDevice`) now detect create-vs-update, emit the correct per-table `*_created/_updated/_deleted` (and `device_created`) audit event **inside the same transaction** as the row write, and `deleteById` enforces `ensureWritableMission` so deletes on finished/finalized missions throw instead of silently destroying locked records. New `AUDIT_EVENT_TABLES` map keeps event names/detail shapes in lock-step with Rust.
- DON-162 (critical, also closes the DON-34 archive stub): new dependency-free `electron/zip-archive.cjs` (Node `zlib` + CRC-32, no native-ABI risk). `createMissionArchive` builds a real per-mission archive (manifest + mission.json + SQLite snapshot + marker attachments) via temp-write → validate → atomic rename into a per-mission `archives/` dir; `finalizeMission` now emits the full `finalize_requested → archive_succeeded/_failed → mission_finalized` sequence with `archive_path` pointing at the real standalone archive. `mission_events` ordering tie-breaks on monotonic `rowid` (not random UUID) so same-ms finalize events keep insertion order.
- All new coverage hits the **real Electron better-sqlite3 backend** (harness previously masked these). Verified: `npm run test` 150 files / **873 tests**, `eslint`, `npm run build`, `test:backend` 47 Rust — all clean; governance/finalize/review E2E (chromium, 20) + visual mission-lifecycle (6) pass; AI visual review governance-card PASS. Manual updated for the real archive + finalized-mission lock.
- **Remaining:** packaged on-device Electron smoke for the two criticals (refused delete on finalized mission; standalone archive lands in userData `archives/` and survives a later mission's finalize) — fold into the next Electron beta.

DON-165 (S2 Electron / Shared Tracking, High Bug) — Breadcrumb accumulator re-sorted the entire retained history every poll. Surfaced by the P1 hot-path scaling audit (read-only Workflow run: 31 candidates → 30 rejected → 1 triple-confirmed). Same failure class as DON-151/148 (cheap in tests, degrades as an incident grows); DON-151 and DON-148 fixes were independently re-confirmed sealed by the same audit.
- Root cause: `accumulateBreadcrumbPositions` called `Date.parse` inside two O(n log n) sort comparators on every poll (`breadcrumb-accumulator.ts:48-49,67-69`, invoked at `polling-manager.ts:197,358`), so per-poll parse cost grew with cumulative retained history × a log factor (~36k breadcrumbs → ~1.9M parses/poll on the Electron main thread) even though only ~200 new points arrive.
- Fix: parse each timestamp exactly once (decorate-sort-undecorate via a `TimestampedPosition`), sort on the cached numeric value. Identical output and global ordering; parse calls now bounded to the combined set size (no log multiplier). No algorithmic change to dedup or per-device budgeting.
- Verified: new TDD regression test (red→green, asserts parse calls ≤ set size + global chronological order preserved); full `npm run test` (149 files / 857 tests), `npx tsc --noEmit`, `npm run lint` clean; Playwright `devices-workspace` + `full-mission-flow` (chromium, 5 passed) and `visual-tracking` (visual, 5 passed); live-app drive via Chrome DevTools — injected 33 devices × 1.1k = 36,300 deliberately-shuffled breadcrumbs, all 33 trails rendered contiguous/correctly ordered, main-thread probe 2ms, no console errors. (Note: harness `injectTrackingSnapshot` is slow at this scale due to 36k sequential awaited mock-store writes — a test-only artifact, not the render/accumulator path.)

Tauri reference cleanup — current docs/tooling now name Electron as the operational desktop lane. Updated `CLAUDE.md`, hosted/deployment docs, support policy, operator manual, testing guide, parity docs, `beta:verify`, and runtime mast mode so active surfaces no longer describe Tauri as the current app path. Electron is now preferred if both desktop runtime markers are present. Retained `src-tauri`, Tauri adapter tests, and superseded release docs as explicit legacy/history until a separate removal decision.

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
- Fix: live breadcrumb accumulation now uses a per-device 5,000-point render budget sampled across the full retained time window, preserving first/last points so one noisy tracker cannot evict another device and cannot erase its own older route just because later non-mission movement exists. Poller snapshots carry per-device breadcrumb metadata; diagnostics/support reports include retained/observed/truncated counts; runtime persistence uses the raw newly fetched breadcrumb payload before render budgeting, with a guard against future global persistence caps.
- Verified: focused DON-159 unit set (5 files / 49 tests), full `npm run test` (149 files / 856 tests), `npm run lint`, `npm run build`, `npx playwright test tests/e2e/diagnostics.spec.ts --project=chromium` (3 passed), full `npx playwright test --project=chromium` (107 passed), and `npm run test:backend` (47 passed / 1 ignored). Manual updated for the new diagnostics report content.

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

DONE: `electron-v0.1.0-beta.5` cut, built green by `.github/workflows/electron-release.yml` (run `27570596320`), Ubuntu 24.04.2 on-device release-asset smoke passed (launch, mission start, marker create, restart persistence/recovery, finish→finalize, standalone archive in `userData/archives`, out-of-Ireland coordinate rejection, sanitized diagnostics), and **published** to GitHub. Smoke ran against the CI-built AppImage with the real SQLite backend and renderer network blocked; evidence on the box at `~/sartracker-beta5-smoke/evidence{,2}/`.

Live Traccar ALSO confirmed on beta.5: connection test "Connection successful." against `https://kmrtsar.eu` and tracking online with **33 real devices / 7 fixes**, using the operator's locally-persisted provider config. Server URL/user live in `~/.config/sartracker-web/settings.json`; the basic-auth password is an encrypted blob in `secrets.json` (gnome_libsecret). The live run seeded a throwaway userData with copies of those two files (same machine → same keyring decrypts) and did NOT block network or touch the real mission DB. Evidence: `~/sartracker-beta5-smoke/evidence-tracking/`.

Still not retested on beta.5 (need specific data): Discovery offline tile read with the private MBTiles package, the Saturday multi-device breadcrumb scenario, and the DON-151 launch/panning slowdown after history accumulates. Fold into the next on-device session when the private package / tracking history is available. DON-159/DON-151/DON-160 stay In Review pending that team field retest.

Next: continue `DON-144` — choose the private Discovery package distribution owner/channel and lock the repeatable admin raw-source-to-package workflow.

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

- **On-device Electron smoke (incl. LIVE TRACKER):** see `SMOKE-TESTING.md` at the repo root (gitignored, local-only). It is the full runbook for smoke-testing an `electron-v*` beta on the Ubuntu box, including how the Traccar server is stored locally (`~/.config/sartracker-web/settings.json` + encrypted `secrets.json`) and how to reuse it for a live connection test. Read it before smoking a new beta.
- **Unit tests:** `npm run test`
- **E2E (standard):** `npx playwright test --project=chromium`
- **E2E (visual AI):** `npx playwright test --project=visual` then `npm run visual:review`
- **Backend/Tauri:** `npm run test:backend`
- **All:** `npm run test:all`
- **Build:** `npm run build`
- **Lint:** `npm run lint`
- **Type check:** `npx tsc --noEmit`
- **Deploy:** push to `master` → Vercel auto-deploys to production
- **Electron handoff:** see `docs/electron-beta-handoff.md`; current published Linux team prerelease is `https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.4`, and the next candidate is `electron-v0.1.0-beta.5` pending GitHub Actions + Ubuntu smoke. The Electron GitHub release workflow is implemented under `DON-143`; Windows remains gated by `DON-141`.

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
