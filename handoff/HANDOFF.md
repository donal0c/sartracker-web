# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 145 unit files / 793 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-111 (S1 maps) — official map package coverage manifest and readiness certificate:
- New `src/features/map/official-map-manifest.ts` module: builds sanitized manifest entries, coverage checks, and readiness certificates from package settings.
- Settings UI upgraded: each package now shows a full manifest card (map type, zoom range, tile count, size, bounds, timestamps, status).
- Coverage check button per package: compares current map viewport against package bounds, shows success/danger result inline.
- Export Readiness Certificate button: generates a sanitized text report suitable for sharing or pre-mission checks. No paths, credentials, or source URLs leak.
- Diagnostics support report already includes safe package metadata (from DON-110).
- 32 new unit tests covering manifest building, bounds formatting, coverage inside/outside/unknown, certificate generation, and sanitization.
- Browser-validated: coverage check works for both inside (Kerry) and outside (Dublin) cases.

## What's Next

Next S1 map task after DON-111 is `DON-114` (field-ready official map checklist and operator manual updates) and `DON-115` (cross-platform official map import release smoke). S2 Electron remains `DON-29`.

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

- `npm run test` — 145 files, 793 tests passed
- `npm run lint` — clean
- `npm run build` — bundle budgets passed
- `npx tsc --noEmit` — clean
- `npm run test:backend` — 46 passed
- `npx playwright test --project=chromium` — 104 passed (1 pre-existing flake: breadcrumb trail mode)
- Browser validation: manifest card rendering, coverage check inside/outside, certificate export — `output/don-111/`

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
