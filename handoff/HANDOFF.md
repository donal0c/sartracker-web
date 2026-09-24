# HANDOFF.md — Current state

Updated 2026-09-24. Use this file as the current baton; detailed release and
qualification history remains in the workplan and assurance records.

## Current state

Release remains **HOLD**. No Beta 13 candidate is frozen, no qualification run
or tag has been started, and no publication or team distribution has occurred.
PR #48 is merged; current `master` is
`a81dd4a388196d241a48205ad45e961c1ab26c9b`, including the post-merge C17
change that records any fixed-canary leak as an observed privacy failure.

PR #49 is open for DON-264 on `codex/don-264-overlay-warning`, rebased onto
current master. Failure streaks persist by map and stable
overlay registration ID across hook re-registration. Diagnostic events retain
only the allow-listed error class, never raw exception text. Concurrent overlay
warnings are presented in a bounded keyboard- and wheel-scrollable region, so
the map remains usable while each active warning remains reachable.

## Active work and evidence

- The quick re-registration regression was red on the rebased pre-fix
  `a0e17d9f` and green after the fix. Full correctness passed after the
  warning-region fix: 570 files, 5,832 passed, 25 skipped. The subsequent
  accessibility-label wording fix passed its focused unit regression; lint
  passed on the final source.
- DON-264 Chromium warning/recovery and ten-warning scrolling checks passed.
  The visual runtime warning/recovery check passed and its screenshot was
  inspected locally. Browser and visual harness results are not field
  acceptance.
- `npm run electron:pack` passed, including production build and macOS arm64
  packaging. Packaged local C14 passed marker warning, recovery, clearance and
  cleanup; receipt `/tmp/don264-c14-closeout.klCU9Z/map-surface-report.json`
  reports `releaseEligible: false`. This is package evidence, not candidate
  qualification.
- The fresh independent review at final head `02758843` confirmed the clipping
  fix and accessibility/documentation cleanup, with no actionable P1-P3
  findings. GitHub reports no unresolved inline threads and the PR is
  mergeable.
- At last check GitHub reported no unresolved inline threads and the PR
  mergeable. Read the live PR to verify its current head, CI, review, and draft
  state before changing readiness. Superseded CI runs and the canceled manual
  workflow dispatch are not final-head green evidence.

## Next actions

1. Confirm normal PR checks pass on the current pushed head; verify the fresh
   independent review, no unresolved review threads, and mergeability still
   apply. Change draft readiness only after live exact-head verification.
2. Keep DON-264 separate from C17 residuals and all BCP-17 gates. Do not merge,
   qualify a candidate, tag, publish, promote, or claim field readiness.

The release HOLD and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
