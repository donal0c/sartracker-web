# Breadcrumb PR6 Archive Lifecycle Evidence

This record binds `DON-248` / BCP-14, `DON-252` / BCP-15 and `DON-253` /
BCP-16 to one pull request. It is pre-merge engineering qualification, not
production, release, live-Traccar, original-field-machine, SAR-team custody-
tabletop or forensic-erasure proof. Opening a PR or reaching a candidate head
is intermediate. Donal retains approval and merge authority.

## 2026-09-07 Astra recovery of b3fb01fa

### d392181b cleanup/live-write correction and e6b6e3e0 baseline

The responsive-writer correction below is pushed as
`d392181b3958c21948e926a6785358be91da1926`, tree
`a1a48582881ed1caa2cf626f06ed172ebc9b901c`. Exact-head macOS lifecycle passes
two launches in 11,060 ms: main 52.723 ms/frame 18.3 ms/current fix 27 ms.
Canonical receipt `tmp/pr6-macos-d392181b-report.json` validates clean stable
head/tree; SHA-256 `bae76a307bc4266f4595f8afc4027fe0cc1f8be4a9197f0837b72ad1633d73bc`,
ASAR `006bbb73ff6fb6f3787496dca4f17815cbb58e0b706f57cd9acc7bfc1917a55a`.
Reference Ubuntu x64, constrained to CPUs 0,1,2,3 (two physical cores/four
SMT threads), passes two launches in 37,108 ms: main 82.513 ms/frame 123.4 ms/
current fix 107 ms. Canonical receipt `tmp/pr6-reference-d392181b-report.json`
validates clean stable head/tree; SHA-256
`163009415d6a89adc1212d44752fc95175fb1af6652ab84fc15e1bbb8f0204bd`,
ASAR `c9ca2fc756d92237efe72334aff893e2e7f11ac0e02fc4c291b1ea00038c9d55`.

The same clean reference source passes the physical SIGKILL recovery matrix:
32/32 required cases in 175,772 ms, not protocol self-test. Eligibility,
interrupted-cleanup resume and archive-lifecycle observations pass; the
structural digest recomputed independently matches. Receipt
`tmp/pr6-kill-d392181b.json`, SHA-256
`d4f7b278d1ef42325526590dcdf0b4120c42114d2e93fe73ab066a96c562206b`.
Linux CI `34166963970` passes: all 4,018 tests/384 files in 865.36 seconds
(legacy-event heartbeat 38.880 ms), build, 960k Replay, native SQLite/graphics,
tracking soak, archive lifecycle, terminal evidence and launch/artifact checks.
Its canonical lifecycle receipt validates clean exact head/tree, two launches
in 47,010 ms (main 84.485 ms/frame 154 ms/current fix 133 ms). Receipt under
`tmp/pr6-linux-d392181b/breadcrumb-pr6-packaged-archive-smoke/` SHA-256:
`ec5a5315fcf845be7d008c00b2d71500456a9af20e7e5be7bfbc48200b50647d`;
ASAR `383732bf3ca219c8dd62f242d3f4f75f2fda7c0814f4e87d46f5dd79397de31f`.
The exact CI log is `tmp/pr6-linux-d392181b-ci.log`. The downloaded evidence
artifact ID is `10034860114`; source gates and every required workflow step
pass. This checkpoint changes only evidence and handoff; application/tests
remain byte-identical to the reviewed d392 implementation. Any descendant's
exact-head qualification receipts are recorded externally in PR #10/Linear
after commit, avoiding a recursive documentation-head update.
>2 GiB remains unstarted; no sound
timing evidence places that potentially multi-hour run inside Donal's 01:00
Dublin stop boundary. All local/reference jobs have finished. These are
synthetic named-platform checks, not release or field proof.

The canonical publication repair is pushed as
`e6b6e3e02a80dfb6fd223fd8a36e90a6a6a1e471`, tree
`535c71e046ae673984cad26baa111bfc7f2a7609`. Exact-head macOS lifecycle passes
in 11,768 ms/two launches (main 52.649 ms, frame 17.6 ms, current fix 22 ms).
Receipt `tmp/pr6-macos-e6b6e3e0-report.json` SHA-256:
`efad191b2a4cbf96106bd61b29b97fa842579f0917ac461d315a00f0f65466b1`;
ASAR `232ddbb8df802d0ef515a4e87bd42a79df66004bf9b70dd8dd11667b0decdc54`.
Linux CI `34163950630` passes source, build, Replay, tracking and packaged
lifecycle. Its canonical report validates the clean exact head/tree and two
launches in 45,683 ms (main 108.333 ms, frame 174.9 ms, current fix 152 ms).
Receipt under `tmp/pr6-linux-e6b6e3e0/` SHA-256:
`22e1118b0b6eed85d852e969d005bd0171ea6652cd4657c5f66f1972451311ca`;
ASAR `5c493aac8bf24499d246310b460d63d3c8b5a64bba074e61255a21eeddb5d19e`.
These passes do not qualify the subsequently reproduced product defect below.

Three further bounded main-only syscall samples did not reproduce the stall;
that diagnostic loop is stopped. A different controlled test holds the real
cleanup worker's acquired IMMEDIATE transaction for 700 ms, with release owned
by the worker so a frozen main thread cannot prolong it. During cleanup of one
finalized mission, another active mission's real device and tracking writes
fail immediately with SQLITE_BUSY; its coverage catalog publication blocks the
main heartbeat for 789.192 ms (812.043 ms total). Diagnostic source/result:
`tmp/pr6-cleanup-writer-overlap.cjs` / `.json`. This proves a reachable product
defect; it does not attribute the earlier 943.993 ms trace or every CI timeout.

Confirmed cause: SQLite has one writer. The cleanup worker releases/retries
its own transactions, but the main connection's coverage UPDATE can sleep
synchronously in its default 5,000 ms busy timeout. Other live APIs can fail
while promoting their transactions. Prior tests did not hold the actual
cleanup transaction across these concurrent live API calls.

The correction introduces one FIFO owner for synchronous device/position/
history and existing coverage-affecting mutations, and all five derived
coverage publication boundaries. Each attempt owns an outer IMMEDIATE
transaction with SQLite busy timeout zero; the previous configuration is
restored before yielding. Only fully rolled-back SQLITE_BUSY attempts retry,
with a finite 240-by-25-ms delay budget and request/store cancellation.
Permissions and relevant inventory/revision checks repeat after waiting.
Finished live-source coverage remains readable. Shutdown aborts and joins
all coverage requests, including requests without renderer IDs, before close.
Schema, coordinate rules, archive bytes/custody and cleanup semantics are unchanged.

Red-first evidence: initial three real-lock tests reproduce two immediate BUSY
errors and a 774.922 ms coverage heartbeat. Five of six added alternate-API
cases fail before extending the common boundary; the already-covered page
publication passes. All 15 final integration variants pass, including FIFO,
mission finalization during the wait, stale coverage, cancellation, shutdown,
and durable rejected-observation evidence. The unnumbered coverage shutdown
regression separately fails before request ownership is added; all 24 coverage
tests pass afterward. Six writer tests cover rollback, configuration restore,
ordering, cancellation, shutdown, retry exhaustion and invalid async callbacks.

The wider store suite caught an introduced rollback of the intentional
cross-device ingest-anomaly record. A private outcome now carries only that
audited rejection through commit before the public API throws its original
error. Ambiguous adoption and ordinary validation/SQLite errors still roll
back. All 101 store tests pass, and the contended conflict case verifies one
anomaly, unchanged position ownership/coordinates and unchanged incoming-device
contact state. The initial async-callback unit assertion also needed correction:
a mock wrapping an async function has a normal Function constructor; the final
test uses an actual async function for the pre-invocation guard and separately
checks a synchronous callback returning a thenable rolls back.

Focused independent final review is clean on helper
`f20f6b624d0f46202c0666fd4bff146347541e6b`, store
`8c65fb0194ac2d2477773f7cd60d0fcf3bc3b51c`, writer tests
`ecd892dcb59af133bd5b70b9302f3ccd67b8203f`, contention tests
`4d6b52a94737bda0a433a595e58d43cb5257dc26`, coverage tests
`40a11d2f633ca77abb010e6fc68cc21537e5699c`.
Logs: `tmp/pr6-live-write-contention-red.log`,
`tmp/pr6-live-write-related-api-red.log`, `tmp/pr6-coverage-shutdown-red.log`,
`tmp/pr6-responsive-affected.log`, `tmp/pr6-responsive-store-green.log`,
`tmp/pr6-responsive-final-focused.log`, `tmp/pr6-responsive-module-final.log`.
Full serial source passes 4,018 tests across 384 files in 419.91 seconds;
legacy-event heartbeat maximum 71.340 ms. Full ESLint, production build
(including TypeScript), bundle budgets, Node syntax/diff checks and backend
58 pass/1 existing ignore pass. Fresh browser validation passes all 235 tests
in 5.0 minutes. Logs: `tmp/pr6-responsive-{full-serial,lint,build,backend,browser}.log`.
The operator manual now describes temporary live-save/coverage waits during
cleanup and continued attention to save/freshness warnings. Its actual rendered
note was checked in the inbuilt browser at
`http://127.0.0.1:1420/manual/index.html`; the initial `/manual/` URL instead
reaches Vite's application fallback, so it is not the manual verification URL.
Independent Opus screenshot review passes 74/74, zero failures/errors:
`test-results/visual-verification/reports/visual-review-2026-09-07T22-30-21Z.json`
and `tmp/pr6-responsive-visual-review.log`. Exact-head macOS/reference package
and physical-kill results are recorded above; Linux CI passes and >2 GiB
remains unstarted. Donal requires work to stop at the first of
15% remaining account usage or 01:00 Dublin on 8 September (00:00 UTC).

### c14529e8 rejection and canonical publication race

Harness export repair was pushed as `c14529e884b635e1115daded4229bdac726b0220`,
tree `b86074081221e7f32b7ba18305c582316bac17d8`. Mac packaged lifecycle passes
all four phases in 12,828 ms/two launches: main 60.297 ms, frame 20.8 ms,
current fix 25 ms. Receipt `tmp/pr6-macos-c14529e8-report.json` has SHA-256
`0c4cfd208b5b4a1f9d750470030b04a2a0e78eb523d8ca58eca7b8ff5426387e`;
ASAR `497c15475c47d3b9a784ed0a33ba0e6baa11b4c447425f15201fb0e9ea887df4`.

Reference Ubuntu packaged lifecycle rejects c145 after 47,292 ms, on launch
two during `cleanup_pending_restore`, with a renderer snapshot deadline.
First Review and interrupted-restore restart passed. Earlier cleanup samples
peak at main 57.496 ms, frame 55.7 ms, current fix 76 ms; the final pending
source age is 262 ms. Earlier successful samples do not cover the lost final
interval. Process/profile cleanup completed. Receipt
`tmp/pr6-reference-c14529e8-failure.json` has SHA-256
`d7a8bcceab58cb3ea22061c6820e1b69d66512bdee0aa15194ac39b9892bd33e`.

A bounded second-launch CPU/timing diagnostic completed cleanup in 2,037 ms,
watchdog 24.24 ms and driver heartbeat 12.74 ms, without reproducing the
timeout. Tracking diagnostics history consumes substantial renderer time.
A separate 60-second tracking-only probe also did not reproduce it: watchdog
84.53 ms, driver 14.66 ms; 10,632 diagnostic storage writes took 20.837 seconds
in total, with a 7.6 ms maximum individual write. These diagnostics explicitly
terminate without qualification. They show overhead, not the historical
timeout cause. No app storage change or unchanged qualification retry followed.

Linux CI `34160547847` failed earlier: 3,980/3,981 tests passed in 820.04
seconds; the existing opposite-canonical-publisher test rejected a changed
owner link count during its pinned read. Packaging did not run. A deterministic
regression reproduces the actual interleaving: one publisher creates the
verdict hardlink while another reads the owner (`nlink` 2 becomes 3).

The bounded repair discards that interrupted read and rechecks ownership in
one finite loop. It retains the first inode/size/mode anchor, handles mixed
parallel stat observations only by re-observing, counts every retry/name
creation against the same budget, and verifies all four aliases after reading.
It never accepts changing-read bytes or an unexplained extra link. Ten
controlled filesystem cases cover legitimate link growth, mixed scans,
anchored disappearance, same-count verdict replacement, exhausted settlement,
unknown links, opposite verdicts, and inode/mode/size changes. The original
c145 reader fails five of these cases; the candidate passes all ten. Native
filesystem forwarding hooks install before native module imports, target only
the owned fixture paths, assert the controlled interleaving occurred, and
restore after testing. Five further cases cover scans spanning both owner and
verdict publication and final observations of subsequently restored aliases,
names, modes and sizes. Three fail before the final correction; all five pass
afterward. Observed substitutions/disappearances reject immediately; only a
pending success gaining its anchored name may settle. The focused independent
review is clean on script blob `2c347e8b51bdb9b97220422ef94bc20be8a55343` and
test blob `792a8f42213a14a104732e21aedf1f021d1a05b3`.

All 122 affected tests and the full serial source gate pass: 3,996 tests across
382 files in 399.97 seconds, with TypeScript, ESLint, production build/bundle
budgets, Node syntax/diff checks and backend 58 pass/1 existing ignore. An
accidental parallel full run failed startup teardown (`ENOTEMPTY`), the next
handler assertion and the legacy inventory heartbeat (259.876 ms). Both
affected files then passed 111 tests in isolation; the serial run passes
without threshold changes. Its legacy-event heartbeat maximum is 46.746 ms.

Trace-only diagnosis without CPU profilers catches a 943.993 ms Electron main
task using 3.302 ms CPU; driver heartbeat stays below 14 ms and a renderer
drain stalls ~940 ms. This establishes a waiting/descheduling category, not
the exact cause or attribution of historical CI failures. A main-only native
operation timing probe and a main-only syscall probe do not reproduce the
stall: maximum observed SQL call 16.275 ms and fsync 15.169 ms respectively.
No SQLite busy-lock sleep is observed in that syscall sample; unrelated futex
`EAGAIN` is not database contention. The main connection's synchronous
tracking writes remain a suspect requiring controlled evidence. Probe files
are `tmp/pr6-cleanup-{trace-only,main-blocking,syscalls}-loader.mjs` and the
matching `tmp/sartracker-pr6-astra-cleanup-*` timing/native evidence. Every
diagnostic ends explicitly without qualification; no product change follows
from these unproven hypotheses.
No >2 GiB run has started; PR #10 remains unqualified.

### f49a1621 diagnostic candidate and restore rejection

Pushed head `f49a16218e983994104cdbc3801ce766f653720e`, tree
`858483dca3498acdaca2a4f4304b891d6e3905b2`, contains the reviewed trace
diagnostics described below. Full local source gate passes 382 files/3,974
tests, lint/build/budgets, backend 58/1 existing ignore, syntax and diff checks.
Application, dependencies, manual and browser/visual test blobs are unchanged
from c2; the 235 browser and 74 visual passes are carried evidence, not reruns.

Exact-head macOS package/lifecycle passes in 11,468 ms across two launches:
main maximum 81.284 ms, frame maximum 26 ms, current-fix maximum 37 ms.
Receipt SHA-256 `23f892d3073cf3577fa63b9462605f2051a16677c4b221c1021b64f920d6e981`;
ASAR `16ec0ffa3febca7721db4c8a42bec2e0c5923754a9c0481e93dd417b8e29e887`.
Ubuntu actual SIGKILL matrix passes 32/32 on clean stable head/tree in 176,509 ms;
receipt `b6f59e84084f8e8ae850b8f0ca114076716d6f1297c679b08b004c49b11fc197`,
with recomputed matching structural digest.

Linux CI `34157502958` passes source/build, Replay and tracking, then rejects
the packaged lifecycle during restore / `review_before_cleanup` with
`renderer_cdp_watchdog_failed`, `snapshot_collection`, `deadline_exceeded`.
Create/verify passed. Restore retained maxima are main 85.792 ms, frame 117 ms,
current fix 140 ms; a pending source age reached 304 ms at the final audit.
Both process and profile cleanup completed. Failure receipt SHA-256:
`052c4ff35922bda5c16e75e6bbe066285cb7ce47039640fa5817ae6e40830ee0`.
Legacy-event diagnostics peak at 134.374 ms, SQL 3.184 ms, process CPU over
the largest gap 103.661 ms, with no overlapping main GC. Earlier historical
latency failures remain unexplained.

The sanitized trace captured without browser buffer loss and explicitly
truncated to 4,096 events (~679 ms ending at first failure). A renderer task
took 116.929 ms with 108.314 ms CPU, including 9.101 ms minor GC; graphics
tasks lasted 50–60 ms. No retained completed task exceeds 200 ms. This proves
renderer computation occurred, but does not identify the read or explain the
whole CDP deadline. Trace SHA-256:
`319aea002546196dbd597d61318e5a40a6d10c3c659744752b31601b796b68a2`.
Local evidence is under `tmp/pr6-linux-f49a1621/`; durable CI artifacts belong
to the linked run. Its CPU metadata identifies AMD EPYC 9V74 with two physical
cores/four SMT threads, Ubuntu 22.04/Mesa 23.2.1. The previous reference run
used four distinct cores; it is not a matched topology comparison.

The bounded reference diagnostic used CPUs 0/1/2/3 (two physical cores/four
SMT threads), the exact f49 Linux package, default 4,096-row fixture, unchanged
1,000-row Replay pages, software graphics and strict liveness gate. Timings
separated renderer bridge completion from CDP receipt and retained driver CPU
profiles/heartbeats. The original object transfer completed first Review but
spent up to 160.6 ms after bridge completion exporting one page; watchdog
collection reached 184.18 ms and driver heartbeat 63.90 ms. Driver profiles
show Playwright recursive protocol validation/serialization during this work.

A paired JSON-text transfer retained every product IPC call, validation and
page. Export fell to 34.4 ms, watchdog 70.12 ms and driver heartbeat 23.50 ms.
The bounded independent review caught a fidelity risk: ordinary JSON drops
undefined properties and normalizes nonfinite numbers. The candidate now
rejects non-JSON values and transformed `toJSON` values before export, using
fixed safe errors. Seven rejection regressions and the primitive-transfer
regression were observed red first; the latter also verifies complete nested
page content including Unicode, null, false and zero. The strict-replacer
real-package diagnostic completed first Review with export maximum 43.9 ms,
watchdog 96.24 ms and driver heartbeat 31.79 ms. The final `toJSON` identity
guard is unit-covered; that guard was added after the real-package diagnostic.

All three diagnostic runs explicitly terminate as non-qualifying after first
Review and clean up; they are not full lifecycle passes. Timings/CPU profiles
are retained under `tmp/sartracker-pr6-astra-review-{matched,json,strict}-*`.
The repair changes only harness export, preserving full semantic validation,
page sizes and the independent watchdog. It removes measured harness overhead;
it does not prove the exact historical CI failure cause. No >2 GiB run started.

The final harness repair passes the full serial source gate: 382 files/3,981
tests in 394.72 seconds, full ESLint, production build/bundle budgets, backend
58 passed/1 existing ignore, syntax and diff checks. Legacy-event heartbeat
maximum is 66.581 ms, SQL poll 2.072 ms, overlapping main GC none. Bounded
independent re-review is clean on script blob
`0e1efe05036faf17ba11a6ddd1bc878e4f64b126` and test blob
`c09683b63fc6da22f24d5c7864225065978e3951`, unchanged through the gate.
Next is the existing-PR push and fresh exact-head packaged/Linux qualification.

### c2c04dca gate results and Linux renderer diagnosis

The bounded collector/heartbeat-diagnostic correction was pushed as
`c2c04dca1457c8aa9c1904125829ae646679270c`, tree
`0d0caa8de7331fdd172bad634507eb190ad12a10`. It is rejected by Linux packaged
lifecycle, not merge-ready. No >2 GiB attempt has started in this task.

- macOS arm64 exact-head package/lifecycle passes: two launches, 11,994 ms,
  verified archive 5,788,420 bytes, terminal verify progress retained, all
  liveness dimensions below 200 ms; main maximum 76.219 ms and current fix
  maximum 34 ms. Receipt SHA-256
  `e0b2341a8d5de513b35855557a9ae9d8e78460d915b4cc5e9824c0ef77e25f47`.
- Browser suite passes 235/235; independent Opus visual review passes all 74
  entries, zero failures/errors. Archive Review/cleanup screenshots personally
  inspected. An initial incorrect global mission-model environment flag was
  removed from the browser invocation; it had overridden the per-test URL
  fixtures. No source change was needed for that invocation error.
- Ubuntu actual SIGKILL matrix qualifies all 32 required cases on clean stable
  c2c04dca. Report SHA-256
  `1d5313aab3a4c145c662de5e0c58451310797c3aa8117fb10e6acc696eeaa733`.
  Its structural digest was recomputed and matches. Default Linux `/tmp` was
  safely rejected as too broad before preparation; a supported explicit narrow
  `--work-root` passed without weakening the guard or changing workload timeout.
- Linux run `34153646204` passes 381 files/3,965 tests, lint/build/package,
  960k Replay, native SQLite/llvmpipe, and packaged tracking. The legacy-event
  scenario peaks at 21.358 ms; SQL polling 3.350 ms, overlapping main GC none.
  The historical 200.669968 ms unit breach remains unattributed.
- Linux lifecycle fails during create with `renderer_frame_gate_breached`:
  213.5 ms, four frame samples, main 58.507 ms, current fix 79 ms, request/source
  delivery 44 ms. Process/profile teardown completed. Receipt SHA-256
  `207b4225d72677f91521e89c8918e4ad2985f88093b9258c71163faa600f418c`.
  AppImage launch and package upload were correctly skipped after this failure.

Personal source retrace and a bounded independent check found no stale startup
clock folded into the measured frame. The finalization dialog is closed: this
harness calls preload while a separate live mission occupies the map. A traced
reference-host stress run reproduced frame starvation before archive operations
began: a 368.29 ms GPU scheduler task overlapped the gap while timers continued.
That diagnostic used CPUs 0/1, which inspection subsequently showed are siblings
on one physical core. Its map-readiness variation still failed during setup.
The original diagnostic repeated on four distinct cores completed create/verify
with a 90.8 ms frame maximum and no post-arm long renderer task. CI's preserved
Replay metadata identifies four CPUs; CI is Ubuntu 22.04, the reference host
Ubuntu 24.04/Mesa 25.2. These comparisons do not establish the historical CI
cause and do not authorize a performance fix, timing relaxation, or scale retry.

The next bounded change is opt-in CI rendering diagnostics, not a product fix.
It projects only finite timings, closed task/thread names and explicit markers
into bounded sidecars; arbitrary arguments, URLs, and payloads never enter the
record. Browser-side loss and retention truncation are explicit. Failure freezes
capture before cleanup can replace the relevant interval, and retention uses
task end time so a long overlapping task is preserved. Healthy measurement and
deliberate-kill timing are unchanged; first-launch trace loss at the intentional
SIGKILL is reported as incomplete. Optional setup/transport failure does not
replace the lifecycle verdict, and late sessions are detached. Nine focused
tests pass; real-CDP injected-failure capture and teardown pass. Independent
bounded re-review is clean. Its full serial source gate passes 382 files /
3,974 tests in 370.69 seconds, full lint, production build/bundle budgets,
backend 58 passed/1 existing ignore, syntax and diff checks. The legacy-event
heartbeat peaks at 101.009 ms, SQL polling 1.919 ms, overlapping main GC none.
Generated version output was restored to its committed blob. Application,
shared/persistence, package dependencies and manual blobs remain identical to
c2c04dca. Actual-CI diagnostic observation is still required.

### Original b3fb01fa blockers

Starting head `b3fb01fac43f7e3dff0a2ea8edd171ac11e4491f`, tree
`66b6db82fee6929e73ca2ad49d8fe7a23bacf35f`, is rejected. Its macOS failure
receipt SHA-256 is `e084ba9017ebeed4ed3da168196c523c3123e9a4bc4c2cbb6176735632201fa1`:
two launches, 11,679 ms, only `Independent verify progress did not prove
verified.`, complete profile/process teardown. Linux run `34148723233` failed
only the DON-278 legacy-event heartbeat at `200.669968 ms` (3,959/3,960 tests).

Finite blocker diagnosis:

1. **Terminal progress collection.** The store independently verifies, commits
   verified custody, emits `verify:verified`, and returns a verified result.
   IPC projects the same operation/mission identity; preload accepts the phase.
   The smoke collector unsubscribed when the invoke result and earlier liveness
   transitions resolved, without proving terminal progress consumption. A
   focused diagnostic on the actual packaged b3fb01fa app used the original
   2,048-position/101-marker/101-outing seed and original collector. Delaying
   only terminal delivery by 25 ms reproduced missing `verified` while the
   returned archive was verified and a passive listener received the event
   later. This establishes a collector defect; the historical receipt lacks
   raw events proving its particular scheduling interleaving. The correction
   waits for exact mission/operation terminal progress with a bounded timeout.
   Five deterministic tests cover both orders, unrelated identities, missing
   progress, and operation failure. The delayed real-package diagnostic passes
   with the corrected collector; independent focused review is clean.
2. **Legacy-event responsiveness.** Reconstruction runs in a worker. The
   measured main thread polls a two-row backfill-state table every 5 ms around
   a 10 ms heartbeat. Focused baseline macOS/Ubuntu runs pass. A two-CPU Ubuntu
   run peaks at 46.129 ms with overlapping 30.671 ms main-thread GC; the whole
   affected file passes 73/73, with 29.141 ms in this scenario. Instrumentation
   did not reproduce the original 200.67 ms excursion. Its cause remains
   unresolved, not harmless scheduling noise. The original 500,000-row fixture,
   cadence, SQL, and `<200 ms` gate remain; diagnostics now retain polling
   duration, process-wide CPU, and GC overlapping the largest heartbeat gap.
   Independent review checked asynchronous GC drainage, retention, clock
   alignment, and resource cleanup. Further CI evidence must retain attribution.

No production archive, custody, or migration module changed. There is no
operator-visible change, so manual content remains applicable. Full source and
authoritative candidate qualification are pending. Ubuntu availability was
confirmed read-only; no multi-GB run started. Donal's fresh-task instruction
supersedes the historical stop-after-package sequence below and authorizes
finishing this existing PR through truthful merge readiness, without merge or
beta publication. A new diagnostic observation is not a retry-to-green waiver.

The corrected code passed its full serial local source gate: 381 files /
3,965 tests in 376.36 seconds, full ESLint, production build and bundle budgets,
affected Node syntax, diff checks, and backend 58 passed / 1 existing ignore.
The heartbeat scenario reached 19.817 ms in that suite. Verified source blobs:
collector `9d6feb23e31dcf95ab2fa89d2793f9b966034735`, collector regressions
`3f43e1c75755607613a475878d29aaf20792c0f0`, evidence-versioning test
`2dc7535c4091900f4ab4e20c324b7ff584388678`. Product source blobs remain identical
to b3fb01fa and to the previously reviewed `d5727b82` tree. Generated version
output was restored to its committed blob after the build. Candidate package,
CI, browser/visual, physical-kill, and >2 GiB proof remain outstanding.

> This document is part of the PR #10 recovery candidate. Once source is frozen
> and the pending gates complete, its exact final commit/tree, post-freeze gate
> results, four independent review verdicts, Linux packaged report, and field
> receipt must be recorded in PR #10 and `DON-248`/`DON-252`/`DON-253` so that
> recording them does not create a different source head.
>
> Exact head `caf9e5e480fcd02cc44d68c8397efcd6ae78f2cd` / tree
> `81a8ef3e3639f6e8e7cd048691a87b8488a4d998` is rejected. Its Ubuntu run
> produced and verified a `5,243,848,931`-byte archive but ended
> `UNCLASSIFIED_INTERNAL_FAILURE` at `teardown:incomplete`; disposable-profile
> cleanup completed. A `Math.max(...samples)` argument overflow over roughly
> 200,000 samples caused that misleading teardown classification, but the run
> independently breached the hard liveness gate: create `1826.63 ms`, restore
> `2070.74 ms`, cleanup `1033.56 ms`, and durable latency `1029.43 ms`. The
> sub-millisecond “current position” figures measured only an in-process `Map`,
> not the packaged renderer path.
>
> The diagnosed stalls came from roughly 9.7 million retained high-volume
> `mission_events` plus repeated finalization/history scans. The recovery uses
> deterministic finalization-boundary lookups, preserves fail-closed cleanup,
> and restricts `mission_events` deletion to a declared telemetry allowlist
> while retaining operational, finalization, custody, cleanup, supplement, and
> unknown future audit events.
>
> Exact recovery head `49523dc8b460a2080c5fbbd3bc11c961296f481d` is also
> rejected. Linux run `33908771732` passed its source, lint, 3,685-test, build,
> package, Replay, native-module, llvmpipe, and tracking-soak gates, then failed
> packaged archive lifecycle with `current_fix_continuity_gate_breached`.
> A faithful macOS package reproduction failed with
> `current_fix_not_observed_before_gate`. Neither run emitted a failure receipt,
> so neither generic label proved a product stall or identified its phase.
>
> Source retrace reproduced the harness defects: timing began before its
> observer/source attribution was armed; phase handoff split exact-fix, main,
> and renderer-frame continuity; operation close preceded the final ledger
> drain; the terminal restore phase was re-armed across unrelated closeout; and
> teardown retained the old renderer-frame phase. Failed process shutdown could
> also remove the still-owned profile, success publication was not atomic, and
> failure-receipt publication was optional. The red-first replacement keeps one
> exact-identity timeline across active phase handoffs, drains observations at
> the operation boundary, ends timing before terminal closeout, pauses renderer
> attribution before teardown, retains a profile while any owned process may
> survive, and enforces exactly one atomic sanitized terminal artifact. The
> strict `<200 ms` gate is unchanged.
>
> Exact local head `81e47973714ff5cbbd908329559009c281b352fe` / tree
> `4d3f561969090808ed1e4abfad0fc050f764a622` is a third rejected diagnostic.
> Its clean macOS arm64 package reached the new failure receipt, which recorded
> `renderer_frame_sample_invalid` in `create` before any archive operation
> began (`operationCount: 0`). Source retrace proved a measurement-clock defect:
> phase arming used `performance.now()`, while the first queued animation-frame
> callback supplied a timestamp from before arming. The renderer probe now
> measures both endpoints with `performance.now()`. Re-reporting the same
> primary probe fault during teardown is no longer counted as a cleanup failure,
> while a genuinely new stop failure remains distinct and fail-closed. The
> strict gate remains unchanged.
>
> Exact local head `74bdd95ca3bbd09f775ba111d53f6313e76769d6` / tree
> `3bef9c115d5fadeb4ae9427532f27be80a8177ce` is also rejected. Its clean
> package produced one healthy exact create-phase sample with every measured
> gap below `34 ms`, then failed `source_identity_left_pending_at_operation_start`
> before any operation began. The renderer and source ledgers were cut at
> different instants while 50 ms polling remained active, so a normal in-flight
> identity was treated as an immediate error rather than remaining governed by
> its original strict 200 ms deadline. This is a measurement-boundary defect,
> not product- or host-stall evidence. Its unexplained cleanup count also exposed
> that the receipt omitted secondary cleanup-failure attribution.
>
> Exact local head `6a72ae91720b0ce65a9274c2c462dcad484587f5` / tree
> `c09dd5f7365283bd7fcfe4d83ca31ce038b04c80` is also rejected. Its exact
> package passed, then its single lifecycle attempt wrote a complete 0600
> failure receipt for `current_fix_not_observed_before_gate`. The timed-out
> source was emitted 45 ms before the operation began and reached age 213 ms,
> while 17 later operation-fresh identities and 19 total create identities
> reached MapLibre with a 54 ms continuity maximum, 4 ms source/request latency,
> 50.366 ms main maximum, and 10.7 ms renderer-frame maximum. The application
> intentionally publishes latest tracking state through Zustand and a later
> React effect, so an intermediate current snapshot can be superseded before it
> reaches MapLibre. Requiring every HTTP snapshot identity to render was an
> invalid proof-model assumption, not product- or host-stall evidence.
>
> A separate red-first regression preserves live Review after cleanup → archive
> correction restore → re-finalization → ordinary Admin Unlock, including
> repeated cycles and current/intermediate recovery archives. Unlocks now have
> deterministic archive-owned audit identities, and supplements carry their
> exact id, rowid, and time. Lineage verification therefore uses only existing
> unique-id and integer-rowid point reads; it creates no startup index and scans
> or sorts no mission history. Broken ancestry, identity, chronology, or status
> fails closed.
>
> The recovery's source reviews and full local non-browser source cycle are now
> complete at the named trees below. Exact commit/push, one macOS package, and
> the sole packaged lifecycle terminal remain in this bounded cycle. Browser,
> visual, physical-kill, Linux, and exactly one fresh controlled Ubuntu greater-
> than-2-GiB qualification remain deliberately downstream. No merge, release,
> platform, or field acceptance is claimed here. Donal retains approval and
> merge authority.

## 2026-09-04 superseded first-candidate pre-freeze verification

Before `49523dc8` was frozen, its dirty-tree predecessor passed the combined affected gate (`28` files /
`680` tests), the full deterministic serial unit gate (`375` files / `3,685`
tests), ESLint, TypeScript/production build, bundle budgets, Node syntax, and
diff checks. The legacy backend passed `58` tests with one platform-specific
keychain test ignored. Full Chromium passed `173/173`; full visual Playwright
passed `62/62`. The refreshed 15-check cleanup frame then passed an uncached
independent critical visual review and replaced the operator-manual image.

Unsigned macOS arm64 directory packaging passed. The packaged lifecycle runner
correctly rejected the still-dirty pre-commit tree, so this rehearsal supplies
no packaged-liveness proof. Clean exact-head package/lifecycle, physical
SIGKILL, Linux, four-review, and single fresh field gates remained pending. This
is superseded first-candidate evidence, not proof for the replacement source.

## 2026-09-04 rejected `49523dc8` packaged-liveness candidate

The first clean recovery candidate was committed and pushed at
`49523dc8b460a2080c5fbbd3bc11c961296f481d` / tree
`fa0de2f87281412232a04c5aaf35456d8a37c34c`. Linux run
[`33908771732`](https://github.com/donal0c/sartracker-web/actions/runs/33908771732)
passed every gate through packaged tracking soak, then stopped at packaged
archive lifecycle after roughly ten seconds. Its only terminal detail was
`current_fix_continuity_gate_breached`; the always-upload artifact contained no
lifecycle report because that runner wrote success evidence only. A clean
macOS package of the same exact head reproduced the evidence gap while failing
with `current_fix_not_observed_before_gate`.

The four independent head reviews are diagnostic only because the source must
change. Broad review found no correctness break and one optional P3 trigger-
coverage gap. Persistence review's apparent multi-mission lease mismatch was
disproved: the session manager deliberately owns one global Review/plaintext
lane, and the existing two-mission test holds that global lease across the
sequential recovery batch. Its journal CAS and escaped SQL consistency notes
were also not correctness defects. Concurrency and renderer reviews reproduced
the liveness accounting defects above; renderer review additionally found the
valid repeated-correction lineage stranded as `cleanup_in_progress`.

Red-first remediation is green across the root integration gate (`12` files /
`266` tests) and the full deterministic serial suite (`375` files / `3,707`
tests), plus full ESLint, TypeScript/production build, bundle budgets, focused
syntax, diff checks, and the legacy backend (`58` passed / `1` platform-specific
ignored). These are dirty-tree implementation checks, not exact-head package or
Linux proof. A replacement commit, exact package, browser/visual, physical-kill,
Linux, four-review, and field gates remain open.

## 2026-09-04 rejected `81e47973` renderer-clock candidate

The next local candidate was committed at
`81e47973714ff5cbbd908329559009c281b352fe` / tree
`4d3f561969090808ed1e4abfad0fc050f764a622`. Its clean macOS arm64 package
completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`baf77ea65a944aa9eee0c996b8c91d8ce23123949264138464f64ba20f04001a`.
The exact packaged lifecycle then rejected it after `3,931 ms` with one
0600 failure receipt, SHA-256
`918d83542d14cfeaec085ea6099d7c01dd96f5a016f28f4ad31025c1202ec7b8`.

That receipt recorded only `renderer_frame_sample_invalid`, active phase
`create`, one launch, zero operations, and no current-fix timeout or continuity
breach. Owned process and profile cleanup both completed. The negative first
frame came from mixing the queued animation-frame callback timestamp with the
later `performance.now()` phase-arm timestamp, so this was a harness
measurement rejection before product work, not archive-stall evidence. The
red-first repair uses one monotonic clock for both samples, adds one bounded
`phase`/`gapMs`/`gapType` invalid-frame diagnostic, and preserves a distinct
new stop-time failure even when its error kind matches the primary fault. A
pre-freeze audit additionally found that this fresh failure could escape before
the external watchdog settled; its red-first regression now proves unconditional
watchdog stop, released launch ownership, and successful replacement attachment.
Focused liveness/smoke verification is `3` files / `129` tests green. The full
deterministic serial suite is `375` files / `3,712` tests green; full ESLint,
TypeScript/production build, bundle budgets, focused Node syntax, diff checks,
and the legacy backend (`58` passed / `1` ignored) are green. Exact-package and
later candidate gates remain pending on the replacement commit.

## 2026-09-04 rejected `74bdd95` operation-boundary candidate

The renderer-clock and watchdog-settlement repair was committed at
`74bdd95ca3bbd09f775ba111d53f6313e76769d6` / tree
`3bef9c115d5fadeb4ae9427532f27be80a8177ce`. Its exact clean macOS arm64
package completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`f15d9284fed1e926e6d32b17d3a7f0c65c868ffbf320f3bc86d2bc4d752fe416`.
The one packaged lifecycle attempt then wrote a 0600 failure receipt, SHA-256
`2e55a78add58b79d24476084690d17440207586169f56be3d212734d904e1c6f`.

The receipt recorded one exact create-phase sample, `3 ms` source-to-renderer
and request-to-renderer maxima, `12.68 ms` main and `8.9 ms` renderer-frame
maxima, no current-fix timeout or continuity breach, and zero operations. A
second source identity was emitted between the renderer observation cut and the
source-ledger cut. The old start assertion rejected that ordinary
join state immediately, even though unmatched identities already have a strict
per-source `>=200 ms` expiry. During teardown that same identity reached its
real deadline and created a distinct secondary liveness error; cleanup counted
it but the receipt retained only the primary error details.

The replacement must use causal operation fences: a pre-start identity remains
global liveness evidence but cannot satisfy fresh-operation proof, only sources
inside the exclusive-start/inclusive-end source window may count, and finite
in-window pending identities settle only to their original deadline. Renderer
collection/delivery must be serialized so a concurrent watchdog cannot hide a
valid observation across a checkpoint boundary. No polling pause, global-empty
wait, continuity reset, or deadline extension is permitted. Secondary cleanup
failures must remain fail-closed and appear as bounded sanitized receipt detail.
Head `74bdd95` will not be rerun unchanged.

The red-first replacement now implements those fences against the mock source's
monotonic sequence and serializes renderer drain plus source correlation across
explicit and watchdog collection. A periodic drain that completes after
watchdog stop begins is discarded inside that serialized commit boundary; the
final cleanup drain is still recorded. A timed-out drain poisons later
collection, cannot commit late exact-fix evidence, and cannot start another raw
drain. Start-pending and post-end sources retain their global liveness duty but
cannot satisfy operation freshness, while only the finite in-window set is
settled at completion. The strict per-source `>=200 ms` rejection is unchanged.

Cleanup now attributes each genuinely new failure to one stable bounded step,
including profile removal, while ignoring only an exact primary error replayed
by liveness stop. Count/detail disagreement fails closed. Terminal projection is
allow-listed, secret/path-redacted, depth/array/global-node bounded, and total
for nullish rejections, hostile getters/proxies, cycles, and malformed messages,
so those inputs cannot be misreported as success or suppress the required
receipt. Two independent implementation audits exposed and drove the watchdog
commit-boundary and hostile-receipt corrections. The combined focused gate is
`4` files / `157` tests green and the expanded affected gate is `5` files /
`196` tests green. The full deterministic serial suite is `375` files / `3,737`
tests green, alongside full ESLint, TypeScript/production build, bundle budgets,
focused Node syntax, diff checks, and the legacy backend (`58` passed / `1`
platform-specific ignored). These remain pre-freeze local checks, not exact-head
package, Linux, or field proof.

## 2026-09-05 rejected `6a72ae91` latest-state measurement candidate

The causal-fence and cleanup-receipt repair was committed locally at
`6a72ae91720b0ce65a9274c2c462dcad484587f5` / tree
`c09dd5f7365283bd7fcfe4d83ca31ce038b04c80`. Its exact clean macOS arm64
package completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`6d1f74497abb20e79ffb9ca7671b5f2e03919f1b58e4880ffc3eded3d94b8de4`.
The single packaged lifecycle attempt rejected after `6,837 ms` and wrote the
only terminal artifact: a 0600 failure receipt with SHA-256
`355c2455fc0f15965fcff9d4f8b7bd598592708a6c0068764de7073e0e71c4ec`.
Process and profile cleanup both completed with zero attributed cleanup
failures.

The receipt recorded one source emitted at `1788564997984` and audited at age
`213 ms`; the create/verify operations began 45 ms later at
`1788564998029`. In the same interval, the create operation received 17 later
fresh exact MapLibre identities and the phase received 19 total. Create maxima
were `54 ms` current-fix continuity, `4 ms` source-to-renderer and
request-to-renderer, `50.366 ms` main watchdog, and `10.7 ms` renderer frame.
There was no continuity breach, process failure, cleanup failure, or host-stall
signature.

Source retrace showed that the mock assigns a unique identity to every current-
positions HTTP snapshot, while the application deliberately publishes latest
state: the polling manager replaces the current snapshot, Zustand replaces its
store value, and React later commits that value to MapLibre. An intermediate
snapshot can therefore be coalesced or intentionally discarded at a mission/
runtime boundary while a later exact identity reaches the operator map. The
old exhaustive per-HTTP-identity oracle was stronger than the product contract
and produced a measurement false negative.

The red-first successor treats an exact, timestamp-matched, clock-valid renderer
observation at sequence N as a watermark acknowledgement for older current
snapshots only when N and every overtaken source are still strictly below their
original 200 ms deadlines. It never advances on source emission, operation
boundaries, phase changes, invalid clocks, or a late renderer observation.
Sequence regression fails closed within and across renderer drains. The oldest
source not overtaken by a valid renderer acknowledgement still expires at its
original `>=200 ms` deadline, and exact visible-fix continuity, observed
source/request latency, main-isolate, and renderer-frame gates remain strict.
Operation freshness still requires its own exact observation inside the causal
exclusive-start/inclusive-end source fence; a superseded identity never counts.
Focused red-to-green verification is `1` file / `50` tests and the expanded
affected gate is `5` files / `202` tests. Three independent focused audits are
clean. The full deterministic serial suite is `375` files / `3,743` tests
green, alongside full ESLint, TypeScript/production build, bundle budgets,
focused Node syntax, diff checks, and the legacy backend (`58` passed / `1`
platform-specific ignored). Head `6a72ae91` will not be rerun unchanged.

## 2026-09-05 rejected `23161300` renderer-watermark candidate

The latest-state acknowledgement repair was committed locally at
`2316130047fb1c69e966ac58956b1abc0b6a5792` / tree
`8b96ad6e17887b60dcbbfadd0472b62cc2f5c768`. Its exact clean macOS arm64
package completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`11aac487cf767983788ac29224349cf4067b5cc238f11df1c5a6c5575e1a457d`.
The single packaged lifecycle attempt rejected after `7,727 ms` and wrote the
only terminal artifact: a 0600 failure receipt with SHA-256
`36795e1f7512b982015f90c9b292f1f7b3445d6069dfc1ba474854f4a5fc3c31`.
Process and profile cleanup both completed with zero attributed cleanup
failures.

The receipt recorded `current_fix_continuity_gate_breached` during the first
restore launch. Restore had 38 exact MapLibre samples, including 36 fresh for
the active operation; maxima were `216 ms` current-fix continuity, `13 ms`
source-to-renderer and request-to-renderer, `153.650041 ms` main watchdog, and
`16.9 ms` renderer frame. There was no pending-source timeout. The last
externally collected exact fix was stamped at `1788566532281`; an independent
main-watchdog callback audited the stale external watermark at
`1788566532497`.

That receipt cannot distinguish a genuine no-fix interval from a timely fix
already stamped at MapLibre but not yet returned by the independent CDP drain.
The main and renderer watchdog loops ran independently, while the main callback
audited current-fix continuity without first joining the serialized renderer
collection. A red-first deterministic reproduction proved that this ordering
could permanently record a `>=200 ms` failure even when the queued renderer fix
itself was stamped below 200 ms. Head `23161300` is therefore rejected and the
receipt is harness-indeterminate rather than admissible evidence of a product or
host stall.

Source retrace also found a separate real product-path risk consistent with the
same timing shape. The renderer applies a current snapshot synchronously, but
the poller awaited its mission-persistence and cache settlement before arming a
new full 50 ms validation interval. A 153 ms settlement plus that extra interval
and the measured 13 ms transport/render path can cross 200 ms even though no
individual main or renderer heartbeat does. The red-first successor timestamps
the synchronous publication and subtracts already-spent settlement time from
the next success interval. It keeps one poll in flight, holds mission evidence
until settlement, and leaves failure backoff unchanged.

The proof repair removes current-fix auditing from unrelated main-watchdog
ticks. Each serialized renderer collection instead captures a conservative
request-start wall-clock watermark before draining, correlates all observations,
and audits current-fix continuity and pending-source expiry only through that
watermark. A timely renderer fix can no longer be overtaken by the main loop;
an empty renderer drain at exactly 200 ms still fails. Queue acquisition and the
actual CDP drain are each independently bounded by the strict gate, and a timed-
out drain poisons the channel so no late completion can commit evidence.

Phase handoff partitions the collected exact fixes at one renderer-owned
watermark and applies immutable lower/upper operation bounds, preventing either
phase from borrowing freshness across the fence. Pause similarly owns the
renderer queue, drains before and after the bounded phase-null mutation, freezes
the continuity/operation upper bound, and preserves that original bound through
an idempotent cleanup retry after a primary probe failure. This retains any
terminal frame-gap evidence and prevents post-pause fixes from repairing an
ended interval. Final watchdog teardown failures remain classified as renderer
CDP failures with bounded sanitized cleanup attribution.

The strict `>=200 ms` continuity, source, main, renderer-frame, and CDP gates are
unchanged. For that rejected candidate, pre-freeze verification was green:
focused cadence/liveness
`2` files / `145` tests; expanded affected `10` files / `477` tests; full serial
`375` files / `3,759` tests; full ESLint; TypeScript/production build and bundle
budgets; Node syntax and diff checks; and backend `58` passed / `1` platform-
specific ignored. Independent holistic, cleanup-attribution, and operation-fence
re-audits are functionally clean. These remain dirty-tree local checks, not
exact-head package proof. Head `23161300` will not be rerun unchanged.

## 2026-09-05 rejected `d91ec232` kill-oracle candidate

The cadence/renderer successor was committed and pushed at
`d91ec23252afa118cc6323ed840554bb109043b2` / tree
`560b3dc6f3eb573f499ee8f74b6924ad7dc00076`. Its exact clean macOS arm64
package passed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`cdd430e0a6869688c88b1ecc1f9255c7fdb7ee7bcab82a3a7920e7ddcace2e39`.
The head's sole macOS packaged lifecycle attempt passed in `10,400 ms`; its
0600 report SHA-256 is
`beefb7fb13e1085f9db2986d66eac4999636d9c61e338728fdf0817b80fb0b64`.
The report validator returned `valid: true`, `passed: true`, and no failure
reasons. It bound the exact stable head/tree and packaged build, two fully
observed launches, exhaustive archive verification/review before and after
cleanup, a real decrypt-phase `SIGKILL` with restart plaintext sweep, 5,516
cleaned rows, zero remaining breadcrumbs, zero secret matches across 63 files,
and zero terminal plaintext residue. Strict liveness maxima remained below 200
ms in every phase; the largest was restore main-watchdog `177.752 ms`, followed
by restore current-fix continuity `168 ms` and cleanup continuity `151 ms`.

Exact-head Chromium passed `173/173`, visual Playwright passed `62/62`, and an
uncached independent visual review passed `74/74`. The physical 32-case
SIGKILL matrix then rejected without publishing a report. Non-authoritative
diagnostic subsets isolated the failure to `create.seal`; the other 13 create
phases passed in bounded subsets. The sealed archive itself existed and matched
its registry ciphertext digest, size, file identity, operation ID, and cleanup
verification gate, with one registered/disk archive and no orphan.

Source retrace proved a kill-oracle false negative. After a `create.seal` kill,
the parent tried to rediscover the new archive by filtering the public
`listMissionArchives()` projection on `creation_operation_id`; that private
registry field is deliberately absent from the projection, so the parent did
not exclude the new row from the pre-existing custody-set comparison and
misreported baseline damage. A real-process regression reproduced the failure.
The first minimum successor queried the authoritative private registry read-only
by both mission and exact creation operation and retained the two-row duplicate
check. Independent operation-fence review correctly rejected that as incomplete:
it could still skip operator-facing Review if the public archive projection
were stale, and its final post-close snapshot did not revalidate creation
operation identity. The red-to-green correction now validates UUIDv4 identity,
requires the exact mission-bound ID once in a fresh public projection, requires
recoverable custody at `create.seal`, and revalidates mission plus creation
operation in the final independent disk/registry snapshot. It reports only
booleans, never the private operation field.

Linux run `33935825755` was also bound to exact head `d91ec232`. It passed source
binding, dependency/static/unit/build gates, Linux artifact inspection, replay,
llvmpipe, and packaged tracking soak. Its packaged archive lifecycle then failed
after `9,922 ms` and wrote a cleanup-complete receipt. The primary failure was
`current_fix_continuity_gate_breached` in `create` before any archive operation:
the interval began at `1788572435703`, the first source request/emission was
`1788572435736`, and an empty renderer drain audited the interval at
`1788572435929` (`226 ms`). During stop, the same source reached `209 ms` and
added `current_fix_not_observed_before_gate`. Main-isolate maximum was
`56.89306199999919 ms`; renderer-frame maximum was `132 ms`.

Source retrace classifies this receipt as a second harness false negative, not
admissible product- or host-stall evidence. `startLivenessMission()` accepted
`participant-active-list.children.length === 1`, but the real zero-participant
placeholder is itself one child. The harness armed `create` while asynchronous
participant hydration was still loading; the product correctly defers current
fixes from the operational map until that safety scope is trustworthy. The
successor now requires one real rendered `.sar-readout` and exactly one active
device participant matching the mock ID through the public preload store before
arming liveness. After the deliberate restart it resumes and proves the same
readiness before attaching the probe, so preserved `restore` attribution cannot
start during recovery hydration. Each readiness IPC read is bounded by the
remaining monotonic readiness budget, so a wedged renderer fails into the
existing terminal cleanup and receipt path. No clock, source deadline,
acknowledgement, or
strict `>=200 ms` gate changed.

Head `d91ec232` is rejected for final qualification and will not be rerun
unchanged; its passing package, lifecycle, browser, and visual evidence is
prior-head evidence only, and its Linux receipt is retained as rejected
diagnostic evidence.

## 2026-09-05 rejected `7e0d8ea3` final-review candidate

The first combined oracle successor was committed and pushed at
`7e0d8ea3407aeecd298fd25cc16130c132ae9dc8` / tree
`a036132e7780a4e9aff084c64a30288a830d313d`. Its exact clean macOS arm64
package passed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`76f311ef3ddc1aaabd2f81c247f7d5789ed94a358c6a4fe4768b036fea3a8d74`.
The head's sole macOS packaged lifecycle attempt passed in `10,548 ms`; its
0600 report SHA-256 is
`23112d9dd0389f457295f13e860a7938b51726071dcddd4097d4d5846537307c`.
It covered two launches, archive creation/verification/Review, a real
decrypt-phase `SIGKILL`, restart sweep, restore, cleanup of 5,516 rows, and
post-cleanup Review with zero secret or plaintext residue. Every liveness gate
remained strictly below 200 ms; the largest phase observations were restore
main-watchdog `171.844 ms`, restore current-fix continuity `157 ms`, and cleanup
continuity `142 ms`.

Exact-head Chromium passed `173/173`, visual Playwright passed `62/62`, and the
fresh uncached independent visual review passed `74/74` with the medium-severity
gate enabled. The physical process matrix then qualified all `32/32` canonical
SIGKILL cases. Its 0600 report SHA-256 is
`fea482fce2564ef66fa28e9e836cc976f37c4d4d4d0efe38bd501859acdaddc5`;
`create.seal` proved exact private operation identity, fresh public identity,
final post-close mission/operation custody, registry/disk digest and size,
file identity, one registered file, no orphan, and the expected cleanup blocker.

That evidence does not qualify the head. Final broad and concurrency reviews
were clean, but persistence review found restart recovery still accepted a
same-name active mission with a different UUID. Renderer/input review found two
additional P2 oracle gaps: the rendered participant count was not bound to the
expected Traccar device, and a sealed archive could satisfy public-presence
proof without the v2 slot inventory required for operator verification retry.
Linux run `33938682590` was cancelled as soon as the accepted finding arrived;
it is not Linux proof and no field-scale qualifier was started.

The current red-first successor carries the original mission UUID across the
restart, requires exactly device `991` in both durable participant state and
the rendered row, and rejects decoy, group, removed, duplicate, and stale rows.
The physical-kill oracle now runs every store row through the same pure
`projectArchiveResult` boundary used by main-process IPC, strips private fields,
requires one exact mission-bound v2 archive with present custody, a lower-case
SHA-256, unique passphrase/recovery slots, and coherent sealed or verified
state, then derives the Review container and recovery-slot inputs from that
projection. The projector is the fifth explicit kill-harness identity input so
future projection changes alter the evidence digest. No liveness deadline or
strict `>=200 ms` failure gate changed.

That red-first successor's focused gate passed `4` files / `97`
tests, and its fresh full serial suite passes `375` files / `3,770` tests. Full
ESLint, TypeScript/production build and bundle budgets, focused Node syntax,
diff checks, and backend `58` passed / `1` platform-specific ignored are green.
Bounded persistence, renderer, and evidence-lineage re-audits are clean. These
remain pre-freeze local checks, not exact-head package or qualification proof.

## 2026-09-05 rejected `b75f8689` cadence candidate

The next pushed candidate was
`b75f8689304769438157cd5e018996cdafcdb328` / tree
`3216b03286c8543dfbeaff42097528ca197cbd7e`. Its sole exact macOS packaged
lifecycle, Chromium `173/173`, visual Playwright `62/62`, fresh uncached visual
review `74/74`, and physical SIGKILL `32/32` passed. Those results are now
prior-head evidence only.

Linux run `33940959449` passed source binding, lint, `3,770` deterministic
tests, build/package, 960k Replay, artifact/native-SQLite inspection, llvmpipe,
and packaged tracking soak. The first `review_before_cleanup` operation then
failed at `240 ms` current-fix continuity; main-isolate maximum was `59.142 ms`,
renderer-frame maximum was `118.1 ms`, and both source-to-renderer and
request-to-renderer maxima were `67 ms`. No package was uploaded. This is valid
product-cadence failure evidence, not proof-oracle noise, and b75 will not be
rerun unchanged.

Source retrace showed that current-snapshot publication still awaited durable
mission/cache settlement before the next poll was scheduled. The red-first
successor publishes the accepted current snapshot synchronously, transfers its
evidence into a globally capacity-bounded eight-payload queue with per-mission
FIFO and one mission guardian,
exact persisted-payload coalescing, and sticky durable loss/overflow evidence,
and drains or retries that ownership at Finish and stop. It retains raw
canonical evidence before participant hydration and applies participant scope
only at persistence. The separate cache lane keeps one active plus one latest
pending state, captures `cached_at` on observation, retains every current fix
plus at most 5,000 cross-device breadcrumb representatives, and cooperatively
yields throughout large selection work. Both post-predicate renderer reads now
share their remaining monotonic readiness deadline. The strict `>=200 ms` gate
is unchanged.

The b75 broad and renderer/input formal source reviews were clean. Persistence
and concurrency/finalization review both found the unbounded renderer
confirmation reads; the affected evidence and runtime rechecks are now clean.
At that point, successor checks were still dirty-tree and pre-freeze: the focused gate
passes `8` files / `307` tests, the final cache/runtime slice passes `2` files /
`91` tests, the fresh full serial suite passes `375` files / `3,791` tests, and
TypeScript, full ESLint, production build/bundle budgets, focused Node syntax,
diff checks, and backend `58` passed / `1` platform-specific ignored are green.
At that point no successor exact-head package/lifecycle, browser,
visual, physical SIGKILL, Linux, final-review, or greater-than-2-GiB proof exists.

## 2026-09-05 rejected `b7793753` operation-proof candidate

The cadence successor was committed locally at
`b7793753ecfec7984214c07dfea21a3918a96c6d` / tree
`b3f1251d19b9acb0af64f098bbc8f649fbd07217`. Its exact clean macOS arm64
package completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`9523e29ea37e8ddf4696645f0f68f2e15492b7198f5ed93f7b0804ede73a7cf3`.
The sole packaged lifecycle attempt then rejected after `9,779 ms` and wrote a
mode-0600 failure receipt with SHA-256
`2c93e138f10bafa24ba7a745ad730a786750cdd94be215aaa1f8acbe801392e1`.
The receipt binds the exact clean head/tree and two launches; process and
profile cleanup completed with zero secondary failures.

The receipt records only `lifecycle_failure`: restore completed without a
fresh operation fix, with no `>=200 ms` gate kind or source/renderer
diagnostics. Two launches narrow the failure to `resume_interrupted_restore`
or `review_after_cleanup`, but the old completion path deleted the named
checkpoint before throwing a plain error, so the exact operation is
irretrievable. This is proof-boundary-indeterminate, not admissible evidence of
a product cadence stall, and b779 will not be rerun unchanged.

Source retrace reproduced the restart race. An in-flight fix requested before
the named operation can reach MapLibre afterward and advance the cumulative
restore count while remaining correctly excluded by the operation's source,
request, emission, and observation fences. The cumulative phase waiter could
therefore return and freeze the operation before the next 50 ms poll. The
red-first successor waits for `resume_interrupted_restore`'s own exact fix
inside its existing work fence and requires a genuinely new restore baseline
before opening the post-cleanup Review operation. It does not admit post-work
fixes or change any source, continuity, main, renderer-frame, CDP, or strict
`>=200 ms` deadline. Missing-fresh failures now snapshot the validated
operation kind, causal fences, phase delta, source cadence, and phase metrics
before checkpoint removal, producing attributable sanitized terminal evidence.
The successor's pre-freeze gates pass the four lifecycle files at `191/191`,
the wider affected set at `10` files / `399` tests, and the full deterministic
serial suite at `375` files / `3,795` tests. Full ESLint, production build/bundle
budgets, backend `58` passed / `1` platform-specific ignored, Node syntax, and
diff checks are green. An independent focused review found no runtime blocker
after tightening the seven workload-to-operation-kind mappings. These remain
pre-freeze source checks, not exact-head package or lifecycle proof.

## 2026-09-05 rejected `30061c2d` cleanup-snapshot candidate

The named-operation proof repair was committed locally at
`30061c2d93f20cdc7f48d6abb5b77bbd041abdd0` / tree
`a77a4a37689791f958158c9c43608251e8fbc972`. Its exact clean macOS arm64
package completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`84a6cd909633d18459d10f0c4a9419a639a786fb8f4d56ea6755d8eee7a53a6b`.
The sole packaged lifecycle attempt rejected after `9,937 ms` at
`start-mission-cleanup` with the renderer-visible closed code
`ARCHIVE_CLEANUP_FAILED`. Its two-launch mode-0600 failure receipt has SHA-256
`659aa9ed2cd155196d9b4d1f575c62433a0fd08cb1417be9e927901f44fafdc4`.
Owned process/profile cleanup completed. The old IPC boundary retained neither
the worker substage nor its cause, so the historical receipt alone cannot name
the internal SQLite error and 30061 will not be rerun unchanged.

The causal defect is reproduced by a focused red regression using the same WAL
topology: finalized cleanup target A and independently writable live mission B.
After cleanup's first read inside a deferred transaction, B commits a device
update. SQLite then raises `SQLITE_BUSY_SNAPSHOT` on cleanup's first write; the
membership bypass converts it to `ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_ACTIVE`,
which the coordinator did not recognize as retryable and immediately collapsed
to the exact public `ARCHIVE_CLEANUP_FAILED` envelope. That immediate path fits
the packaged timing. Cleanup code is unchanged between passing b75 and failing
30061; b779's independent 50 ms live-mission persistence is the relevant runtime
delta. Direct probes separately disproved ordinary worker-open WAL contention.

The smallest red-first repair changes each cleanup cursor boundary from
`BEGIN DEFERRED` to non-blocking `BEGIN IMMEDIATE`, acquiring the writer slot
before any boundary read can form a stale snapshot. The regression now proves
that the contender sees bounded busy responses during those atomic boundaries,
cleanup completes and removes only target A's rows, and mission B is writable
immediately afterward. Existing finite 25 ms busy-family retry and yielding
remain intact; no liveness threshold, batch size, custody check, cleanup scope,
or failure gate changed.

The attribution repair transports only a versioned bounded tuple of known
substage/cause enums, finite cursor counts, worker-exit state, and an immutable
archive-inventory table identity. It crosses a real worker, runner, closed IPC
message, Playwright's bounded first error line, and the mode-0600 failure receipt
while retaining the terminal archive code suffix used by the operator UI.
Malformed/noncanonical tokens, deep or cyclic causes, throwing getters, revoked
proxies, paths, error text, unknown fields, and identifier-shaped private values
fail closed without replacing the original durable failure audit.

Pre-freeze evidence is green at `6` focused files / `110` tests, `20` archive
files / `412` tests, and the deterministic serial repository suite at `377`
files / `3,806` tests. Full ESLint, TypeScript/production build and bundle
budgets, focused Node syntax, diff checks, and backend `58` passed / `1` ignored
are green. A focused independent review is clean after the three containment
corrections above. These were pre-freeze source checks for exact successor
`e9584e94`; its exact package completed, but the lifecycle attempt below
rejected that head before any later gate.

## 2026-09-05 rejected `e9584e94` renderer-CDP candidate

The cleanup-snapshot repair was committed locally at
`e9584e94dbb7bc8403a62517657b6518e0a2627f` / tree
`c45f2064231a4b533499a32d3fbf39c240c125fd`. Its exact clean macOS arm64
package completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`7692a05e4c0c1e5560afae83b44158c8fcb83a426ad661422126fdc5b7a605e3`.
The sole two-launch lifecycle attempt rejected after `11,287 ms` with
`external_liveness_gate_failure` / `renderer_cdp_watchdog_failed`. Its
mode-0600 failure receipt has SHA-256
`a7a2f9bd1e694e8aa77b6b9b971700261c41bc279cae7b7cfc34379fde0aa5d7`.
Process and profile cleanup completed; teardown retained one secondary
`liveness_probe_stop` aggregate. This head advanced through the cleanup that
rejected 30061 and will not be rerun unchanged.

The failure occurred on launch 2 in restore phase during the named
`review_after_cleanup` operation after `63` operation-fresh samples and a
`64`-sample phase delta. No current-fix continuity or timeout diagnostic was
recorded. Restore maxima remained below the strict gate: current fix `72 ms`,
main watchdog `119.533 ms`, renderer frame `63.4 ms`, and source/request to
renderer `70 ms`. The historical receipt did not preserve whether the renderer
CDP request timed out or rejected, so it cannot prove the exact mechanism and
is not admissible evidence of a product stall.

Source trace found that the old harness returned the entire paged Review tree
through one large by-value renderer evaluation on the same Playwright/CDP
client used for liveness drains. A real Chromium micro-probe confirmed that
large by-value responses can delay unrelated requests on a shared client past
the 200 ms boundary. This supports a shared-transport instrumentation failure,
but does not retroactively turn the e958 receipt into causal proof.

The red-first successor assembles Review in Node through sequential bounded-
size renderer transfers and reserves a second CDP connection/page exclusively
for the liveness observer. It binds that page by the exact browser-global target
ID, fails closed on a missing or ambiguous match, settles both transports under
independent cleanup-only bounds, and preserves the first renderer-CDP failure as
bounded `stage` / `causeClass` enums. Queue acquisition and each liveness CDP
request retain their separate strict `200 ms` bounds; no liveness, source,
continuity, cleanup, or custody gate changed. The focused affected gate is green
at `6` files / `186` tests; the deterministic serial suite passes `377` files /
`3,813` tests. Full ESLint, TypeScript, production build/bundle budgets, focused
Node syntax, diff checks, and backend `58` passed / `1` ignored are green. Two
independent focused reviews and a real Chromium dual-client target/close probe
are clean. These are pre-freeze source checks; the successor's one exact
package/lifecycle attempt produced the rejection below.

## 2026-09-05 rejected `ec258eba` final-validation candidate

The renderer-CDP repair was committed locally at
`ec258ebadafcabbe9ad8c513f35aa705566a3a70` / tree
`ef09d6a401759b3aeba54b613ba14289bbbf841f`. Its exact macOS arm64 package was
verified before later successor packaging replaced the local artifact, with
executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`90764b3c33b3560827a2a061e94a4a5ea8035e94261db76350fe66213947e700`.
The sole real two-launch lifecycle attempt rejected after `10,956 ms` because
the final evidence validator returned exactly one closed gate. Its sole
mode-0600 failure receipt has SHA-256
`e816a6055d5f9e4384cb70a18e667b88d8d90dbd15b096bd2dddfd6ef63b244e`.
It recorded no liveness diagnostics or secondary cleanup failure, and process
and profile cleanup completed. A preliminary relative-path invocation was
rejected during CLI setup before Electron launch or evidence-directory creation;
it was not a lifecycle attempt. Ec258eba is rejected and will not be rerun.

The old receipt discarded `validation.failureReasons` and the disposable profile
was removed, so the exact historical gate is irrecoverable. This is a final-
evidence-validation-indeterminate harness rejection, not evidence of a product
lifecycle or liveness failure. Source trace did confirm a separate producer/
validator defect: raw liveness maxima were accepted only when finite,
non-negative, and strictly below `200 ms`, then rounded to three decimals before
the final validator applied the same strict gate. A raw `199.9996 ms` value
therefore passed the producer, became `200`, and failed one final gate. That is
the strongest deterministic explanation for the receipt shape, but it cannot be
claimed as ec258eba's exact historical cause.

The red-first successor preserves the already-validated raw finite maxima in
JSON instead of rounding them. It does not clamp, floor, relax, or otherwise
change the strict `<200 ms` contract. Final validator failures now retain total
count plus at most 16 sanitized, 400-character reasons under the distinct
`evidence_validation_failure` classification. Malformed metadata cannot suppress
the primary receipt or masquerade as a confirmed gate: it uses bounded unreadable
sentinels, a nullable unknown count, and
`evidence_validation_metadata_failure`. The executed regression carries an exact
validator reason through a secondary cleanup failure into the atomic receipt.
Pre-freeze verification is green at `6` affected files / `250` tests and the
full deterministic serial suite at `377` files / `3,818` tests. Full ESLint,
TypeScript/production build and bundle budgets, Node syntax, diff checks, and
backend `58` passed / `1` ignored are green. Two independent focused re-reviews
are clean. This section records pre-freeze source evidence only; package and
lifecycle outcomes are authoritative only in a terminal receipt bound to the
exact executing head and the external PR/Linear ledger.

## 2026-09-03 cancelled-cleanup fence remediation

The exact-head broad, persistence and concurrency reviews at `b30ebeb2…`
reproduced a P2: cleanup cancellation rejected before the dedicated SQLite
worker physically exited, releasing the archive-family and Review fences during
the worker's termination grace. The red-first regression keeps the cleanup
promise and mission Review blocked until `workerExited`; the fix is pushed at
`561ffcb96960ba3bd62dcede1c616b74a79b22a7` / tree
`afbd3b3940d9908edea9d661c24078e471bf63a1`.

The qualification-safe run-identity fix is `b30ebeb2…`; cleanup moved off the
Electron main loop at `92c87f01…` after the first >2 GiB attempt measured
multi-second main heartbeat/current-position gaps. Those earlier receipts are
prior-head diagnostics only. Final Ubuntu, Linux, package, browser, visual,
documentation and review evidence must bind to one exact head.

## 2026-09-03 latest remediation

The post-remediation exact-head broad review found three P2s and all three were
fixed red-first in `5ce12514…`: Mission Review now receives a durable
`correctionAuthorized` signal from the same bounded SQLite read snapshot rather
than inferring authorization from the newest 500 audit rows; browser validation
persists only sanitized secret verifiers so an archive can be reopened after a
session reload; and browser corrections require the current archive predecessor,
supersede the predecessor, and retain the audited supplement authority, reason,
timestamp and chain metadata. Fresh broad, persistence and concurrency reviews
at the exact source head are clean, with no P1/P2/P3 findings.

The narrow crypto-only review then found one P2 assurance mismatch: recovery
credentials were being converted to immutable JavaScript strings in four worker
paths while the evidence claim said they were not. The remediation is committed
at `c5a2c354cd954df600ab1e73a1b7e0f44384e3f5`: recovery-code canonicalization
now stays in mutable bytes, create/verify/restore/cleanup pass those buffers
directly, and the lifetime regression covers every path. Crypto/lifetime tests
are `39/39` green and the evidence claim is now bounded to the truthful
no-worker-string invariant.

## Candidate proof wave (2026-09-03)

Source remediation is committed and pushed at `5ce12514056d9adef51a763bb0a0672095d6e805`
/ tree `0a94e503dc7c4d8b2535d5a41d19ae863069cf36`. The affected deterministic
suite is `281/281` green, archive-review and mission-review Chromium flows are
`17/17` green, and archive visual Playwright is `3/3` green. The exact-head
review wave was clean for three of the four final charters: broad life-safety,
persistence/completeness and concurrency/finalization. Renderer/input
containment remained required on the final documentation head. The narrow
crypto-only check was remediation evidence, not a fifth final-review charter.
Full serial unit, package, kill-matrix, Ubuntu >2 GiB, Linux workflow and final
documentation-head proof remain open until their raw reports are bound to the
final head. The
source-head full serial unit gate is now `368/368` files and `3,524/3,524` tests
green; the four generated archive visual manifests also passed independent
visual review (`4 pass / 0 fail / 0 error`).

The current P1/P2 remediation is red-first tested at `53269409…`; no prior-head
review or proof is promoted automatically. The correction restore now rejects a
same-size staged snapshot mutation using the authenticated SHA-256 and pinned
regular-file identity. The correction runner validates and carries those fields
without exposing them in the completion envelope. The outbox write and renderer
incident paths recheck the durable recovery fence immediately before each
mutation. The exact-head broad, persistence and concurrency reviews are pending;
no prior-head approval or proof is promoted automatically.

At `53269409…`, the correction snapshot worker now accepts a completion only
after a successful worker exit, while archive-backed rehydration validates the
projected finalization event rather than registry tables intentionally absent
from the archived snapshot. Mission Store records the global attachment-custody
recovery blocker only when an attachment journal remains, so no-attachment
failures cannot strand unrelated missions. These changes are covered by
red-first completion/exit, abort-window, archive-review snapshot, and
no-residue-fence tests. Fresh exact-head reviews remain the release gate.

At `22d5089e…`, the review close registry accepts the existing correction
restore reason, IPC always reports a successful correction envelope, and the
renderer keeps a durable attachment-custody failure visible while returning to
the live read-only source. A real archive-review → cleanup → snapshot → restore
integration test now proves both plaintext sweeps and the correction close audit.
The fresh exact-head review wave is the release gate.

At `6d666a86…`, IPC now treats a committed correction with a clean live-store
state as successful even if the worker exits abnormally after its durable
transaction; committed custody failures retain their explicit failure envelope
without a second session close. Cleanup retries reopen renderer evidence only
after plaintext cleanup succeeds, operator banners preserve the safe custody
cause, governance refreshes in a finally path, and the writer-lane admission is
applied through all database-backed mutation helpers. Red-first regressions
cover the post-commit exit, close ownership, cleanup retry, browser legacy
envelope, UI cause, and held-worker mutation cases. Fresh exact-head reviews
remain the release gate.

The affected review wave at `26238179…` found a P1/P2 path-swap window in
correction rehydration and a P2 replay mutation during custody recovery. At
`64c5143d…`, rehydration copies and authenticates the snapshot through a pinned
descriptor into a private read-only restore file, while replay pauses on the
recovery code without adding a false ledger failure. At `4291a49…`, the paused
replay schedules a bounded retry and resumes after the fence clears, and
cancellation cannot mask a post-commit custody-cleanup failure. Custody recovery
writes a durable `completed` marker before removing its final journal directory,
so a restart can clear only a worker-proven completion. These fixes are covered
by red-first path-swap, replay-fence, retry-resume, cancellation-race and
completion-order tests; the fresh exact-head reviews are the release gate.

The broad and persistence reviews at `84424c08…` found the mission-name and
recovery-write P2s. Both were fixed red-first and pushed at `e9d7bd51…`; no
prior-head review is promoted as final evidence. A broad-review P3 about sweeping
pre-commit rejected-restore snapshots remains outside the frozen P2 remediation
scope because the renderer-owned session close already performs that sweep.

The final concurrency review at `d28a82d…` found a post-commit correction
attachment-journal removal failure that was being reported as generic rehydrate
failure. The worker now classifies any unproven post-commit journal removal as
`ARCHIVE_REHYDRATE_CLEANUP_REQUIRED`; Mission Store persists the durable recovery
blocker before reconciling the committed unlock, and the red-first attachment
restore regression proves later correction work is fenced. This fix is pushed at
`84424c08a9d2e8c3c8ed408367226372b7ab1631` / tree
`818115351f9d90cf3ecc939e5faa23d066a5d0b9`.

## 2026-09-03 exact-head remediation ledger

The concurrency and renderer rechecks found two P2 defects at `739560cb…`: a
shared SQLite busy timeout could still block the Electron main loop before the
retry delay, and the correction snapshot runner did not subscribe to its
AbortSignal after startup. The red-first fixes are pushed at
`0bc9563978bfb34455b5c04e62e3c36ccba3d0c4` / tree
`19744f2498219c8b81dbe40f2dcf1cc1ec9baf8e`; the follow-up cleanup-admission
P2 is fixed and pushed at `d28a82d7690d3e184efbadd98bfb330c9aca5fac` / tree
`c212d1cd0d89d5572965ad4958518f2ed7507e3b`:

- cleanup transaction boundaries temporarily set the connection busy timeout
  to zero, then retry asynchronously at 25 ms, so lock contention cannot stall
  current-position/UI work;
- correction cancellation is joined through IPC, the review snapshot worker,
  mission-store admission, and the archive correction worker; and
- the exact 40-character source head is embedded in packaged operator-visible
  version text.

The local full serial gate passed at `d28a82d…`: `368/368` files and
`3,487/3,487` tests.
The 32-case local SIGKILL matrix is qualified, and the archive-review/
mission-review Chromium operator slice is `17/17` green. The standalone
coverage suite is `1/4` because three pre-existing DON-275 checks still report
“Participant history is still being added”; this is recorded as a browser-proof
limitation, not silently treated as PR6 coverage. The Ubuntu field-scale run
was restarted after the host reboot but is bound to the prior code head and is
not final proof; rerun it against the final exact documentation head.

## 2026-09-03 correction-custody remediation

The exact-head review wave found one further P2 in the new attachment recovery
path: startup recovery queried a non-existent `missions.storage_state` column.
The fix now reads the durable `mission_cleanup_journal` state and has two focused
restart tests proving that uncommitted attachment residue is removed while bytes
from an already-committed correction are preserved. This remediation is pushed at
`d410df0c8fd1ffc421d824496a6a24e40dc438fb` / tree
`f21a3df774e81913dfa6b9d541443674ea859f0c`.

The candidate also includes the prior fixes for authenticated same-size snapshot
mutation rejection, session-keyed correction authority, cooperative correction
worker cancellation, streamed bounded attachment reads/copies, and post-commit
live-source recovery classification. The next review wave must be run against
this exact head; no prior-head proof is promoted automatically.

## 2026-09-02 remediation ledger

The previous exact-head broad/persistence reviews exposed two lifecycle gaps.
The candidate fixes are now source-backed and red-first tested:

- Finalized archives project the post-seal `finalized` mission status and
  deterministic `mission_finalized` (plus supplement) audit events into the
  sealed SQLite snapshot. Restored Mission Review therefore retains the
  terminal lifecycle history instead of presenting a `finished` snapshot.
- Interrupted cleanup remains a durable `cleanup_in_progress` blocker and now
  has an explicit operator Resume cleanup action. The request is mission/archive
  bound, uses a fresh bounded operation identity, and crosses the explicit
  main/preload handler; the browser harness and IPC containment tests cover the
  route. Expected shutdown cancellation of the startup registry sweep is not
  persisted as a false failure marker.

Focused remediation evidence: archive review/lifecycle/cleanup/IPC tests
`84/84` green; full deterministic unit suite `359` files / `3,433` tests green;
lint, TypeScript, Node syntax and diff checks green. The candidate was pushed as
`537fcc9462336e0e1c6cc9916a0aa7f3172b51e1` / tree
`337a0bd9aea1a02a6a36270bd0363076c430db57`. Independent exact-head review and
reference-host/package/browser proof are not implied by these local checks.

The next exact-head review wave found and closed two additional P2 gaps:

- Cleanup recovery is now reachable from both Mission Control and Saved Mission
  Archives while the durable storage state is `cleanup_in_progress`; start and
  cancellation failures preserve the Resume cleanup action.
- Retained archive reads are serialized and skipped on the docked active/paused
  live-position path, so opening Review cannot fan out unbounded archive IPC.
  Create/verify/restore/cleanup workers carry credentials as transferred
  mutable byte buffers. Recovery-code canonicalization stays in mutable bytes,
  and the workers scrub those buffers at their final KDF/unwrap boundary; no
  worker reconstructs an immutable credential string.

Those are historical candidate claims. The recovered operator surface keeps
the entry action neutral and offers Resume only after eligibility proves an
intact, explicitly in-progress cleanup journal; invalid recovery state and
membership drift remain non-resumable blockers.

The previous resulting candidate was `358370abd39c7ac708164d7adf2d1f564cc00bf8`
/ tree `29b3c37d755681cf41dc7ef4f9773fc6994e86f4`; its full deterministic gate
was `360` files / `3,439` tests green. That evidence remains prior-head only;
no earlier proof is silently promoted to this head.

The next exact-head review wave found and closed one correction-lifecycle P2 and
one renderer-safety P2. Rehydration and the final unlock event now run through a
worker-owned transaction, with a rollback/retry fault-injection test. Correction
snapshot deletion is an explicit terminal failure when sweeping cannot be
confirmed. The operator only sees correction for the current verified v2 archive;
if a failed restore cannot confirm plaintext cleanup, the active session remains
visible in `plaintext_cleanup` recovery. Hostile 64 MiB and unknown-field restore
inputs are rejected before collaborators are invoked. These fixes are committed
at `fec8be41704fb8d112483f108bcf5b4113e43faa`; fresh exact-head reviews remain
the release gate.

## Execution identity

| Item | Exact value |
| --- | --- |
| Branch | `codex/breadcrumb-pr6-archive-lifecycle` |
| Pull request | [#10](https://github.com/donal0c/sartracker-web/pull/10), draft until the immutable exact-head review ledger is clean |
| Exact base and initial `origin/master` | `eec92812b783a795c093f37268b295dd2179a3af` |
| First frozen implementation candidate | `60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95` |
| First candidate tree | `0fdbc3d4812d83feecdf4151688fc317381719c6` |
| First replacement candidate | `d60059d9267d4391ffeaa158ae0adec1dad57a2a` |
| First replacement tree | `1e92fd45d701bbcc57a53a2d86ce5031b1879467` |
| Second replacement candidate | `e975ff1c64f914d582efe2aedb09d29f4df19ca2` |
| Second replacement tree | `1b01df864dbe3299bd05279524fdb926332fc8ae` |
| Pre-visual candidate | `136000ff4b4489e5ff5c57fd10e1a7bda658a2e7` |
| Pre-visual candidate tree | `8a0b30c9fb3e2b81a72e5f76fbf60bcc69293e65` |
| Superseded pre-retry candidate | `618f9c8b7f3c818aab25787c926b1394d2282297` |
| Superseded pre-retry tree | `87aea9263d5634e76608cd8096a7b3996741b2ca` |
| Frozen code candidate | `3b148e532bd5a98b3d2fa24466fc8501a111efdd` |
| Frozen code candidate tree | `4be6f73d00de9cf9a4315c133ddfe51295c3e344` |
| Post-candidate base reconciliation | `af745dc0c4027e25f8f306f38aa603026c3f2277` / tree `13d75423584d6a6f73501168b5cf4d9f5a547af3`, merging `origin/master` `0ca331ff816800e83134142cb109903e5d2c2992` |
| Exact qualification-harness remediation head | `53164028f72254c4e17fcc0b4b845f7601fee153` / tree `5c347d30691f291164dc65ed25c2bc437f906e55` |
| Previous archive-lifecycle remediation head (superseded) | `f220f59650ba96231f06a4f45015791223934300` / tree `9b5bf3a24da9a4ba6e98e8ee3e21d7ba236e6538` |
| Previous archive-lifecycle remediation head | `bd14adb5c4f41797c975089bb3d52dc22da95d1a` / tree `41225f06694b53e0230e446eaf5881f82c699d69` |
| Superseded code/qualification head | `661305694d43682a6e4aa0e0fafeeb962affc7ea` / tree `0854dfd72b0b1c04c3e6fda0827ca9761060c6f5` |
| Remediation candidate (pushed) | `537fcc9462336e0e1c6cc9916a0aa7f3172b51e1` / tree `337a0bd9aea1a02a6a36270bd0363076c430db57` |
| Superseded correction-worker candidate | `fec8be41704fb8d112483f108bcf5b4113e43faa` / tree `0365f9be98ddcf217306c6b904dca439e6b9e8f0` |
| Superseded correction-custody candidate (pushed) | `d410df0c8fd1ffc421d824496a6a24e40dc438fb` / tree `f21a3df774e81913dfa6b9d541443674ea859f0c` |
| Cleanup-admission remediation candidate (pushed) | `d28a82d7690d3e184efbadd98bfb330c9aca5fac` / tree `c212d1cd0d89d5572965ad4958518f2ed7507e3b` |
| Post-commit custody-fence remediation candidate (pushed) | `84424c08a9d2e8c3c8ed408367226372b7ab1631` / tree `818115351f9d90cf3ecc939e5faa23d066a5d0b9` |
| Superseded source candidate (pushed) | `0d6f1bf1ed6f2c0ab9b804229a8ffde536577e3c` / tree `e86f1b5037ca91e4de50d012ac2051c530498c88` |
| Superseded source candidate (pushed) | `5326940948ee62d97b7ada91017275c65ef5a9a8` / tree `6db7275ba5f3aea30f596f47518fa2b466bf1ccd` |
| Superseded source candidate (pushed) | `5ce12514056d9adef51a763bb0a0672095d6e805` / tree `0a94e503dc7c4d8b2535d5a41d19ae863069cf36` |
| Superseded pre-recovery packaged candidate | `0f0723d4b1ec7e78d4f6c166abad049188660ca6` / tree `b53474dc93069930a0c284ed6507510bd6a87d94` |
| Prior-head packaged macOS archive-lifecycle smoke (superseded) | `0f0723d4…`; report SHA-256 `e30b9c9d3a12b2ae02a36193b3c64e1c2a046a268cb37c28d4c4bbcddf191bbe`; passed its then-current gates but predates the recovery and is not final-head proof |
| Rejected field-diagnostic head | `caf9e5e480fcd02cc44d68c8397efcd6ae78f2cd` / tree `81a8ef3e3639f6e8e7cd048691a87b8488a4d998`; its failed receipt is diagnosis, not qualification |
| Rejected cadence candidate (pushed) | `b75f8689304769438157cd5e018996cdafcdb328` / tree `3216b03286c8543dfbeaff42097528ca197cbd7e`; Linux run `33940959449` rejected the first pre-cleanup Review operation at `240 ms` current-fix continuity |
| Rejected operation-proof candidate (local) | `b7793753ecfec7984214c07dfea21a3918a96c6d` / tree `b3f1251d19b9acb0af64f098bbc8f649fbd07217`; exact package passed, then the sole lifecycle attempt wrote proof-indeterminate receipt SHA-256 `2c93e138f10bafa24ba7a745ad730a786750cdd94be215aaa1f8acbe801392e1` |
| Rejected cleanup-snapshot candidate (local) | `30061c2d93f20cdc7f48d6abb5b77bbd041abdd0` / tree `a77a4a37689791f958158c9c43608251e8fbc972`; exact package passed, then the sole lifecycle attempt failed at cleanup start with receipt SHA-256 `659aa9ed2cd155196d9b4d1f575c62433a0fd08cb1417be9e927901f44fafdc4` |
| Rejected renderer-CDP candidate (local) | `e9584e94dbb7bc8403a62517657b6518e0a2627f` / tree `c45f2064231a4b533499a32d3fbf39c240c125fd`; exact package passed, then the sole lifecycle attempt failed during launch-2 `review_after_cleanup` with receipt SHA-256 `a7a2f9bd1e694e8aa77b6b9b971700261c41bc279cae7b7cfc34379fde0aa5d7` |
| Rejected final-validation candidate (local) | `ec258ebadafcabbe9ad8c513f35aa705566a3a70` / tree `ef09d6a401759b3aeba54b613ba14289bbbf841f`; exact package passed, then the sole lifecycle attempt failed one irrecoverable final evidence gate with receipt SHA-256 `e816a6055d5f9e4384cb70a18e667b88d8d90dbd15b096bd2dddfd6ef63b244e` |
| Rejected correction-custody candidate (pushed) | `20486b6ceaf86060a64892f43c07cd303e2a8548` / tree `131da068cc3ec973c1e8ce20edc59a606ca60f71`; its sole lifecycle, Chromium, visual, uncached visual review, and physical-kill matrix passed, but final review found correction-consumer and custody/plaintext-cleanup races; Linux run `33954733857` was cancelled and the head will not be rerun |
| Rejected pre-freeze successor tree | `840947d5fcacb66c64597f85f6a434753de621a9`; post-repair audit reproduced a correction pathname-rebind race that could redirect rollback deletion outside custody and a lifecycle race that released staging ownership before terminal consumption. It was rejected before packaging and will not be rerun unchanged. |
| Current recovery successor | Frozen test/docs-only descendant of reviewed tree `91f8f3ed`. Production blobs retain the red-first correction and lifecycle repairs: correction `8/102`, independent audits `8/137` and `7/99`, maximum 4,096-entry writer ownership `59.9-94.7 ms`, changed matrix `20/628`, and lifecycle `3/259` with a clean re-audit. `91f8f3ed` passed the council and exact-tree specialist reviews, then its first source cycle exposed two load-sensitive fixed waits (`3,958/3,960`); the deterministic lazy-import test repair passes `14/14`. At freeze, no package or deferred platform gate had run. |
| Recovery candidate and final proof | Pending. Once the current frozen source completes the approved gates through the sole packaged lifecycle, record the exact pushed head/tree and terminal result in the PR #10 and Linear ledger; browser/visual, physical-kill, Linux, and Ubuntu proof remain downstream |
| Scope | one PR6 containing all three internal strict-TDD checkpoints |

Historical carry-forward note: before the `caf9e5e…` field run, a read-only
merge-tree check and blob manifest bound selected earlier application proof
across a master reconciliation. The recorded path-list and manifest digests
apply only to those named prior heads. This recovery changes finalization,
cleanup, qualification, and packaged-liveness inputs, so none of those old
manifests is current or mandatory for the final tree. The affected proof must be
rerun on the new immutable candidate rather than carried forward by ancestry or
partial blob equivalence.

The first candidate was committed only after the staged tree was clean, the focused
qualification and kill harnesses were independently rechecked, and the local
unit/static gate passed. It was then pushed before external exact-head proof.
The first local packaged run found that CSS uppercased the visible hexadecimal
head while the smoke harness compared it case-sensitively to the lowercase Git
value. Manual CDP inspection and `app.asar` both contained the exact full
40-character head, but the harness failed before lifecycle execution. This is
a confirmed P2 proof-integrity defect. The first head is retained as prior-head
evidence only. A red test reproduced the CSS-uppercased full head failure; the
replacement accepts hexadecimal case only while still requiring one exact
bounded 40-character token and rejecting prefixes/longer tokens. The focused
replacement gate passed `30/30`, ESLint, TypeScript, Node syntax and diff
checks before commit. Once that gate passed, the packaged run reached mission
seeding and exposed a second smoke-only P2: the runner expected an internal
acknowledgement object even though the locked public `addPositionsBulk` bridge
correctly returns `Position[]`. The replacement now requires an array with
exactly the requested bounded batch length and separately verifies the
persisted total. It rejects acknowledgement objects, short and overlong arrays.
A bounded source retrace compared every other smoke-consumed result with the
public bridge types, main projection and store implementation and found no
other mismatch. The red/green focused gate finished at `31/31` plus ESLint,
TypeScript, Node syntax and diff checks.

The next disposable package traversal found two further harness-only P2s before
any final candidate was accepted. Restore interruption called `input.page` even
though the closed launch owner is `input.launch.page`, so the intended physical
decrypt-phase kill could not be armed. A red test now fixes both calls to the
owned launch page. Once the lifecycle reached terminal cleanup, its whole-result
comparison correctly reported that two independently opened Review sessions
were not byte-identical. Exact sorted payload diffing proved one and only one
session-transport field changed: `review.workerThreadId` (`5` to `7`). The
closed comparison excludes exactly that path, rejects missing or additional
Review-result fields, and retains the complete mission, audit, breadcrumb and
Replay objects. Negative tests mutate mission revisions, immutable audit
content, breadcrumb counts, Replay rows, row order and totals and require every
mutation to change the comparison digest. Focused tests are `39/39`; ESLint,
TypeScript, Node syntax and diff checks pass. A synthetic disposable package
then traversed create, independent verify, read-only Review, audited mutation
denial, physical decrypt-phase `SIGKILL`, restart sweep, credential-gated
cleanup and residue/secret scans to terminal green. That run was deliberately
unbound and is not final exact-head proof.

The next independent audit found that this traversal checked only the first
bounded Replay page. Red-first remediation now fixes one generation and
exhausts every track, object and outing-filter continuation page, rejecting
cycles, partial pages, empty non-terminal pages, invalid cursors, duplicates,
order changes, total changes and scope changes. The physical fixture now uses
the public preload bridge to create 4,096 breadcrumbs, 101 marker objects and
101 distinct GPX outings, and requires all `4,096` / `202` / `101` projected
rows or choices to match before and after cleanup. A fresh independent audit of
the remediated pagination proof was clean.

The Ubuntu diagnostic also exposed a product C5 performance defect: a legacy
registry pending check could synchronously scan 9.7 million mission events.
The frozen candidate records a fixed durable backfill target, reads pending
state from canonical metadata only, scans at most 1,000 raw rows and processes
at most 50 archive events per asynchronous turn, and advances registry changes
and cursor metadata atomically. Malformed or regressed boundaries fail closed.
A fresh independent C5 source audit was clean. The qualifier separately replaces
an arbitrary total-duration limit with a 120-second no-durable-semantic-progress
watchdog; immediate durable failures and the 200 ms liveness gates remain hard
failures.

Exact-head visual qualification then found one stale PR5 test route: the
finalized Search Operations visual clicked the removed plaintext
`mission-finalize-confirm` control even though the product correctly presented
the encrypted custody dialog. The failure repeated in isolation. Red-first
remediation drives the real passphrase, one-time recovery-code issuance,
type-back and create/seal/verify route. Its file passed `2/2`, the full visual
DOM suite passed `61/61`, and the corrected critical screenshot passed a fresh
independent visual review. No product behavior was changed. That candidate
later became prior-head evidence when the sealed-verification retry audit found
that an operator could not retry independent verification with the original
passphrase and recovery code and that a newly sealed custody row could remain
unavailable until restart. Red-first remediation added the bounded,
single-flight retry dialog, immutable archive-identity checks, authoritative
timeline reconciliation and serialized off-main custody recovery. A fresh
independent focused review found no remaining substantiated P1/P2. That
candidate is retained as historical prior-head evidence only; it is superseded
by the current remediation head recorded above.

## Authority and requirement trace

The raw transcript in
`team-feedback/breadcrumb-question-answers-20260822.md` outranks summaries,
the ADR and model output. PR6 does not add a team answer or assign a human
custody role.

| Authority | Locked meaning retained by PR6 | Main proof surfaces |
| --- | --- | --- |
| `SAR-QA-007` | Raw fixes, named tracks, timestamps, accuracy, the map image, audit history and the saved timeline remain reviewable | mission-scoped inventory/content proof, archive Replay and read-only Mission Review |
| `SAR-QA-017` | Replay reconstructs evidence known at T, not historical screen state | every page exhausted at up to five deterministic comparison times against the restored archive and a new immutable-request-bound live snapshot (including the protected epoch when present), with store-level current-epoch checks before retry and at commit |
| `SAR-QA-019` | GPX timestamps are never invented; undated GPX remains explicit static evidence outside precise Replay | GPX custody ledger plus the engineering exact-byte/hash-only/unavailable classifications and verification attacks |
| `SAR-QA-020` | Finalized evidence is read-only and corrections remain visible | finalized write fences, immutable supplement chain and revision timeline |
| `SAR-QA-021` | Traccar `fixTime` remains the breadcrumb evidence clock | inherited PR5 Replay/finalization contracts and archive semantic proof |
| `SAR-QA-006`, `SAR-QA-013` | Re-reading the same immutable Traccar position must not duplicate or overwrite source evidence | inherited idempotent position persistence and immutable source-row proof |

The non-blocking custody-tabletop confirmation was not sent from this task.
The one-recovery-code-per-archive rule and the decision not to assign a holder
are engineering custody controls from the binding PR6 packet, not answers
attributed to `SAR-QA-006` or `SAR-QA-013`.

## Delivered operator outcome

- Finalizing creates one self-contained mission-scoped encrypted archive. It
  does not copy unrelated missions or load a whole multi-gigabyte database into
  one JavaScript buffer.
- A newly sealed file is independently reopened, decrypted and restored into
  permission-restricted scratch space. `verified` requires exact ciphertext,
  frame, entry, schema, inventory, row-count, content-digest, attachment, GPX
  and Replay-semantic checks. A Replay sample never substitutes for exhaustive
  completeness.
- Creation, verification and restore failure is explicit and leaves
  operational mission evidence intact. Cleanup is an intentional, bounded
  deletion of archived mission rows, rebuildable derived projections, and the
  four settled operational tables `gpx_import_source_receipts`,
  `ingest_anomaly_deliveries`, `participant_backfill_checkpoints`, and
  `tracking_history_checkpoints`. The mission rows are represented in the
  verified archive; the derived and operational exclusions are not claimed as
  archive evidence. Within `mission_events`, only `device_updated`,
  `position_recorded`, and `mission_backup_synced` telemetry is cleanable.
  Interruption preserves the verified archive, mission stub, archive/supplement
  registry, every non-telemetry mission audit event, and unknown future audit
  event type. Resume is offered only when an intact journal explicitly proves
  cleanup is in progress. Invalid recovery state fails closed, and live-row
  membership changed after finalization requires re-finalization; ordinary live
  Review stays blocked until storage state is consistent. A sealed-but-
  unverified archive is not represented as complete.
- Sealing/finalization locks the mission read-only. Independent verification
  establishes archive completeness and Review eligibility; it does not perform
  the lock.
- Saved missions and every archive revision remain indefinitely visible on the
  timeline. Verified v2 revisions and superseded v2 revisions with prior
  verification open read-only using one of that archive's original credentials.
  Supported sealed/superseded v1 revisions open read-only without a credential
  and stay visibly labelled unencrypted. Sealed-unverified v2 revisions remain
  visible but are retry-only until exhaustive verification succeeds.
- A correction produces a new visible supplemental revision chained to the
  preceding ciphertext hash. Earlier archive bytes are never mutated or
  deleted.
- Removing eligible mission-scoped live data after archival is a separate,
  explicit, credential-gated and journalled action. It is resumable only when
  the validated journal proves an interrupted cleanup; an invalid journal or
  guard remains non-resumable, and membership drift requires re-finalization.
  Cleanup is never automatic and never deletes the verified archive or mission
  timeline stub. This is logical SQLite deletion: freed pages may be reused
  without shrinking the database file.
- Current-position independence during archive create, verify, restore, Review,
  and cleanup is a hard invariant. Its candidate-specific proof must come from
  the pending exact-head packaged external-watchdog report; it is not asserted
  from unit or in-process timing alone.

## Security decision and truthful claims

The binding engineering decision is
`docs/breadcrumb-archive-security-decision.md`. `SARARCH2` is a repository-
owned format that uses standard primitives; this record does not call the
format itself a standard.

- Each archive has a fresh random AES-256-GCM mission archive key.
- Mandatory passphrase and per-archive recovery-code slots wrap the same key.
- Scrypt profile v1 is `N=131072`, `r=8`, `p=1`, 32-byte output, 32-byte salt,
  and `maxmem=268435456`. Readers validate the version and every parameter and
  never silently weaken them.
- Frame nonces are a random four-byte prefix plus a monotonic unsigned 64-bit
  index. AAD binds the canonical header digest, index, final flag and declared
  plaintext length.
- Exact frame ordering, one final frame, trailer count and end-of-file are
  required. Wrong keys, mutation, truncation, reorder and splice fail closed.
- Newer/unknown container, cipher, framing, KDF or schema versions fail closed.
- Existing version-1 ZIP archives remain readable, explicitly labelled
  unencrypted and immutable; the operator finalization route creates v2.

Here, **no plaintext residue** means no application-addressable creation
staging, verification scratch or archive-review session file remains after the
applicable success, failure, cancellation, close or startup cleanup reports
success. A failed sweep remains explicit and retryable rather than being
represented as clean. An open Review session necessarily contains a visible,
permission-restricted temporary plaintext working copy. This is not a claim of forensic SSD secure erasure.
JavaScript string erasure is not claimed either; secrets are bounded, excluded
from logs/diagnostics and cleared at the earliest ownership boundary, while
worker-owned buffers/keys are overwritten where Node permits.

## Implementation boundaries

- `electron/archive-crypto.cjs`: KDF/slot, nonce/AAD and single-frame crypto.
- `electron/archive-container.cjs`: canonical streaming `SARARCH2` framing and
  logical-entry encoding.
- `electron/archive-inventory.cjs`: schema-v13 declaration, drift gate and
  deterministic table content proof.
- `electron/mission-archive-worker.cjs` and runner: pinned mission-only
  extraction, scratch construction, attachment proof and streaming create.
- `electron/archive-verify-worker.cjs` and runner: independent sealed-file
  restore and exhaustive verification.
- archive custody journal/operation/reconciliation modules: durable filesystem
  intent, exact publish/identity, restart recovery and conflict blocking.
- archive Review modules: permission-restricted read-only sessions, bounded
  projection workers, attachment opening and startup/close sweeps.
- cleanup coordinator/credential worker: current eligibility, a fresh unwrap
  using the archive's existing passphrase or recovery slot, exact custody re-
  witness, bounded transactions and durable cursor resume.
- `electron/mission-store.cjs`: schema v13, PR5 fence/epoch preservation,
  registry/supplement/finalization and cleanup state machines.
- main/preload and renderer adapters: closed bounded envelopes; no renderer
  direct database/filesystem access.

## Strict-TDD and deterministic proof

Every behavior checkpoint began with a failing test. Red tests and rejected
review heads were not counted as proof. The superseded pre-remediation
candidate passed the following local gates; these results are historical and
must not be presented as exact-final-head proof:

| Gate | Historical superseded-candidate result |
| --- | --- |
| Full unit/integration | `354` files / `3,360` tests passed on the identical staged candidate tree before commit |
| ESLint | passed |
| TypeScript project build | `npx tsc -b --pretty false` passed |
| Staged whitespace/merge-marker/secret candidate scan | passed; no generated evidence or unstaged file committed |
| Frozen-candidate sealed-retry regression bundle | `7` files / `127` tests passed; fresh independent focused review clean |
| PR6 qualification validator | `14/14` focused tests passed; semantic no-progress and monitor-ownership audit clean |
| Legacy archive registry | `22/22` focused tests passed; independent C5 audit clean |
| Packaged lifecycle helper/workflow contracts | `70/70` focused tests passed; fresh independent pagination audit clean |
| Physical-process kill helper | `19/19` adversarial tests passed |

After the Ubuntu field-harness P2, the qualification code/test tree passed the
red-first qualifier script/library bundle `68/68`, targeted ESLint, TypeScript
and diff checks. The preceding f111 code head passed the local serial full
deterministic gate at `359` files / `3,416` tests, with lint, TypeScript, Node
syntax and `git diff --check` green. The 3885 head added the queue-time,
bounded-shutdown and exit-fault red-first qualification checks. The current
6613 head adds deferred cleanup boundaries, finite retry of transient
`SQLITE_BUSY*` conflicts and a 500-position default page, with a six-second
concurrent-WAL-writer regression. Its full local serial result is recorded in
the candidate section below. Every final claim is re-bound after the
documentation commit.

| Physical-process gate | Result |
| --- | --- |
| Physical-process phase matrix before freeze | `32/32`, zero failures; honestly `matrix_pass_unbound` because the implementation tree was dirty while being assembled |
| Superseded-head physical-process phase matrix | `32/32`, zero failures; `qualified` on `618f9c8b…` / `87aea926…`; report SHA-256 `84ee328c526ada367bbb4a574a88ddc3445d7aba151b4ea782dd00744f86d92e`; retained as prior-head harness evidence only |
| Frozen-candidate physical-process phase matrix | `32/32`, all requested `SIGKILL`s observed; `qualified` on `3b148e532…` / `4be6f73…`; report SHA-256 `a50f0d1f3b48f591075b77ec9fc234be6ea9b52b8f4a4704d7ac0c685b0538a7` |
| Pre-commit candidate integrity audit | clean after a schema-v13 PR5-fixture compatibility P2 was fixed red-first |

The pre-freeze kill report is support for the harness, not final exact-head
qualification. Its final independent affected recheck found no P1/P2 after the
following forged-proof attacks were closed:

- cleanup row claims contradicting the observed 49-table inventory;
- fabricated, duplicate or incomplete schema/cleanup declarations;
- hidden unregistered `.sararch` bytes;
- runtime omitted from the report digest;
- report creation after the final repository capture;
- lexical report paths whose physical parent aliases the repository or the
  disposable work root.

## Required adversarial coverage

| Attack/failure | Durable coverage |
| --- | --- |
| Wrong passphrase and wrong recovery code | crypto slot vectors; verifier, Review and cleanup wrong-key integration |
| Bit flip, truncated frame boundaries, reorder, duplicate and splice | container known-answer/adversarial suite and verifier attacks |
| Wrong mission, archive request or finalization epoch | authenticated header/manifest and store/registry fence attacks |
| Disk full during create/verify/restore | worker failure injection; live mission and sealed archive state assertions |
| `SIGKILL` at every create/verify/restore/cleanup phase | real child processes plus parent-owned restart inspection and residue/custody checks |
| Undeclared, fabricated, duplicate or missing tables | schema inventory drift gate and qualification/kill-report forgery attacks |
| Restored row or attachment mutation | exhaustive table/entry/attachment digest attacks |
| Registry/disk mismatch, hidden orphan or same-size substitution | pinned file identity, whole-file digest and startup reconciliation attacks |
| Every cleanup precondition withheld | eligibility matrix; wrong key; active work/Review; stale epoch; custody mismatch; newer supplement; evidence health |
| Archive-review mutation | source facade has no mutation API; preload denial and browser/packaged attempts |
| Superseded-epoch recovery | supplement/finalization/registry restart attacks |
| Newer container/schema | closed parser and timeline availability failures |
| Wrong-typed or hostile 64 MiB renderer inputs | preload normalization rejects before IPC/main work and retains current-position priority |
| Concurrent live ingest/current reads | pinned extraction and per-phase liveness tests; exact host proof below |
| Plaintext and secret/privacy residue | three application-owned roots, exact secret scan, diagnostics/support/incident sanitizer tests |

## Browser and visual proof

On superseded clean candidate `618f9c8b…`, the full visual DOM suite passed `61/61`
and generated 73 registered frames. A fresh uncached Opus review passed all
`73/73` frames with zero fail/error at the critical gate. The isolated
canonical report SHA-256 is
`623b474d99fa7c798bf13a750b14e41a91c6640e2b1400330423abfed6af876f`.
An independent audit matched all 73 entry/PNG/result triads and every aggregate
result to its manifest identity. Its canonical manifest uses bytewise-sorted
root-relative POSIX paths and lines of `<file SHA-256><two spaces><path><LF>`;
the resulting 220-file tree digest is
`535375257255f8347f3f9f71571975f22edd2b2af7d9c960ff564830b2f48f03`.
An earlier undocumented producer aggregate was discarded because it could not
be reproduced from the unchanged tree.
A separate exact-head root repeat also passed `73/73` (report SHA-256
`4249cc23d80d4bff927a7abf6c031337ac22acd9a5913dd754522627707697cc`).
This covers the rendered operator surface, including encrypted custody,
read-only Review and its temporary-residual warning, the complete cleanup
checklist, retained archived timeline, and visible search-evidence read-only
state. It does not by itself prove desktop persistence or cryptography.

The targeted archive operator flow passed `2/2`; that head's full Chromium
suite passed `171/171`. These artifacts remain prior-head evidence only because
the subsequent retry P2 changed operator archive behavior.

On exact frozen candidate `3b148e532…` / `4be6f73…`, the full Chromium suite
passed `172/172`; the visual DOM suite passed `62/62` and produced 74 manifest
entries. A fresh Opus review passed `74/74` with zero failure/error at the
critical gate. Its aggregate report SHA-256 is
`6687d06328bddc6c019bfff3427e9f78447357bb090d72ee6d5eb04dc59efbae`.
An independent read-only audit recomputed every screenshot cache key, matched
all 74 unique manifests/PNGs/individual results to the aggregate and confirmed
the preserved/source trees are byte-identical. The complete visual-evidence
tree digest is
`8c9267d6a89271e748a6fcb635e1e5dc427c6c729eee3087c5078d4d63b9eaeb`;
the screenshot-set digest is
`9eb114bbb0719510a7f5421f86c6df20b18a311cedb4770367049ddda6a06277`.
Four exact synthetic browser-validation frames from that set are retained in
the operator manual. Their SHA-256 values are
`3985eae4d05f65bc9ac213c3026ac52c4ba666e6fdc8992a1cee42f3fca92f9d`
(one-time test recovery code),
`e8297ed026f7d9ba45b5f2780d2a6bb94708ddfa5e48fda66238ad87d128f693`
(sealed verification retry),
`425c3f4cb85c477d661d1dd2370dcaf6d76f45426e2864e9c61297f54d9f7fa0`
(read-only Review warning), and
`55e5095c0a3664381c94ff01b33f04a8a9f74ee8fc294c2c853125afd3c6f6ca`
(cleanup checklist). They are UI examples, not desktop cryptographic or field
proof; the displayed recovery code is synthetic test data.
The visual run overwrote Playwright's single `.last-run`, so the retained
filesystem independently proves the `62/62` visual run and exact Chromium
suite inventory (`172` tests in 30 files), while the original closed execution
transcript is the retained evidence that all `172/172` Chromium tests passed.

## Local macOS arm64 package proof

An unsigned macOS arm64 package built from superseded clean candidate `618f9c8b…`
after TypeScript, Vite, bundle-budget and native-rebuild gates. The packaged
`app.asar` SHA-256 is
`185d3dd8d1e01d525d9c8e8f95ef02f7afdfc355433d43dd6d3ffd73739b7ba3`;
the executable SHA-256 is
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`.
This is package qualification, not a signed or published release.
The disposable package was swept after qualification, so the two binary hashes
are producer-recorded in the closed lifecycle report; the later evidence audit
rehashed the preserved reports and visual tree, not removed transient binaries.

The packaged lifecycle CI wrapper passed with report SHA-256
`dfdfe6ec85fa5a3be5d673417c4a37cb456ac68ead40fb87a3fccd16ff86694d`.
The report binds the expected/before/after head and tree, clean worktree and
visible packaged build identity. Both launches exited under observation. It
proved v2 create plus independent verify; `4,096` Replay tracks, `202` objects
and `101` outing-filter choices on both complete Review reads; identical
pre/post-cleanup semantic digest
`87c9a81de9239b87f1d482c7e80653278d63aa78a27a436ebf5b26159e4d6620`;
preload mutation denial and audit; a real decrypt-phase `SIGKILL` after material
plaintext was observed; restart sweep from two residual entries to zero; cleanup
after a fresh check of an original archive credential, moving 5,517 rows with
zero live breadcrumb rows left; zero exact-secret matches across 57 scanned
files; and zero final plaintext residue entries. The legacy Rust backend passed
58 tests with its one intentional
keychain test ignored.

A fresh read-only audit of those preserved local, visual and kill artifacts found
no P1/P2 proof-integrity issue. It independently rehashed the copied reports,
recomputed the kill structural digest, round-tripped its closed report builder,
and checked all 49-table facts in every one of the 32 canonical phase records.

This package is prior-head evidence only.

The exact frozen candidate then built and packaged successfully as an unsigned
macOS arm64 Electron application with bundle budgets enforced. Its `app.asar`
SHA-256 is
`4ea85d02d1a776c127e8c720ba5e9ccdb0844bd01b042a0e99fcdab703ae9b0a`
and its Electron executable SHA-256 is
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`.
The exact package lifecycle report passed and has SHA-256
`566e040dfed157e6b17daaaeb4d11725aba0e99b237e1c082aa3ddf6c5df6389`.
It binds a clean/stable exact head/tree and two observed launches; v2 create and
independent verify; `4,096` Replay tracks, `202` objects and `101` outing-filter
choices before and after cleanup; identical content digest
`d5d357a0a1fe6dfda1fd8c29638418160a1ce56ff1bbb9f8b7558333e5b5fdd5`;
read-only mutation denial plus audit; a real decrypt-phase `SIGKILL`; restart
sweep from two residual entries to zero; credential-gated cleanup moving
`5,517` rows with zero live breadcrumb rows left; zero exact-secret matches in
57 scanned files; and zero terminal plaintext-residue entries.

The exact physical-process kill matrix passed all `32/32` canonical create,
verify, restore and cleanup cases, with all 32 requested `SIGKILL`s observed.
Its report SHA-256 is
`a50f0d1f3b48f591075b77ec9fc234be6ea9b52b8f4a4704d7ac0c685b0538a7`
and its closed structural digest is
`3b081d614dfecf8554f58ad94e065638841041c1600c81934594f34723e99b48`.
Repository identity stayed clean/stable and terminal residue/secret counts were
zero. Local qualification validators passed `156/156`; the legacy Rust backend
passed 58 tests with its one intentional real-keychain test ignored.

The producer's first package invocation used a 12-character build tag and was
correctly rejected by exact-head binding. It rebuilt with the workflow's full
`EXPECTED_SOURCE_SHA`; no rejected artifact is counted above. A fresh
independent read-only audit was clean: it rebuilt the kill report byte-for-byte,
proved all 32 canonical phases/49-table inventories, matched all 129 packaged
`electron/`/`shared/` sources and 58 generated `dist/` files to the checkout,
and confirmed the rejected directory was empty. Its full `.app` tree digest is
`722d20500d1b07b68cede82a164bf5d1107c21bafb957c4e812e099d6be7b876`.
This is an unsigned unpacked validation bundle, not signing/notarisation or
distribution proof. Disposable profiles/ciphertext were intentionally swept,
so their retained proof is the closed report plus source-retraced scan path,
not post-hoc access to removed plaintext.

## Exact-head Linux workflow

Workflow-dispatch run
[`33324463800`](https://github.com/donal0c/sartracker-web/actions/runs/33324463800)
was dispatched on branch `codex/breadcrumb-pr6-archive-lifecycle` with
`head_sha=60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95`, then intentionally cancelled
after the packaged-smoke P2 invalidated that head. It had reached only source
binding, dependency installation and lint; package/lifecycle proof had not run.
It is not accepted evidence. First replacement workflow-dispatch run
[`33324881333`](https://github.com/donal0c/sartracker-web/actions/runs/33324881333)
was bound to `d60059d9267d4391ffeaa158ae0adec1dad57a2a` and tree
`1e92fd45d701bbcc57a53a2d86ce5031b1879467`, then cancelled during the full
unit gate after the second smoke P2 invalidated that head; no package work had
started. Final replacement workflow-dispatch run
[`33325220201`](https://github.com/donal0c/sartracker-web/actions/runs/33325220201)
is bound to `e975ff1c64f914d582efe2aedb09d29f4df19ca2` and tree
`1b01df864dbe3299bd05279524fdb926332fc8ae`, then was intentionally
cancelled during deterministic units when the local packaged harness invalidated
that head. Package and lifecycle work had not started. It is not accepted
evidence.

Earlier-candidate workflow-dispatch run
[`33327665270`](https://github.com/donal0c/sartracker-web/actions/runs/33327665270)
was dispatched from branch `codex/breadcrumb-pr6-archive-lifecycle` at exact
head `136000ff4b4489e5ff5c57fd10e1a7bda658a2e7` and tree
`8a0b30c9fb3e2b81a72e5f76fbf60bcc69293e65`.

That prior-head run failed in its serialized unit gate with six correlated
timing/load signatures and no value or state mismatch, then was cancelled after
the visual P2 invalidated the head. It is not accepted proof. Superseded-
candidate workflow-dispatch run
[`33328312924`](https://github.com/donal0c/sartracker-web/actions/runs/33328312924)
completed green on attempt 1 in 17m38s. Downloaded source-binding SHA-256
`460925a78c166b177d0ee2b27d7e1711f9bf344fa9a1cfc28a903b9dbfd73b46`
records exact head `618f9c8b7f3c818aab25787c926b1394d2282297`, tree
`87aea9263d5634e76608cd8096a7b3996741b2ca` and `dirty=false`.

All workflow gates passed: lint; `353` files / `3,340` tests; production
web build and bundle budgets; AppImage and `.deb` packaging; clean source-tree
restore; PR5 960k Replay qualification (42 ms maximum event-loop delay and
1.95/2.16 ms live reads); x86-64 native `better-sqlite3`; Mesa llvmpipe;
tracking soak (`6/6`, `8,664/8,664`, 26.7 ms main maximum); packaged PR6
lifecycle; AppImage launch/graceful close; and both artifact uploads.

The downloaded AppImage is 152,326,996 bytes with SHA-256
`b7a2ae9340c558560a19bce37bc6b9a9e6fd92866f862022a7d521ce34bf2512`;
the `.deb` is 102,180,654 bytes with SHA-256
`71967259f959716966f8e209a88dd4f92ed740fa80019fc33c7c8be6d6063140`.
Both match the uploaded `SHA256SUMS`. The package ZIP API digest is
`sha256:f19cec4a179eb03669bb0ed77f3159be28a013bbcae7804066eed96379684113`;
the evidence ZIP digest is
`sha256:9674cf00296d149dffbb3fc7afa27670b50f0e2958f1b4b7ee1398d5288b1bfa`.
Downloaded report SHA-256 values are
`259b4f650be57fa5095538ab27fbf128782786b16ab04a797450350ff981a39a`
(960k),
`d256ac604a3499389e8a98915d901d17e69ceec158ec1c13a7b0c150b1fee25f`
(tracking) and
`c4f21d06630303897f98a3fee659fd766a09a520b04ac25a91196595dec925aa`
(packaged lifecycle).
The lifecycle report repeats v2 verification, identical pre/post-cleanup
read-only content, mutation denial/audit, real restore SIGKILL with zero restart
residue, 5,517-row cleanup to zero live breadcrumbs, zero exact-secret matches
across 66 files and zero terminal plaintext residue. The only workflow annotation
is GitHub's generic Node-action deprecation notice; no safety gate was failed,
skipped or neutralized. This is CI/package proof, not release or publication.

The sealed-verification retry P2 invalidated that head as final evidence.

Current frozen-candidate run
[`33331382152`](https://github.com/donal0c/sartracker-web/actions/runs/33331382152)
was dispatched only after the remote branch resolved to exact head
`3b148e532bd5a98b3d2fa24466fc8501a111efdd`. Attempt 1 completed green in
15m12s; downloaded source binding SHA-256
`28d9cd7af066f0caaa78cc786dc78c60ec5f3db69aa38a00fae060ba839c8bfe`
records the same head, tree `4be6f73d00de9cf9a4315c133ddfe51295c3e344`
and `dirty=false`.

Every workflow gate passed: lint; `354` files / `3,360` tests; production build
and bundle budgets; Linux packages and x86-64 native `better-sqlite3`; Mesa
llvmpipe; tracking soak; packaged archive lifecycle; AppImage visible-window
launch and graceful close; and both artifact uploads. The 765,808,640-byte
normal-envelope Replay fixture contained 960,000 positions and projected
1,012,902 total tracks; seek was 178.56 ms, a late page 127.7 ms, live reads
1.17/1.95 ms and maximum event-loop delay 75.26 ms, with restart first-page
equality. This is not the separate >2 GiB proof. Tracking stored exactly
8,664/8,664 positions with SQLite integrity `ok`, zero redundant-telemetry
slope, zero renderer crashes/heartbeat errors and a 110.842 ms main-process
maximum against the 200 ms threshold.

The packaged lifecycle repeated exact v2 create/verify, immutable read-only
Review before and after cleanup, mutation denial/audit, decrypt-phase
`SIGKILL` plus restart sweep to zero, credential-gated 5,517-row cleanup to
zero live breadcrumbs, zero secret matches in 65 files and zero final plaintext
residue. Downloaded report SHA-256 values are
`3c4621490f0e0b45c4eff3d548fccc7b1f42dee9dc6efe9acddd64c9c74ab64d`
(Replay),
`752dc081f9ac511195d96d8d34f08fdd330162c330955e59a8ed044df8fc5951`
(tracking) and
`c8feaa5125752d84a0ac9feae9b22f487d20cde8aa780431169148e33c0d1567`
(archive lifecycle).

The 152,331,453-byte AppImage SHA-256 is
`418f577f5bf9700add62271b40095666df2c79de27e063b8de9399fad17fb88c`;
the 102,165,994-byte `.deb` SHA-256 is
`aae7bced9f1a808a8b69e07024a900540326e3c3dc32c121a1dc3ea77e414cfa`.
Downloaded artifact ZIP bytes exactly match the GitHub API digests:
`sha256:2460446a057cfabb52a7592ed8a86b7061e976bef6644004b5081e631bc1a29d`
for validation evidence and
`sha256:1d2121a907d2dd6ae758f3c7fbe75b05ed002c28e128f9f6b5345844bea6e877`
for packages. GitHub's only workflow warning says v4 actions were forced from
deprecated Node 20 to Node 24; no gate failed, skipped or neutralized. This is
exact-candidate CI/package evidence, not release or publication.

A fresh independent artifact audit returned no substantiated P1/P2. It
independently downloaded both ZIPs and matched their GitHub-recorded digests,
confirmed the package source binding and full candidate build tag, identified
the bundled `better_sqlite3.node` as Linux x86-64 ELF, revalidated the lifecycle
report and recomputed the tracking verdict from raw fields. Embedded executable,
`app.asar` and `better_sqlite3.node` SHA-256 values are respectively
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`,
`dc7bf0a0f828c3265bdde6b632143303cfb33fbad73ec100669288f7466ae6a4`
and `c6dd5b3806e9fdc0e48e5ac18e0f7fac1db4b265f6a010afd275983efac159cd`.
The audit classified the forced action-runtime Node 24 annotation as advisory
and proof-neutral: application commands still ran under Node 22.23.2. Visible
AppImage execution remains workflow/screenshot evidence; it was not rerun on
the auditing Mac.

## Ubuntu greater-than-2 GiB reference-host proof

The runner rejected the 3.704 GB `field-v2` source because it had a non-empty
SQLite `-shm` sidecar. That is a correct closed-fixture failure, not a proof
failure or a reason to weaken the gate. The isolated run instead uses the
synthetic closed `mission-14d-v2` fixture: `3,514,122,240` bytes, source
SHA-256 `1d4890aa…22d00`, regular file with link count one and no sidecars. The
source is schema v4, so it is not passed proof input by itself. The exact-head
run first derives and closes a schema-v12 copy under the exact PR5 base, proves
that derived fixture's integrity and absence of sidecars, and only then gives a
second disposable copy to the PR6 qualifier. Host RAM, disk and load must be
reconfirmed immediately before the expensive proof; older availability figures
are not passed proof.

The prior-head run on `60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95`
failed safely before archive creation after the qualifier's fixed 30-minute
total maintenance deadline expired. Schema-v13 background reconstruction was
still making progress over the fixture's 9,717,159 captured legacy mission
events; the source fixture remained byte- and inode-identical, no JSON proof
was written and the disposable profile was swept. This is not passed scale
proof. It exposed a harness-only defect: a fixed total wall clock is wrong for
finite, durable forward progress, and the migration heartbeat interval was not
owned by failure cleanup. Red-first remediation replaces it with a fixed
lack-of-durable-cursor-progress watchdog while preserving immediate failure
markers and every 200 ms/RSS/completeness gate, and makes monitor shutdown
idempotent and failure-owned. Central retrace then found and fixed the separate
product C5 synchronous-scan defect described above. Frozen-candidate scale
qualification remains required. A later base/docs-only final descendant may
carry that proof only with explicit blob-by-blob PR6 implementation/harness
equivalence and proportionate final-head rechecks; any such input change
requires a rerun.

The first production attempt from exact implementation candidate `3b148e532…`
failed closed before archive creation or evidence write. The qualifier's real
maintenance reader correctly derived `archiveProgress.pending`, but its settled
predicate referenced an undeclared `legacyArchivePending`, causing a
`ReferenceError`. The input fixture, original source, repository and SQLite
sidecar/inode state stayed unchanged. A real settled schema-v13 SQLite
execution regression reproduced the exact failure red-first; the one-line fix
uses `archiveProgress.pending === 0`. Qualification script/library tests passed
`68/68`, with targeted ESLint, TypeScript and diff checks green, before commit
and push at exact qualification head
`53164028f72254c4e17fcc0b4b845f7601fee153`. A fresh independent focused review
of that exact head found no P1/P2 and confirmed the real reader path, exact
value use and unchanged fail-closed bounds. A fresh preflight on that clean
pushed head revalidated repository identity, source/derived/qualifier hashes,
distinct inodes, absent sidecars, available RAM/disk and host load before the
unchanged production command was relaunched. The failed attempt is not proof.

The subsequent exact `646ce768…` attempt completed the 4.16 GB copy, produced a
`5,243,848,930`-byte streamed archive and entered independent verification, but
the qualification-only durable-ingest worker exhausted its finite SQLite-busy
retry while lifecycle cleanup was active. It failed closed with
`SQLITE_BUSY`; no qualification JSON was emitted and the disposable profile was
swept. Its bounded receipt recorded `121,865` queued writes, `121,808`
acknowledged, `57` rejected, `62` busy retries, and a maximum durable latency of
`18,199.53 ms`; archive verification had completed and cleanup teardown was
incomplete. The receipt is diagnostic evidence, not qualification proof. The
new red-first regression holds a writer lock for six seconds and proves that a
cleanup boundary retries safely; the implementation now uses deferred
read-then-write pages, finite `SQLITE_BUSY*` boundary retries and 500-position
pages. The focused bundle is green on `66130569…`; the controlled >2 GiB rerun
is still pending.

## Candidate proof wave (2026-09-02)

This historical code head was `661305694d43682a6e4aa0e0fafeeb962affc7ea` / tree
`0854dfd72b0b1c04c3e6fda0827ca9761060c6f5`. It includes the qualification-only
durable-ingest worker, worker-exit safe shutdown, crypto buffer cleanup, the
correction-predecessor reconciliation/pinning/single-flight fixes, the
red-first liveness-lane remediation, and the cleanup/live-ingest contention
fix. The qualifier measures a pure
main-event-loop heartbeat and in-memory current-position publication separately
from worker-thread durable ingest, records durable latency/contention, verifies
the latest-position projection after settlement, and enforces a bounded
120-second durable settlement deadline. The 200 ms heartbeat/current gates,
full-sync pragmas, zero-loss requirements and current-position priority are
unchanged. The local archive/lifecycle/qualification regression bundle is
`71/71`; the exact local serial deterministic gate is `359/3,431` tests.
ESLint, TypeScript, Node syntax and `git diff --check` were green. This wave is
superseded and supplies no current-candidate proof.

The prior local browser and visual gates are bound to 3885, not this candidate:
Chromium `172/172`, visual Playwright `62/62`, and uncached visual review
`74 pass / 0 fail / 0 error` (report SHA-256
`9ef14c76e60dd68c626d2a9d5ed8785c1927503434868889367de092371e8581`). They
are historical prior-head evidence and cannot be carried forward through this
recovery; exact-candidate reruns are required. They are not production or field
proof.

The exact-head unsigned macOS arm64 package/lifecycle smoke was rerun from a
clean 3885 checkout. It passed source clean before/after, full packaged
build-head binding, Archive Review/Replay, interrupted-restore startup sweep,
credential-gated cleanup and zero plaintext or secret residue. The report binds
head `3885e6f24159a4aef18fad3f1172bea76db26c03` / tree
`85c773fba7751c836d5565474260cc529eb8b9d4`; its SHA-256 is
`5a9d22a5c4d20b05efe1fc61f3df2bfa5f358d484bf1d1ba2dd7c8e5464b0200`.
The smoke seeded `4,096` tracks, `202` replay objects and `101` outing choices,
verified both pre/post-cleanup Replay parity, denied a mutation with durable
audit, swept a decrypt-phase SIGKILL restore residual on restart, and ended
with zero exact-secret matches and zero plaintext residue. This is unsigned
package proof, not release or publication.

The real 32-case physical SIGKILL matrix also passed on the clean 3885 checkout:
verdict `qualified`, all `32` cases, protocol self-test `false`, source clean
and stable at the same head/tree. Report SHA-256 is
`f9698e24c194fc1637e79072237e0b6ca3182129c194f0df21a8119a82bae460`.

The prior GitHub Electron Linux workflow run
[`33509882673`](https://github.com/donal0c/sartracker-web/actions/runs/33509882673)
passed every gate against the preceding a913 code head: `359/3,416` deterministic
tests, production build/budgets, Linux packages/native SQLite, 960k Replay,
Mesa llvmpipe attestation, tracking soak, packaged archive lifecycle and
AppImage launch/close. The source binding records head
`a9134e3b3643060caacd357f3ef8405040bb989f`, tree
`931181203ea1b41c4330b7b9a0317c67ee7eaa1a` and `dirty=false`; its SHA-256 is
`4b0aa72d32f81f509da35e4af43d1d3fa26e7967cde1dd9f24f01bd96acbf792`.
Downloaded exact reports are `bcp-960k.json` SHA-256
`c5c541ad9a7e6b0e236a7c00a5746d92c8f2841db5b2b998c8166297cc7b6129`, tracking
soak SHA-256 `e3d0f3e9cc75a71bf84ba935564b0cf1cf51ed75002316a5531e437bd04af1b3`,
packaged lifecycle SHA-256
`750576337c5ebd8b80201aba91cd3fd04261a3d7d0d5dce48f7a36cd5a8e3270`, and
`SHA256SUMS` SHA-256
`b0b0568d7a33c1b3c04ddd228a9978d5b654de48341128f0e735160db6a426d0`.
The normal-envelope fixture contained 960,000 positions; replay seek was
`232.54 ms`, late-page seek `159.78 ms`, and the packaged tracking soak stored
exactly `8,664/8,664` positions with SQLite integrity `ok`. The AppImage is
`153,090,019` bytes (`2ef57f20129894762ca4a2a2d377e941b11a4cfc9b3dbb81dbd19c9c8e33517d`)
and the `.deb` is `102,919,648` bytes
(`ecc09db98a6496cc330460a72a76cb1ff037c65738f66eb6366d8e3c1143e55e`). The
packaged lifecycle independently verified `4,096` tracks, `202` objects,
`101` outing choices, credential-gated cleanup of `5,517` rows to zero live
breadcrumbs, zero secret matches across 65 files and zero terminal plaintext
residue. This is historical prior-head CI/package proof, not current-candidate,
release, or publication proof.

The superseded code-head GitHub Electron Linux workflow
[`33552060716`](https://github.com/donal0c/sartracker-web/actions/runs/33552060716)
also passed every step against `3885e6f24159a4aef18fad3f1172bea76db26c03` /
tree `85c773fba7751c836d5565474260cc529eb8b9d4`, with clean source binding.
The normal-envelope Replay fixture contained `960,000` positions; its total
track count was `1,012,851`, first-page seek `207.34 ms`, late-page seek
`166.95 ms`, and the 200 ms event-loop gate passed at `59.47 ms`. The packaged
tracking soak stored exactly `8,664/8,664` positions with SQLite integrity
`ok`; the packaged archive lifecycle independently verified `4,096` tracks,
`202` objects, `101` outing choices, cleanup of `5,517` rows, decrypt-phase
SIGKILL restart sweep and zero terminal plaintext residue. The exact downloaded
report hashes are source binding `7e08367ff2e5186220ae2c3daef9248efce21f9d4b94aa457ef2c0292e4a7113`,
`SHA256SUMS` `8058c1df75ddd96bc73545729bef23ce71e830f02cb5747e2acfea648172d8f7`,
normal-envelope `66bb5905ea1ef81fc85771ad695107cda7342157bdf615aca4408d32b2cf2ee5`,
tracking soak `bac7067dd8aff03d668ac18e49fb97acdf7fe4e6a11bdb9f81f212fda78f7c0a`,
and packaged lifecycle `a64281ce06e0255a3976543ed3ffda13a5af24b1d59340762a4a9f22de458229`.
This is historical prior-head CI/package evidence. The recovery changes its
inputs, so the final candidate requires a fresh exact-head workflow run.

### 2026-09-04 rejected caf9 run and recovery proof contract

The exact `caf9e5e…` reference-host attempt is a failed diagnostic. It created
and independently verified a `5,243,848,931`-byte encrypted archive, but its
bounded failure receipt ended `UNCLASSIFIED_INTERNAL_FAILURE` at
`teardown:incomplete`. The disposable profile was removed. The apparent
teardown failure came from spreading roughly 200,000 samples into `Math.max`,
but removing that harness defect cannot turn the run into a pass: create,
restore, cleanup, and durable-write measurements separately exceeded the
strict 200 ms gate. The written recovery hypothesis attributes those stalls to
roughly 9.7 million retained telemetry audit rows and repeated finalization /
acknowledgement history scans. Only one new controlled field run is permitted
after the cheap prerequisites; the caf9 receipt is never qualification proof.

The replacement liveness contract uses a loopback synthetic Traccar server that
emits unique source-position IDs with canonical timestamps. The packaged Linux
Electron path carries each fix through Traccar HTTP, the main/preload boundary,
React tracking state, and the real MapLibre tracking source. A watchdog outside
the app correlates the exact IDs and timestamps and checks phase/operation start
to first fix, consecutive fixes, operation and phase tails, request-to-renderer,
source-to-renderer, main-inspector, and renderer-frame gaps across create,
verify, restore, and cleanup. Every value must be strictly less than 200 ms;
`200` fails. The 50 ms poll is time-compressed validation, not production
cadence. Source and renderer ledgers are bounded, and any overflow fails closed.

The pending raw packaged-report SHA-256 and canonical-evidence SHA-256 must be
recorded distinctly, pinned, and bound to exact source head/tree and packaged
build. The separate greater-than-2-GiB qualifier measures Node/SQLite scale
contention; it must not be described as packaged renderer proof. Both exact-head
receipts are required as complementary evidence. Even if they pass, they do not
prove live Traccar, the original field machine, production, or a packaged
renderer running the multi-GiB workload itself.

### 2026-09-05 rejected 20486 run and finite-boundary successor

Exact pushed head `20486b6ceaf86060a64892f43c07cd303e2a8548` / tree
`131da068cc3ec973c1e8ce20edc59a606ca60f71` is rejected and must not be
rerun. Its one packaged lifecycle passed in `11,471 ms` with two clean
launches/exits, `5,516` rows removed, zero plaintext or secret residue, and
every liveness maximum strictly below `200 ms`; the report SHA-256 is
`359b79196c398a7ba5fc2b5ab77b1c03dc2d1ec786c74a50a42c2c691bdf449d`.
Chromium `173/173`, visual Playwright `62/62`, uncached visual review `74/74`,
and the physical `SIGKILL` matrix `32/32` also passed. Those are prior-head
proof only. Final review found correction-consumer and combined custody /
plaintext-cleanup races, so Linux run `33954733857` was cancelled before field
qualification.

The first repaired successor was frozen as tree
`840947d5fcacb66c64597f85f6a434753de621a9`, then rejected before packaging.
Fresh audit reproduced two further blockers: correction rollback could be
redirected outside the attachment root by rebinding an ordinary directory
pathname between validation and deletion, and a second lifecycle invocation
could replace the first run's successful evidence after child staging was
released but before the first supervisor returned. That tree will not be rerun.

The successor prepared after that rejection removes both vulnerable structures. Correction
attachment mutation now runs only in an Electron `utilityProcess` whose cwd is
bound to the database directory and authenticated by an exact READY dev/inode
handshake. The utility descends one validated path component at a time, records
one bounded custody plan in SQLite before writing bytes, and creates a
recognisable operation-owned public name plus its exact private hardlink peer.
Both names must be regular mode-0600 files on one lossless bigint inode with
exactly two links. Unlock and plan removal commit in one SQLite transaction;
startup reconciliation validates committed or uncommitted state without any
filesystem delete, rename, or rollback.

Two independent pre-freeze audits then reproduced four additional deterministic
integration defects. `SharedArrayBuffer` could not be cloned across Electron's
UtilityProcess boundary; post-terminal and post-error shutdown could strand a
live helper; a nominal or fallback result was not bound through IPC to the exact
correction operation; and both startup and failed-correction reconciliation
hashed up to 4,096 attachments while holding SQLite's immediate writer lock.
All four were repaired red-first. The protocols now use cloneable message
cancellation plus bounded termination and join physical exit. Completion carries
the exact operation identity, the store verifies the matching durable unlock
event on every outcome, and wrong-operation or residual custody state is
persistently fenced across restart. Reconciliation now computes full digest
proofs before the writer transaction, then re-reads the exact plan, mission and
unlock state and revalidates unchanged file identities/topology before clearing
custody in the short transaction.

The corrected focused slice passes `8` files / `102` tests. Independent
integration and custody/protocol audits are clean at `8` files / `137` tests and
`7` files / `99` tests respectively, including real utility children, durable
failure fences, exact-operation attribution, plan drift, ABA hardlink replacement
and worker-exit ownership. At the maximum 4,096-entry bound, committed-pair
transactions held the writer for `67.6-79.2 ms`; a valid 4,186,365-byte
uncommitted plan held it for `81.2-93.6 ms`. Concurrent WAL writers succeeded in
all measured runs within `59.9-94.7 ms`. The corrected changed-test matrix passes
`20` files / `628` tests. Its initial run caught one obsolete test-only store
harness that omitted the required UtilityProcess injection; the exact real
correction flow was red at the 120-second teardown timeout, received only the
test IPC adapter, then passed in `2.34 s`. Production retains no child-process
fallback. These remain pre-freeze source results, not packaged proof.

Lifecycle supervision now separates the short-lived preparation gate, durable
active lease, private child staging, and canonical terminal evidence. The child
uses a parent-prepared mode-0700 directory without replacing its pinned inode.
Only the exact immutable active lease owner may read, publish, conceal, clean,
or consume terminal evidence. Success remains hidden through child cleanup,
then is exposed, read back, and bound to a durable consumed record before the
supervisor returns. Same-head reuse remains forbidden; a dead consumed lease
may be reclaimed only for a different head after its prior terminal is proved.
All wrapper exit paths, including an already-observed exit, now prove the POSIX
process group empty or perform bounded residual-group termination and reap;
unproved settlement retains staging and fails closed. The lifecycle slice
passes `3` files / `259` tests and an independent P1/P2 re-audit is clean.

The first fully reviewed successor was frozen as tree
`91f8f3edb2efc1e367f8d00ab94cbe52453860e3`. The three-model council,
renderer/operator review, and an independent persistence review of a separate
`git archive` extraction found no deterministic P1/P2. Its first full non-
browser source cycle nevertheless rejected the tree before lint, build,
backend, commit, or package: `2` of `3,960` tests failed because two workspace
tests used a fixed 50 ms sleep across `React.lazy` cleanup and verification
dialog imports. Under full-suite transform contention neither dialog had
mounted, so the product paths were not invoked. The harness now waits for each
exact split module inside React `act`, matching the repository's established
Suspense pattern. The focused file passes `14/14` without warnings. This is a
test-synchronization repair only. Its test-only successor then required bounded
delta review and a full source cycle; `91f8f3ed` will not be rerun unchanged.

That replacement was frozen as tree `969bf644bba64256c40ab323e68c0189764db874`
after two clean delta reviews, then its first full source cycle was also rejected
before lint, build, backend, commit, or package. This time `3,959/3,960` tests
passed; Vitest reported the unchanged 25,000-row tracking acknowledgement test
at `6,815 ms` after it hit the generic 5-second timeout under parallel-suite
contention. Its persistence path and test blob were
unchanged from `20486b6c`, and the exact focused case passed in `1,695 ms` before
the repair and `1,643 ms` after it. The test asserts compact acknowledgement,
durable count, conflict, and checkpoint semantics—not latency. The replacement
therefore retains all 25,000 rows and assertions and adds only the same test-local
15-second harness ceiling used by other large-data tests. Packaged liveness keeps
its separate strict `<200 ms` gates unchanged; `969bf644` is not rerun unchanged.

The resulting behavioral tree was frozen as
`d5727b82ff2febaba6b77cbd3d52f2592c4f7d7a`. Two bounded independent delta
reviews were clean. Its one full non-browser source cycle passed `380/380` unit
files and `3,960/3,960` tests in `84.33 s`, full ESLint, production build and
bundle budgets, changed-script Node syntax, `git diff --check`, and the legacy
backend at `58` passed / `1` ignored. Any final status-only descendant must keep
every non-documentation blob identical to this reviewed and tested tree. This is
local source evidence only, not exact-head package or platform qualification.

Earlier finite-boundary repairs remain: authenticated post-commit correction
evidence, exact cleanup cursor continuity, cross-archive custody, bounded
no-progress cancellation, and qualification terminal ownership. None of these
changes alters the strict `<200 ms` liveness gate. No package, packaged
lifecycle, browser/visual, physical-kill, Linux, or Ubuntu gate has run for the
current successor. A read-only probe previously confirmed the recorded Ubuntu
host was reachable as `Linux 7.0.0-28-generic x86_64`; the qualifier remains
deliberately deferred.

### 2026-09-07 approved bounded closeout order

Donal approved the following finite order for this recovery. It does not lower
the life-safety bar or the strict `<200 ms` liveness gate:

1. repair only the confirmed blockers red-first and pass their focused gates;
2. finish the evidence, handoff, workplan, and operator-manual wording;
3. normalize the tracked generated-version file to the current pre-commit HEAD,
   freeze one candidate content tree and intended-file manifest, and defer non-
   safety P3 work;
4. complete the missing renderer/operator charter plus fresh broad and affected
   persistence and concurrency/liveness reviews against that frozen tree;
5. verify that the tree is unchanged, then run exactly one full local source
   cycle: deterministic unit/integration tests, full ESLint, production build,
   backend tests, affected Node syntax, and `git diff --check`—not `test:all`,
   because browser work is downstream;
6. verify the intended files and unchanged remote PR branch, commit and push an
   explicit fast-forward, then prove the committed and pushed tree is exactly
   the frozen reviewed tree;
7. build one validation package with `EXPECTED_SOURCE_SHA` set to the new final
   commit, bind executable and ASAR hashes to that exact head/tree, then restore
   the tracked generated-version file to its committed blob without rebuilding
   and verify the source tree is clean before running the sole packaged
   lifecycle attempt and validating exactly one terminal success or failure
   artifact; and
8. stop and report before any remaining browser/visual, physical-kill, Linux CI,
   or final Ubuntu greater-than-2-GiB qualification.

A failed lifecycle rejects that exact head and returns to causal diagnosis; it
is never rerun unchanged. Passing the stop point means only that the candidate
may proceed to the deliberately deferred gates. It is not shippable, mergeable,
released, field-qualified, or production-proven at that point.

## Independent review gate

All code, tests, generated version content, documentation, and proof claims
freeze first on one immutable candidate tree plus intended-file manifest. Final
reviews bind to that tree, and no content edit is allowed while they run. The
later commit is admissible only when its Git tree exactly equals the reviewed
candidate tree; commit metadata and the push may change the commit identity but
not its content identity. Any tree change invalidates the affected review and
gate evidence. The pushed SHA/tree, four verdicts, central source retrace and
any remediation/rechecks must then be recorded externally in the
[PR #10 exact-head ledger](https://github.com/donal0c/sartracker-web/pull/10)
and the three Linear issues so the record itself does not create a new source
head. PR #10 must remain draft until every required row is clean.

| Independent charter | Required immutable verdict record |
| --- | --- |
| Broad life-safety / end-to-end | PR #10 exact-head ledger and Linear |
| Persistence / completeness | PR #10 exact-head ledger and Linear |
| Concurrency / finalization / liveness | PR #10 exact-head ledger and Linear |
| Renderer / input containment / operator surface | PR #10 exact-head ledger and Linear |

Remediation rechecks are conditional follow-up evidence, not a fifth charter.
If a final-head finding is accepted, its fresh broad and affected focused
rechecks must also be recorded in the PR #10 and Linear ledger before closeout.

No task agent self-approves. Every finding is centrally source-retraced. P1/P2
blocks completion. Tests or CI cannot overrule a confirmed finding.

The sustained-contention remediation received a focused independent persistence
audit on exact code head `a9134e3b…` / tree `93118120…`: CLEAN, with no P1/P2/P3.
The auditor confirmed worker-local retry isolation, transaction rollback before
retry, main-thread publication ordering and exact durable-write draining. This
is remediation evidence only; the full four-charter ledger is still required
on the final documentation head.

## Evidence tiers and deferred work

- Deterministic unit/integration proof covers controlled code paths and attacks.
- Browser/visual proof covers the synthetic operator surface, not desktop
  persistence or real cryptographic custody.
- Packaged proof covers the built Electron bundle on the named host/platform.
- Reference-host proof covers one synthetic >2 GiB workload on one Ubuntu
  machine, not all hardware or production incidents.
- GitHub Linux workflow covers its exact CI runner/artifacts, not publication.
- Physical SQLite compaction is not part of PR #10. Logical cleanup may leave
  the file size unchanged while SQLite reuses freed pages. Safe oversized-store
  recovery, physical compaction, standing retention, and measured index work
  remain explicitly deferred to `DON-250` / `DON-251`; no in-process multi-GB
  `VACUUM` is authorized.

BCP-17/final release qualification, live Traccar, the original field machine,
multi-machine custody, the team tabletop, installer fleet coverage, release,
publication and field acceptance remain outside PR6. `DON-249`, `DON-250`,
`DON-251` and `DON-254` remain separate. No tag, release, merge, publication or
SAR-team contact occurred in this task.
