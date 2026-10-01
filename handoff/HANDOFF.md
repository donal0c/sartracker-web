# HANDOFF.md — Current state

Updated 2026-10-01 (night). Issue order (13.6 queue): [workplan](../docs/two-track-execution-workplan.md).
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
- CI: 706a4666 green. Run 36908282541 (0e8553b3): packaged C09 failed on the
  stale "3 shown" GPX text (fixed 951ac7af). The legacy-recovery 226 ms gate
  from 36904008594 must be rechecked on the next run.
- **Local, unpushed (push after 36908282541 ends):** 6767a3c1 + 3c81eaf8 +
  71c64d4a (DON-322; the last two must go together: 3c81eaf8 alone breaks
  Archive & Lock), 8ab542cf (DON-315/316 live-recording smoke, Codex clean),
  951ac7af.

## Verification limits

- Live Traccar is verified for one approved device; everything else on the
  box uses synthetic providers. PCLinuxOS is untested (DON-298).
- Mac packaged checks today: `no-gpu-flag` mechanics (WebGL forced off, so no
  map after restart), `unwritable-profile` + `duplicate-launch` PASS, SIGTERM
  clean / SIGKILL unclean, `team-workflow` automated parts passed (4,174 fixes
  exact). The box must repeat them on the AppImage.
- The box sleeps when idle; open a Terminal for Donal's sudo password for
  `systemd-inhibit` on long runs.

## Who is doing what (1 Oct late; coordinator owns this file)

- **Coordinator:** handoff, workplan, all pushes, Mac soaks, team-smoke.
  Next: DON-317 item 4 (lived-in profiles), DON-300 item 8 + DON-319 smoke
  steps, then the packaged run of `controls`/`lifecycle`/`outage`.
- **Session 9f** (commits locally; coordinator pushes): DON-309 option A
  (event-derived retired intervals, schema 14, archive readers accept 13+14)
  implemented, running archive suites. Owns mission-store.cjs, main.cjs,
  preload.cjs, GPX runtime, `public/manual/index.html`.
- Rules: announce files before editing; one heavy run at a time.
- **When Donal frees Docker:** package once; Mac soak 3x (DON-313) and the
  team-smoke rows for tonight's fixes.

## Waiting on Donal

- Nothing open. Decided tonight: DON-318 residual accepted; DON-300 item 8
  (confirm twice, dated at confirmation); DON-309 option A (only deliberate
  imports restore; changed bytes = restore + revision; Restore list → DON-323
  backlog); DON-301 to 9f.

## Next action

- Eamonn's PCLinuxOS report: DON-318-321 (+DON-322 found). The runtime
  log holds ~7 h at his rate, so his bundle may lack the overnight event.

- Waiting on Eamonn: support bundle, Layers screenshot, Tomies Wood GPX
  (DON-319 root cause; DON-318 trigger). Skip DON-297 (Eamonn's doc),
  DON-298 (box), DON-293 (parked).
- Evidence owed at the next candidate: see the workplan list under the 13.6
  queue.
- Local evidence: `tmp/don-313-attribution/` (profiles, 960k fixture,
  benchmarks), `tmp/don-310-mac-soak/`.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
