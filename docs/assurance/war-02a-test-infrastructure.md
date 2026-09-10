# WAR-02A deterministic test infrastructure

Starting source: `083f504753089abfcce9decdee8348dc069f03b8` (fetched master,
2026-09-10). Assurance owner: DON-254. Scope is additive test infrastructure;
production, Repair Train A and existing regression files remain untouched.

## Contract defined before implementation

- A virtual scheduler owns integer milliseconds and stable insertion order at
  equal deadlines. Tests explicitly schedule poll, mission-switch, restart,
  teardown and worker-completion events. Cancellation removes pending work;
  backward time, invalid delays and runaway queues fail visibly. It does not
  pretend to virtualize native SQLite, operating-system workers or Promise jobs.
- Named asynchronous gates expose an entered receipt and require explicit
  release. Integration tests await those receipts, never wall-clock sleeps,
  polling retries or an arbitrary number of microtask flushes. Native work is
  awaited before its completion is delivered at a selected virtual event.
- A fault plan targets an operation, before/after boundary and occurrence.
  EIO/ENOSPC are injected errors; interruption is a distinct test error, not
  an OS power-loss claim. An unused armed fault fails the test. Traces show
  attempted/completed operations and the exact injected boundary.
- Filesystem adapters wrap real disposable files, including file write, file
  sync, rename and directory sync. SQLite backup errors are injected at the
  application/native-call boundary; this does not emulate SQLite's VFS, torn
  sectors or filesystem journal replay.
- Real production renderer coordination and rolling backup controls are
  exercised through existing seams. Test-only CommonJS dependency isolation
  must not replace global modules or change production files. Historical
  negative controls disable one named safety property in the test boundary;
  the same assertion must fail, while the current control passes.

## Safety and proof limits

No product rules are introduced. SAR-QA-001/007/020 constrain retained evidence;
SAR-QA-002 keeps current position independent of evidence work. The source is
the [indexed Q&A](../breadcrumb-team-question-and-answer-ledger.md) and its
raw transcript. Scheduling labels describe test events, not new mission rules.

The target is T1/T2 local evidence, not browser, package, power-loss, provider,
multi-machine, soak, release or field qualification. PST-002 and IPC-002 remain
open at their broader proof boundaries. AUD-13/AUD-02/AUD-03 remain Repair Train A.

## Planned verification

First run helper contract tests red before implementation. Exercise all five
lifecycle event kinds, equal-time ordering, cancellation, invalid time, bounded
execution and explicit gates. Test before/after EIO, ENOSPC and interruption,
fault hit accounting, real file preservation, SQLite old/new snapshot contents,
and renderer evidence across mission switch and restart. Run the two historical
controls in green and deliberately disabled modes with identical safety oracles.
Then run focused suites and one stable serial source suite, lint and build.
Independent exact-head architecture and determinism/fault reviews follow the PR;
affected rechecks and cumulative review follow any remediation.

## Implemented boundary and use

All helpers and tests live in `tests/unit/assurance/war-02a/`. The default Vitest
include already collects this directory; no runtime, dependency or CI gate was
changed. Its own `tsconfig.json` checks helpers strictly because the application
build intentionally does not type-check test files.

| Helper | Contract and limit |
| --- | --- |
| `virtual-scheduler.ts` | `schedule(label, delay, callback)` and `advanceTo(ms)` explicitly order events. Equal deadlines use insertion order. Timer adapters leave global timers untouched. Reentrant advancement and a finite dispatch-budget overrun throw. Callbacks dispatch synchronously; they must not return a Promise. `assertIdle()` detects leftover events. |
| `createGate(name)` | `wait()` exposes an `entered` receipt; the driver then chooses `release(value)` or `reject(error)`. Arrival and settlement are one-shot. `assertSettled()` catches unreleased or unused gates. Native work and Promise jobs remain outside virtual time; tests join them through receipts rather than time guesses. |
| `fault-plan.ts` | One fault per plan, addressed by operation, before/after boundary and 1-based occurrence. `run()` records a before event, invokes the real operation, then records after. A before fault prevents invocation; an after fault reports failure after the effect. The exact native error is retained when the native call itself rejects. `assertTriggered()` rejects a missed injection. |
| `fault-filesystem.ts` | Real handle write/writeFile and file/directory sync, rename and remove. Other filesystem calls pass through. Paths on wrapped operations are lexically restricted to a disposable trusted root; this is not a symlink security sandbox. It never fills the real disk or damages another profile. |
| `sqlite-backup-adapter.ts` | Real `better-sqlite3` online backup, with faults before/after the native backup call and an optional held completion delivery. It closes the native connection before the gate. It replaces the worker runner only inside the isolated test; its returned thread ID is a test acknowledgement, not evidence of a real worker. SQLite page-write/fsync/VFS faults, worker-thread isolation and OS-kill recovery are not covered. |
| `isolated-commonjs.ts` | Evaluates the checkout's complete CommonJS module with direct-dependency overrides; does not patch `require.cache`, globals or on-disk source. Negative controls use one exact source anchor and refuse missing/ambiguous matches. Transitive dependencies remain real and unmodified. |

The scheduler's five-kind replay test is a harness capability demonstration,
not a test of the production tracking poller. Joined production tests cover
mission switch, teardown timeout, native completion delivery and store restart.
This deliberately avoids Repair Train A's polling/stationary regression seams.

Example driver pattern:

```ts
const completion = createGate<void>('worker-completion')
// The adapter performs native work, then calls completion.wait().
const operation = adapter.run(input)
await completion.entered
clock.schedule('worker-completion', 20, () => { completion.release() })
clock.advanceTo(20)
await operation
completion.assertSettled()
clock.assertIdle()
```

## Historical controls and falsification

Renderer scope: fix `0c674e81e97f0376bff268d181d99a1583cd1556`
(`DON-276`/`DON-275`) broadened teardown loss ownership beyond the active mission.
The new test finishes mission A, creates B, stages the real durable incident at
a virtual soft deadline, then delivers loss or a successful drain. It closes
and reopens the real store and checks both missions' evidence health. The lost
case goes red when the isolated coordinator's scope query is filtered to the
active mission: A incorrectly comes back healthy. The successful-drain control
checks that provisional uncertainty remains retractable.

Backup atomicity: fix `1799b2cad4c4403d692dc316d3f0cd4798d0f9dc` (`DON-232`)
replaced direct mirror writes with temporary copy plus rename. Its historical
full integrity scan is **not** restored by this harness. The new test creates a
good mirror, changes the live SQLite rows, injects a failure and independently
reads bytes and SQLite rows. The negative control sets the temporary destination
to the mirror inside isolated source evaluation. The rename-error case then
loses the good mirror and fails the same preservation assertion.

These are targeted semantic mutants of current code, not a claim to replay
every line of an old checkout. Neither edits production files. The source suite
runs `negative-controls.test.ts`, which invokes the proof driver and requires
both current controls to pass and both disabled controls to fail. The driver
uses structured Vitest results and checks the named safety assertion; an import,
timeout, missing native module or arbitrary test failure is not red proof.

## Repeatable commands

```sh
npm test -- tests/unit/assurance/war-02a --no-file-parallelism
node scripts/assurance/war-02a-prove-red.mjs
npx tsc -p tests/unit/assurance/war-02a/tsconfig.json
npm test -- --no-file-parallelism
npm run lint
npm run build
```

Manual red-only commands intentionally exit 1 and must never be reported green:

```sh
WAR02A_NEGATIVE_CONTROL=renderer-active-only npm test -- tests/unit/assurance/war-02a/renderer-lifecycle.test.ts -t 'historical renderer scope: lost'
WAR02A_NEGATIVE_CONTROL=backup-direct-target npm test -- tests/unit/assurance/war-02a/backup.test.ts -t 'historical backup atomicity: EIO before file.rename'
```

## Evidence ledger

- Before implementation: two helper suites failed collection because the
  scheduler/fault helpers did not yet exist; the filesystem/backup suites then
  failed for their missing adapters. These are test-first setup failures, not
  historical defect proof. Reentrant-clock and unreleased-gate checks subsequently
  failed at assertions before their guards were implemented.
- Focused implementation: 7 files / 54 tests pass. The separate proof driver
  records two current-control passes and two failures at their named safety
  oracles. The strict test-infrastructure type check passes.
- Stable source cycle on the implementation worktree, Node 22.22.3/macOS arm64:
  `npm test -- --no-file-parallelism` passed 422 files / 4,325 tests in 471.78 s.
  `npm run lint` and `npm run build` passed, including bundle budgets. The build's
  generated version metadata was restored to its original blob; there is no
  production diff. A subsequent test indentation change is whitespace only.
  Local logs are in ignored `tmp/war02a/`; these are local source results, not CI
  or package evidence. Independent exact-head reviews remain pending.

The 24 filesystem cases cover EIO, ENOSPC and injected interruption before/after
write, file sync, rename and directory sync. The 12 SQLite/mirror cases cover
the same codes before/after native backup and rename. After rename the new whole
file is visible even if acknowledgement fails; it is not claimed rolled back.
Injected interruption runs JavaScript cleanup. Abrupt process death, power loss,
partial native page writes and filesystem journal recovery remain unqualified.
