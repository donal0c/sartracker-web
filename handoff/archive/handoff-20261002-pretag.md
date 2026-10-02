# HANDOFF.md — Current state

Updated 2026-10-02 (afternoon). Issue order (13.6 queue): [workplan](../docs/two-track-execution-workplan.md).
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
- Pushed tonight after 0e8553b3: DON-322, DON-309 (schema 14, 2d3f784c),
  DON-315/316/317 smoke, DON-300 items 5 (fold sections, 60204b3a) and 8
  smoke, DON-319 smoke, lived-in profiles. 60204b3a failed CI on Linux
  layout (wrapped summary, scroll offset); fixed c5fe9772, CI 36975711300
  green. 2 Oct: DON-312 step 1 sampler 3e257710, DON-321 smoke d6399660.
- Linear audited 2 Oct: fixed-with-evidence-owed issues are In Review.
- **Box pre-tag run, 2 Oct** (13.6 code, version still says 13.5; evidence in
  `~/sartracker-13.6-smoke/` on the box). Build fc731f1e: custody, DON-285,
  DON-288, lifecycle, tracking, outage, controls, upgrade 13.5->14, archive,
  coordinates, settings, crash-archive, offline-map, replay-basemaps, 960k
  open all PASS (some after a test-tool fix). **Block found: DON-300 item 8**
  (one roster fetch counted twice -> false leave, lost fixes) -> fixed
  3b6d9272; DON-321 burst fixed 1421c326. Rebuilt e7a7a0f8 (CI 37001809472
  green): team-workflow (item 8 PASS), team-mission, tracking, lifecycle,
  outage re-run clean. Hand checks done: picker + watched-folder draw,
  window X, F11. Soak (old build): data exact; stalls 295/358 ms and 2.22 GB
  -> DON-312/313 stay 13.7 (9f plan on tickets).
- **Next:** Donal's go to tag 13.6 (version bump); then identity rows +
  short smoke on the tagged artifact; note draft `docs/releases/beta.13.6.md`.

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
  Next: first packaged run of tonight's smoke changes (needs Docker/box).
- **Session 9f** (commits locally; coordinator pushes): standing by. Owns mission-store.cjs, main.cjs,
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
