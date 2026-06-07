# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 146 unit files / 824 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-114 (S1 maps) — field-ready official map checklist and operator manual updates:
- Maps menu now includes a consolidated field-readiness checklist for official maps: package registered, current view covered, fallback source status, and last verified timestamp.
- Checklist gives clear `Field ready`, `Partially ready`, or `Not field ready` language before operators rely on offline Discovery maps.
- Operator manual now covers the fresh Electron install to offline Discovery readiness flow, package choices, app-owned storage, hosted-web public-map-only limits, certificate export, and troubleshooting without private paths or secrets.
- Unit coverage added for ready, missing, invalid, public fallback, outside-bounds, no-bounds, source fallback, and verification timestamp states.

## What's Next

Next S1 map task: `DON-115` (cross-platform official map import release smoke). `DON-113` remains useful admin/back-office package preparation work, but it is not blocking the operator import/readiness release gate. S2 Electron: `DON-29` (runtime decision checkpoint) is Done — Electron confirmed as production shell. `DON-30` (ongoing support policy) is Done — policy at `docs/desktop-runtime-support-policy.md`.

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

- `npm run test -- tests/unit/field-readiness-checklist.test.ts tests/unit/basemap-switcher.test.ts` — 2 files / 24 tests passed
- `npm run test` — 146 files / 824 tests passed
- `npm run lint` — clean
- `npm run build` — bundle budgets passed
- `npx tsc --noEmit` — clean
- `npm run test:backend` — 46 passed / 1 ignored
- `npx playwright test tests/e2e/map.spec.ts --project=chromium` — 13 passed

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
