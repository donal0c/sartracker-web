# HANDOFF.md — Current state

Updated 2026-09-28 by Claude (foundation reset, stage 1 P01–P05). Awaiting
Codex validation before stage 2 (R01) starts.

## Release state

- **beta.13.4 is published** to the team as a controlled test build (not for
  live incidents). Tag `electron-v0.1.0-beta.13.4` → `a273ae6d`; CI run
  36319976860; `.deb` `804aa08f…1891`, AppImage `466ce20d…41fc`. Published
  manually with Donal's approved soak deviation. [Release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- The only release gate is now [docs/release-checklist.md](../docs/release-checklist.md):
  one table of 22 checks on the exact CI artifact, severity decided in advance,
  owner exceptions bound to the tag, no rebuild after a failure without Donal.
- The guarded publisher enforces that checklist (`--check-notes` validates a
  note offline). `scripts/team-smoke/` automates 16 of the checks.
- Qualification campaign: not a release gate (Donal, 2026-09-27). Its
  control-plane CLI and npm commands are removed; its packaged probes still run
  in CI. **Open decision for Donal:** delete the remaining campaign code (see
  the reset report) or keep it dormant.

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

1. Codex validates the reset (report: `tmp/claude-handoffs/01-foundation-reset-result.md`
   in the original checkout).
2. Apply the Linear changes listed in that report (no Linear access in the
   Claude session).
3. R01 crash/archive recovery, then R02–R08, then maintenance beta 13.5 through
   the new checklist — its first real use.

## Verification snapshot (2026-09-28)

- Team-smoke rehearsal on unchanged 13.4 bytes (Ubuntu 24.04, installed `.deb`,
  `--ignore-gpu-blocklist`, tool `eb610377`): 13 PASS, 2 FAIL (unwritable
  profile; lifecycle: issues 3 and 4), 7 NOT TESTED by design (manual rows).
  Outputs on the box: `~/team-smoke-rehearsal-13.4/`.
- Publisher: 40 unit tests, including exception acceptance/rejection.
- Full correctness suite and lint: see the reset report for the final run.

## Pointers

- Private (non-repo) release environment note — box access, fixtures, live
  config location: `~/workspace/vibes/sartracker-private/release-environment.md`.
- Post-mortem: `~/workspace/vibes/release post-mortem/` (08, 09, 10).
- History: [Codex-era handoff](archive/2026-09-27-beta13-qualification-era.md),
  [pre-reset workplan](archive/2026-09-28-pre-reset-workplan.md), `docs/archive/`.
- Linear: DON-254 (qualification), DON-255 (publication), DON-265 (programme).
