# HANDOFF.md — Live Baton

> Read this before doing any work. Update it after every meaningful chunk of work.

## How To Use This File

- Keep this file short.
- This is the live baton, not the full project diary.
- Beads are the task tracker.
- `docs/areas-to-investigate.md` is the rolling improvement queue.
- If parity evidence changes, update the parity docs and summarize the outcome here.
- Put older detailed history in `handoff/archive/`, not here.

## Last Updated

- 2026-04-12 09:00 by Claude Opus (mock-traccar hardening: sartracker-web-2jk.16)

## Current State

- Workflow is now simplified:
  - `AGENTS.md` -> `CLAUDE.md`
  - `handoff/HANDOFF.md` = single live handoff
  - `docs/areas-to-investigate.md` = improvement queue + fixed improvement prompt
  - beads = tracked feature/bug/hardening work
- Old multi-file Codex/Claude packet handoff system has been removed.
- **Visual verification E2E test suite now in place** (see below).
- **M23 helicopter layer parity is now complete** across Tauri persistence, browser harness, layer catalog, map overlay, operator panel, and Playwright validation.

## Last Work Done

**sartracker-web-2jk.16 — Mock Traccar server hardening (5 fixes)**

Fixed 5 issues found during the fitness review of `tools/mock-traccar/`:

1. **`/health` endpoint now public** — moved before auth middleware in router.ts
2. **Offline devices excluded from `/api/positions`** — roster status check filters offline devices from current-position response, matching real Traccar behavior
3. **Deterministic route generation** — replaced `Math.random()` with seeded mulberry32 PRNG; same seed always produces identical routes across runs
4. **Timestamp spacing independent of playback speed** — `getScenarioDate()` no longer divides by speed multiplier; breadcrumb gap segmentation (5-min threshold) and stale detection now work correctly at any playback speed
5. **Team Delta timing aligned** — `goUnknownAfterMs` set to `39 × 30_000` (1,170,000ms) matching the actual last route point; `computeDeviceStatus` now triggers correctly

Added `tests/unit/mock-traccar-hardening.test.ts` (16 tests) covering all 5 fixes.

Verification green: lint, 320 unit tests (67 files), build, 78 E2E tests (55 chromium + 22 visual + 1 full-mission)

## Active Work

- M23 is complete and validated.
- Mock Traccar server hardened (`sartracker-web-2jk.16`) — ready for integration testing.
- Next recommended implementation bead: **`sartracker-web-2jk.13` — M24 focus mode parity**
- Next parity verification target after that remains **Batch 5** markers (`LPV-080` to `LPV-086`)

## Open Beads That Matter Now

- `sartracker-web-2jk.14` — offline map resilience parity
- `sartracker-web-2jk.2` — replay / training mode parity
- `sartracker-web-2jk.13` — focus mode parity
- `sartracker-web-2jk.15` — final parity acceptance sweep
- `sartracker-web-2jk.16` — mock Traccar server + Glenagenty fixtures
- `sartracker-web-bsl` — sections 13-16 not triple-verified in deep UI validation

## Known Parity Gaps

- `LPV-029` — mission metadata/coordinator dialog missing in mission-start flow
- `LPV-061` — layer tree type filter missing
- `LPV-068` — layer tree context menu actions missing
- `LPV-069` — bulk layer actions / tracking protections missing

## Next Actions

Choose one path and update this file when done:

1. Start **M24 focus mode parity** as the next clean implementation bead.
2. Continue parity verification with Batch 5 markers.
3. Pick one bounded improvement from `docs/areas-to-investigate.md`.

## Verification Snapshot

- Verified parity batches:
  - Batch 1 visibility: complete
  - Batch 2 layer tree/console: complete with 3 known gaps
  - Batch 3 tracking/devices: complete
  - Batch 4 mission lifecycle: complete with 1 known gap
- Not yet parity-verified:
  - Batch 5 markers
  - Batch 6 drawings
  - Batch 7 measurements/coordinates
  - Batch 8 review/settings/diagnostics
  - Batch 9 GPX/helicopters/structure
- Visual E2E test suite:
  - 22 Playwright tests: all green
  - 55 existing E2E tests: all green (zero regression)
  - Opus visual verification: 11/11 passed
  - Coverage: app shell, mission lifecycle (6 states), tracking (panel + map + layers), markers (4 types), drawings (4 tools + multi-drawing)
- Mock Traccar server:
  - 16 unit tests covering all 5 hardening fixes
  - Manual curl verification: /health public, offline filtering, auth gates

## Archive

- Older detailed handoff history: [handoff/archive/HANDOFF-history-2026-04-11.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/handoff/archive/HANDOFF-history-2026-04-11.md)
