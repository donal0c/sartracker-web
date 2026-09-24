# HANDOFF.md — Current state

Updated 2026-09-24. Use this file as the current baton; detailed release and
qualification history remains in the workplan and assurance records.

## Current state

Release remains **HOLD**. No Beta 13 candidate is frozen or qualified, and no
tag, publication, or team distribution has occurred. Current `master` is
`30cb7d45ed6011adc3da034d815bb7d8742bd6a3`, after PR #49 merged. It includes
the C17 fixed-canary leak classification and DON-264 persistent overlay warning
behavior.

PR #47 remains draft on `codex/c01-startup-store-fault-response` while it is
rebased and its local C01 review fixes are reapplied. Exact old head
`8cdf6f62` failed Linux C19 run `35984100420`: one 261.161 ms main-loop gap
against 200 ms. Master run `36001695717` passed the same packaged observer at
50.836 ms, making a one-off host pause more plausible but not proving it. Keep
the old failure unresolved and do not mark PR #47 ready from the master pass.

DON-179 remains **In Review**; PR #47 does not complete its opt-in diagnostic
upload scope.

## Active work and evidence

- The local C01 review fixes bound failure-evidence waiting to ten seconds and
  validate the held-gate dialog against its exact 20-second producer deadline.
  Before rebase they passed 77 focused tests, full correctness (568 files,
  5,836 passed, 25 skipped), lint and build; independent review found both
  findings resolved. Reapply and reverify them on the rebased source.
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

1. Finish the rebase, reapply only the reviewed C01 fixes, then run focused,
   fault, browser, packaged, correctness, lint and build checks.
2. Obtain fresh independent final-head review, address its findings, push and
   require exact-head Linux CI. Keep PR #47 draft while the historical C19
   cause remains unresolved; the master pass is supporting evidence, not
   clearance.
3. Preserve the Beta 13 release hold; do not merge, qualify, tag, publish, or
   distribute.

The release HOLD and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
