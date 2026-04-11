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

- 2026-04-11 18:46 by Codex (M23 helicopter layer parity)

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

Completed **M23 helicopter layer parity** as a first-class mission feature:

- added persisted helicopter slot support to the TypeScript mission store boundary and Tauri SQLite mission store
- added browser-harness persistence so helicopter workflows are testable in Playwright validation mode
- added a dedicated helicopter runtime/store/bridge instead of overloading tracking
- integrated helicopter slots into the grouped layer catalog and layer visibility hydration
- added a distinct map overlay with fixed slot colors and call-sign labels
- added an operator-facing helicopter panel for slot entry/update/clear flows
- added coverage:
  - unit tests for helicopter runtime, layer catalog, mission store adapter, and browser harness persistence
  - Rust persistence CRUD test
  - Playwright spec: `tests/e2e/helicopter-panel.spec.ts`
- verification now green:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `npm run test:e2e` (full suite, including visual project)

## Active Work

- M23 is complete and validated.
- Next recommended implementation bead: **`sartracker-web-2jk.13` — M24 focus mode parity**
- Next parity verification target after that remains **Batch 5** markers (`LPV-080` to `LPV-086`)

## Open Beads That Matter Now

- `sartracker-web-2jk.14` — offline map resilience parity
- `sartracker-web-2jk.2` — replay / training mode parity
- `sartracker-web-2jk.13` — focus mode parity
- `sartracker-web-2jk.15` — final parity acceptance sweep
- `sartracker-web-2jk.16` — mock Traccar server + Glenagenty fixtures
- `sartracker-web-awm` — device markers too small on topo basemap
- `sartracker-web-bsl` — sections 13-16 not triple-verified in deep UI validation
- `sartracker-web-lo6` — intermittent OpenTopoMap degradation message

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

## Archive

- Older detailed handoff history: [handoff/archive/HANDOFF-history-2026-04-11.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/handoff/archive/HANDOFF-history-2026-04-11.md)
