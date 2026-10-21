# HANDOFF.md — Current state

Updated 2026-10-21 (beta.13.7 published). Queue: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md). Earlier detail:
[archive/handoff-20261018-pre137.md](archive/handoff-20261018-pre137.md).

## Status

- **beta.13.7 published 21 Oct 2026** (prerelease): tag 981e17cd, run
  39563099270 (attempt 1 failed one strict-timing test on a runner I/O stall,
  376 ms write / 4 ms CPU; re-run green, no rebuild). AppImage `952b4c13…8d00`,
  .deb `c06e486d…6cbe`. Every check PASS on the installed draft (box) incl.
  new `team-group-refresh` (DON-330) and `quit-during-finalize` (DON-332), live
  Traccar 7,983/7,983, upgrade from a 13.6-made profile, 960k open (2.4 s /
  5.5 s). Hand checks by Donal: window X, F11, GPX picker/watch/rescan.
- **One exception (Donal, 21 Oct): installed soak.** Data exact (691,224);
  25 main-loop gaps >200 ms (max 353 ms), all low-CPU commits late in launch 2;
  launch 1 clean. Peak 2.147 GB, within 2 GiB by ~0.5 MB. 13.6: 59 gaps, 516 ms,
  2.27 GB. Note: [release note](../docs/releases/sartracker-electron-0.1.0-beta.13.7.md).
- **New: DON-337** watched GPX folder forgotten after restart (not a 13.7
  change). Shipped as known issue with workaround; fix in 13.8.
- Box evidence: `~/sartracker-13.7-smoke/` (out/full, out/soak, large, hand).

## Next action

1. Donal: tell the team 13.7 is out, with its two known issues (brief freezes
   under heavy load; re-add a watched GPX folder after every restart).
2. Ask Donal how the team meeting (week of 19 Oct) went: maps (DON-144/76/7)
   and any new reports change the 13.8 order.
3. Then the [13.8 queue](../docs/two-track-execution-workplan.md): DON-313
   commit stalls first, DON-312 memory margin, DON-337 (needs Donal's design
   choice: resume the watch vs a visible stopped-watch notice).

## Linear state (21 Oct)

- Closed after the 13.7 run, with evidence comments: DON-330, 328, 327, 311,
  314, 320, 322, 309, 317, 299, 296.
- Open, waiting on evidence: DON-318/319 (Eamonn; PCLinuxOS via DON-298),
  DON-151/247/240 (original-machine runs), DON-300 items 1–7, DON-310 (closes
  with DON-313). Old June audit items DON-159–164 still In Review, untouched.
- DON-290 (release-checklist issue) carries the 13.7 record; reuse it for 13.8.

## Verification limits

- Live Traccar: one approved device; other box checks use synthetic providers.
  PCLinuxOS untested (DON-298). Window X is a hand check on Linux.
- Box keep-awake: `sudo systemd-inhibit` launched over `ssh -t` dies when the
  Terminal closes; the box's AC sleep setting is "nothing", which held for
  this run. Use `systemd-run` if a longer run needs a guaranteed inhibit.
- Hand-check helper scripts that import the tool's `lib/app.mjs` directly must
  set `DISPLAY=:0` and `XAUTHORITY` themselves (only `run.mjs` does it).

## Who is doing what

- **Coordinator (Claude):** 13.8 queue. No worker, agent or test run active.
- **Box:** released 21 Oct; all app/tool processes stopped.

## Waiting on others

- Eamonn: support bundle, Layers screenshot, Tomies Wood GPX (DON-319 cause,
  DON-318 trigger); long Mint run for DON-247 after 13.7.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`.
