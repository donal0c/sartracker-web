# HANDOFF.md — Current state

Updated 2026-09-28 by Codex following Claude's foundation reset. Foundation
corrections are in final validation; P05 backlog reconciliation remains separate.

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

1. Crash → Archive & Lock blocked with no Admin Roster (R01, top priority).
2. Active 12.11 mission carried across upgrade shows "History incomplete" (R02).
3. Recovery Resume un-pauses a mission paused before a crash (R03; reproduced by team-smoke 2026-09-28).
4. Clean exits recorded as unexpected shutdowns: window X, and (new, team-smoke 2026-09-28) plain SIGTERM quit (R04).
5. Unwritable profile → silent exit (R04; reproduced by team-smoke).
6. Slow quit 8–15 s; first open of a ~1M-fix mission >2 min (R05).
7. Minor: malformed IPC ids reach SQLite before rejection (R06).
8. New: with WebGL unavailable (GPU blocklisted), the app shows a black window
   with no message (R08). Seen on the Ubuntu box without `--ignore-gpu-blocklist`.

## Next actions

1. Complete validation/delivery of the foundation corrections: failed-spawn
   cleanup, lost-history detection, truthful partial results and approval hashes.
2. Restore existing-area Discovery testing: retained package declares z8–16
   but contains z9–16. Confirm the tester's file identity, then validate a
   separately named metadata correction on unchanged 13.4. Broader maps stay last.
3. Orientation: rotated camera is likely; isolated library testing confirms
   compass-click resets it. Confirm on the affected installation before changing code.
4. Apply audited Linear dispositions after live checks; some old duplicates
   are already deleted. P05 is not complete.
5. R01 crash/archive recovery, then R02–R08, then maintenance beta 13.5 through
   the new checklist — its first real use.

## Verification snapshot (2026-09-28)

- Historical Ubuntu tool `eb610377` rehearsal on unchanged 13.4 caught the
  unwritable-profile and lifecycle failures. Codex inspected saved results;
  mixed-row PASS counts are not complete manual/visual proof. Outputs:
  `~/team-smoke-rehearsal-13.4/`.
- Codex: 90 focused tests passed, including red-first harness failures and
  stale approval after asset replacement. Independent source review found no
  further actionable P1/P2 findings in the corrections.
- Full correctness: 592 files / 6,178 passed / 27 existing skips. The subsequent
  participant-eligibility boundary correction passed the focused suite. Lint and
  TypeScript checks pass; corrected-tool packaged rehearsal and CI pending.

## Pointers

- Private (non-repo) release environment note — box access, fixtures, live
  config location: `~/workspace/vibes/sartracker-private/release-environment.md`.
- Post-mortem: `~/workspace/vibes/release post-mortem/` (08, 09, 10).
- History: [Codex-era handoff](archive/2026-09-27-beta13-qualification-era.md),
  [pre-reset workplan](archive/2026-09-28-pre-reset-workplan.md), `docs/archive/`.
- Linear: DON-254 (qualification), DON-255 (publication), DON-265 (programme).
