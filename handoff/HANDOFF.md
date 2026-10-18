# HANDOFF.md — Current state

Updated 2026-10-18 (PR #60 merged; checkpoint worker dropped; DON-336 log retention). Queue: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md). Earlier detail:
[archive/handoff-20261002-pretag.md](archive/handoff-20261002-pretag.md).

## Status

- **beta.13.5 published 1 Oct 2026** (controlled team beta).
- **beta.13.6 published 2 Oct 2026** (prerelease): tag 01c43873, run
  37011458608, AppImage `38568d4f…0b0a`, .deb `907b1129…0010`. Every check
  PASS on the installed draft (box) incl. live Traccar and 960k open; hand
  checks (window X, F11, GPX picker/watch/rescan) by Donal. One exception
  (Donal): installed soak limits, data exact; stalls 329/516 ms, 2.27 GB
  [DON-312/313, 13.7]. Box evidence: `~/sartracker-13.6-smoke/out/f-*, g-*`.

## Next action

1. 13.7 landed on master (not released): DON-330 group refresh c8cfbf35,
   DON-328 marker at newest fix 9ec0011c (Donal approved 4 Oct; stale flag kept
   from the position; list/readout follow-up 18580e93), DON-327 warning codes
   7a5b2325. New smoke checks a648b22c PASS on a local macOS package (4 Oct:
   team-group-refresh 82 s, tracking 305 s); Linux 13.7 candidate run owed.
   DON-325/329 merged in PR #56 (8a88acb0, 17 Oct; Linux run 39036124595
   green). Residuals: DON-331 (Donal decision), 332, 333, 334, 335. See
   [evidence](archive/2026-10-17-don325-don329-local-validation.md).
   **Merged 17 Oct (master 0f579dc7):** #57 renderer churn (DON-312), #58
   256-fix restart-snapshot pieces, #59 one-step backup mirror (restarts under
   live writes made a ~1 s copy take 249 s; may explain DON-240). Mac soaks:
   memory 11/11 under budget (1.82–2.07 GB), backups 0.9–1.5 s, data exact;
   main loop 2/5 PASS. **18 Oct probes** (see
   [checkpoint design](../docs/don-313-off-main-checkpoint-design.md)):
   startup stalls were participant backfill writing a 2 h window (≤7,200
   fixes) in one transaction. Fixed by PR #60 (256-fix pieces, merged
   de1a84ad); 3 soaks: startup cluster gone, 2/3 PASS, data exact. Off-main
   WAL checkpoint worker built and probed in 4 variants: no gain over #60,
   dropped (Donal 18 Oct; branch kept locally, uncommitted). Remaining: 30–40
   commits/launch at 100–185 ms (tiny bodies; sync cost suspected, measure
   on box) and a rare 2.17 s blocked stall (33 ms CPU). 128-fix budget
   dropped. **DON-336** (log rotated in ~20 s, bundle read last 1,000 lines):
   fixed by PR #61 (merged f3fe38a5, Done): one tracking summary per minute,
   writes ≥100 ms logged as `storage_slow_write`, bundle keeps up to 500
   earlier warn/error entries. Packaged soak: whole run in 128 KB, every
   stall ≥150 ms matched a slow write, commit 85–90% of each (sync cost).
   Linear DON-312/313/240 reopened. See
   [churn note](archive/2026-10-17-don312-renderer-churn.md).
   Next: Linux 13.7 candidate run naming DON-330/328/327/264/332 checks.
2. In Review until named on the 13.7 candidate run: DON-311, 314, 320, 322,
   309, 317.
3. Waiting: box for the DON-312/313 Linux soak and the new smoke steps' first
   packaged run; DON-247/240 gate call.

## Verification limits

- Live Traccar: one approved device; other box checks use synthetic
  providers. PCLinuxOS untested (DON-298). Window X is a hand check on Linux.
- The box sleeps when idle; long runs need Donal's sudo for `systemd-inhibit`.
- DON-336 branch: 635 suites / 6,661 pass; 4 timing tests failed only at
  load average 30 and passed on rerun (104/104). Earlier review repair: 629 / 6,611. Synthetic packaged-store
  cancellation/reopen checks pass; actual quit-during-finalize UI and installed
  Ubuntu remain unproven. DON-312/313 budgets remain failed.

## Who is doing what

- **Coordinator (Claude):** Linear, 13.7 candidate verification. No worker or
  test run active.
- **Donal decisions pending:** DON-331 refused-quit policy; whether DON-247 is
  a 13.7 gate.
- **Maps (M01–M03) next after the team talk:** Donal meets the team week of
  19 Oct. Hold the M01 area-workflow questions until then, then pivot straight
  to DON-144/76/7. Until then: close out 13.7 (DON-312/313 first).

## Waiting on others

- Eamonn: support bundle, Layers screenshot, Tomies Wood GPX (DON-319 cause,
  DON-318 trigger).
- Box unavailable today: installed Ubuntu and DON-312/313 budget checks wait.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`.
