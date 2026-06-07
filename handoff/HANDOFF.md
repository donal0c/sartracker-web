# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 146 unit files / 824 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-142 (S2 Electron/S1 maps) — Electron beta handoff release and Discovery map loading instructions:
- Added `docs/electron-beta-handoff.md` as the active runbook for the current Electron app handoff, Discovery package loading, offline confidence checks, diagnostics, and private-data rules.
- Updated `docs/releases/README.md` and `docs/releases/TEMPLATE.md` so future agents do not follow the obsolete Tauri beta path for Electron handoff.
- Created local interim artifact bundle under `tmp/don142-electron-handoff/` with Linux AppImage, Linux `.deb`, macOS arm64 zip, and `SHA256SUMS`. These are not committed.

## What's Next

Decide whether to share the current Linux/macOS interim validation artifacts directly or wait for `DON-141` Windows smoke before publishing a GitHub draft/prerelease. Finish `DON-115` with the Windows laptop smoke before claiming full cross-platform official-map handoff readiness. `DON-113` remains useful admin/back-office package preparation work, but it is not blocking the operator import/readiness release gate.

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
- **Electron handoff:** see `docs/electron-beta-handoff.md`; current GitHub release workflow is Tauri-era and must not be used for Electron artifacts until migrated.

## Latest Verification

- macOS DON-115: `npm run electron:pack -- --mac --arm64` passed; `npm run electron:smoke:official-offline -- --app tmp/electron-dist/mac-arm64/SAR\ Tracker\ Electron\ Validation.app/Contents/MacOS/SAR\ Tracker\ Electron\ Validation --package <private Reeks MBTiles> --evidence-dir tmp/don115-macos-official-map-offline --platform darwin` passed.
- Ubuntu DON-115: synced current repo to `donal@192.168.18.31:~/sartracker-don115-validation/repo`, ran `npm ci`, `npm run electron:dist:linux`, focused readiness unit tests, and `npm run electron:smoke:official-offline -- --app tmp/electron-dist/linux-unpacked/sartracker-web --package <private Reeks MBTiles> --evidence-dir tmp/don115-linux-official-map-offline --platform linux --app-arg --no-sandbox --app-arg --ozone-platform=wayland --app-arg --ignore-gpu-blocklist`.
- Ubuntu focused tests: `npm run test -- tests/unit/field-readiness-checklist.test.ts tests/unit/basemap-switcher.test.ts` — 24 passed.
- DON-142 artifact bundle: `tmp/don142-electron-handoff/SHA256SUMS` generated for Linux AppImage, Linux `.deb`, and macOS arm64 zip.

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
