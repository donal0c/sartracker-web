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
- Verified implementation `d392181b3958c21948e926a6785358be91da1926`, tree
  `a1a48582881ed1caa2cf626f06ed172ebc9b901c`, fixes the controlled
  cleanup/live-write defect. Source, browser/visual, macOS and reference
  Linux packaged lifecycle, physical-kill recovery and Linux CI `34166963970`
  all pass. This checkpoint changes evidence/handoff only; application and
  test bytes remain identical. >2 GiB qualification remains unstarted.
  Exact-head receipts for any documentation descendant are recorded in the
  PR #10 / DON-252 ledger after commit; read those before starting a gate.

## Active Work

- Real cleanup-worker lock held for 700 ms: another mission's device/position
  writes fail immediately with SQLITE_BUSY; coverage catalog publication
  freezes the main heartbeat for 789.192 ms. This proves a reachable defect,
  not attribution of the separate historical 943.993 ms main-thread wait.
- Committed correction introduces one FIFO synchronous transaction owner for live
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
  4,018/384, fresh browser 235/235 and Opus visual 74/74. Exact-head macOS
  and reference Linux lifecycle pass; physical SIGKILL matrix passes 32/32.

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
- Linux CI `34166963970` passes; its exact-head receipt is preserved locally
  under `tmp/pr6-linux-d392181b/`. All d392 local/reference jobs have finished.
  Confirm the latest PR-head CI/receipt in Linear before resuming qualification.
  Do not start the final >2 GiB run
  without a sufficient uninterrupted execution window: its 12-hour ceiling
  is not evidence it can finish before tonight's hard stop.
- Reference Ubuntu clone `/home/donal/sartracker-pr6-astra-c2c04dca` is clean
  at d392181b. No diagnostics are running. Last read-only preflight: 124 GiB free
  disk, 28 GiB available memory. Recheck before scale.
- Preserve the closed v12 fixture at
  `/home/donal/sartracker-pr6-final-fieldscale.RYyjkP/fixtures/mission-store-v12-closed.sqlite`.
  Copy before opening; original SHA-256 and all guard requirements are in the
  evidence doc. No >2 GiB run has started in this task.

## Verification Snapshot

Current product correction: source 4,018/384 (419.91 s), lint/build/TypeScript/
budgets/backend 58 pass/1 existing ignore, syntax/diff and browser 235/235
(5.0 min), Opus visual review 74/74 (report 2026-09-07T22-30-21Z). d392 macOS
lifecycle: 2 launches/11.060 s, main 52.723 ms/frame 18.3 ms/current fix 27 ms.
Reference Ubuntu with two physical cores/four threads: 2 launches/37.108 s,
main 82.513 ms/frame 123.4 ms/current fix 107 ms. Physical SIGKILL 32/32 in
175.772 s, clean/stable head and independently matched structural digest.
Linux CI `34166963970`: all 4,018/384 tests (865.36 s), source/build, 960k
Replay, native/graphics, tracking and lifecycle pass. Lifecycle has two
launches/47.010 s, main 84.485 ms/frame 154 ms/current fix 133 ms.
All receipt hashes are in the evidence doc and DON-252/PR ledger. PR #10 is
not ready to merge or release: the required >2 GiB qualification is pending.
