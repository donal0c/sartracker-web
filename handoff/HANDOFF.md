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

## Next action

**Unreleased on master (ee3b4903), all Codex-reviewed:** DON-281, 282, 283
(paused stays paused after a crash), 291 (late-add history), 292 (pre-start
ticks dropped after any finished mission; likely Eamonn's TB13-03), 294 (Archive
& Lock targeted an older mission; now a Mission list on the governance card).
1.2a team-mission smoke found 292, 293 and 294. Full correctness 6,236; Chromium 230.
**Linux on the exact CI AppImage `01386b44…` (run 36643435970):** PASS for
bad-credential, database-refusal, duplicate-launch, tracking+48 h, outage,
coordinates+DMS, archive. Lifecycle FAIL only on DON-284. Team-mission data and
DON-294 are verified in the store; the reopen step has a tool timeout (fix the
archive-row selector). Evidence: box `~/sartracker-ee3b4903-validation/`.

## Next: beta.13.5 (Donal approved, 30 Sep)
1. Discovery: accept a package whose metadata claims more zoom levels than it
   has (the team's `reeks-standard-60km-z16.mbtiles` declares z8, tiles z9–16).
   Keep rejecting tiles outside the range and corrupt data; record the real
   range. Add a test-only map import hook so the smoke loads the team's file.
   Codex review. The derivative on DON-144 is then unnecessary.
2. Fix the team-mission reopen selector.
3. Known issues ship as written: DON-284, 285, 288 (Donal, 30 Sep).
4. Bump to 0.1.0-beta.13.5, write the note from TEMPLATE, tag, CI draft.
5. `docs/release-checklist.md` on the draft assets. Manual rows need a
   person: window-X, GPX picker, basemap glance, live Traccar (read-only).
6. Donal's go/no-go and exceptions, guarded publish, fresh-download check.
7. Team note: fixes; the Discovery map works again with no re-import.
Parallel: help/manual refresh by a separate Claude instance in its own
worktree (brief: `tmp/claude-handoffs/05-manual-refresh.md`, local).
Rules: Claude orchestrates, Codex reviews. Don't push during a candidate CI build.
**DON-293** (replay of backfilled history) awaits the team's answer.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
