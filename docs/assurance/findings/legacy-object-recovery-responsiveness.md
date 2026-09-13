# Legacy object recovery observer repair — DON-254 follow-up B

Base: freshly fetched `origin/master`
`deedab27483ad4fe1ca998a4d68afd555f4e2337`, including merged PR23 and PR24.
Branch: `codex/don-254-legacy-recovery-responsiveness`.

## Finding and scope

**Current review remediation:** [Claude finding dispositions](legacy-recovery-claude-remediation.md)
supersede the worker-inspector implementation described below. Both large recovery
tests now await real production completion/physical exit and inspect persisted
data independently after timing; final partial intervals are gated. The former
inspector protocol and CPU/GC diagnostics are removed. Historical comparisons
below retain their original source identity and causal limits.

The current-head reproduction identifies a blocking **test inspection**, not
a demonstrated production reconstruction defect. The repair moves that
read-only SQLite observer into a separate test worker. Application, archive,
tracking, persistence and production worker files are unchanged. No production
responsiveness fix or whole-candidate qualification is claimed.

DON-254 was reopened on 2026-09-13; its current state is **In Progress**.
Comment `56ae12d3-1f0b-4609-92cf-7bd7f6c0d2c8` supersedes older Done receipts.
The original follow-up is comment `1dfb6581-71a5-4582-9bd8-4ba0ac6173a8`.
Release remains HOLD, and BCP-17/WAR-12 qualification remains after all
release-blocking repairs and feature freeze.

## Retained rejection and current causal comparison

The [original log](../../evidence/responsiveness-causal-repair/rejected-grouped-live-reader-full-source.log)
records **239.509125 ms** against strict `<200 ms`: 4,437 passed / one failed
across 432 files, 105.31 seconds wall time, using `npm run test -- --run`
with default file parallelism on macOS. The log does not bind an exact execution
SHA/tree or external host load. Neither a first bad performance build nor the
historical native cause can be reconstructed from that log.

The unchanged current-head focused oracle passed on macOS arm64 / Node
22.22.3 and the reference Ubuntu x64 / Node 22.22.2. Those passes did not
erase the rejection. Bounded attribution was then added without changing the
original fixture, synchronous count, interval or timing predicate.

| Current-head control | Main heartbeat maximum | Inspection query maximum | Result |
| --- | ---: | ---: | --- |
| Original synchronous observer, isolated macOS | 13.989 ms | 2.621 ms | Focused pass; no causal repair |
| Original synchronous observer, full default-parallel source | **256.329 ms** | **244.243 ms** | Retained rejection; 4,658 pass / one fail |
| Off-thread observer, isolated macOS | 13.032 ms | 2.352 ms | Diagnostic intervention pass |
| Off-thread observer, full default-parallel source | **14.481 ms** | **204.046 ms** | 4,662 pass; slow query remains visible |

In the reproduced rejection, the largest heartbeat window starts at
23,738.240916 ms; its synchronous count starts at 23,750.309541 ms and lasts
244.242625 ms. Measured thread CPU is 1.006 ms, process CPU 8.445 ms,
event-loop active time 244.3175 ms and idle time 12.0055 ms. No overlapping
main-realm GC was observed. The counterfactual preserves the slow inspection
while removing its execution from the measured event loop. It establishes that
the test's synchronous read contributed to the measured stall. The 204.046 ms
read remains a real unresolved database-read latency observation, even though
it no longer blocks the test's measured loop. No operator-facing concurrent-read
latency gate is established by these completion tests. It does not distinguish native I/O/locking from OS
descheduling or retroactively establish the historical 239.509125 ms cause.
The second full run also includes three new diagnostic helper controls; this
small additive test difference is disclosed rather than calling the two trees
identical. Production inputs are identical.

[Raw logs and bindings](../../evidence/legacy-object-recovery/) retain every
rejection. The old observer was introduced by test commit `1f69c7907`; this
identifies source provenance, not a first bad release. PR5's earlier production
worker isolation at `e9466e54` remains intact; its earlier 217.40, 239.90 and
346.538 ms failures remain in [PR5 evidence](../../breadcrumb-pr5-evidence.md).

## Invariants and measurement boundary

- Exactly 50,000 legacy markers, the original schema-v11 upgrade recipe and
  all existing correctness/readiness assertions remain. The count still runs
  `prepare('SELECT COUNT(*) AS count FROM mission_object_versions').get()`
  on every request, with the original 10 ms polling, 4,500-attempt bound and
  60-second test deadline.
- Open, current-position write and measured-event-loop predicates remain
  strict `<200 ms`. No measured duration is subtracted. Existing qualification
  routing and the production backfill's 25-row turns, byte caps and four-ms
  yield are unchanged.
- The observer is read-only and returns one scalar count/timing reply per
  request. Request collisions reject. Failure, cancellation and close join
  physical worker exit; concurrent close callers share one completion.
- The timer remains on the caller's thread. A deliberate 250 ms main-thread
  block is rejected even with the inspector active (measured 250.238 ms in
  the affected-suite control). Slow observer work cannot exempt production
  main-thread work from the gate.
- Bounded GC/query/CPU attribution labels process CPU separately from thread
  CPU. Unobserved tail time is diagnostic only; the original timer predicate
  is unchanged. Missing main-thread inspection measurements are null.

The old oracle mixed application work with its own synchronous SQLite reads,
and retained only a maximum heartbeat. That is the measurement escape closed
here. There is no evidence justifying another production worker, SQL tuning,
archive change or transport redesign for this reproduced failure.

## Verification state

The initial stable helper passed eight controls. Three serial focused strict 50k
runs retain all objects, with main maxima **12.915 / 14.610 / 12.853 ms**.
The affected legacy recovery/archive/worker suites pass **165 tests / six
files**, including the unchanged evidence-versioning file. Helper strict
ES2023 TypeScript checks passed at that revision. Independent review then
required stronger worker fault handling and retained-control checks. The final
19 inspector controls pass, including the actual 250 ms main-thread negative
control and SQLite open/read failures. Final strict 50k recovery passes at
**12.845 ms** maximum main heartbeat. Final lint, strict ES2023 helper types
and unchanged qualification-routing controls pass; both nonauthor review
charters are clear. The final serial correctness cycle passes **444 files /
4,656 tests**, with the same six qualification-only cases visibly skipped
(481.06 seconds). This is correctness evidence, not timing qualification.

The fresh macOS arm64 package build, TypeScript app build and bundle budgets
pass. The [native receipt](../../evidence/legacy-object-recovery/packaged-native-report.json)
passes exact 50,000 seeded-marker and complete baseline-row digests across
settlement/restart, fail-closed pre-settlement mutation/read checks, real worker
completion, post-restart mutation and two physical app exits with code zero.
Main maxima are **60.224 ms recovery / 56.613 ms close / 57.254 ms restart**;
open is 13.440 ms and current write 1.242 ms. The receipt binds the ASAR,
executable, six implicated production source files and exact probe/timer hashes.
Its source was locally dirty because the test-only repair was uncommitted;
this is not an exact committed-head or complete-runtime source attestation.
The final exact-head CI/readiness decision is recorded in the PR terminal
receipt; it is separate from these local results. The
[review receipt](../../evidence/legacy-object-recovery/review-receipt.md)
records all findings and their disposition.

Development rejections are retained separately: a jsdom URL-resolution error,
an unowned cancellation assertion, two intermediate helper exit-join failures,
and a DOM-versus-Node PerformanceEntry type mismatch. An intermediate serial
correctness run was deliberately interrupted when independent review required
helper changes; it also exposed an unnecessary qualification-routing import in
the new negative control. Its partial log is retained as interrupted, not passed.
They are harness
development failures, not application timing measurements or waived gates.

The supplemental package proof uses a disposable second mission store in
actual packaged Electron main. It must be labelled direct native
store/worker/restart evidence, not the operator UI flow, installed `.deb`,
live provider, field-machine, soak or final-candidate qualification. Original
retained field fixtures and archive bytes are never opened or modified.
WAR-06 production ownership remains separate; final readiness requires fresh
master reconciliation or the explicit pending-WAR-06 boundary.
