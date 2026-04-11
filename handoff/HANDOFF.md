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

- 2026-04-11 18:30 by Claude Opus (visual E2E test suite)

## Current State

- Workflow is now simplified:
  - `AGENTS.md` -> `CLAUDE.md`
  - `handoff/HANDOFF.md` = single live handoff
  - `docs/areas-to-investigate.md` = improvement queue + fixed improvement prompt
  - beads = tracked feature/bug/hardening work
- Old multi-file Codex/Claude packet handoff system has been removed.
- **Visual verification E2E test suite now in place** (see below).

## Last Work Done

Built a two-layer visual verification E2E test suite in `tests/e2e/visual/`:

- **22 new Playwright tests** across 5 spec files covering app shell, mission lifecycle, tracking, markers, and drawings
- **Layer 1**: Standard Playwright DOM assertions (element visibility, text content, state)
- **Layer 2**: Each test captures a screenshot with a verification manifest. Opus subagents independently read each screenshot and verify a numbered checklist of visual criteria.
- **Results**: All 22 Playwright tests pass. 11/11 Opus visual verifications passed (after 2 prompt iterations).
- **Real finding confirmed**: Device marker labels too small on topo basemap (independently flagged by Opus reviewer — matches existing bead `sartracker-web-awm`).
- **Zero regression**: All 55 existing E2E tests still pass. Playwright config updated with separate `chromium` (standard) and `visual` (AI-verified) projects.
- **Key files added**:
  - `tests/e2e/visual/helpers/test-setup.ts` — shared harness setup, mission lifecycle, tracking injection
  - `tests/e2e/visual/helpers/verification-manifest.ts` — parallel-safe manifest (per-entry JSON files)
  - `tests/e2e/visual/visual-app-shell.spec.ts` — 4 tests
  - `tests/e2e/visual/visual-mission-lifecycle.spec.ts` — 6 tests
  - `tests/e2e/visual/visual-tracking.spec.ts` — 4 tests
  - `tests/e2e/visual/visual-markers.spec.ts` — 4 tests
  - `tests/e2e/visual/visual-drawings.spec.ts` — 4 tests
  - `playwright.config.ts` — updated with `visual` project (1440x900 viewport, visual tests isolated)
- Full details in `CLAUDE.md` under "Visual Verification E2E Tests".

## Active Work

- Next parity verification target: **Batch 5** markers (`LPV-080` to `LPV-086`)
- Batch 4 mission lifecycle is **done-with-gap**
  - `LPV-020`..`LPV-028` = `Match`
  - `LPV-029` = open parity gap

## Open Beads That Matter Now

- `sartracker-web-2jk.14` — offline map resilience parity
- `sartracker-web-2jk.2` — replay / training mode parity
- `sartracker-web-2jk.12` — helicopter layer parity
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

1. Continue parity verification with Batch 5 markers.
2. Pick the best candidate from `docs/areas-to-investigate.md` and execute one bounded improvement.
3. Work the next highest-priority open bead.
4. Expand visual E2E tests (Wave 2: settings, diagnostics, GPX import, coordinate converter).

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
