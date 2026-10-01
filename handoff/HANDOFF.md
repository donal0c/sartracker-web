# HANDOFF.md — Current state

Updated 2026-10-01 (evening). Issue order (13.6 queue): [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.5 published 1 Oct 2026** (controlled team beta, not for live
  incidents): tag fac5adcf, release run 36784213719, AppImage `3847d36d…94e0`,
  .deb `012ec1fe…2e61`. Six owner-approved exceptions in the note.
- 13.6 work on master since then: DON-311, DON-304, DON-310 A+B (morning);
  DON-314 e73e5734, DON-288 3f98a23f, DON-285 6dbe43d3, DON-284 + DON-285
  follow-up ee32ac32, DON-296 78b00506, DON-302 a6731ece, DON-299 class 1
  a0b8643a, DON-300 items 1/2/7 aa1ec7dc (all pushed). Each was
  Codex-reviewed and its findings were fixed.
- CI 36880796648 (ee32ac32) failed one timing test (fatal fence vs the 10 s
  startup watchdog; passes locally). Hardened in e4dfdd5c (local, not
  pushed). CI 36883863760 on aa1ec7dc is running: if green, push e4dfdd5c.
  If that test fails again, investigate before anything else.

## Verification limits

- Live Traccar is verified for one approved device; everything else on the
  box uses synthetic providers. PCLinuxOS is untested (DON-298).
- Mac packaged checks today: `no-gpu-flag` mechanics (WebGL forced off, so no
  map after restart), `unwritable-profile` + `duplicate-launch` PASS, SIGTERM
  clean / SIGKILL unclean, `team-workflow` automated parts passed (4,174 fixes
  exact). The box must repeat them on the AppImage.
- The box sleeps when idle; open a Terminal for Donal's sudo password for
  `systemd-inhibit` on long runs.

## Waiting on Donal

- **DON-313:** attribution done; plan on the ticket. Recommended: bounded
  sub-transactions with a real yield (not a worker). Also decide whether the
  960k CI fixture carries the DON-282 fence (steady-state open) with a
  separate one-time-repair row.
- **DON-309:** schema 13 → 14 for retire/restore intervals (no going back to
  13.5 with the same profile). Recommended: accept.
- **DON-300 item 8:** when a complete roster omits a group's devices, every
  member gets a durable "left" (tracking gap). Recommended: confirm absence
  over two consecutive complete rosters, one group-level notice.

## Next action

- Then DON-300 items 3-6 (layout at 1440x900), DON-301 (manual rewrite
  merge; conflicts with today's manual edits), then DON-315/316/317
  (DON-299 smoke classes). Skip DON-297 (Eamonn's doc), DON-298 (box),
  DON-293 (parked).
- Evidence owed at the next candidate: see the workplan list under the 13.6
  queue.
- Local evidence: `tmp/don-313-attribution/` (profiles, 960k fixture,
  benchmarks), `tmp/don-310-mac-soak/`.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
