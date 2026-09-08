# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Current and historical proof is in
> `docs/breadcrumb-pr6-evidence.md`; older history is in `handoff/archive/`.

## Current State

- Existing PR #10 / programme PR6, branch `codex/breadcrumb-pr6-archive-lifecycle`.
  **External review requests changes; remediation is active.** The previous
  implementation qualification below is historical, not proof of new fixes.
  See `docs/breadcrumb-pr6-review-remediation.md` for every visible finding.
- Qualified implementation: `23f90f087e90d0aa145130d9c65b17815a630109`, tree
  `9e783fd843373ab53cd27093769cf1f67c959034`. Runtime remediation now changes that
  implementation. Do not apply its historical qualification to the uncommitted fixes.
- Workspace: `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  Preserve the existing PR. No replacement PR, merge, release or reviewer dispatch.
- Donal authorized finishing all author-side work through review readiness and
  approved reference disposable tests/Linear updates. Old time/usage limits were
  lifted; no reset credit was used or authorized.

## Historical Verified Result (before external-review remediation)

- Source **4,034 tests / 385 files pass**, 217.99 s. Build/TypeScript/bundle budgets
  and lint pass; four archive operator browser flows pass in 13.6 s.
- Exact macOS and reference Ubuntu packaged lifecycle validators pass two launches
  each; all 32 physical interruption/recovery cases pass.
- Linux CI **34231604598 passes every step**, including source, normal 960k Replay,
  packaged tracking, archive lifecycle and AppImage. Packaged main/frame/current
  maxima: 82.826/193/157 ms. All strict responsiveness gates stay below 200 ms.
- Full large-fixture run `q-f708e5ad-4e5f-44b6-a0a1-e1442a2fde5a` passes its
  canonical validator: 5.24 GB encrypted archive, exhaustive 49-table proof,
  five Replay samples, matching read-only Review before/after cleanup, all 1,181
  writes durably visible, archive unchanged after cleanup.
- Create heartbeat is **52.810 ms**, down from rejected 1849.141 ms. Maximum
  coordinator heartbeat 66.044 ms; peak whole-process RSS **367.3 MiB** (<512 MiB).
  All owners joined and disposable profile cleanup completed.
- Canonical receipt checked in:
  `docs/evidence/pr6/fieldscale-23f90f08-20260908.json`, SHA256
  `3eeaf9635c444bf1e9286c1059c19da25c895f25745ac5efb41d27fae7fde0bb`.
- Final correction prepares history again before sealing, including restart
  recovery, and requires fresh bounded reads before/inside the atomic custody
  transaction. Red-first coverage now spans admission, complete sealing and restart.
  No transaction crosses a yield; custody, membership, predecessor and fence guards
  remain intact in that historical candidate. New dialog changes require fresh browser evidence.

## Evidence Safety And Limits

- Earlier 611 and 0f09 failed receipts/profiles remain preserved; see evidence doc.
  They are not relabeled by this pass. All task-owned qualification processes ended.
- Original closed v12 fixture on `donal@192.168.18.31`:
  `/home/donal/sartracker-pr6-final-fieldscale.RYyjkP/fixtures/mission-store-v12-closed.sqlite`.
  **Never open the original with SQLite; copy first.** Before/copy/after SHA256
  `53fd13f87775529b46346a83519b823c50b22bd20297c489e0165d52ff3abcb6` matches.
- These are pre-merge engineering results, not release/field qualification or
  forensic erasure proof. Existing release and operational acceptance controls remain.

## Issues And Next Actions

- DON-248/252/253 remain In Progress pending external review/merge. DON-252 retains
  Bug/Regression/Performance; its comments and the evidence ledger record provenance.
- Address the external ledger against reviewed head `c69b0c23`, with regressions
  and proportionate smokes. Donal explicitly requested avoiding automatic full
  qualification repeats. Five omitted Medium findings have been requested;
  their absence does not block work on the visible findings.

## Current Remediation Snapshot

- All visible items have an implementation or explicit retained-design rationale
  in `docs/breadcrumb-pr6-review-remediation.md`. Global event pages and atomic
  correction restore remain deliberate; no cleanup baseline is rewritten.
- New behavior includes tracking backpressure, independent archive scope checks,
  first-observed legacy content pins, Worker/read bounds, correction provenance
  and orphan recovery, descriptor ownership, row-count confirmation and pending
  cancellation dismissal. Finalized coverage rebuilding requires correction unlock.
- Build/TypeScript/bundle budgets and lint pass. Four Chromium plus three visual
  operator flows pass; all four screenshot reviews pass. Manual image updated.
- Full source uses CI's `--no-file-parallelism`: **4,105 tests / 394 files pass**
  in 443.06 s. The unchanged 200 ms provenance timing assertion passes at
  90.793 ms. Exact candidate `8839da77` also passes the macOS packaged lifecycle
  validator: two launches, 4,096 fixes, matching Review before/after cleanup,
  forced restore interruption/restart recovery, no final plaintext residue.
  Main/current/frame maxima 53.051/60/15.201 ms remain below 200 ms. Receipt:
  `docs/evidence/pr6/review-remediation-8839da77-20260908.json`.
- DON-252 remediation comment `c97ee3e6-7422-451e-b4b5-750cd40d8f1b` records current
  proof and limits. Check CI against the current PR head before claiming remote
  verification. Visible findings are addressed/dispositioned; the five omitted
  Medium entries still require the source ledger. No merge or release.
- Linux CI `34284048832` on pushed `cb6e28a2` passed source/build/960k/tracking,
  but archive Review restore exceeded current-fix continuity by 7 ms (207/200).
  The failure receipt is preserved in `docs/evidence/pr6/` and the remediation
  ledger. A deterministic follow-up corrects M-4's extra cooldown: elapsed
  capacity waiting counts toward the already-clamped interval. All 197 affected
  tests, build and lint pass. Corrected source `4b9d2ceb` passes its exact macOS
  package smoke (two launches, forced interruption/restart, matching Review;
  main/current/frame 52.315/112/18.101 ms). Receipt is in `docs/evidence/pr6/`.
  The ordinary pushed-head Linux CI remains the remote gate; do not treat the
  rejected `cb6e28a2` run as green.
- CI `34286926496` (`d60cbc2a`) also rejected archive continuity at 200 ms;
  source/build/960k/tracking passed. Focused reference probes confirmed a full
  evidence queue waiting for persistence. A red regression then exposed
  redundant current-fix writes from already-persisted history render updates.
  Those publications now explicitly decline new evidence ownership; fresh
  history and the live queue retain durable acknowledgment. The 165 affected
  tests, build and lint pass. Focused packaged proof is pending. Diagnostic
  builds are not qualification; the discarded frozen-Proxy probe is invalid.
  Detailed timings and preserved failures are in the remediation ledger.
- The remaining cleanup lock wait was 1,074.4 ms. Foreground admissions now
  share a counter with cleanup, which waits outside transactions before taking
  another boundary. Same-workload diagnostic `53c2946c` completes both launches
  without a liveness failure; worst position-write DB duration is 48.35 ms.
  The 317 distinct affected tests, build and lint pass. Manual explains that
  busy live writes can slow cleanup. Clean implementation `25bcd332` passes
  unchanged macOS and reference four-CPU Linux packaged lifecycle validators;
  main/current/frame maxima 51.218/63/15.800 and 72.733/154/106.601 ms. Both
  cover two launches, matching Review, cleanup and interruption/restart with
  zero secret matches/final plaintext residue. Receipts are in `docs/evidence/pr6/`.
  Ordinary pushed-head CI is next; no fresh full-scale qualification is claimed.
