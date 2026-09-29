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
**DON-291 DONE, not released.** Fix 46b0606c + smoke11c1bccc; CI36559932497
passed (6,227 tests,227 Chromium). Exact CI AppImage on Ubuntu passed48h
lookback, history outage/recovery, exact provider rows, rendered tracks and
restart; duplicate launch also passed. Synthetic provider proof, not field
acceptance; Eamonn's exact click path unconfirmed. Evidence/hashes: DON-291.
Bulky author artifacts deleted as requested; compact evidence retained in
`tmp/don291-review-evidence` and `tmp/don291-linux-evidence`. Watch remains paused.
Claude re-checked 29 Sep: AppImage hash = CI/SHA256SUMS, remote smoke tool
= master; remaining rows on the same build: bad-credential, database-refusal,
outage, coordinates, archive, settings-support PASS; lifecycle FAIL only on
known DON-283/284; unwritable-profile FAIL = known DON-285; markers-gpx and
replay-basemaps automated parts pass, manual parts not done. No new regression.
Box `~/sartracker-don291-validation-20260929/claude-smoke-1/`. The box
auto-suspends when idle (15 min); ask Donal to mask sleep targets.
**DON-283 implemented, not pushed:** bc34425e records the startup pause as a
recovery hold; recovery Resume lifts only that hold, so an operator pause
survives a crash (double crash covered). Full correctness 596 files / 6,219
passed; lint and build green; Mac package lifecycle smoke no longer reports
the pause finding (DON-284 quit marker remains). Codex review is running
(aw task fb5ef563f12c). Then: push, CI, Ubuntu lifecycle row.
**Roles (Donal, 29 Sep):** Claude orchestrates and implements; Codex reviews.
**NEXT: 1.2a**: team-mission smoke scenario and retro register (workplan).

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
