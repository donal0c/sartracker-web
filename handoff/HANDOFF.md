# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 144 unit files / 761 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-110 (S1 maps) — official map packages now import into app-owned Electron storage:
- `Add Discovery Package` copies selected `.mbtiles` files into `userData/official-map-packages/` before registration.
- Import preflights disk space, dedupes/replaces by map id, and returns only safe copy metadata to the renderer.
- Settings save validates the copied package and records safe metadata including package size, not private paths in diagnostics.
- Settings can remove a registered package; app-owned files removed from saved settings are cleaned up by the Electron settings store.
- Browser/hosted mode remains public-map-only; Electron validation proved the original source package can be removed after import while the copied package stays ready.

## What's Next

Next S1 map task is `DON-111`: official map package coverage manifest and readiness certificate. S2 Electron remains `DON-29`.

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

- `npx vitest run tests/unit/electron-file-system.test.ts tests/unit/settings-workspace.test.ts tests/unit/electron-settings-store.test.ts tests/unit/electron-runtime-files.test.ts tests/unit/diagnostics-model.test.ts`
- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run test:backend`
- Playwright browser proof: `output/playwright/don-110/01-browser-settings-official-maps.png` and `browser-validation.json`
- Electron CDP proof: `output/playwright/don-110/02-electron-settings-app-owned-package.png` and `electron-validation.json`

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
