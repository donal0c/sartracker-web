# HANDOFF.md — Current state

Updated 2026-09-28. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.4** is the published controlled team beta (not for live incidents);
  immutable. See its [release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- Foundation reset (P01–P05) is complete; CI 36445372627 passed.
- **DON-281 (R01)** is complete on master (fix 6a7cfd53), independently
  validated on Linux. It is not in any release.

## Verification limits

- DON-281: CI 36454746119 passed on 77e300e7 (6,208 tests, 226 Chromium).
  Exact CI AppImage passed Ubuntu crash → roster Settings → acknowledge →
  archive → restart; audit and warning retained. Evidence/hashes: DON-281.
  This is development-package proof, not a new release or field acceptance.
- The outbox durability defect is not established. The crash marker is written
  for every open mission; its "was lost" wording overstates that. This is a
  recorded finding: do not change it without Donal.

## Next action

DON-281 is closed; its watch is stopped. Next queued slice is R02 / DON-282
(legacy upgrade coverage), following the workplan. No next slice started.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
