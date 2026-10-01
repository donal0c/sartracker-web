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

## Next action — start 13.6 with DON-311

13.5 is out and the team note went to Eamonn (1 Oct). Work the 13.6 queue in the
[workplan](../docs/two-track-execution-workplan.md) top-down, starting with
DON-311 (initial catch-up can starve live trails), then DON-310 (soak stalls).
Eamonn: Outings explanation on Donal's call; his layout doc feeds DON-297.
Box (shared, ask Donal first): smoke tool, 13.4 upgrade profile, 960k fixture,
live fixtures in `~/sartracker-live-fixtures`; old folders cleaned 1 Oct.

**Waiting on Donal (Claude raises these):** DON-296 default KMRT group ·
DON-284 wording · DON-288 fallback · DON-302 retire the old live script.
**Ask the team:** DON-293.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
