# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Current State

- **Branch:** `master` is the canonical working branch.
- **Hosted testing:** `https://sartracker-web.vercel.app/?missionHarness=1`
- **Desktop:** Electron validation shell present (MapLibre + direct HTTPS Traccar). Tauri desktop routes Traccar through Rust `reqwest`.
- **Browser mode:** testing/training only (sessionStorage, not operational persistence).
- **Latest test counts:** 144 unit files / 754 tests; ~105 Playwright E2E; 46 backend tests.

## Last Work Done

DON-117 (6-6-26 feedback batch) — actionable immediate children DON-118 through DON-133 are now Done; coordinator-confirmation items DON-134 through DON-140 remain Backlog:
- DON-132: Layer workspace fills available RHS vertical space
- DON-129: Manual range rings require explicit radius
- DON-126: Breadcrumb dot density and size improvements
- DON-121: Per-measurement visibility in layer tree
- **DON-133**: Reworked Focus Mode — compact auto-collapsed Mission Control with inline safety controls + full tabbed workspace (Tracking/Tools/Layers) defaulting to Layers tab
- **DON-125**: Redesigned Devices workspace — 6 filter tabs (Devices/Active/Hidden/Online/Stale/NoFix) with counts, full-height scrollable device list, unified single-list design

## What's Next

Query Linear for current work. DON-117 is fully complete. Check children of `DON-7` (S1 maps), `DON-25` (S2 Electron), or `DON-5` (parity) for next streams.

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
