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

## Next action — box smoke on 13.5 candidate 6

**Candidate 6 = candidate 5 + team fixes (30 Sep, Donal: in 13.5, box waits):**
DON-306 plain-words refusal when re-importing a retired GPX (copy/rename
workaround; full Restore = DON-309, 13.6), DON-307 Minimize on a lived-in
profile, DON-308 diagnostics report states the version and keeps its content.
Codex-reviewed (aw b35981225cba). Mac: correctness 6,258, Chromium 232,
packaged `team-mission` incl. the new steps. Draft hashes: Linear DON-305/306.
Open for Eamonn: what the Outings panel is for; his layout doc is coming.

**DON-305 fixed:** every 5-min tick re-reads the last 6 h of every device,
newest first, plus 3 older chunks; the sweep takes at most 4 of the 8 shared
transport slots (the first version starved live trails; found by the CI soak).
Codex-reviewed, nothing blocking. Follow-up: initial catch-up still uses all 8.
Donal authorized re-running flaky CI on the same artifact without asking.

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
