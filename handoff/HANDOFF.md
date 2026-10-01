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
- CI: 706a4666 green. Run 36904008594 (965e96e4) failed one packaged timing
  gate (legacy-recovery first open 226 ms vs 200; no open-path change in the
  delta): if 36908282541 repeats it, investigate before anything else.

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

- **Coordinator:** handoff, workplan, all pushes, Mac soaks; now DON-315/316/
  317 (team-smoke additions, incl. DON-300 item 8 and DON-319 steps).
- **Session 9f** (commits locally; coordinator pushes): recapture GPX panel
  shots, then DON-322, then DON-309 (schema 14). Owns mission-store.cjs,
  main.cjs, preload.cjs, GPX runtime, `public/manual/index.html`.
- Pushed tonight (0e8553b3): DON-314/288/285/284/313/296/302/299c1/300/
  318/319/320/321, DON-301 manual rewrite. CI run 36908282541 covers all.
- Rules: announce files before editing; one heavy run at a time.
- **When Donal frees Docker:** package once; Mac soak 3x (DON-313) and the
  team-smoke rows for tonight's fixes.

## Waiting on Donal

- Nothing open. Decided tonight: DON-318 residual accepted; DON-300 item 8
  (confirm twice, dated at confirmation); DON-309 schema 14 accepted;
  DON-301 to 9f.

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
