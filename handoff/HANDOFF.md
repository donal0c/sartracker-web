# HANDOFF.md — Current state

Updated 2026-09-28 by Codex following Claude's foundation reset. Source pushed
through be5fc69f; final CI passed. Foundation P01–P05 is complete.

## Release state

- **beta.13.4 is published** to the team as a controlled test build (not for
  live incidents). Tag `electron-v0.1.0-beta.13.4` → `a273ae6d`; CI run
  36319976860; `.deb` `804aa08f…1891`, AppImage `466ce20d…41fc`. Published
  manually with Donal's approved soak deviation. [Release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- The only release gate is now [docs/release-checklist.md](../docs/release-checklist.md):
  one table of 22 checks on the exact CI artifact, severity decided in advance,
  owner exceptions bound to tag and approved artifact hashes, no rebuild after
  a failure without Donal.
- The guarded publisher enforces that checklist (`--check-notes` validates a
  note offline). Mixed automated/manual rows remain NOT TESTED until their
  required human checks are recorded.
- Qualification campaign: not a release gate (Donal, 2026-09-27). Its
  control-plane CLI and npm commands are removed; its packaged probes still run
  in CI. Retain the intertwined library for now; later extraction can simplify
  it without dropping working regression checks.

## Known issues in 13.4 (fix order = workplan stage 2)

1. Crash → Archive & Lock blocked with no Admin Roster (DON-281; next).
2. Active 12.11 mission carried across upgrade shows "History incomplete" (DON-282).
3. Recovery Resume un-pauses a mission paused before a crash (DON-283).
4. Clean exits recorded as unexpected shutdowns: window X and SIGTERM (DON-284).
5. Unwritable profile → silent exit (DON-285).
6. Slow quit/cold ~1M-fix open and native startup limitations (DON-286).
7. Minor: malformed IPC ids reach SQLite before rejection (DON-287).
8. New: with WebGL unavailable (GPU blocklisted), the app shows a black window
   with no message (DON-288), without `--ignore-gpu-blocklist`.

## Next actions

1. Foundation complete: CI 36445372627 passed on be5fc69f. Next product slice is
   DON-281; new working-tree product edits are not covered by this CI result.
2. Restore existing-area Discovery testing: retained package declares z8–16
   but contains z9–16. Confirm the tester's file identity, then validate a
   separately named metadata correction on unchanged 13.4. Broader maps stay last.
3. Orientation: rotated camera is likely; isolated library testing confirms
   compass-click resets it. Confirm on the affected installation before changing code.
4. Claude's next bounded slice is DON-281 crash/archive recovery. PR5 residual
   triage is DON-289; maintenance checkpoint DON-290. Broader maps stay last.
5. P05 is reconciled: 239 Done; 8 superseded by 278; 11/13/14 canceled for
   obsolete scope. 254/265 Done means controlled-beta delivery, not matrix or
   operational acceptance. Archived duplicates and original history preserved.

## Verification snapshot (2026-09-28)

- Claude's earlier 13.4 rehearsal caught unwritable-profile and lifecycle
  failures; its mixed-row PASS counts are not complete manual/visual proof.
- Codex: 90 focused tests passed, including red-first harness failures and
  stale approval after asset replacement. Independent source review found no
  further actionable P1/P2 findings in the corrections.
- Full correctness: 592 files / 6,178 passed / 27 existing skips. The subsequent
  participant-eligibility boundary correction passed the focused suite. Lint and
  TypeScript checks pass. Final Linux CI on be5fc69f passed all jobs: 592 test
  files, 6,197 tests passed / 10 skipped; 225 Chromium preflight tests passed,
  plus targeted browser, WAR-02B and packaged checks. This validates foundation
  source, not later product edits or operational acceptance.
- Clean smoke tool 7173c301 on unchanged installed 13.4: exact tracking PASS
  (27 fixes), 90 s outage/backfill PASS (45 fixes), lifecycle FAIL for DON-283/284
  with histories still gap-free. Saved results: `~/team-smoke-codex-foundation-final-20260928/`.
  Earlier mixed GPX/replay rows remain NOT TESTED for missing human checks.

## Pointers

- Private environment/fixtures: `~/workspace/vibes/sartracker-private/release-environment.md`.
- Post-mortem: `~/workspace/vibes/release post-mortem/` (08, 09, 10).
- History: [Codex-era handoff](archive/2026-09-27-beta13-qualification-era.md),
  [pre-reset workplan](archive/2026-09-28-pre-reset-workplan.md), `docs/archive/`.
- Linear: DON-254 (qualification), DON-255 (publication), DON-265 (programme).
