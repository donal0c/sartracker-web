# HANDOFF.md — Current state

Updated 2026-09-24. This is the operational baton; detailed release and review
history stays in the workplan and assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified, and no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 (`codex/c01-startup-store-fault-response`) remains a draft. Local work is
rebased on `30cb7d45`; GitHub still points to `8cdf6f62` on the old base and
reports a merge conflict plus a failed Linux check. The branch changes and new
C19 timing instrumentation have not yet been pushed. The old Linux failure
`35984100420` measured 261.161 ms against 200 ms. Preserve it as unresolved;
master's 50.836 ms pass does not explain it.

DON-179 remains **In Review**; opt-in diagnostic upload is not complete.

## Active work and verification

- PR fixes use a 10-second monotonic watchdog starting after Electron readiness,
  with a 20-second held-gate observer. Failure evidence waits for writes to
  settle, with a cap for pending writes; timeout messages identify the stage.
- **C01 remains open:** `app.whenReady()` itself is not bounded, and
  `createElectronMissionStore()` synchronously opens/migrates SQLite on Electron
  main. The watchdog cannot run while native SQLite blocks that thread. A full
  bound needs utility-owned live store access and an async main-process facade;
  this is a wider persistence redesign. Do not implement it without the scoped
  decision recorded in the workplan. Keep PR #47 draft until the remaining
  readiness decision is made.
- The C19 smoke now records marker mutation, `prepareClose`, and `close`
  separately, including CPU and Linux scheduler deltas; the 200 ms gate is
  unchanged. Local packaged macOS disposable-store smoke passed, with gaps
  1.62/0.16/1.74 ms. macOS has no Linux scheduler counters; exact-head Linux CI
  must validate them. Do not replace the historical 261.161 ms receipt.
- Local checks passed: 123 focused unit tests; correctness 5,850 passed and 25
  skipped; full lint and production build; packaged macOS legacy-recovery smoke.
  The package-smoke receipt was made from a dirty working tree and is diagnostic
  only, not exact-head or Linux evidence.
- Fresh exact-head independent review and Linux CI remain outstanding. The
  branch still needs a protected force-with-lease update against the observed
  remote head `8cdf6f62` before those checks can run.

## Next actions

1. Update the existing PR with the verified commits using a protected
   force-with-lease against the observed remote head `8cdf6f62`. Keep it draft;
   do not merge or release.
2. Run exact-head Linux CI and request the fresh independent review; retain all
   failed receipts and reconcile every review finding in the PR record.
3. Present Donal the single remaining scope decision: approve utility-owned
   live MissionStore plus async facade work, or accept this narrower draft with
   the C01 synchronous-open gap still unresolved. Keep DON-179 In Review.

The release hold and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
