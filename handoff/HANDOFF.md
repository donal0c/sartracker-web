# HANDOFF.md — Current state

Updated 2026-09-30. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.4** is the published controlled team beta (not for live incidents);
  immutable. See its [release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- Foundation reset (P01–P05) is complete; CI 36445372627 passed.

## Verification limits

- All proofs are synthetic providers on the Ubuntu box, not live Traccar or
  field acceptance. Per-issue evidence and hashes are in Linear (DON-281/282/291/292/294).
- The crash-marker "was lost" wording overstates (1.8, needs Donal).
- The box auto-suspends when idle; the sleep inhibitor is denied over SSH. Ask
  Donal to run `sudo systemctl mask sleep.target suspend.target`.

## Next action — DON-305 fixed; retag 13.5, box tonight

**DON-305 fixed (30 Sep), Codex-reviewed (aw 22fcab037a6e), nothing blocking.**
Every 5-min tick re-reads the last 6 h of every device, newest first, plus 3
older chunks on a backward cursor (about 35 min per pass on 48 h). Unchanged
sweep chunks skip the render path. Tests: reconciler late-upload suite,
polling-manager (failure visible; unchanged not republished), mock
`holdBack/releaseHeld`. Smoke: `team-mission` late-burst phase (7 min budget),
`live-traccar` watches 7 min (late arrivals not yet due → NOT TESTED).
Evidence: full correctness 6,247 pass; Chromium 231 pass; Mac package
`team-mission` all automated steps pass (49 late fixes stored 295 s after
upload; 9,791 fixes exact; screenshots checked). Load at 30 devices (~180 req/tick) is
unverified until the box smoke/soak.

Then: commit, push, delete the 13.5 draft and tag, retag at the new HEAD
(approved), wait for CI.

**The Ubuntu box is shared (Donal's son's school machine).** Use it only when
Donal says it is free, then release it. Tonight: full smoke on the new draft
(`--previous-profile ~/sartracker-13.5-smoke/upgrade-from-13.4.pristine-copy`,
`--map-package`, `--live-config/--live-selector`: see the private note), plus the
new `crash-archive` and `no-gpu-flag` checks. The .deb needs reinstalling:
open a Terminal via osascript so Donal only types the password. If he agrees,
run the overnight installed soak. Then fill the note's table (current
exceptions: DON-284/285/304 + layer toggles + soak; Donal approved them for
the previous candidate, so re-confirm on the new hashes), publish, check a
fresh download, and draft the team note.

**Waiting on Donal (Claude raises these):** DON-296 default KMRT group ·
DON-284 wording · DON-288 fallback · DON-302 retire the old live script · box
sleep mask. **Ask the team:** DON-293. Queue: the workplan "After beta.13.5".
Box leftovers: `~/Desktop/SAR-smoke-track.gpx` (test file; Donal may delete).

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
