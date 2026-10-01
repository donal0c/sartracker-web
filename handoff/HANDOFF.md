# HANDOFF.md — Current state

Updated 2026-10-01. Issue order (13.6 queue): [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.5 published 1 Oct 2026** (controlled team beta, not for live
  incidents): tag fac5adcf, release run 36784213719, AppImage `3847d36d…94e0`,
  .deb `012ec1fe…2e61`; fresh public download matches. Six owner-approved
  exceptions (DON-284/285/288/299/304/310 + native picker) in the note.
- beta.13.4 superseded.

## Verification limits

- Live Traccar is verified for one approved device (4,431/4,431 incl. 2,463
  late uploads); everything else on the box uses synthetic providers, not field
  acceptance. PCLinuxOS (the team's OS) is untested (DON-298).
- The box sleeps when idle. For a long run, open a Terminal so Donal types the
  sudo password for a temporary `systemd-inhibit` (see 13.5's `c6/install.sh`).

## Next action — 13.6 queue

- **DON-311 fixed** (86b8384a): backfill holds at most 6 of 8 history slots,
  live trails admitted first; reconciler batch matches (catch-up +32% at
  200 ms latency, not 2x). Open: CI soak and box `team-mission` backfill
  time at the next release candidate (dispatched CI stops at the 960k step).
- **DON-310**: Mac GPU soak still stalls (291/479 ms), so not llvmpipe.
  Donal chose A+B (done: 2473beca, f247773f); no measurable gain, so route
  C is open as **DON-313** (SQLite off the main thread).
  The CI 960k replay step fails on the same cause (2 s open), which also
  stops dispatched validation before the CI soak.
- **DON-312** (new): soak exceeds the 2 GB memory budget on the Mac.
- **DON-304 fixed** (e018c128): Discovery restored after restart when its
  package is ready, visible notice otherwise; team-smoke with the real
  package at the next candidate. Follow-up DON-314 (Replay map).
- **Next: DON-313** in a fresh session. Its Linear comments hold the Mac
  evidence paths, repro/profiling commands and the first step (prove long
  tasks vs back-to-back writes). Plan to Donal before coding. Then DON-314,
  DON-288, ... per the [workplan](../docs/two-track-execution-workplan.md).
- Evidence owed at the next candidate (box): see the workplan's list under
  the 13.6 queue.
- Mac evidence: `tmp/don-310-mac-soak/` (local, gitignored).
Eamonn: Outings explanation on Donal's call; his layout doc feeds DON-297.
Box (shared, ask Donal first): smoke tool, 13.4 upgrade profile, 960k fixture,
live fixtures in `~/sartracker-live-fixtures`; old folders cleaned 1 Oct.

**Waiting on Donal (Claude raises these):** DON-296 default KMRT group ·
DON-284 wording · DON-288 fallback · DON-302 retire the old live script.
**Ask the team:** DON-293.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
