# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Detailed proof and historical receipts are in
> `docs/breadcrumb-pr6-evidence.md`; older history is in `handoff/archive/`.

## Current State

- Existing PR #10 / programme PR6, branch
  `codex/breadcrumb-pr6-archive-lifecycle`, remains **draft and unqualified**.
  HEAD `6118026c67a46e8428aeff316ccf607f61f7a840`.
- Workspace: `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  The old 44b1 task is retired evidence only. No replacement PR or merge.
- Local corrections are under verification, not committed: archived Replay memory,
  indexed position cleanup, cooperative finalization lookup and bounded denial-audit proof.
  They do not qualify the failed candidate or resolve every outstanding gate.
- Donal's 8 September plan freezes scope, bounds diagnosis, preserves integrity/
  tracking/recovery gates and avoids expensive reruns for documentation alone.
  Donal has now explicitly authorized continuing until the PR is ready for
  external review, with all other checks complete. The former few-hours limit
  no longer ends this run. No reset credit was consumed or authorized.

## Failed Qualification

- Linux CI `34168363973`: archive-create frame gap 202.4 ms; main 53.081 ms,
  current fix 67 ms. Source/build/Replay/tracking pass. Original trace also has
  a 264.036 ms frame gap ending 96.128 ms before finalization, with 263.466 ms
  graphics occupancy. Bounded reference diagnostics found no justified archive
  fix or configuration change. CI remains rejected; no introducing commit proven.
- Large-data run `pr6-fieldscale-6118026c-20260908-b` ended 09:12 UTC after
  2 h 26 m. It created/verified a 5,244,082,405-byte archive, passed initial
  restored Review and completed 11,652,544 logical row deletions. Then the
  retained contention error surfaced: `CLEANUP_GATE_FAILED / SQLITE_BUSY`,
  synthetic worker 993 acknowledged/13 rejected writes.
- Whole-process peak RSS 2,376,781,824 bytes; create/restore coordinator gaps
  1810.433/1796.623 ms. Post-cleanup Review and final proof were not reached.
  Teardown is incomplete, profile cleanup false. All owned scale processes ended.
- Receipt: remote `/home/donal/pr6-fieldscale-6118026c-20260908-b.json.failure.json`,
  local `tmp/pr6-fieldscale-6118026c-20260908-b.failure.json`. Retain the failed
  disposable profile `/tmp/sartracker-breadcrumb-pr6-qualification-xzV0e2`.
  Never relabel the failed receipt or delete its retained evidence casually.

## Active Corrections And Proof

- Archived Replay now uses SQLite's page cache without the 2 GiB mmap.
  Its trusted source flag travels separately from renderer input through all
  four Replay worker methods. Live Replay tuning and read-only access remain.
  Red-first regression and all 32 relevant tests pass; lint/TypeScript pass.
- Actual changed worker on the reference diagnostic copy returns the identical
  query digest at 87,148 KiB VmHWM (85.1 MiB), compared with about 2.2 GB before.
  This query returns zero exact tracks at its selected time and exercises legacy
  scans; it is not full restored-archive equality or packaged qualification.
- Position cleanup now orders by the existing mission/device/time index with
  rowid tie-breaker, identically for select and delete. No new index, migration,
  journal format, mission selection, row limit or custody/membership guard change.
  Real rolled-back 500-row work falls from 1763.712 ms to 2.616 ms. All
  1,935,360 positions remain. Red-first query-plan regression and 46 cleanup/
  runner/membership/startup tests pass. Writer rejection still needs full-path proof.
- Browser harness Archive Review/Replay/cleanup/correction flows pass 4/4
  (13.7 s). No operator control, wording or workflow changed; the manual's
  existing legacy-Replay limitation remains applicable.
- Combined full source passes 4,021/384 in 419.38 s, log
  `tmp/pr6-scale-fixes-full-source.log`. Build/TypeScript/bundle budgets pass.
  Backend passes 58 with one existing ignore. All owned checks have ended.
  The memory-only attempt was interrupted
  before the cleanup correction; sandbox mock-server failures mean it is not
  passing evidence. The combined run has loopback permission.
- Finalization now prepares legacy history in 1,024-row pages, yields between pages,
  and requires a fresh result before durable admission. The existing mission Replay
  generation guards the scan so another mission can track; global SQLite revision
  guards admission. No new schema/index. Archive-family serialization and existing
  event writers preserve the evidence-generation contract. Stale admission retries
  are bounded and never retry an already-started archive lifecycle.
- Red-first denial-audit proof now counts only rows appended after its captured
  rowid boundary; all 49 qualification-script tests pass. Finalization's scan suite
  passes 7, including two-connection writes. Final full source passes **4,032/385**
  with `--maxWorkers=2` in 216.64 s (`tmp/pr6-readiness-full-source-final.log`).
  Strict legacy provenance heartbeat passes at 170.501 ms. Build and lint pass;
  archive browser flows pass 4/4 in 15.6 s. No source thresholds were relaxed.
- Earlier attempts retain their failures: startup teardown raced an asynchronous
  diagnostic write (test now observes the real refusal log); the new SQL assertion
  mistakenly rejected existing bounded `rowid > lower AND rowid <= upper` queries
  (corrected); an overlapping browser/full-suite run breached a timing gate.
  Reference scale timing and corrected-candidate packaged/CI qualification remain pending.

## Reference Host And Evidence Safety

- Reference clone `/home/donal/sartracker-pr6-astra-c2c04dca` stays clean at
  6118026c on `donal@192.168.18.31`. Diagnostic copy/source live separately at
  `/tmp/pr6-scale-diagnosis-20260908.UBHDZo`; last disk check 115 GiB free.
- Original closed v12 fixture:
  `/home/donal/sartracker-pr6-final-fieldscale.RYyjkP/fixtures/mission-store-v12-closed.sqlite`.
  Never open it with SQLite. Copy first. Size 4,159,836,160; inode 9570324;
  one link, mode 0600, no sidecars. Fresh post-run SHA matches:
  `53fd13f87775529b46346a83519b823c50b22bd20297c489e0165d52ff3abcb6`.
- Donal explicitly approved both broader reference source transfer and the exact
  current Linear status in chat. Both succeeded; DON-252 comment
  `10151e08-61b8-480d-bbcd-f56c80cb733c` records 4,032 local passing tests and pending
  qualification. Earlier stale approval-card text must not be posted.
- The read-only large-copy preparation diagnostic passes: 1229.707 ms total,
  50.611 ms maximum heartbeat, 0.046 ms final admission read and 0.029 ms audit
  boundary/count read, 77,436 KiB maximum RSS. Full concurrent admission also passes:
  1230.929 ms preparation/admission, 50.155 ms maximum heartbeat, 13/13 actual worker
  writes acknowledged. It intentionally stops before archive creation; receipt
  `tmp/pr6-scale-admission-diagnostic-b.jsonl` is admission-only proof.

## Issues And Next Actions

- `DON-248`, `DON-252`, `DON-253`: In Progress. DON-252 retains Bug,
  Regression and Performance labels. Prior DON-278 completion does not qualify PR6.
- The local correction chunk has passed source/browser/build/lint and targeted
  reference checks; Linear records this exact proof boundary. Freeze and push its
  candidate for packaged/CI/kill and >2 GiB qualification. PR remains draft until
  those checks pass. Do not relabel earlier failed receipts or launch an unchanged run.
- Donal retains approval, merge, beta publication and team-contact authority.
  Every liveness dimension stays strictly below 200 ms. Archive evidence remains
  immutable; cleanup is logical deletion, never operational VACUUM or erasure.
- Prior d392 implementation passed source 4,018/384, browser 235/235, visual
  74/74, backend 58/1 ignored, package lifecycle and kill 32/32. CI 34166963970
  passed. These are historical receipts, not proof for the current local changes;
  exact applicability/hashes and the later 611 rejection are in the evidence doc.
