# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Detailed current and historical proof is in
> `docs/breadcrumb-pr6-evidence.md`; older history is in `handoff/archive/`.

## Current State

- Existing PR #10 / programme PR6, branch `codex/breadcrumb-pr6-archive-lifecycle`,
  remains **draft and unqualified**. HEAD `0f09f3615dfb810758b8ad1dee545ebb90a70a7a`.
- Workspace: `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  Preserve this PR; the old 44b1 task is retired evidence only.
- Donal authorized continuing until ready for external review, everything else
  complete. Former time/usage/few-hours limits were lifted; no reset is authorized.
  Scope stays frozen. No merge, release, reviewer dispatch or team contact.
- Donal explicitly approved reference source transfer for remaining disposable
  tests and Linear updates. Both succeeded; do not ask again for the same actions.

## Latest Qualification And Correction

- Exact 0f09 macOS/reference Ubuntu packaged lifecycle validators pass; physical
  kill matrix passes 32/32; Linux CI `34218858249` passes every step. Source
  passes 4,032 tests, lint/build and four archive browser flows on that candidate.
- Its large run `q-e06fa31d-97cc-41a5-896b-48612f9ae49a` ended 13:05:44 UTC after
  95 minutes with **LIVENESS_GATE_FAILED**. It verified a 5,244,082,405-byte archive,
  completed 11,652,544 logical deletions and acknowledged all 1,119 writes, none
  rejected. Peak RSS 375,525,376 bytes passes the 512 MiB gate.
- Create heartbeat **1849.141 ms fails**. Migration/verify/restore/cleanup pass at
  68.426/56.378/76.518/51.632 ms. Post-cleanup Review/final proof were not reached;
  teardown remains incomplete and disposable profile cleanup is false.
- Preserve `tmp/pr6-0f09f361-fieldscale.failure.json` and remote disposable
  `/tmp/sartracker-breadcrumb-pr6-qualification-1pBO3u`. All owned run processes
  ended. The earlier 611 failure/profile remain preserved too; see evidence doc.
- Extending the admission-only SQL regression through real sealing reproduced two
  unbounded legacy history reads. The local fix prepares history again after
  creation and requires fresh bounded reads before/inside the atomic custody
  commit. Recovery does the same. No transaction crosses a yield; custody,
  predecessor, membership, exact-fence and journal checks remain.
- Red-first regression passes admission/complete/restart 3/3; 68 focused lifecycle,
  boundary, scan and custody attack tests pass. A paired read-only large-copy
  diagnostic returns the same result: old reads block 36.577 seconds; prepared
  reads take 0.021 ms after cooperative preparation, maximum heartbeat 51.087 ms.
  This isolates the scan under its own cache regime; it is not qualification.
- Full source passes **4,034 tests / 385 files**, 217.99 seconds with loopback
  permission (`tmp/pr6-seal-full-source-permitted.log`). Lint/build/TypeScript/
  bundle budgets pass; archive browser flows pass 4/4 in 13.6 seconds. The first attempt had
  16 mock-server failures caused by sandbox `EPERM listen 127.0.0.1`; its log
  `tmp/pr6-seal-full-source.log` is retained. No product change or gate waiver
  was made for those failures.
- No operator control, wording or workflow changed. Existing manual and
  legacy-Replay limitation remain applicable.

## Reference And Evidence Safety

- Host `donal@192.168.18.31`; old clone
  `/home/donal/sartracker-pr6-astra-c2c04dca` stays clean at 6118026c.
  Isolated candidate: `/tmp/pr6-scale-diagnosis-20260908.UBHDZo/candidate-0f09f361`.
- Original closed v12 fixture:
  `/home/donal/sartracker-pr6-final-fieldscale.RYyjkP/fixtures/mission-store-v12-closed.sqlite`.
  **Never open the original with SQLite; copy first.**
  Size 4,159,836,160 bytes, one link, mode 0600. Post-run SHA256 still matches
  `53fd13f87775529b46346a83519b823c50b22bd20297c489e0165d52ff3abcb6`.
  Last free disk: 94 GiB. Failed profiles are retained intentionally.

## Issues And Next Actions

- DON-248/252/253 remain In Progress; DON-252 retains Bug/Regression/Performance.
  Latest Linear comment `9a7ca8c2-9292-493b-964e-e567f891127d` records the scale
  failure and bounded sealing correction.
- Local sealing verification is complete; commit/push the verified correction.
  Then exact candidate package/kill/CI/reference checks and
  full >2 GiB qualification. Do not repeat an unchanged rejected run.
- Only after complete passing evidence, finish docs/Linear/PR description and mark
  the existing PR ready for external review. Documentation-only descendants may
  reuse runtime evidence with explicit unchanged-source binding; latest CI must
  pass. Do not trigger expensive reruns merely to change a documentation SHA.
- Every liveness dimension stays strictly below 200 ms. Archive evidence remains
  immutable; cleanup is logical deletion, never operational VACUUM or erasure.
