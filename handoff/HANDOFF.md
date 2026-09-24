# HANDOFF.md — Current state

Updated 2026-09-24. Use this file as the current baton; detailed release and
qualification history remains in the workplan and assurance records.

## Current state

Release remains **HOLD**. No Beta 13 candidate is frozen, no qualification run
or tag has been started, and no publication or team distribution has occurred.
PR #48 is merged; current `master` is `a81dd4a388196d241a48205ad45e961c1ab26c9b`,
including the post-merge C17 change that records any fixed-canary leak as an
observed privacy failure.

PR #49 remains draft for DON-264. Its branch `codex/don-264-overlay-warning`
has been rebased onto current `origin/master`; the feature head before this
handoff update was `d555f838`. It preserves failure streaks by map and stable
overlay registration ID across hook re-registration, reports only an allow-listed
error class, and clears the warning after a verified successful sync.

## Active work and evidence

- The new quick re-registration regression was red on the rebased pre-fix
  parent `a0e17d9f` and green on the fix. Five focused unit files passed (36
  tests); the full correctness run passed 570 files / 5,832 tests, with 25
  skipped.
- Lint passed. The DON-264 Chromium recovery test passed, and the visual runtime
  safety test passed; its screenshot was inspected locally. These are browser
  harness evidence, not operator or field acceptance.
- `npm run electron:pack` passed, including production build and macOS arm64
  packaging. The local packaged C14 map-surface smoke passed warning,
  recovery, clearance and cleanup checks with `releaseEligible: false`. It is
  package evidence only, not candidate qualification.
- Exact-head GitHub CI and fresh independent review are pending. The earlier
  manual workflow dispatch was canceled at its deferred qualification gate;
  it is not green evidence and must not be repeated for this task.

## Next actions

1. Commit the refreshed DON-264 handoff, workplan and assurance entries, then
   push the rebased branch with a lease.
2. Confirm normal PR checks run on the pushed head, obtain a fresh read-only
   independent review of that exact head, and verify unresolved threads and
   mergeability. Keep PR #49 draft unless exact-head checks and review are green.
3. Keep DON-264 separate from C17 residuals and all BCP-17 gates. Do not merge,
   qualify a candidate, tag, publish, promote, or claim field readiness.

The release HOLD and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
