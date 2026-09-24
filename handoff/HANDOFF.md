# HANDOFF.md — Current state

Updated 2026-09-24. Use this file as the current baton; detailed release and
qualification history remains in the workplan and assurance records.

## Current state

Release remains **HOLD**. No Beta 13 candidate is frozen, no qualification run
or tag has been started, and no publication or team distribution has occurred.
PR #48 is merged; current `master` is
`a81dd4a388196d241a48205ad45e961c1ab26c9b`, including the post-merge C17
change that records any fixed-canary leak as an observed privacy failure.

PR #49 remains draft for DON-264. Its branch `codex/don-264-overlay-warning`
is rebased onto current master. Failure streaks persist by map and stable
overlay registration ID across hook re-registration. Diagnostic events retain
only the allow-listed error class, never raw exception text. Concurrent overlay
warnings are presented in a bounded keyboard- and wheel-scrollable region, so
the map remains usable while each active warning remains reachable.

## Active work and evidence

- The quick re-registration regression was red on the rebased pre-fix
  `a0e17d9f` and green after the fix. Full correctness passed: 570 files,
  5,832 passed, 25 skipped. Lint passed.
- DON-264 Chromium warning/recovery and ten-warning scrolling checks passed.
  The visual runtime warning/recovery check passed and its screenshot was
  inspected locally. Browser and visual harness results are not field
  acceptance.
- `npm run electron:pack` passed, including production build and macOS arm64
  packaging. Packaged local C14 passed marker warning, recovery, clearance and
  cleanup; receipt `/tmp/don264-c14-closeout.klCU9Z/map-surface-report.json`
  reports `releaseEligible: false`. This is package evidence, not candidate
  qualification.
- The previous independent review found and helped close a P2: repeated
  warnings could exceed the map viewport and be clipped. The bounded scroll
  region now exposes all active warnings. That review was against the prior
  head; obtain a fresh read-only review of the final pushed head.
- Check current exact-head PR CI, review, unresolved threads and mergeability
  live on PR #49 before changing its draft status. A superseded CI run is not
  final-head evidence. The canceled manual workflow dispatch is not green
  evidence and must not be repeated for this task.

## Next actions

1. Confirm normal PR checks and the fresh independent review apply to the
   current pushed head; verify there are no unresolved review threads and PR
   #49 remains mergeable. Mark it ready only if all final-head checks are green.
2. Keep DON-264 separate from C17 residuals and all BCP-17 gates. Do not merge,
   qualify a candidate, tag, publish, promote, or claim field readiness.

The release HOLD and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
