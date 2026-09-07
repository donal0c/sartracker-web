# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Prior evidence is retained in
> `docs/breadcrumb-pr6-evidence.md`; older history is in `handoff/archive/`.

## Current State

- Existing PR #10 (`codex/breadcrumb-pr6-archive-lifecycle`, programme PR6)
  remains open and unqualified. Fresh Astra task owns diagnosis, bounded
  corrections, existing-PR push, and merge-readiness evidence. Donal retains
  approval, merge, beta publication, and team-contact authority.
- Starting/live head `b3fb01fac43f7e3dff0a2ea8edd171ac11e4491f`, tree
  `66b6db82fee6929e73ca2ad49d8fe7a23bacf35f`, is rejected: macOS lifecycle
  missed terminal verification progress; Linux CI `34148723233` failed the
  legacy-event heartbeat at `200.669968 ms` (3,959/3,960 passed).
- Work is in `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  The old `44b1` checkout is evidence only and its task remains retired.

## Active Work

- The real packaged collector reproducibly loses `verify:verified` when that
  progress message arrives after the verified invoke result. A focused 25 ms
  delivery-delay diagnostic reproduced the original closed gate; a passive
  listener received the event later. Fix retains the exact mission/operation
  subscription until terminal delivery, with a fail-closed 5-second timeout.
  Product archive, verification, custody, and migration code are unchanged.
- Five collector regressions pass, including both delivery orders, unrelated
  identities, missing terminal, and operation failure. Focused independent
  review is clean; real packaged delayed-delivery diagnostic passes with the
  corrected collector. The historical receipt alone cannot identify its race.
- Linux heartbeat cause remains unresolved. Baseline focused macOS and Ubuntu
  tests passed; Ubuntu constrained to two CPUs peaked at `46.129 ms`, including
  `30.671 ms` main-thread GC. The full affected file passed `73/73`; its event
  scenario peaked at `29.141 ms`. These do not explain the historical breach.
- The unchanged 500,000-event test now retains SQL-poll timing, process CPU,
  and largest-gap GC diagnostics for the next CI observation. Its workload,
  10 ms heartbeat, 5 ms polling, and strict `<200 ms` assertion remain intact.
  Focused instrumentation review is clean.

## Locked Boundaries

- Preserve the existing PR implementation and accepted correction/custody,
  transaction-contention, bounded-history, and lifecycle-ownership repairs.
- Finalized evidence and archive revisions remain immutable and retained.
  Cleanup remains logical deletion; no operational VACUUM or erasure.
- Every liveness dimension remains strictly `<200 ms`. A qualification
  timeout does not change that requirement. A diagnostic pass is not release
  or field proof; an unexplained historical failure is not harmless noise.
- Do not retry expensive qualification blindly. Diagnostic repeats must test
  an explicit hypothesis; the >2 GiB gate remains last after cheaper proof.

## Issues And Next Actions

- `DON-248`, `DON-252`, `DON-253`: PR6 implementation/qualification, In Progress.
- `DON-278`: prior Replay completion does not qualify PR6's failed
  legacy-provenance responsiveness observation.
- Local source gates are green; Linear records are current. Commit the bounded
  collector/diagnostic correction and fast-forward the existing PR only.
- Bind the resulting exact head/artifact to package, Linux, browser/visual,
  physical-kill, and finally Ubuntu >2 GiB qualification. Retain actual failure
  observations and stop for causal investigation on a gate breach.
- Fresh read-only Ubuntu probe passed: `Linux 7.0.0-28-generic x86_64`, about
  29 GB available RAM and 127 GB free disk. Recheck immediately before scale
  work; no scale run has started in this task.

## Verification Limit

Full serial local source gate passes: 381 files / 3,965 tests in 376.36 seconds,
full ESLint, production build/bundle budgets, affected Node syntax, diff check,
and backend 58 passed / 1 existing ignore. The heartbeat scenario reached
19.817 ms within that full suite. Exact-head CI, authoritative packaged
lifecycle, browser/visual, physical-kill, and >2 GiB results remain pending. PR #10 is not
ready to merge or release. The old stop-after-package instruction is superseded
by Donal's fresh-task authorization to carry through merge readiness.
