# HANDOFF.md — Current state

Updated 2026-09-24. Use this file as the current baton; detailed release and
qualification history remains in the workplan and assurance records.

## Current state

Release remains **HOLD**. No Beta 13 candidate is frozen or qualified, and no
tag, publication, or team distribution has occurred. Current `master` is
`30cb7d45ed6011adc3da034d815bb7d8742bd6a3`, after PR #49 merged. It includes
the C17 fixed-canary leak classification and DON-264 persistent overlay warning
behavior.

PR #47 remains draft on `codex/c01-startup-store-fault-response`. The local
branch is rebased onto current master at `30cb7d45` with fixes through
`95b3cd5c`; GitHub still has old head `8cdf6f62` on base `a81dd4a3` and reports
a merge conflict. Exact old head
`8cdf6f62` failed Linux C19 run `35984100420`: one 261.161 ms main-loop gap
against 200 ms. Master run `36001695717` passed the same packaged observer at
50.836 ms, making a one-off host pause more plausible but not proving it. Keep
the old failure unresolved and do not mark PR #47 ready from the master pass.

DON-179 remains **In Review**; PR #47 does not complete its opt-in diagnostic
upload scope.

## Active work and evidence

- The reapplied C01 fixes bound failure-evidence waiting to ten seconds and
  validate the held-gate dialog against its exact 20-second producer deadline.
  Post-rebase focused tests passed (77); full correctness passed (571 files,
  5,847 passed, 25 skipped), lint and production build passed. Fresh review
  found synchronous `createElectronMissionStore` open/migration still runs on
  Electron's main thread outside the watchdog; it can block the timer. Scope
  against DON-250 is awaiting Donal's direction.
- Linux failure receipt checksum:
  `314d88880af4132654a574c21b1133bc828820f74e897363e15ac0db8195f88c`.
  Its measured block combines mutation, `prepareClose` and `close`; it has no
  CPU, scheduler or storage attribution. Seven implicated MissionStore files
  and the Electron executable hash match the master pass; the ASAR differs.
  Darwin same-profile readings were 52.40 ms (base), 54.41 ms (prior head),
  and 54.53 ms (old PR head). None resolves the Linux outlier.
- The separate first Darwin package attempt showed a native startup dialog
  because my symlinked packaging setup omitted `bindings` from packaged
  `better-sqlite3`. Redacted logs and the failed first-launch receipt are
  retained; the corrected package passed. This was a harness packaging fault,
  not C19 or an injected product fault. It used an isolated temporary profile;
  normal profile files had no comparison-date modifications. The exact outer
  command and absolute executable path were removed with the temporary wrapper.
- Master run `36001695717` passed Linux lint, full correctness, production
  build, browser regressions, candidate-producer checks, packaged C17, and
  packaged legacy recovery. Its push trigger skipped strict responsiveness.

## Next actions

1. Resolve whether synchronous SQLite startup work belongs in PR #47 or the
   existing DON-250 scope; do not claim the watchdog bounds that native call.
2. After scope is settled, complete the needed review and exact-head Linux CI.
   Keep PR #47 draft while the historical C19 cause remains unresolved; the
   master pass is supporting evidence, not clearance.
3. Preserve the Beta 13 release hold; do not merge, qualify, tag, publish, or
   distribute.

The release HOLD and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
