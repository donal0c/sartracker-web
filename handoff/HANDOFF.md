# HANDOFF.md — Current state

Updated 2026-09-28. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
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
Next numbered slice: 1.2 / DON-283. Before its handover, triage DON-291's new
48-hour lookback report for priority as recorded in the workplan. Neither started.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
