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

## Next action — fix DON-305 in beta.13.5, rebuild, box tonight

**Donal's decision (30 Sep): fix DON-305 in 13.5.** Late-uploaded Traccar fixes
(phone regains signal, or the server comes back) are recovered only by the
anti-entropy sweep (`breadcrumb-history-reconciler.ts`): one 2 h chunk per
device every 5 min, oldest first, so about 2 h per pass on a 48 h mission. The
live check found 2,418 of 4,671 missing 3 min after backfill; all arrived late,
14:22–14:24. A re-run with them already on the server passed 4,671/4,671.
See the DON-305 correction comment.

Work order (tests first; Claude implements, Codex reviews):
1. Add late uploads to the fake Traccar (`scripts/team-smoke/lib/mock-traccar.mjs`,
   `team-traccar.mjs`): a device goes silent, then uploads a buffered burst.
   Write a failing unit/integration test measuring recovery time.
2. Fix: newest-first sweep that covers the recent hours on every tick, with
   bounded load, so a late burst is stored within about one tick (5 min).
   Keep SAR-QA-006/013/021 provenance (receipt time recorded, fixTime authority).
3. Add a team-smoke late-upload phase, and make `live-traccar` wait past one
   tick. Full correctness, full Chromium, and a Mac package run.
4. Bump nothing (still 0.1.0-beta.13.5). Delete the draft and tag, retag at
   the new HEAD (retag approved by Donal), and wait for CI.

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
