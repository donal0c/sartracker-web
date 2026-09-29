# HANDOFF.md — Current state

Updated 2026-09-29. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.4** is the published controlled team beta (not for live incidents);
  immutable. See its [release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- Foundation reset (P01–P05) is complete; CI 36445372627 passed.
- **DON-281 (R01)** complete on master (6a7cfd53), Linux-validated; unreleased.

## Verification limits

- DON-281: CI 36454746119 and exact-AppImage Ubuntu recovery proof (see
  DON-281). Development-package proof only, not a release.
- Crash marker "was lost" wording overstates; recorded for 1.8, needs Donal.

## Next action

**1.1 / DON-282 DONE, not released.** Fix 019ccdbe + 2a6cc03f;
CI 36474893891 passed (6,212 tests, 226 Chromium). Exact CI AppImage passed
Ubuntu profile-copy upgrade, promotion, repeated old-code rollback repair,
stable reopen and rendered warning checks. Evidence/hashes: DON-282.
Store-driven re-delivery, not live Traccar or field acceptance. Watch stopped.
**DON-291 source reviewed; Linux validation pending.** Cause
reproduced on a packaged cc480ff2 build (13.4 tracking code): the 48 h
lookback works for participants ticked before Start, but a participant added
after Start silently defaulted to "effective now", fetched no earlier history
and still showed "backfill complete". Beta 12 had no participant model.
Donal chose (29 Sep) an explicit required **History from** choice (Mission
start / Now / Custom) for late adds, plus a Start-offset notice and honest
"no earlier history requested" wording. No membership or fixTime rule changed.
team-smoke `tracking` now includes the 48 h lookback phase (mac package PASS).
Codex: 65 focused tests, 9 browser flows and 5 visual scenarios pass; captures
independently inspected. No standalone Claude visual-review receipt claimed.
CI 36559932497 passed: 6,227 tests and 227 Chromium checks. Exact CI assets
downloaded locally. Ubuntu smoke pending: host unreachable on 29 Sep
(SSH timeout then Host is down). Watch paused until machine available;
DON-291 stays In Review. Eamonn's actual click path unconfirmed.
Result: `tmp/claude-handoffs/04-mission-lookback-result.md` (original checkout).
Resume numbered queue at 1.2 / DON-283 after Codex review.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
