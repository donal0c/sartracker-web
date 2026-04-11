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

- 2026-04-11 19:35 by Codex

## Current State

- Workflow is now simplified:
  - `AGENTS.md` -> `CLAUDE.md`
  - `handoff/HANDOFF.md` = single live handoff
  - `docs/areas-to-investigate.md` = improvement queue + fixed improvement prompt
  - beads = tracked feature/bug/hardening work
- Old multi-file Codex/Claude packet handoff system has been removed.

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

## Archive

- Older detailed handoff history: [handoff/archive/HANDOFF-history-2026-04-11.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/handoff/archive/HANDOFF-history-2026-04-11.md)
