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

## Next action — beta.13.5 candidate in CI

**Tagged `electron-v0.1.0-beta.13.5` at d10ba78f; CI run 36677312888** (draft
prerelease when green, ~55 min). Contents: DON-281, 282, 283, 291, 292, 294 and
the Discovery package fix (ea2597c0: a package may declare more zoom levels
than it holds; the real range is attested; out-of-range tiles still rejected).
Codex review 32983a4b93e4: no product blockers; its two smoke-tool fixes are in.
Full correctness 6,240 passed. Local Mac package: team-smoke `offline-map` on
the team's real file (sha e317fd01…) imported offline, ready z9–16, 31,729
tiles, rendered after restart.

Remaining steps (Donal approved, 30 Sep):
1. When CI is green: download the draft assets to the box and run team-smoke
   with `--previous-profile ~/sartracker-13.5-smoke/upgrade-from-13.4.pristine-copy`
   (made by installed 13.4) and `--map-package` (path in the private note).
   Tool checkout on the box is already at d10ba78f.
2. Manual rows need a person: window-X, GPX picker, basemap glance, live
   Traccar (read-only). Fill the note's table and exception hashes.
3. Donal's go/no-go and exceptions (DON-284, 285; DON-288 known issue),
   guarded publish, fresh-download check.
4. Team note. **Correction:** a package 13.4 already rejected is not rechecked
   on restart; the operator presses Settings → Save & Close (or adds the
   package again). The release note says so.
Parallel: manual refresh by a separate Claude instance (brief
`tmp/claude-handoffs/05-manual-refresh.md`); it should mention re-checking a
rejected Discovery package. Don't push during the candidate CI build.
**DON-293** (replay of backfilled history) awaits the team's answer.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
