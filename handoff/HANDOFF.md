# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 146 unit files / 824 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-115 (S1 maps/S2 Electron) — cross-platform official map import release smoke, partial:
- macOS packaged Electron smoke passed with the private Reeks/West Kerry Discovery MBTiles package, renderer network blocked, local official tile read, inside/outside coverage checks, field-readiness checklist, Settings package status, and sanitized diagnostics export.
- Ubuntu 24.04 Dell packaged Electron smoke passed from a fresh Linux-built package on the active Wayland desktop with `--no-sandbox`: local official tile read, network-blocked Discovery rendering, inside/outside coverage checks, field-readiness checklist, Settings package status, and sanitized diagnostics export.
- Linux artifacts from Ubuntu build: AppImage SHA256 `1ae8667f7d74eba9204162b9b91ac46defd7bb07a6c19d2381d60da0b55a2d07`; `.deb` SHA256 `20f3660a7b8ccc67cfbdd7c4d239e111a21c5c94517f39fd8e89928f5697c8ae`.
- Evidence is local only under `tmp/don115-macos-official-map-offline/` and `tmp/don115-linux-official-map-offline/`; do not commit private map packages or screenshots unless explicitly sanitized for sharing.

## What's Next

Finish `DON-115` with the Windows laptop smoke: build/install Windows Electron package, import the same private Discovery package through the UI, block network, prove inside/outside readiness, and export sanitized diagnostics. `DON-113` remains useful admin/back-office package preparation work, but it is not blocking the operator import/readiness release gate.

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
- **Desktop beta:** tag `v*` → GitHub Actions release workflow → draft prerelease

## Latest Verification

- macOS DON-115: `npm run electron:pack -- --mac --arm64` passed; `npm run electron:smoke:official-offline -- --app tmp/electron-dist/mac-arm64/SAR\ Tracker\ Electron\ Validation.app/Contents/MacOS/SAR\ Tracker\ Electron\ Validation --package <private Reeks MBTiles> --evidence-dir tmp/don115-macos-official-map-offline --platform darwin` passed.
- Ubuntu DON-115: synced current repo to `donal@192.168.18.31:~/sartracker-don115-validation/repo`, ran `npm ci`, `npm run electron:dist:linux`, focused readiness unit tests, and `npm run electron:smoke:official-offline -- --app tmp/electron-dist/linux-unpacked/sartracker-web --package <private Reeks MBTiles> --evidence-dir tmp/don115-linux-official-map-offline --platform linux --app-arg --no-sandbox --app-arg --ozone-platform=wayland --app-arg --ignore-gpu-blocklist`.
- Ubuntu focused tests: `npm run test -- tests/unit/field-readiness-checklist.test.ts tests/unit/basemap-switcher.test.ts` — 24 passed.

## Known Limits

- Browser mode is not durable for live incidents (no IndexedDB persistence, no filesystem).
- Electron desktop is the operational lane (SQLite, filesystem, diagnostics, GPX, offline maps).
- High-definition maps are local desktop packages only.
- Pre-existing flake: `devices-workspace.spec.ts` breadcrumb trail mode test intermittently fails on map layer state assertions.

## Active Linear Parents

`DON-5` (parity), `DON-7` (S1 maps), `DON-25` (S2 Electron), `DON-76` (official maps).

## Planning Docs

- `docs/two-track-execution-workplan.md` — canonical queue
- `docs/desktop-runtime-support-policy.md` — Electron runtime support, update cadence, release channels, diagnostics, rollback (DON-30)
- `docs/hosted-browser-testing-plan.md` — deployment strategy
- `docs/team-testing-feedback-loop.md` — tester instructions
