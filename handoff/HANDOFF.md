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

1. Crash → Archive & Lock blocked with no Admin Roster (DON-281): fixed on
   master, awaiting Codex validation; not in any release yet.
2. Active 12.11 mission carried across upgrade shows "History incomplete" (DON-282).
3. Recovery Resume un-pauses a mission paused before a crash (DON-283).
4. Clean exits recorded as unexpected shutdowns: window X and SIGTERM (DON-284).
5. Unwritable profile → silent exit (DON-285).
6. Slow quit/cold ~1M-fix open and native startup limitations (DON-286).
7. Minor: malformed IPC ids reach SQLite before rejection (DON-287).
8. New: with WebGL unavailable (GPU blocklisted), the app shows a black window
   with no message (DON-288), without `--ignore-gpu-blocklist`.

## Next actions

1. Codex: validate DON-281 (result note `tmp/claude-handoffs/02-archive-recovery-result.md`
   in the original checkout). Empty roster now routes to Settings → Admin roster
   and back to the same decision; authority, warning and Complete/100% block
   unchanged. Outbox-durability hypothesis not supported (see note); crash
   marker is written for every open mission even with nothing pending, and its
   "was lost" copy overstates that — separate decision, not changed here.
2. Restore existing-area Discovery testing: retained package declares z8–16
   but contains z9–16. Confirm the tester's file identity, then validate a
   separately named metadata correction on unchanged 13.4. Broader maps stay last.
3. Orientation: rotated camera is likely; isolated library testing confirms
   compass-click resets it. Confirm on the affected installation before changing code.
4. Next product slices: DON-283, DON-284. PR5 residual triage is DON-289;
   maintenance checkpoint DON-290. Broader maps stay last.
5. P05 reconciled; 254/265 Done means controlled-beta delivery only.

## Verification snapshot (2026-09-28)

- Foundation: Linux CI 36445372627 on be5fc69f passed (6,197 tests; 225
  Chromium preflight; packaged checks). Smoke tool 7173c301 on installed 13.4:
  tracking and outage PASS, lifecycle FAIL for DON-283/284; results in
  `~/team-smoke-codex-foundation-final-20260928/`. Mixed rows stay NOT TESTED.
- DON-281 (local, not CI): correctness 593 files / 6,191 passed / 27 skips;
  lint, types, bundle budget; 32 Chromium e2e; local macOS pack crash →
  archive → roster → acknowledge → archive → restart probe PASS. Settings
  is now a lazy chunk (main chunk had 20 bytes of budget headroom).

## Pointers

- Private environment/fixtures: `~/workspace/vibes/sartracker-private/release-environment.md`.
- Post-mortem: `~/workspace/vibes/release post-mortem/` (08, 09, 10).
- History: [Codex-era handoff](archive/2026-09-27-beta13-qualification-era.md),
  [pre-reset workplan](archive/2026-09-28-pre-reset-workplan.md), `docs/archive/`.
- Linear: DON-254 (qualification), DON-255 (publication), DON-265 (programme).
