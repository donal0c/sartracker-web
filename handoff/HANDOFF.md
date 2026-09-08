# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Current and historical proof is in
> `docs/breadcrumb-pr6-evidence.md`; older history is in `handoff/archive/`.

## Current State

- Existing PR #10 / programme PR6, branch `codex/breadcrumb-pr6-archive-lifecycle`.
  **Implementation qualification is complete.** External review remains.
- Qualified implementation: `23f90f087e90d0aa145130d9c65b17815a630109`, tree
  `9e783fd843373ab53cd27093769cf1f67c959034`. This closeout changes documentation
  and evidence only. Runtime proof stays bound to that implementation; verify
  unchanged application/test/build/dependency/workflow/script blobs on descendants.
- Workspace: `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  Preserve the existing PR. No replacement PR, merge, release or reviewer dispatch.
- Donal authorized finishing all author-side work through review readiness and
  approved reference disposable tests/Linear updates. Old time/usage limits were
  lifted; no reset credit was used or authorized.

## Verified Result

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
  remain intact. No operator controls/wording/workflow changed; manual is current.

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
- Finish the documentation-only push, verify latest branch CI, and mark the existing
  PR ready for external review. Record final head/CI in PR/Linear rather than making
  another documentation commit just to record its own SHA.
- Do not repeat expensive runtime qualification for this documentation-only closeout.
  External review and Donal's approval/merge are the next human steps.
