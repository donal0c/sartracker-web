# Responsiveness causal repair — DON-254

2026-09-11, base `49b2e1d416ca2fa4ff98cfae31c4d947bc4b0a6e`, branch
`codex/responsiveness-causal-repair`. Dedicated repair; no merge, release,
deployment or field acceptance. [Raw bounded evidence](../../evidence/responsiveness-causal-repair/).

## Finding and decision

Two reproducible application defects justify a narrow repair with the existing
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
The new deterministic controls cover those escapes. Last-known-good and
introducing commit for the two defects are not yet established; the confirmed
affected baseline is the master SHA above. This is engineering/CI evidence,
not a new SAR team report or an accepted replacement release.

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
proof; it does not claim a freshly rebuilt artifact. Linux CI remains pending.
This is not merge-ready approval yet.

Four independent source charters are clear at `7637e936`: broad life-safety and
measurement, custody/completeness, concurrency/finalization, and renderer/input
containment. The first three verified the committed identity of their reviewed
diff; the renderer review inspected that exact commit. Reviewers ran no tests.
The broad reviewer corrected this report's initial omitted test-total claim
against the retained complete log. Subsequent commits change evidence/docs only;
no executable/test input changed and the source reviews remain applicable.
