# Independent review — PR #47 (`codex/c01-startup-store-fault-response`)

## Inspection provenance

- Worktree: `/Users/donalocallaghan/.codex/worktrees/7486/sartracker-web`
- Inspected HEAD: `5b4f0b256c87bafaf1b7a6bc0e8b14267f044fca` (`git rev-parse HEAD`)
- Worktree state at inspection: **clean** (`git status --porcelain` empty)
- Diff base: `git diff origin/master...5b4f0b25` after `git fetch origin` — 19 files, +1462/-191
- Live PR check (read-only): PR #47, `headRefOid = 5b4f0b256c87bafaf1b7a6bc0e8b14267f044fca`, `isDraft: true`, `mergeable: MERGEABLE`. The head now matches this review; the handoff's claim that GitHub still points at `8cdf6f62` is stale as of this inspection.
- Local verification I ran: `npx vitest run tests/unit/electron-main-startup.test.ts tests/unit/electron-startup-watchdog.test.ts tests/unit/main-event-loop-probe.test.ts tests/unit/legacy-recovery-report-validation.test.ts tests/unit/qualification-startup-receipts.test.ts tests/unit/qualification-producer-development-policy.test.ts` → **6 files, 123 passed**. That reproduces the PR's focused-suite claim. I did not run the full correctness suite, lint, build, packaged smoke, or any browser/Playwright check.
- I read the changed product, test, qualification, smoke, manual and planning code directly. I did not take the PR's finding table or the prior review at face value; every disposition below was re-derived from the code at this SHA.

## Verdict summary

The watchdog itself is a clean, well-tested piece of work: one monotonic deadline, armed only after `app.whenReady()`, shared (not reset) across stages, correctly disposed, and it does not leave an unhandled rejection when the timer fires with no stage racing it. The 200 ms C19 gate is genuinely unchanged and strictly extended, and the docs do not claim the macOS smoke clears the retained Linux failure.

There are **7 actionable findings**. P1 is a behavioural risk in the product (a startup that *succeeds* slowly is now fatal). P2 and P3 are gaps in the evidence the PR relies on to claim the behaviour is proven — both are cases where a passing receipt does not establish what it appears to establish.

---

## Actionable findings

### P1 — A fully successful but slow startup is now killed, discarding a loaded window

`electron/startup-watchdog.cjs:50-64` and `electron/main.cjs:362-370`, `1487`

**Affected condition.** `run()` re-checks the cumulative deadline *after* the operation resolves (`startup-watchdog.cjs:52`) and rejects, and the `Promise.race` at line 64 rejects as soon as the single 10 s timer fires regardless of the stage's health. The budget is cumulative from readiness across all eight wrapped stages, and the last two wrapped stages are `operational window content load` and `operational renderer availability fence` (`main.cjs:362`, `367`) — i.e. the deadline is still enforced after a `BrowserWindow` exists and the renderer has finished loading.

**Failure scenario.** Cold launch on a field laptop: large mission profile, on-access AV scanning, encrypted or network-backed `userData`. Every stage completes successfully but cumulative post-readiness elapsed reaches 10 001 ms while `markRendererAvailable()` is resolving. `run()` throws `StartupTimeoutError`, `createWindow` rejects, `startElectronApp` rejects, `handleStartupFailure` shows *"Startup could not complete because operational renderer availability fence did not finish within 10 seconds…"* and calls `app.exit(1)` — destroying a window that had fully loaded. Because the cause is a slow profile rather than a fault, this repeats on every launch: the machine becomes unusable for the incident rather than merely slow. Before this PR the same launch produced a working app in ~11 s.

**Concrete repair.** Separate "pending at the deadline" (a hang — keep failing closed) from "completed after the deadline" (slow — log and continue):

1. Stop enforcing the deadline once a usable shell exists. Call `startupWatchdog.dispose()` immediately after the `operational window content load` stage resolves, and run `markRendererAvailable()` unwrapped (it is a local fence over already-durable state, not a blocking dependency).
2. For a stage that resolves after the deadline but before any shell exists, keep the reject. For the post-shell case, emit `runtimeLog.append({ level: 'warn', event: 'startup_response_budget_exceeded', fields: { stage, elapsedMs, timeoutMs } })` and continue.
3. Keep the existing `startup-watchdog.cjs:52` recheck — it is the only thing that can catch a synchronous stage that blocks past the deadline (the case `tests/unit/electron-startup-watchdog.test.ts` "rejects a stage that returns after the deadline even if the timer could not run" exists for) — but scope its fatal outcome to pre-shell stages.

If Donal decides that an unconditional exit is the wanted trade-off, that is a legitimate call, but it should be recorded explicitly in the workplan as *"a slow-but-healthy startup will be terminated"*, because that is the operator-visible consequence and it is not currently written down anywhere.

---

### P2 — The held-gate receipt proves the dialog appeared; it does not prove the product exits itself

`scripts/qualification/startup-receipts.mjs:475-476`, `526-532`; `scripts/qualification/startup-probe.mjs:816-823`, `845-855`; `scripts/qualification/producer-development-policy.mjs:26-28`

**Affected condition.** The new `validateHeldGateResponse` (`startup-receipts.mjs:478-497`) tightens the *dialog* half of the held-gate predicate. The *closure* half is still `validateClosedProcess(..., 'faultShellAtMs')` with `requireExit` defaulting to `false` (`startup-receipts.mjs:476`, `526`), so it accepts `process.closed === true` and never inspects `exitCode`, `signal` or `forcedKill`. Meanwhile the producer (`startup-probe.mjs:816-823`) dismisses the dialog and then **immediately** SIGTERMs, with no grace period and no `waitForProcessExit` before the kill. `inspectHeldGateDevelopment`'s `actionable` predicate (`producer-development-policy.mjs:26-28`) likewise checks only `faultShellAtMs`.

**Failure scenario.** Regress `handleStartupFailure` so `app.exit(1)` is never reached — e.g. `waitForStartupEvidenceWrites` is changed to `await evidenceWrites` without the cap, and the held `crashes/crash-log.json` FIFO makes `crashLog.record()` never settle. The app shows the dialog at ~10 s, the harness observes it in-bound, dismisses it, then SIGTERMs. `closed: true`, `dialogObservedAtMs ≈ 10 000`, `faultShellAtMs` equal, `timedOut: false` → `validateHeldGateResponse` passes, `validateClosedProcess` passes, `producerCheckPassed: true`. A product that hangs forever after showing the dialog earns a PASS. This is exactly the producer-vs-harness confusion the strengthening was meant to remove: the held gate is the *only* scenario in the matrix that exercises the new watchdog, and it does not assert the product's own fail-closed termination.

The pattern needed already exists in this file — `runNewerSchemaScenario` / `runNativeFaultScenario` (`startup-probe.mjs:1049-1052`, `1253-1257`) do `await waitForProcessExit(appProcess, 10_000)` after dismissal and record `exitAfterDialogMs`, and their receipts use `requireExit = true` (`startup-receipts.mjs:341`).

**Concrete repair.**
1. In `runHeldGateScenario`, after `dismissErrorDialog` (`startup-probe.mjs:817`), add `const processExit = await waitForProcessExit(appProcess, STARTUP_FAILURE_EVIDENCE_TIMEOUT_MS + 2_000).catch(() => null)` before the SIGTERM fallback, and record `exitCode`, `signal` and `exitAfterDialogMs` measured **from dismissal** (not from launch — the modal box is operator-gated, so exit time cannot be bounded from `launchStartedAt`).
2. Change `startup-receipts.mjs:476` to `validateClosedProcess(scenario.process, label + ' profile', failures, 'faultShellAtMs', true)` and add `scenario.process.forcedKill === false` to `validateHeldGateResponse`.
3. Add `scenario.process.forcedKill === false && scenario.process.exitCode === 1 && scenario.process.signal === null` to the `actionable` predicate in `producer-development-policy.mjs:26`.

---

### P3 — Linux scheduler evidence is not fail-closed when kernel schedstat accounting is disabled

`build/main-event-loop-probe.js:122-146`, `211-262`

**Affected condition.** `readThreadSchedulerSnapshot` reads `/proc/thread-self/schedstat` and accepts any three finite non-negative numbers as `status: 'measured'` (line 129-141). `validateMainPhaseEvidence` then only requires each delta to be `>= 0` (line 240-244). But `sched_info.run_delay` and `sched_info.pcount` — fields 2 and 3, the run-queue wait and time-slice counters — are only updated when the kernel has `CONFIG_SCHEDSTATS` **and** `kernel.sched_schedstats=1`. With schedstats off, the kernel still reports `se.sum_exec_runtime` for field 1 but leaves fields 2 and 3 at 0. Ubuntu ships `sched_schedstats=0` by default.

**Failure scenario.** Exact-head Linux CI runs on a host with `sched_schedstats=0`. Every phase records `status: 'measured'`, a plausible `threadRuntimeMs`, and `threadRunQueueWaitMs: 0`, `threadTimeSlices: 0`. The gate passes. If a future run reproduces the retained 261.161 ms interval, the evidence will show "run-queue wait 0 ms" — which reads as *"the thread was never descheduled, so this was not a host scheduling pause"* — when in fact the counter was never populated. That is precisely the inference this instrumentation exists to support, and it can be wrong in the direction of a false conclusion about a retained life-safety-adjacent performance failure.

**Concrete repair.** Read `/proc/sys/kernel/sched_schedstats` once inside `readThreadSchedulerSnapshot` (or check that the *absolute* `pcount` in the start snapshot is `> 0` — by the time the probe installs, the main thread has been scheduled thousands of times, so an absolute zero is definitive). Record the result as an explicit `schedstatsEnabled` field on the phase evidence, and in `validateMainPhaseEvidence` fail the Linux branch with `status: 'unavailable', code: 'SCHEDSTATS_DISABLED'` when it cannot be confirmed enabled. Do not gate on the per-phase *delta* being non-zero: a short synchronous phase that never yields can legitimately add 0 to both counters.

(Version risk checked and cleared: `process.getBuiltinModule` is used at line 126 and Electron `^40.10.0` bundles Node 22.x, which has it. But note the macOS smoke short-circuits at the `platform !== 'linux'` check on line 124, so the entire `/proc` path has zero executed coverage outside the unit test's stubbed `root` — Linux CI is the first real exercise of it.)

---

### P4 — `makeSchedulerDelta` reports `status: 'measured'` with no measurements when only the start snapshot failed

`build/main-event-loop-probe.js:160-168`

**Affected condition.** `status: start.status === 'not_linux' ? 'not_linux' : end.status`. When `start.status === 'unavailable'` and `end.status === 'measured'`, this yields `'measured'` — but the branch is the *non*-measured branch, so `threadRuntimeMs`, `threadRunQueueWaitMs` and `threadTimeSlices` are absent, while `code: end.code ?? start.code ?? null` still carries the start failure's code. The emitted evidence is self-contradictory: `status: 'measured'` alongside `code: 'ENOENT'` and no deltas.

**Failure scenario.** A transient `/proc` read failure at `startPhase` on Linux (`EINTR`, or the file briefly unreadable) with a successful read at `finish`. The phase records `status: 'measured', code: 'EINTR'`. `validateMainPhaseEvidence` does fail closed here (the `threadRuntimeMs` check on line 240 sees `undefined`), so no gate is wrongly passed — but the retained receipt now asserts "measured" for a phase with no measurement, and any future consumer keyed on `status` alone (a report renderer, a comparison script, a human reading the JSON) is misled.

**Concrete repair.** `status: start.status !== 'measured' ? start.status : end.status` — prefer the snapshot that actually failed. Keep `code` as-is.

---

### P5 — `phaseMaximum` is computed and never used in the C19 smoke

`scripts/electron-legacy-object-recovery-smoke.mjs:247`

**Affected condition.** `const phaseMaximum = Math.max(...mutation.phaseTimings.map(phase => phase.mainLoop.maximumGapMs))` has no reader. It is not asserted on, and the `console.log` at line 266 re-derives per-phase values independently rather than using it. The line reads as an assertion that was drafted and dropped.

Note the 200 ms gate is **not** weakened by the deleted `assert.ok(mutation.timer.maximumGapMs < 200, …)` on the preceding line: `assertTimer(mutation.timer, 'restart')` at line 246 already contains that exact assertion (`scripts/electron-legacy-object-recovery-smoke.mjs:433`), and `validateMainTimer` (`build/legacy-recovery-report-validation.js:326`) plus the new per-phase check (`build/main-event-loop-probe.js:257`) both enforce it. The removal was genuinely redundant. This finding is only about the orphaned variable.

**Concrete repair.** Delete line 247, or fold it into the summary line as the headline number. In a gate script for a retained failure, a dangling `Math.max` over the gated quantity invites a future reader to assume it is enforced. (It also suggests `no-unused-vars` is not reaching `scripts/**` — worth a separate look, since the PR reports lint green.)

---

### P6 — Raising the held-gate bound 4× consumed the per-case development timeout headroom

`scripts/qualification/startup-receipts.mjs:9`; `scripts/qualification/startup-probe.mjs:932`; `scripts/qualification/producer-development-plan.mjs:26`

**Affected condition.** `C01_HELD_GATE_TIMEOUT_MS` went from 5 000 to 20 000 ms. The same constant is also reused as the lock-holder readiness bound in `startStoreLockHolder` (`startup-probe.mjs:932`), which is an unrelated helper wait. The per-case owned-process timeout in the development plan is still a fixed `timeoutMs: 60000`.

**Failure scenario.** `C01-held-store` worst case: profile seeding + up to 20 s waiting for `C01_STORE_LOCK_READY` + 20 s dialog observation + 2 s SIGTERM wait + 2 s + cleanup ≈ 45 s before profile snapshotting. On a loaded CI runner this can cross 60 s, giving `timedOut: true` → `infrastructurePassed: false` → exit 1. That is an intermittent infrastructure failure indistinguishable at the gate from a real one, on the branch whose whole purpose is to prove bounded startup.

**Concrete repair.** Give the lock holder its own small constant (5 000 ms is ample for a child printing a ready line), and raise `producer-development-plan.mjs:26` to at least `120000` with a comment tying it to `C01_HELD_GATE_TIMEOUT_MS`.

---

### P7 — `coverageComplete` / `qualificationEligible` are now statically false but written as if dynamic

`scripts/qualification/startup-receipts.mjs:772-773`

**Affected condition.** `valid && STARTUP_PROBE_DESCRIPTOR.uncoveredAxes.length === 0`, where `uncoveredAxes` is a frozen four-element literal (`startup-receipts.mjs:63-72`). Both fields are unconditionally `false` at this SHA, no matter what evidence is produced. The replaced comment explicitly warned against exactly this: *"a valid receipt must not remain permanently incomplete because other tiers or external acceptance are still pending."* This PR reverses that decision without saying it is reversing it.

I checked the blast radius: the only consumer, `validateLegacyStartupReceipt` (`scripts/qualification/legacy-startup-receipts.mjs`), reads `recomputedPredicates` only, so C19 is unaffected, and `settings-receipts.mjs` / `package-smoke-receipts.mjs` already hardcode `false`. So this is a clarity and decision-record problem, not a broken gate.

**Concrete repair.** Write `coverageComplete: false` / `qualificationEligible: false` with a one-line reason naming the uncovered never-ready bootstrap axis, matching the sibling receipt modules — or derive from the axes *this tier is meant to cover* so the expression can actually become true. Record the reversal of the previous "must not remain permanently incomplete" decision in the workplan.

---

## Confirmed correct (things I checked and found sound)

- **No unwrapped await in the bounded startup path.** Every `await` in `startElectronApp` (`main.cjs:1309-1493`) and in `createWindow` (`main.cjs:275-370`) goes through `startupWatchdog.run`. There is no gap where the timer could fire with nothing racing it and the fault be deferred to a later stage. The `startupWatchdog === undefined` branches in `createWindow` are reached only from the macOS `activate` re-open path (`main.cjs:1580`), which is correctly outside the startup deadline.
- **Single deadline, not per-stage.** `startedAt` is captured once at construction and never reset; `run()` also rejects up front if the budget is already spent. Verified by `tests/unit/electron-startup-watchdog.test.ts` and the `13_500` cumulative test in `electron-main-startup.test.ts`.
- **Monotonic, not wall clock.** `performance.now()` throughout; the "wall clock moves backwards" test injects a 60 s `Date.now` regression and the bound holds.
- **No unhandled rejection.** `void timeoutPromise.catch(() => undefined)` covers the fire-with-no-racer case, and `Promise.race` attaches a handler to `task`, so a losing `task` rejection is also handled. `dispose()` runs in `.finally()` before `.catch(handleStartupFailure)`, so the timer is cleared on both paths.
- **Parallel startup reads are safe.** `storageDiagnostics.initialize()` touches `userData/storage-diagnostics.json`; `crashLog.hadUncleanShutdown()` touches `userData/crashes/*`. Disjoint paths, and only the former writes. No race.
- **Logger reuse is real and serialized.** `electronRuntimeContext.runtimeLog/crashLog` are set before the first bounded stage (`main.cjs:1301-1303`), so `handleStartupFailure` reuses the same instances; `runtime-log.cjs:53-57` and `crash-log.cjs` both serialize writes behind a chain. The tests assert `createCrashLog`/`createRuntimeLog` called exactly once.
- **The 200 ms gate is unchanged and strictly extended.** `assertTimer` still `< 200`; `validateMainTimer` still `>= 200` fails; the new `validateMainPhaseEvidence` adds a per-phase `>= 200` failure. For a short phase with `samples: 0` the monitor's final `sample()` makes `maximumGapMs` equal the phase duration, so a single >200 ms blocking operation now fails where the aggregate might have averaged it away. This is a tightening.
- **The retained Linux failure is not cleared.** Both `handoff/HANDOFF.md` and the workplan state that run `35984100420` at 261.161 ms stays unresolved, that master's 50.836 ms does not explain it, and that the macOS phase gaps (1.62/0.16/1.74 ms) cannot supply Linux scheduler evidence. No overclaim. One wording caution below.
- **Probe serialization still works.** `readThreadSchedulerSnapshot`, `makeSchedulerDelta` and `createEventLoopMonitor` are nested inside `installMainEventLoopProbe`, so the three `Function.prototype.toString()` injection sites still capture them, and the new code contains no backtick or `${` that would break the template-literal wrappers at `electron-tracking-soak.mjs:1040` and `electron-breadcrumb-transport-smoke.mjs:114`. `Object.freeze` on the returned probe is safe — no caller assigns to it.
- **Test isolation is handled.** The `vi.spyOn(performance, 'now')` / `vi.spyOn(Date, 'now')` stubs are restored: the file's `afterEach` calls `vi.restoreAllMocks()` (`electron-main-startup.test.ts:30`). The project vitest config sets neither `restoreMocks` nor `clearMocks`, so that explicit call is what makes the new fake-timer tests safe — worth keeping in mind if anyone refactors that hook.

## Minor / non-blocking

1. **`StartupTimeoutError.message` mis-describes a cumulative budget** — `startup-watchdog.cjs:7` reads `Startup step "<stage>" did not finish within 10000 ms`, but the stage may have run for 3 ms and merely been the one holding the baton when a shared budget expired. The operator-facing copy (`main.cjs:1316`) is better — *"…did not finish within 10 seconds after Electron was ready"*. Align the internal message, and note the runtime log already carries `elapsedMs` for disambiguation (`main.cjs:1268-1276`).
2. **`activeStage` is a single mutable field across nested runs** — `startup-watchdog.cjs:45`. `run('operational window startup')` nests `run('operational window content load')` and `run('operational renderer availability fence')`, so attribution is "whichever `run()` most recently started", not an explicit stack. It currently yields the innermost (most useful) stage, but that is incidental. A small stage stack would make it intentional.
3. **Held-gate bound vs. product worst case** — `C01_HELD_GATE_TIMEOUT_MS` (20 s) is exactly `C01_STARTUP_RESPONSE_TIMEOUT_MS` + `STARTUP_FAILURE_EVIDENCE_TIMEOUT_MS` (10 s + 10 s, `main.cjs:16-17`). That happens not to matter today because the bound is applied only to dialog observation, and the evidence cap starts *after* the modal box is dismissed. If P2 is fixed, the exit allowance must be measured from dismissal, not from launch, or the numbers collide with zero margin.
4. **New `hostPlatform` requirement can reclassify retained receipts** — `build/legacy-recovery-report-validation.js:53-55` now fails any report lacking `hostPlatform`. The test fixture works around it by injecting `report.hostPlatform = 'linux'`. If the retained 261.161 ms report is ever re-validated with the current validator it becomes `INVALID_EVIDENCE` rather than the recorded 200 ms FAIL — turning a known failure into "unreadable evidence". Consider accepting an absent `hostPlatform` on pre-instrumentation receipts as `'unknown'` so the historical failure cannot be laundered.
5. **Per-test userData path is read from a mutable module binding** — `electron-main-startup.test.ts:20-21`, `34`, and the `app.getPath` mock at line ~2178 read the module-level `testUserDataPath` at call time. In-flight async work leaking past `afterEach` resolves against the *next* test's directory. The per-test path is still a clear improvement over the shared one; capturing the path per test (pass it into `createElectronMock`) would close the remainder.
6. **Workplan wording leans toward the host-pause hypothesis** — *"The latter makes a one-off host pause more plausible but does not prove scheduler/storage cause"*. The comparison is against a run whose ASAR differs, with no scheduler telemetry on either side, so "more plausible" is not supported by anything in the receipt. It stops short of attributing the failure and explicitly refuses to clear it, which is correct, but I would drop the plausibility clause and label it a hypothesis with no supporting telemetry — otherwise it reads as the beginning of an attribution.

---

## Review of the original 15 findings

| # | PR disposition | My finding |
|---|---|---|
| 1 | Partially fixed / open — module load and readiness excluded; sync SQLite open/migration still outside the bound | **Confirmed, accurately scoped.** The budget starts inside the `whenReady().then()` callback (`main.cjs:1189-1193`), so module load and readiness are genuinely excluded. `createElectronMissionStore` at `main.cjs:1366` calls `new Database(databasePath)`, three `pragma` calls and `migrate(db, …)` synchronously (`mission-store.cjs:581-585`) — during that block the event loop cannot run, so the `setTimeout` cannot fire and `Promise.race` cannot preempt. Correctly recorded as open. |
| 2 | Partially fixed / open — awaited async stages bounded; never-ready Electron and sync SQLite unbounded | **Confirmed, with one refinement.** I verified every `await` on the startup path is wrapped. But the PR should say plainly *which* wrapped stages are actually preemptible: the filesystem stages (`storage/crash-state inspection`, `session start marker`, `archive review sweep`, `restart diagnostic`, window load) are genuinely bounded, whereas `active mission lookup` → `getActiveMission(db)` is a **synchronous** better-sqlite3 query (`mission-store.cjs:3015`). Wrapping it changes nothing if it blocks. The `tests/unit/electron-main-startup.test.ts` "applies the same watchdog to a later active-mission read" test proves the wrapper, not preemptibility, because it injects a never-resolving promise. Refine the disposition to "async stages bounded; synchronous SQLite stages are wrapped but not preemptible". |
| 3 | Fixed — evidence writes awaited with a 10 s cap only for pending writes | **Confirmed.** `Promise.allSettled` + `startBestEffortStartupWrite` (which also absorbs a synchronous adapter throw) + `waitForStartupEvidenceWrites` racing a cleared timer (`main.cjs:1240-1264`). The dialog is shown *before* the wait, so the operator response is not delayed by held writes — verified by the "shows the C01 startup fault before blocked crash and runtime log writes settle" test. |
| 4 | Fixed — same logger instances, serialized writes | **Confirmed.** `main.cjs:1301-1303` sets both on `electronRuntimeContext` before the first bounded stage; `handleStartupFailure` reuses via `??`; `runtime-log.cjs:53-57` serializes. Note the consequence: a `startup_failure` append queues behind any earlier pending append, so on a hung log mount the entry may never land — but the 10 s cap keeps the exit fail-closed. |
| 5 | Fixed — passing receipts still name the uncovered axis and remain ineligible | **Confirmed in effect, but see P7.** `uncoveredAxes` is now returned unconditionally and the new axis text is present and asserted. The mechanism chosen makes `coverageComplete`/`qualificationEligible` statically false via a dynamic-looking expression, reversing the previous explicit decision without recording the reversal. |
| 6 | Fixed — manual no longer promises launcher/system-log output | **Confirmed.** `public/manual/index.html` now states that Electron writes to stderr pre-readiness, that visibility depends on how the app was launched, that application logs are unavailable until initialization completes, and that the app does not write to the system log. That matches `handleStartupFailure`'s `app.isReady()` gate exactly. |
| 7 | Fixed — timeout copy names the stage, distinguishes deadline from corruption | **Confirmed.** `main.cjs:1316` includes *"This timeout does not mean the mission data is damaged; no corruption was confirmed."* Stage names are hard-coded literals so nothing operator-derived reaches the dialog or the log fields. See minor #1 for the internal message wording. |
| 8 | Not reproduced — fake-timer tests mock log adapters | **Confirmed.** Every new `vi.useFakeTimers()` test substitutes `./crash-log.cjs` and `./runtime-log.cjs`. No fake-timer test drives the real filesystem logger. |
| 9 | Fixed — product-gate vs. infrastructure failure use separate exits | **Confirmed as implemented, but the predicate it gates is weak — see P2.** The exit-2 / exit-1 split is correct: `inspectHeldGateExecution` treats `exitCode === 2` as process completion only when `mechanics.infrastructurePassed === true && producerCheckPassed === false`, `??` correctly does not swallow a `false`, and `productCheckPassed !== false` leaves non-mechanics cases neutral. The separation is sound; what it classifies is not yet sufficient. |
| 10 | Fixed — independent startup reads run in parallel | **Confirmed and safe.** Disjoint paths, single writer. The "starts independent diagnostics and crash-state reads in parallel" test asserts both are invoked before either settles. |
| 11 | Disproved — the `isReady() === false` path handles a rejected readiness promise | **Confirmed disproved.** `handleStartupFailure` is on the `.catch()` of the `whenReady()` chain; with `isReady()` false it skips `getPath`, writes nothing, shows the dialog and exits 1. The test asserts `app.getPath` was never called. |
| 12 | Retained as optional cleanup — distinct semantics | **Agreed, and I would leave it alone.** The watchdog deadline and the evidence-write cap have different clocks, different scopes and different outcomes (fail startup vs. stop waiting and exit anyway). Merging them would couple two unrelated bounds. Setting `STARTUP_FAILURE_EVIDENCE_TIMEOUT_MS = C01_STARTUP_RESPONSE_TIMEOUT_MS` (`main.cjs:17`) is the one thing I'd revisit — the aliasing is what makes the worst case exactly equal to the held-gate bound (minor #3). Give it its own value. |
| 13 | Fixed — removed the assertion that only repeated the mock value | **Not independently verifiable at this SHA** (the removed assertion is not in the diff and I have no copy of the original finding text). The surviving assertions in the new tests check observable behaviour — `showErrorBox` arguments, `app.exit(1)`, `BrowserWindow` not constructed, call counts on injected factories — rather than echoing injected values, so nothing of that shape remains in the changed tests. Accepted on that basis. |
| 14 | Issue references present; DON-179 update follows exact-head checks | **Confirmed for the commits** — all five commits in the range carry `[DON-179]`. The Linear update remains genuinely outstanding; I did not query Linear. |
| 15 | Fixed — handoff compressed | **Confirmed.** `handoff/HANDOFF.md` is now current state / active work + verification / next actions with a pointer to the workplan, and it states the C01 synchronous-open gap and the pre-readiness gap in the handoff itself rather than only in the PR body. It matches the etiquette rules in `CLAUDE.md`. One staleness item: it says GitHub "still points to `8cdf6f62`… and reports a merge conflict plus a failed Linux check", which is no longer true — the PR head is this SHA and GitHub reports `MERGEABLE`. |

---

## What is bounded vs. what is not

Stated plainly, because the distinction is the whole substance of this PR:

**Bounded by the 10 s post-readiness watchdog.** Asynchronous filesystem work on the startup path: storage-diagnostics state read/write, crash-state inspection, session-start marker persistence, the previous-session renderer fence, restart diagnostic persistence, archive-review startup sweep, interrupted-cleanup recovery setup, renderer URL load, renderer availability fence. A hang in any of these now produces a named, actionable native error and a non-zero exit, because libuv performs the blocking `open`/`read` on a threadpool thread and the main event loop stays free to service the timer. This is real and it is what the held FIFO gates exercise.

**Not bounded — synchronous native SQLite.** `createElectronMissionStore` (`main.cjs:1366`) is not wrapped and could not be usefully wrapped: `new Database()`, the three pragmas and `migrate()` run synchronously on Electron main (`mission-store.cjs:581-585`). While they run, no timer fires and no race resolves. The same applies to any wrapped stage whose body is synchronous better-sqlite3 work — `active mission lookup` is the clearest example. The `held-store-gate` scenario is therefore bounded by better-sqlite3's own 5 s busy timeout rather than by the watchdog, and the resulting error is a generic `SQLITE_BUSY`, not a `StartupTimeoutError`, so the operator sees the generic message rather than a named stage. A corrupt store, a long migration, WAL recovery, or a network-mounted profile under `synchronous = FULL` remains an unbounded blank-window startup.

**Not bounded — pre-readiness.** `app.whenReady()` is outside the deadline by design. If readiness never settles, nothing fires: no dialog, no log, no exit. If it *rejects*, the fail-closed path works but writes no evidence (no `userData` access before ready), and on Linux the error box degrades to stderr. Both limits are now documented in the manual, the handoff and the workplan.

**The C19 261.161 ms result.** Retained and unresolved. The new per-phase instrumentation is a genuine improvement — it splits the previously-opaque interval into `marker-mutation` / `prepare-close` / `close` with wall, CPU, main-loop and (on Linux) scheduler deltas, while keeping the combined 200 ms gate. But it has produced **no Linux evidence at all** yet: the only run is the macOS smoke, where `readThreadSchedulerSnapshot` returns `not_linux` at the first check and the entire `/proc` path is unexecuted outside a unit test with a stubbed `root`. Combined with P3, the first Linux run may also produce all-zero run-queue-wait counters that look like evidence and are not. The instrumentation should not be treated as diagnostic capability until an exact-head Linux run demonstrates non-zero scheduler deltas.

## Remaining blockers and limits on this review

- Fresh exact-head Linux CI has not run. I could not and did not verify it.
- I ran only the six focused unit files (123 passed). No full correctness run, lint, production build, packaged smoke, Playwright, visual, or browser check was performed by me. The PR's claims for those are plausible but unverified here.
- The packaged macOS smoke receipt cited in the PR was produced from a dirty tree and is diagnostic only, as the PR itself states.
- No held-gate scenario has been executed at this SHA in my session; my P2 conclusion is derived from reading the producer and validator code, not from a failing run.
- I did not read Linear. DON-179 status and the pending progress update are taken from the PR and handoff text.
- Draft status is correct and should hold. P1 should be resolved or explicitly accepted in writing before this leaves draft; P2 and P3 should be resolved before any held-gate or C19 receipt from this branch is cited as proof of bounded behaviour.

AGENT_MAIL_DONE_PR47_5B4F0B25
