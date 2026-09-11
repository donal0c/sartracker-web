# Responsiveness causal repair — DON-254

2026-09-11, base `49b2e1d416ca2fa4ff98cfae31c4d947bc4b0a6e`, branch
`codex/responsiveness-causal-repair`. Dedicated repair; no merge, release,
deployment or field acceptance. [Raw bounded evidence](../../evidence/responsiveness-causal-repair/).

## Finding and decision

Three measured application defects justify narrow repairs with the existing
strict `<200 ms` assertions unchanged. There is no evidence for a threshold
amendment. Their causal controls do not retrospectively explain every historical
source, inspector, renderer or current-fix failure.

1. The GPX worker did not receive the existing foreground writer counter. Its
   five-millisecond yield between 25-point transactions could end while an
   admitted current write slept in the responsive writer's 25-millisecond busy
   retry. The background transaction could therefore overtake that write.
   The native SQLite control releases a lock after admitting foreground work
   and observes GPX staging at the actual foreground commit. Before repair it
   finds a staged import; after repair it finds none. A second normal-runner,
   real-worker control fails when the real priority helper is bypassed and
   passes with the helper restored; cancellation joins the waiting worker.
2. Scheduled archive backfill and reconciliation bookkeeping used the main
   SQLite connection's default 5,000 ms busy timeout outside the responsive
   writer. A separate worker holds a real write lock for 350 ms. On the old path
   the measured main-loop gap is **355.498 ms with 3.988 ms process CPU**. The
   repaired path retries asynchronously: the same complete/shutdown controls
   measure **11.497/11.385 ms** locally and **28.689/11.232 ms** on Ubuntu.
   Durable marker deletion and the backfill cursor prove the work ran; shutdown
   joins the admitted operation. Low CPU therefore cannot be used to dismiss
   these stalls as scheduler noise.
3. Tracking-history bulk persistence compiled the same legacy candidate query
   and repeatedly updated device liveness for each position. A 1,800-position call correlates with a
   286.736 ms main timer gap; an independent boundary run proves one outer
   transaction takes 217.240 ms. Reusing the compiled query in a controlled
   runtime intervention brings main maxima to 191.011/143.447 ms, with all
   8,664 positions intact. Production now prepares the query lazily once per
   bulk invocation and still executes it with fresh parameters for each row.
   The deterministic compilation-budget regression fails at 1,800 compilations
   before repair and passes at one afterward. The fresh-lookup regression
   verifies that an earlier adoption changes the next row's candidate result.
   Query reuse alone was insufficient: its actual Linux package is retained as
   a **206.463 ms rejection**. Adding transaction-local device observation
   coalescing reduces the native 1,800-row update budget from 1,800 to one.
   The actual combined package passes the unchanged independent observer at
   **154.394/136.716 ms**, with all 8,664 positions exact. Final enforced-harness
   and CI qualification remain pending; this is reference-host evidence.

GPX receives the shared counter and waits outside its write transactions.
Archive backfill, custody observation application and reconciliation metadata
writes use the existing responsive writer. Final identity checks remain inside
the transaction after queue admission. A regression changes archive identity
while the observation is queued and requires rejection without applying it.

## Invariants and limits

No schema, coordinate, retention, publication, audit or team-domain change.
The original GPX bytes, exact points and final receipt/revision publication stay
atomic and subject to the existing identity, retirement and mission-state
fences. Current writes retain ordered admission, zero SQLite busy timeout per
attempt and the existing retry budget. Shutdown still terminates and joins
background workers before closing the store.

Priority is cooperative: it cannot preempt a transaction already admitted.
Continuous foreground work can delay import until its existing timeout and
recovery path. This patch does not move every SQLite/fsync operation off the
main thread. GPX receipt recovery and direct legacy-registry preparation paths
remain distinct inspection surfaces. Do not claim universal stall elimination.
The controlled 350 ms lock test requires heartbeat responsiveness; it does not
promise a write can finish within 200 ms while another owner holds that lock.

## Measurement and escape analysis

The former source gate awaited `store.addPosition()` 500 times. That duration
contains queue admission, asynchronous retry and commit, not just synchronous
main-thread work. `process.cpuUsage()` includes worker threads. The heartbeat
was printed but not asserted, and the write loop ended well before the GPX
publication tail. The new test retains the first 500-write burst, then probes
at 50 Hz through settlement plus one write started after settlement. It asserts
both write latency and heartbeat strictly below 200 ms, exactly 50,000 GPX
points, every acknowledged current position, and a completed batch with zero
failed files. An initial unbounded burst through the entire import starved the
background worker; its timeout was retained rather than hidden by a repeat.
The expanded fixture takes 34.2 seconds on Ubuntu, so its integration deadline
is 60 seconds instead of 30. Neither performance limit changed.

Old tests proved chunk yields without proving admission order, did not force a
native lock across startup bookkeeping, and did not measure the import tail.
The new deterministic controls cover those escapes. Last-known-good and first
bad performance builds are not established; the confirmed affected baseline is
the master SHA above. This is engineering/CI evidence,
not a new SAR team report or an accepted replacement release.

Source-history inspection narrows provenance without inventing historical
performance proof:

- `60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95` (2026-08-30) introduced the
  scheduled archive backfill path with direct main-connection writes.
- `044a73887eef791b18c30df0838b7f1bd021fc56` (2026-08-27) introduced the GPX
  cooperative delay and 25-point slices. It was a responsiveness improvement,
  not evidence that this commit introduced a new performance regression.
- `d392181b3958c21948e926a6785358be91da1926` (2026-09-07) introduced responsive
  live writes with zero SQLite busy timeout and 25 ms asynchronous retry.
- `25bcd3326ecccc7a6a23358b1ea52ea7a4f95807` (2026-09-09) introduced the shared
  foreground counter and wired it to archive cleanup. GPX did not receive it.

These identify the relevant code introductions and incomplete integration.
They do not identify the introducing commit for any particular CI outlier.

## Comparable runs

Runs are synthetic and were serial within each host unless explicitly rejected
below. Local host is macOS arm64/Node22.22.3; isolated reference is Ubuntu24.04
x64/Node22.22.2 on the Precision5570. Workload is the same 50k source file;
500-write and full-tail measurements are different coverage and kept separate.

| Probe | Writes | Largest awaited write ms | Heartbeat gap ms |
| --- | ---: | ---: | ---: |
| Baseline local, original gate, observer off | 500 | 55.013 | 25.147 |
| Baseline local, CPU profile + SQL boundaries | 500 | 78.023 | 13.200 |
| Baseline local, SQL boundaries only | 500 | 51.254 | 13.874 |
| Baseline local, observer off again | 500 | 28.738 | 17.858 |
| Baseline Ubuntu, isolated CPU profile + SQL boundaries | 500 | 173.269 | 37.547 |
| Baseline Ubuntu, isolated SQL boundaries | 500 | 64.563 | 33.509 |
| Baseline Ubuntu, isolated observer off | 500 | 63.254 | 32.379 |
| GPX-priority repair Ubuntu, original gate, observer off | 500 | 57.264 | 39.326 |
| Both repairs Ubuntu, original gate, CPU profile + SQL boundaries | 500 | 57.157 | 38.203 |
| Both repairs local, expanded full-tail gate | 1,066 | 34.755 | 20.181 |
| Both repairs Ubuntu, expanded full-tail gate | 1,165 | 50.430 | 45.902 |

The optional diagnostic preload wraps transaction/statement boundaries and
collects bounded CPU/resource snapshots plus a main/worker CPU profile. It is
not shipped runtime instrumentation. Its process/resource probes measurably
perturb timing. `better-sqlite3`'s internal BEGIN/COMMIT bypass public statement
wrappers; outer transaction time includes them but does not isolate commit or
fsync. Baseline local main immediate attempts peaked at 2.424 ms (31 busy
attempts); the 78.023 ms awaited maximum cannot be called 78 ms synchronous work.
Ubuntu's isolated baseline main attempt maximum was 27.915 ms versus 173.269 ms
awaited. Initial Ubuntu baseline/profile runs overlapped other work and are
explicitly excluded from comparisons, including their 275.784 ms rejection.

## Historical rejection disposition

- PR20 head `845e1108`, CI `34578759014`: awaited current write 205.296 ms,
  process CPU 1.048 ms, heartbeat 213.938 ms. The exact historical cause remains
  unassigned. Low CPU is consistent with blocking I/O as well as descheduling.
- PR19 head `769669ba`, CI `34515489481`: main inspector RTT 544 ms,
  renderer 416 ms and missed Devices click; archive was downstream skipped.
  GPX product fixes and this causal repair have different scope.
- PR21 executable `693b1c30`, CI `34532256680`: source/soak pass but archive
  current continuity 205 ms fails; earlier independent main timer gaps
  512/345 ms and later 596/329 ms are not disproved by small inspector RTT.
  Diagnostic work remains useful; it does not qualify a release.

Reusing an investigation or merging a separate product fix cannot waive these
records. New CI must pass its unchanged gates and any new failure needs its own
attribution. DON-254 remains the qualification owner and open.

After an authorized integration of this repair, PR20's investigation remains
useful and must be evaluated on its actual updated executable base. PR19 still
needs its separate GPX product repairs and conflict resolution; an integration
must preserve this worker-counter transport and publication fence, then run its
affected regressions. PR21's diagnostics remain separate evidence and are not
superseded by a small inspector RTT. This task does not modify those PRs or
claim their current failing/conflicted heads have become green.

## Verification state

Focused native/runner suites: 45 tests pass. Archive registry: 23 tests pass,
including queued identity rejection. Expanded local/Ubuntu and startup
complete/shutdown proof is above. Three independent pre-commit source reviews
(measurement, custody, lifecycle) are scoped clear; no reviewer ran tests.
The full stable serial source command passed all 429 files / 4,384 tests in
486.87 seconds; the retained log and Vitest file cache agree. The full-tail gate in that cycle
measured 1,056 writes, 32.062 ms maximum write and 15.783 ms heartbeat; startup
complete/shutdown measured 11.393/11.453 ms. Lint and production build/bundle
budgets pass. All eight existing Chromium GPX/archive operator flows pass.
The browser harness proves rendered behaviour, not native lock handling.
Packaged macOS validation passes on clean source commit
`7637e93606b5da1e9c5a38a1699e0f282bce7f6b`, tree
`40fc7c6dce6a899190921481ec3076eb7fd2bb7e`. Archive receipt independently
validates: two launches/two exits, 5,516 archived rows, zero remaining breadcrumb
rows and zero plaintext residue. Maximum current-fix gap is 119 ms; archive
main watchdog maximum is 61.435 ms and frame maximum 17.4 ms. Tracking CI-profile
soak passes all 8,664 positions and both graceful exits: main inspector RTT
15.351 ms, renderer 66.7 ms, external action 41.290 ms. The paired-interaction
duration includes deliberate target stability waits; it is not action latency.
The final tracking screenshot was inspected: rendered map, mission/status and
tracking controls are present; this is no new layout qualification.

Package executable SHA-256 is
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
application ASAR SHA-256 is
`b387f303f39a871b315af67d3e49f96b282b8669d111148476e2d6e310b5c6a7`.
Receipts are `macos-archive.json` and `macos-tracking.json` in the evidence
directory. A subsequent documentation-only commit reuses this exact executable
proof; it does not claim a freshly rebuilt artifact.

Linux CI [34585453685](https://github.com/donal0c/sartracker-web/actions/runs/34585453685)
passed at `6a88a65ed3765b06870da90084eb9162ac0890b7`, tree
`b22f21afb80ec1494b717e12368b55c25026cf39`: all 429 source files / 4,384 tests,
lint/build, Linux package inspection, 960k replay, tracking soak, archive
lifecycle and AppImage launch/graceful close. The full-tail source gate measured
1,044 writes, maximum 29.908 ms and heartbeat 27.436 ms; startup complete/shutdown
heartbeats were 11.439/10.361 ms. Archive evidence independently validates:
current maxima 123/112/185/172 ms across create/verify/restore/cleanup, independent
main watchdog maximum 70.859 ms, frame maximum 104.5 ms, 5,516 moved rows, zero
remaining breadcrumb rows, two launches/exits and no plaintext residue.
The AppImage launch screenshot shows the idle mission shell and rendered map.

Tracking retains exactly 8,664 positions, matching expected truth digests,
SQLite integrity `ok`, and both graceful exits. Inspector RTT is 72.556 ms;
renderer maximum is 449.99 ms and external action maximum is 228.444 ms.
These channels must not be conflated: programme policy fixes Electron main
response below 200 ms; the existing tracking renderer/action freeze verdict is
1,000 ms and its 250 ms counts are telemetry. No gate was relaxed here.

The external maximum is launch 2's `final-load` Devices-open action. Its trusted
click is at renderer clock 250440.2 ms; click-to-visible-state is 45.4 ms, external
delivery 48.898 ms and external state observation 179.546 ms. Nearby successful
mission-store IPC is 1.6 ms. All eight clicks were delivered and their states
verified. This is not evidence of a 228 ms main-process stall.
The renderer maximum has only aggregate evidence (3,949 samples, 11 at least
250 ms; launch counts 184/3,767). No frame timestamp or per-launch maximum was
retained, so it cannot be assigned to that action, startup bookkeeping or a
backup. The window covers tracking, restart/recovery, Devices interactions,
backups and support export; it performs no GPX import or archive lifecycle.
Runtime tracking batches peak at 100 ms and backup totals at 346 ms, but these
also lack correlation timestamps and backup elapsed time is not synchronous
main CPU. `rendererThrottledByDesktopSession:false` is a heuristic outcome,
not a diagnosis. The renderer excursion is neither a proven regression nor
proven harmless throttling; no product correction is justified by it alone.

The CI tracking receipt has no independent main-loop timer, so a small inspector
RTT cannot close the prior PR21 measurement gap. A bounded diagnostic check uses
the exact downloaded CI AppImage on the isolated Ubuntu reference, with normal
and PR21 attribution harnesses serially. This adds reference-host proof, not
retrospective independent-timer proof for the completed GitHub run.

Linux receipts and source binding are retained as `linux-ci-*.json`. The clean
pre-build source has only the expected generated version change after packaging.
The downloaded AppImage SHA-256 is
`652650d4a34fa45f7603e2c2febd2cbcb5cbcc238485f0acc5545d85ee620f7c`;
extracted executable and ASAR respectively match the CI receipts:
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8` and
`01efe091e791b519786428add661360ee1f818f94edc32edec51e1ac9a234127`.
### Tracking-history causal investigation

The unchanged CI-built executable **fails the independent main-loop criterion**
on the reference host. PR22 remains draft and is not merge-ready. Serial normal
and diagnostic runs both retain all 8,664 positions and pass their ordinary
soak verdicts. Normal harness: inspector 96.150 ms, renderer 217.2 ms, external
action 130.250 ms. PR21 diagnostic harness: inspector 49.383 ms, renderer
150.5 ms, external action 157.095 ms, but independent main timers are
**243.025/215.115 ms** across the two launches, one breach each. Both launches
have complete mandatory channels, positive sample counts (133/3,513), inspector
collection and no evicted main events. The diagnostic harness intentionally
does not fail its ordinary verdict for these measurements; they were inspected
separately and rejected here.

No recorded GC, renderer frame/timer or pointer action overlaps either breach.
Controller maximums are 53.315/63.664 ms. Enclosing scheduler intervals of
503.164/500.365 ms contain main-thread runtime 283.354/270.039 ms but runnable
wait only 1.437/11.512 ms. These observations do not support ordinary CPU
contention as the dominant cause; they do not exclude I/O sleep. Storage-phase
history evicted 2,143 events and early raw runtime records had rotated away,
so absent storage entries are not evidence of absent work.

A materially different run profiles the first twelve seconds of main execution
(or until first-launch shutdown). Its first-launch timer gap is 286.736 ms,
10:28:43.171520–43.458256 UTC. The retained runtime record at 43.461 UTC reports
a 243 ms tracking persistence call inserting 1,800 positions. The corresponding
profile window is dominated by `addPositionsBulk()` SQL and repeated legacy
candidate-query preparation. Profile occupancy includes native waits and is
not a measurement of CPU time or proof of one long native call. The profile
anchor precedes setup commands, so individual sample alignment is approximate.

A further main-only boundary probe measures each outer transaction's entry,
callback entry/exit and return, with a `setImmediate` sentinel per episode.
Its largest transaction is **217.240 ms**: 0.027 ms before the callback,
177.579 ms inside it and 39.634 ms afterward. Its episode contains one
transaction, not a drain of many short writes. The same run's independent
timer gap is **294.248 ms**, containing that transaction; second-launch maximum
is 183.061 ms. No boundary records were dropped. BEGIN lock acquisition and
microtask starvation do not explain this particular transaction; its callback
and transaction completion are the dominant measured work. This and the profile
are separate runs and must not be combined into a single measurement.

The controlled runtime intervention reuses the identical legacy-candidate
prepared query while retaining a fresh parameterized lookup for every row.
It compiles once per database and reuses the statement 4,343/4,319 times across
the two launches. Both launches retain complete diagnostic channels, zero
main gaps at least 200 ms, and maxima 191.011/143.447 ms; all 8,664 positions
remain exact. This supports compilation as a causal contributor, but does not
retroactively explain every prior outlier or establish a bound for larger
payloads. The production repair is deliberately scoped to one bulk invocation,
not the intervention's database-wide lifetime. It preserves the exact SQL,
parameters, ambiguity rules and atomic checkpoint/rollback boundary. Fresh
production package evidence must establish its own effect. The deterministic
1,800-row compilation budget is red/green, the initial full mission-store
suite passes 102 tests, and the added own-writes invariant passes in seven
focused legacy/bulk tests. The query-reuse candidate subsequently passed the
full source suite (429 files / 4,386 tests), but its actual Linux package failed
the independent timer at 206.463 ms (second launch 161.603 ms). Its ASAR is
`3f69136f2186317b8a25829062d7adb09ae580cca2beaa04e926c0ee79ef9922`;
the rejected package and report remain retained. The experimental cache pass
does not supersede this rejection.

A short instrumented probe of that package counted **14,148 device updates /
147.629 ms in aggregate over 8.899 seconds**. This is not 147 ms attributed to
the rejected 206 ms interval. Its largest transaction was 163.323 ms
(128.700 ms callback / 34.602 ms completion); a separate combined CPU/boundary
run peaked at 157.491/112.988 ms. The runs remain separate in the raw evidence.

The next narrow intervention coalesces qualifying device observations inside
each existing transaction. Canonical four-digit UTC dates retain the maximum;
expanded years retain their original per-device SQL order. Inserts and
same-owner duplicate/conflict observations still update liveness. Legacy
adoption, ambiguous adoption, coordinate-only duplicates and cross-owner
conflicts still skip it. The final unchanged SQL comparison preserves an
already-newer or invalid persisted timestamp. There is no new publication,
checkpoint, persistence or interruption boundary.

The native trigger-count regression is red at 1,800 writes and green at one.
Focused tests prove newest timestamps, skipped-row eligibility, retained
conflict evidence, checkpoint/device rollback and success/failure across
restart. Finished-mission duplicate observations still invalidate cleanup
custody; later failure rolls the generation back and corrupt generations still
reject writes. Numeric generation increments are intentionally fewer; equality
and invalidation remain the custody contract. Three affected files pass
116 focused tests; the stable application source cycle passes 430 files /
4,390 tests. Custody and lifecycle reviewers inspected the final diff and log
and cleared it without rerunning tests.

The actual combined Linux package, ASAR
`4aefbc09f42c849501048dad1c32649cb0ab1f4cb3a0bc102f96b96701f37695`,
passes the unchanged PR21 observer: main 154.394/136.716 ms, zero >=200 ms,
133/3,346 samples, complete mandatory channels and no main-event eviction.
All 8,664 positions remain exact; inspector maximum is 61.096 ms and both
launches exit gracefully. This supports the combined narrow repair on the
reference workload; it is not a bound on arbitrarily large history chunks.
No threshold amendment or new partial-publication rule is needed for this
repair. Internal SQL changes add no operator controls or data meanings, so
the existing manual update needs no additional instructions.

### Closing the measurement escape

Tracking CI previously gated inspector round trips, which can stay responsive
while the main loop is blocked. The new minimal timer runs every 50 ms inside
main, samples its final tail and requires finite, nonempty evidence for every
launch. The ordinary soak verdict rejects any independent gap **>=200 ms** or
missing/failed collection, while retaining existing inspector, renderer,
current-write, truth and lifecycle checks. Collection yields through the main
loop and has a five-second controller deadline. The original inspector
heartbeat starts before probe installation and is cleaned up on startup failure.

A native Node/inspector negative control records a 350 ms deliberate block.
The inspector evaluation occurs inside the recorded blocking interval and
returns in 1.412 ms, while the independent timer measures 360.321 ms and rejects
it. A separate red verdict regression proves the old gate accepted a hidden
250 ms gap; the new gate rejects it. These are measurement controls, not
packaged application latency results.

The first enforced-harness run retained independent maxima 190.102/140.710 ms
but was rejected for one first-launch inspector error. The old collector
discarded the error detail, so its exact cause is not assigned. The harness now
preserves bounded error details and limits promise waiting to the new timer
collection instead of changing existing inspector requests. Together with the
reviewed collection deadline/startup corrections, this warrants final harness
qualification; it does not relabel the rejected run as green.

The corrected ordinary harness passes against the same actual package:
**165.785/152.291 ms** independent main maxima, 135/3,397 samples, zero
inspector errors, exact 8,664 positions and two graceful exits. Renderer maximum
is 167.2 ms and external action maximum 129.325 ms. Extracting the ASAR confirms
all five repair modules match the reviewed working source hashes. The native
and harness focused suite passes 56 tests across four files. Final stable
source passes **431 files / 4,395 tests** in 552.79 seconds. The original full-tail
GPX gate retains 1,043 writes, maximum write 32.001 ms and heartbeat 23.720 ms;
startup complete/shutdown controls measure 11.298/11.465 ms. Linux CI proof
remains separate and pending; no new CI artifact is yet claimed.

Four independent source charters are clear at `7637e936`: broad life-safety and
measurement, custody/completeness, concurrency/finalization, and renderer/input
containment. The first three verified the committed identity of their reviewed
diff; the renderer review inspected that exact commit. Reviewers ran no tests.
The broad reviewer corrected this report's initial omitted test-total claim
against the retained complete log. Commits through `6a88a65e` after `7637e936`
changed evidence/docs only. The later bulk-persistence and timer-gate changes
receive affected source reviews and fresh verification; earlier package checks
are not claimed as proof of those changes.
