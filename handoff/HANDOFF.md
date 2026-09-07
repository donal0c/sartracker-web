# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Detailed current and historical proof is retained in
> `docs/breadcrumb-pr6-evidence.md`; older history is in `handoff/archive/`.

## Current State

- Existing PR #10 (`codex/breadcrumb-pr6-archive-lifecycle`, programme PR6)
  remains open and unqualified. Astra owns causal diagnosis, bounded fixes,
  verification and existing-PR pushes. Donal retains approval, merge, beta
  publication and team-contact authority.
- Worktree: `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  The old `44b1` checkout/task is retired evidence only.
- Pushed head `e6b6e3e02a80dfb6fd223fd8a36e90a6a6a1e471`, tree
  `535c71e046ae673984cad26baa111bfc7f2a7609`, fixes canonical-publication
  ownership races. Source, macOS packaged lifecycle and Linux CI all pass.
  A subsequent controlled cleanup/live-write test proves a product defect,
  so those passes do not make the PR ready.

## Active Work

- Real cleanup-worker lock held for 700 ms: another mission's device/position
  writes fail immediately with SQLITE_BUSY; coverage catalog publication
  freezes the main heartbeat for 789.192 ms. This proves a reachable defect,
  not attribution of the separate historical 943.993 ms main-thread wait.
- Local correction introduces one FIFO synchronous transaction owner for live
  device/position/history/coverage-affecting writes and derived coverage
  publication. SQLite busy wait is zero per attempt, restored before yielding;
  only fully rolled-back BUSY attempts retry within a finite budget. Permissions
  and revisions are checked after waiting. Shutdown joins all admitted writes
  and coverage requests, including requests without IDs.
- Preserve intentional anomaly commits: a cross-device position rejection
  retains one anomaly before the API rejects; ordinary errors still roll back.
  No schema, coordinate, archive/custody, or logical-cleanup changes.
- Fifteen real-worker interleavings, six writer tests, 24 coverage tests and
  101 mission-store tests pass. Red-first evidence and clean final focused
  independent review hashes are in the evidence doc. Full serial source passes
  4,018/384, fresh browser 235/235 and Opus visual 74/74. Packaging is pending.

## Locked Boundaries

- Preserve the existing PR/history and accepted custody, correction,
  transaction, bounded-history and lifecycle ownership repairs.
- Archive evidence/revisions remain immutable and indefinitely retained.
  Cleanup is logical deletion, never operational VACUUM or forensic erasure.
- Every liveness dimension is strictly `<200 ms`. No relaxed thresholds,
  blind retries, replacement PR, blanket review wave or retired-task restart.
- >2 GiB qualification runs last, after cheaper proof on the current head.
  Synthetic, browser, package and reference-host evidence are distinct;
  none proves field deployment or release acceptance.

## Issues And Next Actions

- Donal's hard stop: first of 15% Codex usage remaining or 01:00 Dublin on
  8 September 2026 (00:00 UTC). Checkpoint and stop before either boundary;
  do not leave task jobs running past it or start an unsuitable long gate.
- `DON-248`, `DON-252`, `DON-253`: In Progress. DON-252 retains Bug,
  Regression and Performance labels, causal evidence and the local fix design.
  `DON-278` prior Replay completion does not qualify PR6.
- Source/lint/build/backend/browser/visual checks pass; manual is checked.
  Commit/push the verified correction to the existing PR, then exact-head
  macOS/Linux lifecycle and physical-kill proof. Run controlled >2 GiB last.
- Reference Ubuntu clone `/home/donal/sartracker-pr6-astra-c2c04dca` is clean
  at c145. No diagnostics are running. Last read-only preflight: 124 GiB free
  disk, 28 GiB available memory. Recheck before scale.
- Preserve the closed v12 fixture at
  `/home/donal/sartracker-pr6-final-fieldscale.RYyjkP/fixtures/mission-store-v12-closed.sqlite`.
  Copy before opening; original SHA-256 and all guard requirements are in the
  evidence doc. No >2 GiB run has started in this task.

## Verification Snapshot

Local product correction: source 4,018/384 (419.91 s), lint/build/TypeScript/
budgets/backend 58 pass/1 existing ignore, syntax/diff and browser 235/235
(5.0 min), Opus visual review 74/74 (report 2026-09-07T22-30-21Z). These are local checks;
the new product code has not yet been committed or packaged.

e6 source: 3,996 tests/382 files, TypeScript/ESLint/build/budgets/syntax/diff,
backend 58 pass/1 existing ignore. e6 mac package: two launches/11.768 s,
main 52.649 ms/frame 17.6 ms/current fix 22 ms. Linux CI `34163950630` green:
two launches/45.683 s, main 108.333 ms/frame 174.9 ms/current fix 152 ms.
Earlier c2 Opus visual 74/74 passed. Earlier f49 physical SIGKILL 32/32 is
historical, not current-head proof. PR #10 is not ready to merge or release.
