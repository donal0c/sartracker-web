# PR6 closeout history — archived 2026-09-09

Historical text preserved verbatim below. These are prior operating states, not
current instructions. See [current handover](../HANDOFF.md) and
[testing cadence](../../docs/testing-and-review-cadence.md) before new work.

## Previous handover

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

- CI `34321601249` rejected three default-five-second archive fixture timeouts
  and one 353.165 ms GPX write. Fixture deadlines now match their 60-second
  siblings; GPX's 200 ms gate is unchanged with added diagnostics. Both affected
  suites pass locally and on reference Linux (86 each); GPX cause was not
  reproduced. Full details and the rejected run remain in the complete ledger.
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

## Superseded workplan priority and recovery sequence

1. Execute the **Breadcrumb and Mission-History Programme** under the locked ADR and `docs/breadcrumb-programme-execution-policy.md`. PR-1 through PR-5 are merged. Breadcrumb programme PR-6—the archive-lifecycle stage owned by `DON-248`/`DON-252`/`DON-253` and distinct from merged WAR-01 GitHub PR #6—is being recovered on [PR #10](https://github.com/donal0c/sartracker-web/pull/10). The rejected-head history and causal evidence remain below; no rejected head is rerun unchanged. The current bounded order is to repair only confirmed blockers, freeze and review one candidate tree, run one full non-browser source cycle, commit/push an identical tree, then run one exact-head package/lifecycle attempt and stop before browser/visual, physical-kill, Linux, and Ubuntu gates. Strict `<200 ms` liveness and every archive/custody/cleanup boundary remain unchanged. This is pre-merge engineering work, not release or field acceptance. Donal retains approval/merge authority. After the exact merged head exists, run WAR-04B's narrow refresh before any release decision; BCP-17 must qualify one final candidate before `DON-255` may publish it.
   **2026-09-05 recovery update:** pushed head `d91ec232…` passed its sole exact
   macOS packaged lifecycle attempt, Chromium `173/173`, visual `62/62`, and uncached
   visual review `74/74`, then exposed a `create.seal` physical-kill oracle false
   negative. The ciphertext and registry/file identity were intact; the oracle
   searched for private operation identity on a public projection that omits it.
   D91 is rejected for final qualification. Exact-head Linux run `33935825755`
   passed through packaged tracking soak before a second proof-oracle race: the
   one-child readiness check accepted the participant empty-state paragraph and
   armed `create` while participant scope was still loading. The red-first
   successor now requires exact public and final operation-bound archive
   custody, plus exact durable/rendered participant readiness before initial and
   restarted liveness attribution. Each readiness IPC read is bounded by the
   remaining monotonic readiness budget. The strict 200 ms gate is unchanged;
   all final-head gates remain pending. A later candidate, `7e0d8ea3`, passed its
   exact package/lifecycle, Chromium `173/173`, visual `62/62`, uncached visual
   review `74/74`, and physical SIGKILL `32/32`, but final review rejected it for
   same-name mission identity, rendered-device identity, and sealed-archive
   recovery-readiness gaps. Linux run `33938682590` was cancelled and is not
   evidence. The current red-first successor binds the original mission UUID,
   exact device identity in durable and rendered state, and the production IPC
   archive projection plus recoverable v2 slot semantics. Its five-file harness
   identity includes that shared projector; strict liveness gates are unchanged.
   **2026-09-05 cadence rejection:** successor `b75f8689` passed its sole exact
   macOS package/lifecycle, Chromium `173/173`, visual `62/62`, uncached visual
   review `74/74`, and physical SIGKILL `32/32`. Linux run `33940959449` passed
   every earlier gate through packaged tracking soak, then the first pre-cleanup
   Review operation breached the unchanged current-fix gate at `240 ms`; this is
   valid cadence-failure evidence and b75 will not be rerun. The current red-first
   successor publishes current fixes without awaiting durable mission/cache work,
   transfers evidence into a globally capacity-bounded per-mission FIFO with durable loss accounting,
   bounds fallback-cache preparation to one active plus one latest state and
   5,000 cooperatively selected breadcrumb representatives, and bounds both
   renderer confirmation reads by their remaining monotonic deadline.
   **2026-09-05 operation-proof rejection:** exact local successor `b7793753`
   packaged cleanly, then its sole two-launch lifecycle attempt wrote a
   cleanup-complete 0600 receipt without any `>=200 ms` breach or diagnostics.
   The old resumed-restore check could accept a cumulative phase sample from a
   pre-operation in-flight source while the stricter named-operation fence
   correctly excluded it; completion then deleted the checkpoint before a
   generic error. B779 is proof-boundary-indeterminate and will not be pushed or
   rerun. The red-first successor requires resumed restore's own exact in-fence
   fix, establishes a new restore baseline before post-cleanup Review, and
   snapshots exact operation diagnostics before deletion without admitting
   post-work fixes or changing any strict deadline. All
   successor exact-head package/browser/visual/SIGKILL/Linux/review gates and the
   single fresh greater-than-2-GiB qualifier remain pending.
   **2026-09-05 cleanup-snapshot rejection:** exact local successor `30061c2d`
   packaged cleanly, then its sole lifecycle attempt failed immediately at
   cleanup start with closed `ARCHIVE_CLEANUP_FAILED`; the old IPC boundary
   discarded the internal diagnostic. A deterministic two-WAL-connection red
   regression reproduced `SQLITE_BUSY_SNAPSHOT` hidden inside the membership
   wrapper after a live-mission commit invalidated cleanup's deferred read
   snapshot. The smallest successor uses a non-blocking immediate transaction
   for each cleanup boundary and preserves bounded inventory-derived diagnostics
   through worker, IPC, Playwright, and the 0600 receipt. The strict `<200 ms`
   gate, cleanup scope, custody checks, and finite retries are unchanged. Its
   pre-freeze serial suite is `377/3,806`; replacement exact-head gates remain
   pending and 30061 will not be rerun.
   **2026-09-05 renderer-CDP rejection:** exact local successor `e9584e94`
   packaged cleanly and advanced through cleanup, then its sole two-launch
   lifecycle attempt rejected after `11,287 ms` during restore-phase
   `review_after_cleanup` with `renderer_cdp_watchdog_failed`. The mode-0600
   receipt retained 63 operation-fresh samples, a 64-sample phase delta, no
   current-fix timeout/continuity fault, all reported restore maxima below
   120 ms, and complete process/profile cleanup. It cannot distinguish timeout
   from rejection and is instrumentation-indeterminate, not product-stall
   evidence; e958 will not be rerun. The red-first successor aggregates Review
   in Node through sequential bounded-size transfers, reserves an exact-target
   second CDP connection for liveness, bounds both transport closes, and adds
   bounded renderer-CDP stage/cause attribution. Strict 200 ms liveness/queue
   bounds and all source, cleanup, custody, and continuity gates are unchanged.
   Its focused affected gate is `6/186`, the deterministic serial suite is
   `377/3,813`, full static/build/backend gates are green, and two independent
   reviews plus a real Chromium dual-client probe are clean. Those were
   pre-freeze source checks; the exact package/lifecycle attempt produced the
   rejection below.
   **2026-09-05 final-validation rejection:** exact local successor `ec258eba`
   packaged cleanly, then its sole two-launch lifecycle attempt rejected after
   `10,956 ms` on exactly one final evidence gate. Its mode-0600 receipt recorded
   no gate reason or liveness diagnostic, zero cleanup failures, and complete
   process/profile cleanup. The old receipt discarded the exact validator
   reason, so ec258eba is final-validation-indeterminate and will not be rerun.
   Source trace confirmed a harness defect that could accept a raw
   `199.9996 ms` maximum, round it to `200`, and then fail only the final strict
   validator; that is not claimed as the irrecoverable historical gate. The
   red-first successor preserves raw already-validated values and records
   bounded, sanitized final-gate reasons under a distinct classification.
   Malformed reason metadata retains a bounded receipt without inventing a gate
   count. The strict `<200 ms` gate is unchanged. Its affected set passes
   `6/250`, the deterministic serial suite passes `377/3,818`, full
   static/build/backend gates are green, and two independent re-reviews are
   clean. A replacement may advance only on a package and terminal receipt
   bound to its exact head.
   **2026-09-05 correction-custody rejection and finite-boundary closeout:**
   exact pushed head `20486b6c` passed its sole packaged lifecycle in
   `11,471 ms`, Chromium `173/173`, visual `62/62`, uncached visual review
   `74/74`, and physical `SIGKILL` `32/32`; all recorded liveness maxima were
   strictly below `200 ms`. Final review nevertheless found correction-
   consumer and combined custody/plaintext-cleanup races, so Linux run
   `33954733857` was cancelled and that head will not be rerun. The next source
   tree `840947d5fcacb66c64597f85f6a434753de621a9` was also rejected before
   packaging: audit reproduced a correction pathname-rebind race capable of
   redirecting rollback deletion outside custody and a lifecycle race that
   released staging ownership before terminal consumption. The successor
   prepared after that rejection removes both structures. Correction now uses
   a cwd-bound Electron utility process with an exact READY dev/inode handshake,
   one SQLite custody
   plan written before attachment bytes, recognisable operation-owned mode-0600
   target/peer hardlinks with exact `nlink === 2`, atomic plan-clear plus unlock,
   and non-destructive startup reconciliation. Follow-up audits then reproduced
   four more deterministic integration defects before freeze: the cancellation
   envelope could not cross Electron UtilityProcess IPC; a helper could remain
   alive after a terminal message; success and fallback were not bound to the
   exact correction operation; and full attachment hashing held SQLite's writer
   transaction. All four are repaired red-first. Cancellation is now message-
   based with bounded process termination, terminal and durable read-back both
   require the exact operation, ambiguous or residual state is durably fenced
   across restart, and reconciliation computes full byte proofs outside a short
   exact-plan/state/topology transaction. The corrected focused slice passes
   `8/102`; two independent correction audits are clean at `8/137` and `7/99`.
   Maximum 4,096-entry committed and near-4-MiB uncommitted measurements held
   the writer for `59.9-94.7 ms`, with every concurrent writer succeeding. The
   corrected changed-test matrix passes `20/628`; its first run also caught and
   closed one obsolete test-only UtilityProcess injection gap without adding a
   production fallback. Lifecycle now separates its preparation gate, durable active lease,
   pinned child staging, canonical terminal and consumed record. Exact active-
   owner checks govern every terminal boundary, success is exposed only after
   child cleanup and final read-back, same-head reuse is forbidden, and emitted
   or pre-observed wrapper exits must prove the full POSIX process group empty.
   Its focused slice passes `3/259` and its independent P1/P2 re-audit is clean.
   The first fully reviewed successor tree `91f8f3ed` was then rejected by its
   first full non-browser source cycle before commit or package: two of `3,960`
   tests crossed lazy-loaded cleanup/verification dialogs with a fixed 50 ms
   sleep and asserted before mount under suite load. Product code was not
   implicated. The tests now await the exact split modules inside React `act`,
   and the focused workspace file passes `14/14` without warnings. Its test-only
   successor then required bounded review before its source cycle;
   `91f8f3ed` is not rerun unchanged.
   That successor was frozen as `969bf644` after two clean delta reviews, then
   its first source cycle was rejected when Vitest reported the unchanged
   25,000-row tracking acknowledgement test at `6,815 ms` after it exceeded the
   generic 5-second timeout under parallel-suite contention (`3,959/3,960`
   passed). The persistence path is unchanged and the focused case passed in `1,695 ms`
   before the repair and `1,643 ms` after it. Because this is a semantic/compact-
   acknowledgement test rather than a latency gate, the replacement keeps the
   full workload and assertions and adds only a test-local 15-second ceiling.
   The packaged strict `<200 ms` liveness gate is unchanged; `969bf644` is not
   rerun unchanged.
   Behavioral tree `d5727b82` then passed two independent bounded delta reviews
   and its one full non-browser source cycle: `380/380` unit files and
   `3,960/3,960` tests in `84.33 s`, full ESLint, production build and bundle
   budgets, changed-script Node syntax, diff integrity, and backend `58` passed /
   `1` ignored. Any final status-only descendant must keep every non-doc blob
   identical to that reviewed and tested tree. This remains local source proof,
   not package, platform, release, or field acceptance.
   Earlier authenticated correction evidence, cross-archive custody, exact
   cleanup cursor continuity, 30-minute no-progress cancellation, and detached
   qualification supervision remain intact. The strict `<200 ms` gate is
   unchanged. No package, packaged lifecycle, browser/visual, physical-kill,
   Linux, or Ubuntu gate has run for this successor. This is frozen local source
   evidence, not package or platform proof.
   **2026-09-07 Donal-approved closeout order:** settle only those confirmed
   blockers and focused gates; finish docs/manual; normalize the tracked
   generated-version file to the current pre-commit HEAD and freeze one
   candidate content tree/manifest; complete
   renderer/operator, fresh broad, and affected persistence plus concurrency/
   liveness reviews against that exact tree; run one non-browser full local
   source cycle only if the tree remains unchanged; commit and explicitly fast-
   forward the existing PR branch only if the committed tree exactly matches
   the reviewed tree; package once with `EXPECTED_SOURCE_SHA` set to the new
   commit, restore the generated-version source file to its committed blob
   without rebuilding, verify the checkout is clean, and run the sole exact-
   head lifecycle once; then stop and report. Chromium/visual,
   physical-kill, Linux CI, and the single fresh Ubuntu greater-than-2-GiB run
   remain deliberately deferred beyond that stop. Passing the lifecycle is not
   permission to merge, release, or skip any deferred gate.
