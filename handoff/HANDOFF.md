# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 145 unit files / 804 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-112 (S1 maps) — official map package choice guardrails:
- New `classifyPackageCategory()` in `src/features/map/official-map-manifest.ts`: classifies packages as Standard (< 2 GB, recommended), Mission Area (2–4 GB), or National (> 4 GB, admin-prepared).
- Settings UI shows a colour-coded category badge on each package manifest card (emerald/sky/amber).
- National packages show a persistent amber warning panel with admin preparation guidance.
- Standard packages show "Recommended for most operations" guidance.
- Mission-area packages show "verify coverage matches the intended search area" guidance.
- Section description updated to recommend the standard Kerry/West package first.
- Operator manual updated with package category policy.
- 11 new unit tests for category classification thresholds and guidance content.
- E2E-validated: all three badges and guidance/warning panels render correctly in browser mode.

## What's Next

Next S1 map tasks: `DON-114` (field-ready official map checklist and operator manual updates) and `DON-115` (cross-platform official map import release smoke). S2 Electron: `DON-29` (runtime decision checkpoint) is Done — Electron confirmed as production shell. `DON-30` (ongoing support policy) is Done — policy at `docs/desktop-runtime-support-policy.md`.

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
- `docs/desktop-runtime-support-policy.md` — Electron runtime support, update cadence, release channels, diagnostics, rollback (DON-30)
- `docs/hosted-browser-testing-plan.md` — deployment strategy
- `docs/team-testing-feedback-loop.md` — tester instructions
