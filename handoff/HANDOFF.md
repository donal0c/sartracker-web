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

- 2026-04-17 09:06 by Codex (daily code hardening pass; verification green)

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

**Daily code hardening pass (bounded runtime reliability cleanup)**

Implemented three low-risk improvements without changing intended operator behavior:

1. **Tracking side effects no longer flip a healthy poll into failure** — `startTrackingRuntime()` now keeps the live snapshot applied even if cache writes or mission persistence fail, and logs each failure path explicitly instead of letting the poller treat it as transport outage.
2. **Drawing deletion now follows the same explicit lifecycle as saves** — delete operations set `saving`, clear stale errors, surface delete failures back into runtime state, and always clear `saving` on exit.
3. **Runtime service startup boundary is cleaner and more testable** — `runtime-managed-services.ts` no longer reaches directly into Tauri infrastructure for tracking cache creation; the cache adapter is injected from `start-app-runtime.ts`, and the lifecycle helpers now have direct unit coverage.

Added/updated unit coverage:

- `tests/unit/start-tracking-runtime.test.ts`
- `tests/unit/start-drawing-runtime.test.ts`
- `tests/unit/runtime-managed-services.test.ts`

## Active Work

- M23 is complete and validated.
- Mock Traccar server hardened and committed (`sartracker-web-2jk.16`) — ready for integration testing.
- Daily hardening runtime cleanup is implemented locally and verified; not committed/pushed in this automation run.
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
3. Pick one bounded improvement from `docs/areas-to-investigate.md`:
   browser harness runtime duplication cleanup or browser harness store decomposition.

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
- Daily hardening pass:
  - `npm run test` -> 68 files / 325 tests passed
  - `npm run build` -> passed
  - `npx eslint` on changed files -> passed

## Archive

- Older detailed handoff history: [handoff/archive/HANDOFF-history-2026-04-11.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/handoff/archive/HANDOFF-history-2026-04-11.md)
