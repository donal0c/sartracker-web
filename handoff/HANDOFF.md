# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Detailed proof and rejected runs remain in
> `docs/breadcrumb-pr6-evidence.md`, `docs/breadcrumb-pr6-review-remediation.md`,
> and current `docs/breadcrumb-pr6-complete-review-ledger.md`.

## Current State

- Existing PR #10 / programme PR6, branch `codex/breadcrumb-pr6-archive-lifecycle`.
  Updated external ledger now contains all 95 findings (15 High, 4 Medium-High,
  55 Medium, 21 Low). All have a current disposition; expanded fixes are in
  progress. All 4,137 source tests and seven archive browser flows pass;
  all four screenshot reviews and clean macOS packaged smoke pass. The live
  final-head Linux CI result is maintained in PR #10 checks and DON-252/253.
- Latest implementation: `76ef77c145aa7fcc8cb013d6830177135ae87e50`, tree
  `43dc3fbab5930a1976c23c838473f886c6a4b215`. Subsequent receipts are documentation.
- Workspace: `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  Preserve this PR. No merge, release, replacement PR or reviewer dispatch.
- Donal authorized author-side completion, reference disposable tests and Linear
  updates. Old time/usage caps were lifted. No reset credit was used.

## Verified Remediation

- Expanded ledger: red-first regressions cover dialog state/identity handling,
  plaintext settlement and handle ownership, archive entry limits, legacy
  migration capacity, reconciliation races, IPC limits, tracking loss diagnostics
  and retry. Full serial suite passes 4,137 tests / 396 files (462.10 s);
  production build, TypeScript, bundle budgets and lint pass. Four Chromium and
  three visual archive flows pass (39.0 s); current cleanup screenshot matches
  the manual; all four screenshot reviews pass.
- Clean `76ef77c1` macOS arm64 packaged lifecycle passes two launches, 4,096 fixes,
  matching Review before/after 5,516 live-row removals, forced restore interruption
  and recovery, and full teardown. Main/current/frame maxima 51.407/59/18.5 ms;
  no exact secret matches or final plaintext residue. Canonical validator passes.
  Receipt: `docs/evidence/pr6/expanded-review-76ef77c1-macos-20260909.json`.
- Remaining limits are explicit in the complete ledger and manual; all 95
  entries are available. Temporary plaintext can survive a crash until restart;
  no managed-string zeroing or forensic erasure guarantee is made.
- Prior `10f39913` implementation passes macOS and reference four-logical-CPU Linux
  packaged lifecycle validators: two launches, 4,096 fixes, matching Review
  before/after cleanup, forced restore interruption/restart, complete teardown,
  zero exact secret matches and final plaintext residue.
- Maximum main/current/frame gaps: macOS 53.943/67/16.300 ms; Linux
  76.175/147/100 ms. Linux also passes with CI render tracing enabled at
  81.786/147/111.5 ms. All canonical receipt validators return valid/passed true.
  Receipts: `docs/evidence/pr6/review-remediation-10f39913-*-20260909.json`.

## Next Actions And Issues

- Check ordinary final-head Linux CI on PR #10 before author-side completion.
  Once green, remaining work is external review and separately authorized merge.
  Local source/build/lint, browser/visual and clean macOS packaged smoke pass.
  Baseline CI `34293902077` passed 4,113 tests before these new changes.
  The earlier `cb6e28a2` and `d60cbc2a` CI failures remain preserved.
  Run `34292650418` on `4e7061c5` was cancelled to finish M-2, not rejected.
  Do not repeat failed candidates without causal diagnosis.
- DON-248/252/253 remain In Progress pending review/merge; DON-252 retains
  Bug/Regression/Performance. PR body and Linear comments track current CI truth.
- No missing ledger entries remain. The complete ledger explicitly retains
  bounded global event pages, atomic correction restore, strict credentials,
  and permission-restricted plaintext staging with honest crash/restart limits.
- Do not automatically repeat the full large-fixture or 32-case interruption
  qualification. Donal requested proportionate fixes and smokes.

## Historical Proof And Evidence Safety

- Pre-review implementation `23f90f087e90d0aa145130d9c65b17815a630109` passed
  4,034 source tests, Linux CI `34231604598`, normal 960k Replay, macOS/Ubuntu
  packaged lifecycle and all 32 physical interruption cases.
- Its 5.24 GB encrypted archive / exhaustive 49-table field-scale run passed:
  all 1,181 writes durable, matching Review before/after cleanup, archive
  unchanged; creation heartbeat 52.810 ms, peak process RSS 367.3 MiB.
  Receipt: `docs/evidence/pr6/fieldscale-23f90f08-20260908.json`.
  These are historical results, not fresh full-scale proof of remediation.
- Original closed fixture on `donal@192.168.18.31`:
  `/home/donal/sartracker-pr6-final-fieldscale.RYyjkP/fixtures/mission-store-v12-closed.sqlite`.
  Never open it with SQLite; copy first. Preserved SHA256:
  `53fd13f87775529b46346a83519b823c50b22bd20297c489e0165d52ff3abcb6`.
- Reference remediation used an isolated checkout and disposable small fixtures.
  Engineering verification is not release/field acceptance or forensic erasure.
