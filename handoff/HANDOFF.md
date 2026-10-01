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
- **DON-313 (evening):** history writes bounded to ≤256-fix atomic pieces;
  store queue yields between queued writes; 960k qualification separates the
  one-time upgrade repair; the soak harness counts off the app main thread
  (e3831c9d, f97c3707, 0a20c3b5, pushed). Full suite 6,353 pass. Mac soak
  launch 2 now passes; launch 1 startup catch-up still over 200 ms under VM
  contention (240-450% CPU), so a quiet-machine or box soak is owed.
- CI: run 36880796648's fatal-fence timing test hardened (e4dfdd5c); run
  36883863760's Chromium flake hardened (706a4666). Push 706a4666 started a
  new run; check it next. Mac soaks wait until Donal frees Docker.

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

- **DON-313:** approved and implemented. Owed: a soak on a quiet Mac (VM
  paused) or the box for launch 1.
- **DON-309:** schema 13 → 14 for retire/restore intervals (no going back to
  13.5 with the same profile). Recommended: accept.
- **DON-300 item 8:** when a complete roster omits a group's devices, every
  member gets a durable "left" (tracking gap). Recommended: confirm absence
  over two consecutive complete rosters, one group-level notice.

## Next action

- **Team report from Eamonn (PCLinuxOS, 1 Oct), triaged by session 9f:**
  DON-318 (Urgent, false evidence-loss block on Finish/Archive; decision
  for Donal), DON-319 (GPX not on map), DON-320 (retired GPX retried every
  rescan), DON-321 (diagnostics flooded). DON-318 is next. PCLinuxOS
  rendered the map without the GPU flag, and Discovery worked there.

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
