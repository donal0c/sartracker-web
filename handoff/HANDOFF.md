# HANDOFF.md — Current state

Updated 2026-09-30. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.5 published 1 Oct 2026** (controlled team beta, not for live
  incidents): tag fac5adcf, release run 36784213719, AppImage `3847d36d…94e0`,
  .deb `012ec1fe…2e61`; fresh public download matches. Six owner-approved
  exceptions (DON-284/285/288/299/304/310 + native picker) in the note.
- beta.13.4 superseded.

## Verification limits

- All proofs are synthetic providers on the Ubuntu box, not live Traccar or
  field acceptance. Per-issue evidence and hashes are in Linear (DON-281/282/291/292/294).
- The crash-marker "was lost" wording overstates (1.8, needs Donal).
- The box auto-suspends when idle; the sleep inhibitor is denied over SSH. Ask
  Donal to run `sudo systemctl mask sleep.target suspend.target`.

## Next action — send the team note; plan 13.6

Donal sends the 13.5 team note (drafted in session). 13.6 queue: DON-310
(soak stalls, top), DON-309 (GPX restore), DON-288 (no-WebGL message),
DON-284/285/304, initial catch-up transport cap (follow-up of DON-305).
Eamonn: Outings explanation (call) and his layout doc (to ticket).
Box: candidate-6 smoke, soak and large-mission evidence under
~/sartracker-13.5-smoke/{c6,soak-compare}; ask Donal before deleting.

**Waiting on Donal (Claude raises these):** DON-296 default KMRT group ·
DON-284 wording · DON-288 fallback · DON-302 retire the old live script · box
sleep mask. **Ask the team:** DON-293. Queue: the workplan "After beta.13.5".
Box leftovers: `~/Desktop/SAR-smoke-track.gpx` (test file; Donal may delete).

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
