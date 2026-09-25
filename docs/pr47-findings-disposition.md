# PR47 findings and follow-on register

Recorded by SAR coordination, 2026-09-25. This is a disposition index, not a
new implementation mandate or a claim of independent code re-verification.
The implementing task remains the sole editor of its PR checkout. Link this
record from the active workplan; do not create a parallel execution queue.

Sources: PR47 body; its task `01a0d014-c9fb-7e10-a26b-169f3b05ae55`;
`docs/two-track-execution-workplan.md`; and the byte-preserved independent
review at
[`docs/assurance/findings/pr47-review-5b4f0b25.md`](assurance/findings/pr47-review-5b4f0b25.md).
That review inspected source head `5b4f0b25`; it is historical evidence, not a
review of the later repair head. IDs below distinguish the original 15
findings (O), seven subsequent findings (R/P), six smaller review observations
(M), and later discovered failures (F).

## Evidence boundary

The behavior-bearing source head `0e6db8a26b62327055d76f1b61782e6d600caa96`
has a clean independent review and passing exact-source Linux run
`36116343282`. The independent Codex review was performed in the PR47 task;
its result is recorded here, but no GitHub review or standalone review report
was retained for that clean result. The only archived review report is the
historical review of `5b4f0b25`, which found seven issues. The subsequent
`58bb8a7837d3cb035f331d6ed3fdecf8f3fe269c` commit and later PR commits change
documentation only; no production or test files changed. A review of the
`df17e242` documentation delta identified an ambiguous handoff reference to
the archived report; that wording is corrected in this update. Refresh the
live branch tip and checks before a merge decision; do not transfer
source-head evidence to a different source tree. Merge, development probe
success, candidate qualification and release approval remain separate.

## Original review disposition (as recorded by the implementing task)

| ID | Finding | Recorded disposition |
| --- | --- | --- |
| O01 | Module-load startup deadline can reject healthy slow starts | Partly repaired: post-readiness timing; remaining slow-start policy below |
| O02 | Unbounded startup work | Async stages repaired; synchronous SQLite and never-ready Electron remain uncovered |
| O03 | Crash evidence prematurely cut off | Repaired: bounded pending-write wait |
| O04 | Competing log instances / writes | Repaired: one isolated writer and confirmed-stop safeguards |
| O05 | Passing receipt hides uncovered startup axes | Repaired: exclusions stay visible |
| O06 | Manual promises nonexistent Linux reporting | Repaired: manual aligned with implemented reporting |
| O07 | Timeout implies corruption / lacks stage | Repaired: named stage, no false corruption claim |
| O08 | Fake-timer filesystem test interference | Not reproduced; not a proven defect or fix |
| O09 | Product failure classified as infrastructure fault | Repaired: separate classifications |
| O10 | Independent reads unnecessarily serial | Repaired: parallel disjoint startup reads |
| O11 | Allegedly unreachable readiness branch | Disproved: rejected readiness is a valid path |
| O12 | Overlapping timeout helper abstractions | Optional cleanup only; no current release dependency |
| O13 | Self-fulfilling test assertion | Repaired: assertion removed |
| O14 | Missing issue references / progress records | Recorded addressed; DON-179 still owns unfinished upload scope |
| O15 | Oversized/stale handoff | Recorded addressed; preserve historical evidence separately |

## Subsequent seven findings

| ID | Finding | Disposition / remaining action |
| --- | --- | --- |
| R01 / P1 | A loaded operational window can be destroyed by a late startup timeout | Partial by selected design: the single 10-second deadline begins after Electron readiness and the normal window is not exposed until its fence succeeds, but a healthy startup still pending at that hard cumulative deadline fails. This is recorded as an operator-visible limit in the workplan and PR. Assess against representative field hardware before release; do not label all slow-start risk fixed. |
| R02 / P2 | Harness kills app then counts that as successful exit | Fixed: confirmed dialog dismissal starts a separate product-exit observation; the receipt requires code 1, no signal, `forcedKill === false`, and bounded `exitAfterDialogMs`. See `startup-probe.mjs:880-902, 1327-1368`, `startup-receipts.mjs:546-612`, and run `36116343282` held-gate receipts. |
| R03 / P3 | Disabled Linux scheduler accounting called measured | Fixed: `/proc/sys/kernel/sched_schedstats` must report `1`; otherwise scheduler evidence is explicitly unavailable with a code. See `build/main-event-loop-probe.js:121-160` and `tests/unit/main-event-loop-probe.test.ts:136-168`. The independent 200 ms main-loop gate remains authoritative. |
| R04 / P4 | Failed start snapshot yields a false measured delta | Fixed: if either snapshot is unavailable, `makeSchedulerDelta` preserves the unavailable status/code and emits no scheduler deltas. Regression: `tests/unit/main-event-loop-probe.test.ts:170-198`. |
| R05 / P5 | Unused `phaseMaximum` variable in the C19 smoke | Fixed by removal. The live script no longer declares it; `assertTimer()` still enforces the existing `<200 ms` gate at `scripts/electron-legacy-object-recovery-smoke.mjs:429-434`. No gate was weakened. |
| R06 / P6 | Held-gate budgets consumed the per-case timeout headroom | Fixed: lock-holder readiness has its own 5-second bound (`startup-probe.mjs:58, 1055-1072`); held-gate observation and post-dismissal product exit are separately bounded at 20 seconds, and the development case allows 120 seconds (`startup-receipts.mjs:16-19`, `producer-development-plan.mjs:24-34`). |
| R07 / P7 | Permanently false qualification fields looked dynamically satisfiable | Fixed as a clarity issue: `coverageComplete`, `qualificationEligible`, and `releaseEligible` are explicit `false`, with the uncovered axes and reason named (`startup-receipts.mjs:849-858`). This matrix remains development/partial evidence, not C01 qualification. |

## Smaller observations: final disposition

| ID | Observation | Scheduling / closure rule |
| --- | --- | --- |
| M01 | Internal timeout message implied a per-stage rather than cumulative budget | Fixed: `StartupTimeoutError` now says the shared deadline after Electron readiness expired while named stage(s) were pending (`electron/startup-watchdog.cjs:6-12`). `elapsedMs` is retained by the error/log path. |
| M02 | Nested watchdog attribution used one mutable `activeStage` | Fixed: the watchdog tracks pending stage names in a `Set`, and timeout errors carry all active names (`electron/startup-watchdog.cjs:24, 65-100`). The older single-field implementation is absent from the behavior-bearing head. |
| M03 | Exit allowance had to start at dismissal, not launch | Fixed: the observer records the confirmed dismissal timestamp and measures the exit delta from it (`startup-probe.mjs:1327-1368`); receipt and development-policy validators require that bounded delta (`startup-receipts.mjs:566-572`, `producer-development-policy.mjs:86-96`). |
| M04 | Required `hostPlatform` could reclassify historical failed receipts | Open before release reconciliation. The current legacy-recovery validator rejects a missing/unsupported `hostPlatform` (`build/legacy-recovery-report-validation.js:53-55`); the old raw receipt was not revalidated in this bookkeeping pass. Preserve Linux run `35984100420` as the original 261.161 ms FAIL and retain validator/version provenance. Resolve compatibility without changing that historical result to PASS or invalidating away its failure. |
| M05 | Mutable test profile binding could let late work use the next test directory | Retained optional harness hardening. The module-level path is deleted and reassigned in `afterEach` (`tests/unit/electron-main-startup.test.ts:20-21, 31-46`), so late async work could observe the next path. No cross-test write was reproduced; one regression waits for its write before teardown (`tests/unit/electron-main-startup.test.ts:856-862`). Capture the path per test if this suite is revisited; no product defect or new merge gate is established. |
| M06 | Workplan wording suggested an unsupported host-pause explanation | Not present in the current handoff/workplan. Their C19 statements say the 261.161 ms cause is unknown and the comparison does not establish cause or clear the failure. Keep that neutral wording; isolated timing passes do not establish root cause. |

## Later failures and repairs recorded during implementation

| ID | Finding family | Recorded outcome |
| --- | --- | --- |
| F01 | X11 click geometry, search syntax/title, empty-result handling and deadlines | Observer repaired; invalid historical observations retained, not product proof |
| F02 | Supposed held-I/O tests actually rejected files immediately | Real pending diagnostics write and held crash fsync added; rejection tested separately |
| F03 | Process remains alive after fault dismissal with blocked logger I/O | Runtime/crash I/O isolated; final held probes report product-owned exit and preserved profile data |
| F04 | Helper initialization/error lifecycle and requests after failure | Recorded repaired with lifecycle regression tests |
| F05 | Failed or never-settling crash write re-enters fatal handling / hides dialog | Rejections contained, evidence writes bounded |
| F06 | Crash-log API reports saved despite disk failure | Durable error-reporting write used; operator wording corrected |
| F07 | Exit/relaunch while writer may still own profile | Withheld until helper stop confirmed; retaining process/lock is intentional when safety cannot be proved |
| F08 | Pending/failed renderer evidence fence allows unsafe fatal relaunch | Fence bounded; failed/stuck fence prevents automatic relaunch |
| F09 | Missing crash error because receipt read the wrong log shape | Fixed in the held-gate receipt path: the probe separately emits structured `startupFailures` and text `startupFailureSummaries` from their respective runtime/crash sources (`startup-probe.mjs:924-927, 970-1023`); policy and receipt validation consume those fields (`producer-development-policy.mjs:32-54`, `startup-receipts.mjs:501-527`). Regression fixtures are in `tests/unit/qualification-startup-receipts.test.ts:203-230`. Run `36116343282`'s held-crash receipt contains `crashKinds: ["startupFailure"]` and the newer-schema failure summary; it also records product exit code 1, null signal, and no harness kill. |

## Outstanding queue: when each item comes back

1. **After Beta 13: live mission-store isolation.** Donal explicitly deferred
   this on 2026-09-25. See `post-beta13-mission-store-isolation.md`. Includes
   synchronous native startup/lookup boundaries, not only database opening.
   Never-ready `app.whenReady()` is a separate uncovered bootstrap case; assess
   in post-release startup resilience planning, not silently marked solved.
2. **Before release: timing evidence reconciliation and required candidate
   performance tests.** Historical C19 Linux 261.161 ms remains unresolved
   ([run `35984100420`](https://github.com/donal0c/sartracker-web/actions/runs/35984100420));
   the passing 50.836 ms current-master run does not explain
   or clear it. Retain the reported 216 ms mission-evidence, 224.6 ms
   legacy-recovery, 220.3 ms GPX, worker-import timeout and map-fixture
   archive-comparison failures from local runs as reported. Existing CI/run
   history remains the source for retained failures; raw files for all local
   observations were not recovered in this bookkeeping pass. Do not invent
   distinct defect counts or root causes, and do not overwrite the original
   receipts. Link original run/test output where available. Isolated or
   reduced-concurrency passes do not establish cause or erase failures.
   Existing release policy decides qualification; no new threshold.
3. **Existing DON-179 backlog:** explicit opt-in diagnostic upload, private
   storage and retention. PR47 does not complete this work. Do not pull it into
   the next release merely because this startup repair references DON-179.
4. **Before release: existing qualification work remains.** Exact candidate
   C01 applicable probes, other C00-C29 gates, C11, PKG-001 and human acceptance
   remain under the workplan. These are pre-existing programme work, not all
   defects discovered by PR47. Keep scope-limited/uncovered cases truthful.
5. **Post-release cleanup/harness planning:** optional O12 helper consolidation
   and M05 per-test path capture. M01-M03, M06 and R05 have source-confirmed
   dispositions above; do not carry them as open defects. No speculative
   implementation or new broad audit is authorized by this register.

Linear creation is currently blocked by its workspace issue limit. These local
records are the interim backlog; migrate/link to Linear when capacity permits.
SAR coordination must surface outstanding entries at the indicated planning
stage rather than relying on Donal to remember them.
