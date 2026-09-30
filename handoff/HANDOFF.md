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

## Next action — beta.13.5 candidate 3 in CI

Tag `electron-v0.1.0-beta.13.5` at 0ed54a4a, **CI 36695835717**. Candidate 2
failed only on a stale E2E tab count (fixed; full Chromium 231/231 locally).
Contents: DON-295 (Devices Add removed), the Discovery package fix (DON-144),
and DON-281/282/283/291/292/294. Local commits 73d8076a and 5d053e96 (smoke
tool and docs): push after CI.

When CI is green:
1. Push, bundle to the box, move the tool checkout to HEAD, download the draft.
2. Run the full smoke with `--previous-profile
   ~/sartracker-13.5-smoke/upgrade-from-13.4.pristine-copy --map-package …`
   (see the private note); it includes the new `team-workflow` (expect
   FAIL on DON-304 only) and `offline-map`.
3. Fill the note's table; ask Donal for the .deb install, the manual rows
   (window-X, GPX picker, basemap glance, live Traccar, F11) and go/no-go
   with exceptions (DON-284, DON-285, DON-304).
4. Guarded publish, fresh-download check, team note (tell the tester: History
   from → Mission start; Maps → Discovery after start; post-install check).

**Waiting on Donal (Claude raises these; Donal need not remember):**
DON-296 default KMRT group · DON-304 as a known issue in 13.5 · DON-284
"was lost" wording · DON-288 fallback expectation · DON-302 retire the old
smoke · box sleep mask (`sudo systemctl mask sleep.target suspend.target`).
**Ask the team on the next call:** DON-293 (replay of backfilled history).
Full post-13.5 queue: the workplan table "After beta.13.5" (DON-296–304).

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
