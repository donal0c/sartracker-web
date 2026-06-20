# HANDOFF.md - Live Baton

> Read this before doing work. Keep it short. This is the current baton, not the project diary. Older history lives in `handoff/archive/` plus commits and Linear.

## Current State

- **Branch:** `master` is canonical and should be worked directly unless Donal says otherwise.
- **Desktop lane:** Electron is operational. Tauri remains historical/reference.
- **Hosted browser:** `https://sartracker-web.vercel.app/?missionHarness=1` is testing/training only; browser storage is not operational persistence.
- **Latest published beta:** `electron-v0.1.0-beta.7`, published 2026-06-16 after GitHub Actions run `27601812958` and deep Ubuntu smoke. Team artifact: https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.7
- **Next candidate:** beta.8. The web/browser side of the beta.8 candidate is validated; Electron packaged smoke/release is still required before sharing with testers.

## Beta.8 Candidate Status

DON-190 through DON-199 are complete, committed, pushed, and Linear-closed.

Main beta.8 batch coverage:

- DON-190 Devices workspace list/search/selection behavior.
- DON-191 Map Tools / RHS Tools consolidation.
- DON-192 Mission Control minimize behavior, helicopter move to Tools, top-panel simplification.
- DON-193 Tracking stale-state visibility and map-label readability.
- DON-194 Layer Tree and GPX readability controls.
- DON-195 Map shell scale/readability and smaller-display layout.
- DON-196 Drawing detail panel simplification and required-field emphasis.
- DON-197 Casualty terminology/order and marker map-label size.
- DON-198 Mission preview / map sharing / external-resource decisions split to DON-215-DON-218.
- DON-199 Settings/coordinator access-control decision split to DON-219-DON-221.

Additional runtime performance hardening is complete locally for the tracking/Electron data path:

- DON-165: breadcrumb accumulation now keeps per-device ordered state and appends incrementally instead of rebuilding retained history every poll.
- DON-200: tracking runtime uses an optional bulk mission-store position write; Electron persists bulk rows in one transaction while preserving raw breadcrumb mission truth and telemetry semantics.
- DON-201: Electron official-map proxy reuses readonly MBTiles readers/statements per package and closes stale handles when package metadata changes.
- DON-202: Mission Review requests a position count instead of loading every tracking row just to show breadcrumb count.

Final browser/regression gate passed after the batch:

- `npm run lint`
- `npm run build`
- `npm run test` - 152 files / 968 tests
- `npm run test:backend` - 47 passed / 1 ignored
- `npm run test:e2e:chromium` - 121/121
- `npx playwright test --project=visual` - 34/34
- `npm run visual:review -- --fail-on critical` - 39/39

The final visual gate found stale verification harness assumptions, not product regressions. Prompt/test-flow hardening was committed in `2b7765c`.

Performance batch verification snapshot:

- Red-to-green focused unit coverage for DON-165/DON-200/DON-201/DON-202: 6 files / 63 tests.
- Adjacent runtime/map/store contract units: 10 files / 74 tests.
- `npm run lint`
- `npm run test` - 152 files / 975 tests
- `npm run test:backend` - 47 passed / 1 ignored
- `npm run build`
- `npm run test:e2e:chromium` - 121/121
- `npx playwright test --project=visual` - 34/34
- `npm run visual:review -- --fail-on critical` - 39/39
- `node --check electron/main.cjs electron/preload.cjs electron/mission-store.cjs electron/official-map-proxy.cjs`
- `npm run electron:pack` - local unsigned macOS arm64 directory package, `better-sqlite3` rebuild passed.

Not done: no private Discovery MBTiles package smoke and no release publication were attempted in this batch.

## Remaining Beta.8 Gate

Do not promote beta.8 until the packaged Electron release gate passes.

Required next step once the CI-built beta.8 artifact exists:

1. Smoke the **CI-built artifact**, not a local substitute.
2. Run DON-180 duplicate-launch smoke on packaged Linux/AppImage:
   - click launcher during startup
   - click launcher again after ready
   - existing window focuses/restores
   - no second runtime/profile initializes
   - no red startup-fault shell appears
3. Run the beta smoke matrix from `CLAUDE.md`: checksum, packaged launch, mission lifecycle/restart/recovery/finalize/archive, coordinate rejection, sanitized diagnostics, live Traccar where relevant, bad/corrupt credential startup safety, duplicate launch, and any changed beta.8 surface.
4. Keep the GitHub release as draft until the packaged smoke evidence is recorded.

## Current Follow-Ups

- `DON-144` remains open: private Discovery package distribution owner/channel and repeatable raw-source-to-MBTiles admin workflow.
- `DON-214`: Search Area label positioning/zoomed-out drift follow-up.
- `DON-215`-`DON-218`: mission preview, map export/print, external-resource model, evacuation/gear workflow decisions.
- `DON-219`-`DON-221`: privileged settings guard, mission unlock authority, and access recovery.
- `DON-146` remains parked/backlog, blocked on upstream `better-sqlite3` Electron 42 compatibility.

## Traccar Test Details

- Upstream team server: `http://kmrtsar.eu:8082`
- HTTPS server: `https://kmrtsar.eu`
- Validation credentials: `sean` / `sean`
- Do not use `https://traccar.kmrtsar.eu` or port `:5055`; those are listener/non-API paths.
- Hosted browser proxy: provider base URL `https://sartracker-web.vercel.app`, endpoints `/api/session`, `/api/devices`, `/api/positions`, auth `Basic` / `apiuser` / `apiuser`.
- Desktop may use direct upstream HTTP/HTTPS; hosted browser must use the Vercel proxy.

## Useful Commands

- Unit: `npm run test`
- Backend: `npm run test:backend`
- Standard E2E: `npm run test:e2e:chromium`
- Visual E2E: `npx playwright test --project=visual`
- Visual review: `npm run visual:review -- --fail-on critical`
- Build: `npm run build`
- Lint: `npm run lint`
- Local beta gate: `npm run beta:verify`

For packaged Electron smoke details, read local `SMOKE-TESTING.md` and `docs/electron-beta-handoff.md` before starting.
