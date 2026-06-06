# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 144 unit files / 756 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-109 (S1 maps) — Electron Settings now has a self-service official-map setup path:
- `Choose MapGenie File` selects the local source details `.txt` through a narrow Electron dialog bridge.
- `Add Discovery Package` selects an existing `.mbtiles` package from disk/USB and shows it as pending until Settings save.
- Save reuses the existing Electron official-map registry to validate the package and return ready/missing/unreadable metadata.
- Hosted/browser mode remains public-map-only; the Electron-only import buttons are not exposed there.
- Operator manual and `docs/two-track-execution-workplan.md` are updated.

## What's Next

Next S1 map task is `DON-110`: copy imported official map packages into app-owned storage so the USB can be unplugged, with disk preflight, replace/remove, duplicate handling, and safe diagnostics. S2 Electron remains `DON-29`.

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

- `npx vitest run tests/unit/settings-workspace.test.ts tests/unit/electron-file-system.test.ts tests/unit/electron-settings-store.test.ts tests/unit/electron-official-map-proxy.test.ts tests/unit/map-config.test.ts tests/unit/offline-map-readiness.test.ts tests/unit/diagnostics-model.test.ts`
- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run test:backend`
- Playwright browser proof: `output/playwright/don-109/01-browser-settings-official-maps.png` and `browser-validation.json`
- Electron CDP proof: `output/playwright/don-109/02-electron-settings-official-map-import-controls.png` and `electron-validation.json`

## Known Limits

- Browser mode is not durable for live incidents (no IndexedDB persistence, no filesystem).
- Desktop/Tauri is the operational lane (SQLite, filesystem, diagnostics, GPX, offline maps).
- High-definition maps are local desktop packages only.
- Pre-existing flake: `devices-workspace.spec.ts` breadcrumb trail mode test intermittently fails on map layer state assertions.

## Active Linear Parents

`DON-5` (parity), `DON-7` (S1 maps), `DON-25` (S2 Electron), `DON-76` (official maps).

## Planning Docs

- `docs/two-track-execution-workplan.md` — canonical queue
- `docs/hosted-browser-testing-plan.md` — deployment strategy
- `docs/team-testing-feedback-loop.md` — tester instructions
