# Beta13.1 rejected Chromium gate — DON-254

Release remains HOLD. Tag `electron-v0.1.0-beta.13.1` is unchanged at
`2ff4d5742649da016a52c0e682f404d17df8c5dd`. Release run
[36225417118 attempt 1](https://github.com/donal0c/sartracker-web/actions/runs/36225417118)
passed serial correctness, strict responsiveness and build, then failed five of
225 Chromium tests (220 passed). Packaging never started; no draft or artifact
was produced. All five reproduced locally on unchanged source with `CI=1`, one
worker, zero retries and tracing enabled. Original logs and local traces/screenshots
are retained in the source owner's ignored `tmp/beta131-browser-rejection/`.
The failed GitHub run uploaded no trace artifacts; remote traces are unavailable.

| Failure | Confirmed cause / category | Repair | Verification |
| --- | --- | --- | --- |
| Expanded layer tree scroll, layer-panel:120 | Product CSS: `min-h-fit` lets the wrapper grow beyond the workspace, leaving the inner tree with no scroll range. | Restore bounded flex child with `min-h-0`. | Original positive-scroll/refresh assertions pass; added real-wheel outer-scroll and >96px viewport intersection proof, screenshot at 1280x720. |
| Concurrent map alerts, map:328 | Test fixture: injected real overlay IDs are cleared by successful asynchronous overlay recovery. | Isolate presentation fixtures with test-owned warning IDs. | All visibility, geometry, wheel, focus, keyboard and final-card assertions pass; top/bottom screenshots reviewed. |
| Offline diagnostics, settings:100 | Browser adapter: request persistence method absent, runtime correctly refuses history HTTP before admission. Fixture also used stale July telemetry. | Session-backed request/batch adapter; current fixture timestamp. | Original history-window, HTTP 503 and secret-redaction assertions pass. |
| Subsecond history cursor, settings:144 | Same absent adapter prevents history requests entirely. | Same adapter. | Original request-count and subsecond-fix assertions pass. |
| Large hosted history, settings:245 | Same absent adapter leaves only two current positions. | Same adapter through existing retention cap. | Original exact 2,000-row assertion passes. |

## Contract and safety boundaries

Source tracing locates the sidebar constraint in `51acca120`, the mandatory
request-persistence gate in `42f9f3057`, and the warning stress fixture in
`abf55127b`. These identify the relevant edits, not a bisected last-good candidate.
The first jointly confirmed bad artifact is the rejected Beta13.1 source above;
no last-good complete Chromium run has been established in this investigation.
Ordinary source CI runs selected browser gates and omitted these three spec files;
the release-only full suite exposed the gaps. Source CI now replaces its
coverage-only Chromium step with the same full Chromium command as release CI;
only the diagnostic output directory differs. Coverage remains included once,
alongside all other standard cases; specialized browser configurations remain.
Both source and release jobs always retain browser failure artifacts. Two new
workflow contracts failed before this change and pass after it. Exact-final-head
Linux full-suite success is required before recommending merge or a new tag.
The new adapter unit regressions also provide an earlier gate; all original
end-to-end assertions remain.
This is browser/source evidence only, not packaged or deployed behavior proof.

The existing [hosted testing plan](../hosted-browser-testing-plan.md) and
[team feedback guide](../team-testing-feedback-loop.md) define session storage,
capped histories and limited browser recovery. This repair does not make the
browser an operational persistence system. The adapter records request targets
and the last acknowledged chunk as **transport receipts**, not completeness
frontiers. It never exposes `listTrackingHistoryCheckpoints`; after runtime restart
history is fetched again from its authorized start, rather than skipping evicted
rows using a misleading saved cursor. Native persistence and fail-visible request
admission remain unchanged. No coordinate transformation or native database change.

Candidate state is written atomically to session storage before memory changes or
acknowledgement. The existing 2,000-row cap and 500-row emergency quota retry remain;
failure of both writes rejects admission. Receipt metadata is bounded to one row
per mission/device and contains no credentials. The original UI assertions, timeouts,
20-second correctness limit and strict 200 ms thresholds remain unchanged.

Five new adapter regressions failed before implementation, then 46 focused
adapter/store tests passed. Independent review prompted strict timestamp reuse
(three invalid-time cases red, then green), an emergency-quota success case and
same-store memory assertions; final affected unit suites pass 50 tests. All five
browser cases pass together, first attempt, on final code (25.0 seconds).
The final local macOS Chromium run passed all 225 tests in 6.4 minutes, with no
failures or retries, under the release Playwright configuration (`CI=1`). This
does not substitute for the pending Linux source-CI preflight. Adapter and
rendered visual reviews accepted the final change.
Final serial correctness passed 583 files / 6,043 tests, with 26 existing skips
(`npm run test:correctness -- --no-file-parallelism`, 592.34 seconds).
`npm run lint` and `npm run build` passed, including types and bundle budgets.
Exact-head Linux checks remain pending. This is a bounded PR repair;
no next tag until required checks pass. The previous Beta13 correctness rejection is separately preserved
in the Beta13.1 release note. Neither rejected tag may be moved or reused.

## Release-path audit disposition — 2026-09-26

Donal authorized these bounded additions and coordinator-arranged independent
Claude review on the stable exact head. The original local audit is retained at
`/Users/donalocallaghan/workspace/vibes/sartracker-web/tmp/claude-release-path-audit-findings.md`.

| Finding | Disposition and evidence boundary |
| --- | --- |
| F1: Debian version mismatch | Strictly map candidate `0.1.0-beta.13.2` to Debian `0.1.0~beta.13.2` in all four comparisons. Inspect real control Version before extraction. Retained Beta13 control metadata confirms builder tilde encoding; this is not final-candidate installation proof. Positive retained identity failed before correction; wrong-beta and unsupported-format regressions reject. |
| F2: C27 controls | No control or acceptance mutation. C27 stays unattempted until its prerequisites pass. Review/check/scanning/push-protection gaps require Donal's decision; an enforced independent approval requires an eligible distinct GitHub reviewer. Local reviews do not satisfy that approval. |
| F3: artifact lifetime | Release installers now retain for 90 days, matching browser evidence. Final admission must still inspect actual `expires_at` and sufficient remaining campaign margin. |
| F4: pre-tag validation | After reviewed merge, require the full Linux validation workflow_dispatch on that exact source: responsiveness, tracking soak, 960k, archive lifecycle and launch, before creating the next immutable tag. |
| F5: failed browser evidence | Both source and release jobs always upload browser results; release identity uses the resolved tag commit and run attempt. First-attempt error contexts and first-retry traces are retained according to the existing Playwright configuration. |
| F6: flaky-pass release | Both full Chromium commands add `--fail-on-flaky-tests`; existing diagnostic retries and workloads remain. A controlled synthetic first-fail/retry-pass probe returned exit 1 with one flaky test, proving enforcement. |

The combined focused audit suites passed 119 tests. Independent native review found
no blocking F1/F3/F6 issue; it did not itself run tests. Direct subprocess call-order
coverage for real Debian inspection is not added here; strict mapping and retained
identity regressions cover version admission, and final real package inspection
remains mandatory on Linux. Final correctness/lint/build passed as recorded above;
exact-head Linux 225-test success remains pending. No authentication transport redesign is included:
public metadata is accessible without credentials, while archive/draft access needs
supported authentication. Ubuntu OAuth was canceled before approval; see the owned
Ubuntu report for the bounded endpoint probe and current prerequisite state.

Unresolved F2 adapter defect: a reproduced effective-rule array with the existing
zero-approval `pull_request` entry before a qualifying one-approval/resolved-thread
entry still reports missing review enforcement, because the assessor uses the
first match. A hypothetical second ruleset is therefore not a verified solution.
CoS explicitly excluded aggregation changes from this repair. Current controls
remain unmet; no campaign compilation or C27 attempt follows. The write-permitted
collaborators are technically eligible reviewers, but their availability is unknown.
Any no-bypass PR gate would supersede the direct-master exception. Controls and
auth decisions do not block completion of this repair PR.

## PR54 first-head rejection and bounded follow-through

Head `a92266f92d8ef2aae20f6b83403e288b86c2e2c5` was accepted by native and
coordinator-arranged Claude code review (Claude independently ran 31 focused tests).
Linux run [36230930233](https://github.com/donal0c/sartracker-web/actions/runs/36230930233)
then correctly failed the new no-flaky-pass gate: 223 passed, two passed only on
retry. All five original failures passed. Package and packaged-check jobs passed;
dispatch-only qualification remains unrun. Correctness/browser job duration was
24m56s, so this run does not justify increasing its 60-minute timeout.

The uploaded correctness artifact `10902771746` is retained locally under
`tmp/pr54-first-rejection/`. It contains first-attempt DOM error contexts and
successful first-retry traces; the configuration did not capture first-attempt
screenshots or traces. Those absent artifacts are not claimed. Unchanged local
macOS focused cases passed 2/2, so controlled regressions establish the causes:

| Finding | Cause and retained evidence | Bounded correction / verification |
| --- | --- | --- |
| mission-review:123, Escape leaves marker dialog open | Shared dialog defers focus through an effect and animation frame; an immediate key targets outside the panel, while docked Review correctly yields to a modal. CI DOM shows marker still open. Deterministic immediate-commit keyboard/focus regressions fail twice on old code. | Focus synchronously in the layout effect, retaining panel-scoped Escape and opener restoration. Two new regressions plus focus helpers pass; 83 affected unit tests and 31 affected browser cases pass. |
| ui-feedback-batch:176, roster error absent | Global first-call rejection can be consumed by unrelated settings readers. CI DOM already shows Ops Lead. A controlled settings-updated refresh makes the original error assertion fail on the old fixture. | Keep test settings unavailable for every reader until explicitly restored immediately before Retry. Preserve original error/recovery/visibility assertions and observed competing read. No product settings behavior change. |

Original focused cases pass 2/2 without retries after these corrections. The stable
full local macOS Chromium run passed 225/225 in 6.1 minutes, with no failures or
retries (`CI=1`, `--fail-on-flaky-tests`). Stable serial correctness passed 584
files / 6,045 tests with 26 existing skips (595.28 seconds); changed source/test
hashes remained unchanged. Lint, types, build and bundle budgets passed. Renewed
exact-head review/CI remain pending.
Sol's single unchanged Ubuntu focused diagnostic passed 2/2 first attempt and
stopped; it did not reproduce the flakes. Ubuntu 24.04.2 differs from the GitHub
22.04 full-suite/contended environment. First-attempt traces/screenshots and their
hashes are retained in Sol's closed receipt; see the canonical Ubuntu report.

Accepted nonblocking review follow-ups remain in DON-254: observe actual job margin;
browser-only conservative history refetch can duplicate rows and consume the cap
sooner (defer deduplication with regressions); add direct browser-backfill and Linux
runtime/package/control-inspection coverage. No broader change is included.
C27 retained-attempt and compile-bound acceptance rules remain unchanged.
Sol's read-only duration audit found no structural conflict with the maximum
seven-day acceptance window: named multi-day scenarios are accelerated workloads.
Main-process timeout allowances total 75h17m, excluding repeated I/O, transfers,
reviews and other overhead; this is neither a measured runtime nor a whole-campaign
upper bound. The route remains unapproved. Any acceptance must be bound only when
exact artifacts, authentication, inputs and schedule are ready before compilation.
No workload, duration or acceptance definition changes accompany this repair.

## PR54 second-head rejection and browser-driver repair

Linux run [36233554495](https://github.com/donal0c/sartracker-web/actions/runs/36233554495)
on `9b0340921e6468f454bd8500803af41f5fbab3a6` rejected 224 passes plus one
retry-pass. Earlier repair assertions passed. The roster test then failed at
its final asynchronous `page.evaluate`, with the terminal-period message
`Execution context was destroyed, most likely because of a navigation.`
Its first-attempt DOM was retained; no first-attempt trace/raw protocol error
exists. The successful retry cannot supply that missing causal evidence.

One local and one Sol-owned Ubuntu focused diagnostic did not reproduce it.
Three separately scoped Linux diagnostics also passed all 225 tests without
retries: broad tracing (36236267303, 19.4m), target-only tracing (36237908638,
13.0m), and raw protocol-error observation (36239522155, 11.6m). The last
observer installed/restored cleanly and saw no later navigation/context loss
or raw error; one external map-tile request remained pending at test end.
These runs are diagnostics, never replacements for required source CI.
Repeated unchanged-source full diagnostics have diminishing value and stopped.

Installed Playwright 1.59.1 rewrites unclassified protocol errors to the same
navigation wording. Independent Claude analysis proposed a V8 promise-GC
mechanism. Its first synchronous synthetic probe passed all four cases;
Claude corrected that design after source inspection showed its GC ran before
the inspector attached the weak promise handle. The original receipt is retained.
One corrected app-free probe, settling in a later task before a finite GC
microtask chain, reproduced the exact wording at two hops. The raw error was
`Runtime.callFunctionOn`, `-32000`, `Promise was collected`; the page body had
completed with no navigation or context destruction. Other hop counts passed.

The same six-case evaluated function passed once in an isolated Playwright
1.63.0 / Chromium 153.0.8010.12 control. The candidate's bundled private driver
prevented reuse of the old raw hook; completion and lifecycle observations
were retained, without patching dependencies. Primary source provenance:
[Playwright manifest](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/browsers.json),
[Chromium DEPS](https://github.com/chromium/chromium/blob/153.0.8010.12/DEPS), and
[V8 fix](https://github.com/v8/v8/commit/5177b10891e65108c1a19dfc56bff4e58d79d216).
Chromium pins V8 `0b60d2b01800d7ba2c6eeb5e51ecd95f6dab44c7`; GitHub compare
confirms that fix is its ancestor. Original-negative/corrected-positive/control
receipt SHA-256 values are respectively
`a0825b5ff6e9f2a76c6906a1da2da26a95da1268a16eda6f43435adf3cf99c7b`,
`a8a953833f5e7ce2b05ad8551fb131f02da1afa88f85681254c0fb2d0a5f9ba7`, and
`467655f74bd46f69e5498c07b6a3686c374ec00bfbb06c73c1a625792a72d366`.
Detailed commands and receipts remain under `tmp/` and DON-254.

The bounded repair pins only the Playwright test toolchain to 1.63.0 and adds
an app-free browser-driver regression. Its dedicated process exposes GC,
runs six finite cases with zero retries, asserts successful evaluations,
execution counters and no navigation/context destruction, and retains JSON
evidence. The ordinary application browser configuration and all 225 SAR
tests are unchanged. Linux source CI, release preflight and local beta
verification require the separate driver gate. The three Playwright lock
entries change and their obsolete optional fsevents dependency is removed;
no Electron/application dependency or application behavior changes.
The same pin also replaces the Playwright `_electron` automation driver used by
the packaged Electron smoke, soak and qualification harnesses (`scripts/electron-*.mjs`)
and by local `beta:verify` steps `tracking-soak-ci` and `smoke`. Local toolchain
evidence below covers browser configurations only; no 1.63 `_electron` harness run
is claimed. Required evidence for that surface is exact-head Linux "Packaged Linux
checks" on 1.63 (run 36241851816), then the full merged-source Linux
workflow_dispatch before any tag.

Runner-level red on 1.59.1 fails the predicted two-hop assertion; green on
1.63.0 passes. Gate tests pass 25/25; lint and strict standalone type-checking
of the new driver files pass. Full serial correctness passes 584 files / 6,046
tests with 26 existing skips (580.28s); production types/build/bundle budgets
pass. Independent native delta review accepted without blockers. New-toolchain
WAR-06 passes 3/3 (5.0s), WAR-11 6/6 (17.1s), Train C 6/6 (35.0s), and the full
Chromium suite 225/225 (5.9m). All browser runs used one worker, zero retries
and flaky-pass rejection. No owned browser-server listeners remained. Logs and
the attached driver receipt are retained in `tmp/pr54-toolchain-verification/`
with SHA-256 inventory. Exact-head Linux CI remains pending.
The synthetic driver defect is confirmed; attribution of the original SAR
failure remains **suspected, not proven**. No diagnostics waive the original
failed gate, exact-head Linux validation, merged-source qualification or
Donal's merge/publication authority. No operator manual change is needed for
this test-only toolchain delta.
