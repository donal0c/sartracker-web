# Responsiveness attribution — DON-254

Investigation started 2026-09-10. This record is isolated from active Repair
Train B and WAR-06 coordination edits. No gate, production behavior, release,
merge decision, or field acceptance is changed by this harness work.

## Current decision and provenance

PR #19 remains a failed qualification candidate. Its retained run cannot
establish either a main-process application stall or a harmless host delay.
The 544.164511 ms observation is an external inspector round trip, with two
samples at or above its unchanged 200 ms limit. That rejection is binding.

Fetched master is `302bdd040976bd370271cf5866549fa2a7e05ff5`; PR #19 is draft
at `769669baf5d47ee9aa157c90746f6e406778d554`, tree
`1dbca6e67642e7e4092fbb5fc9c70573e4a7d9da`. Run
[34515489481](https://github.com/donal0c/sartracker-web/actions/runs/34515489481),
attempt 2, artifact `10168590752`, was downloaded independently. The complete
report digest, exact boundary blobs, changed-path matrix and failed action
records are retained in
[the machine-readable evidence](../../evidence/responsiveness-attribution/pr19-source-and-failure.json).

The base-to-head diff has three application files (GPX parser, native GPX
worker, GPX runtime), seven test/harness files and 33 documentation/evidence
files. No dependency or workflow/environment change exists. Tracking runtime,
mission store and soak boundary blobs are identical. No GPX import is exercised
by this soak. Read-only inspection confirms zero import/evidence rows in live
and backup SQLite; two legacy GPX migration-state tables each contain one row.
The earlier blanket claim that every GPX-related table was empty was too broad.
This makes GPX-specific causation unsupported, not impossible:
shared renderer scheduling and runtime subscriptions still require comparison.

## Stable findings

- **ATTR-M01 / B-CI-01:** `startMainHeartbeat` times an inspector request on the
  external controller's clock. Main scheduling, controller scheduling and
  transport are conflated; pauses between requests are not measured. Preserve
  the original gate and add independent timer channels.
- **ATTR-M02 / B-CI-02:** stable coordinates return across CDP before
  `mouse.click`. A target can move before dispatch or between down/up. The
  retained post-restart click reached the tracking-status ancestor, not Devices.
  Delivery took 133.331 ms and the failed state wait 5,009.840 ms, producing
  5,143.171 ms. This is failed input/state completion, not demonstrated
  five-second handler execution. Later actual open/close took 48.1/43.4 ms.
- **ATTR-M03:** raw timing arrays lose temporal/launch context; aggregate
  maxima cannot be correlated causally with storage, GC or host activity.
  The new channels retain bounded timestamped observations and dropped counts.
- **ATTR-M04:** inspector evaluation had no request deadline; stopping the
  heartbeat could hang while awaiting it. The diagnostic request now times out
  after five seconds, reports an error and clears its pending entry. This is
  an infrastructure deadline, not an application safety threshold.
- **ATTR-M05:** main inspector RTT, current-fix continuity, cadenced renderer
  frame availability, renderer click-to-state reaction, external action and
  target-stability waiting have different meanings. The soak's renderer/action
  freeze verdict is 1,000 ms; its 250 ms summary count is telemetry. The archive
  continuity/frame gates and soak main RTT gate retain their strict 200 ms
  limits. No aggregate green result implies universal sub-200 ms behavior.

## Historical contradictory evidence retained

| Lane | Retained failures / limits | Interpretation |
| --- | --- | --- |
| PR #11 | `51acca12`, renderer 202.9 ms; unchanged repeat passed | Unexplained; no causal fix |
| PR #12 | current-fix 203/226 ms; renderer 202.4/219.5 ms; cold-cache local 219.2 ms | Graphics traces support a rendering contributor for that workload, not every later breach |
| PR #15 | runs `34398992302` (242/210 ms), `34458799719` (206 ms); final `34462624720` passed | Bounded Mesa workers reduced local contention; hosted causes remain unproven |
| PR #17 | `34496976736` attempt 1 archive 224 ms; attempt 2 193 ms | Same-head repeat is not a fix; soak renderer 499.9 ms and external action 374.58 ms remain qualification evidence |
| WAR-06 / PR #20 | exact head `839737e82a8736be8dea3e7104fdada16398ea31`; source timing 240.89/264.88/272.54 ms | Separate source workload and deterministic mission-scope defects; neither is silently absorbed here |
| PR #19 | main RTT 544.164511 ms; renderer 416.6 ms; failed input timeout | Cause remains unresolved; successful source/960k replay and exact 8,664-position custody do not waive responsiveness |

See [historical rendering investigation](../../archive-ci-rendering-investigation.md),
the linked PR bodies/comments and DON-254's Reliability & Regression Ledger.
Last known good and first known bad **for a causal defect** remain unknown;
individual passing runs are not a demonstrated stable baseline.

The dispatch's approximate 59.5/65.9/101.5 ms comparison values must not be
pooled. The retained 59.539734 ms value is PR #17's archive **create-phase
watchdog**; 65.979697 ms is an earlier `cb6e28a2` archive create watchdog in a
run that later failed 207 ms current-fix continuity. PR #17's 101.541162 ms is
the **tracking-soak inspector RTT**. These are different measurement paths
and, in the 65.9 ms case, not an overall passing run. References:
`docs/evidence/repair-train-a/github-followup/linux-ci-attempt-2-inspection.json`
and `docs/evidence/pr6/review-remediation-cb6e28a2-linux-failure.json`.

## Diagnostic design and proof boundary

The same self-contained timer observer runs in controller, packaged main and
renderer realms. It retains maximum and >=200 ms counts independently of a
512-event outlier ring. Main/controller CPU deltas include all process threads,
so CPU consumption alone is not a JavaScript attribution. Main GC entries are
optional and asynchronously delivered. Linux CPU pressure, main `schedstat`
and cgroup CPU counters are sampled with bounded, sanitized records; missing
or unsupported counters remain unavailable. No process commands, environment,
operator text, geographic coordinates or credentials are collected by these channels.

Cross-realm anchors record controller-before/after and remote monotonic time,
bounding transport uncertainty at both ends of each launch. Wall-clock anchors
permit qualified comparison with existing storage phase logs; they are not an
exact shared monotonic clock. Pointer-down/up/click capture the expected fixed
controls' rectangles, hit containment, path membership and trusted status, plus
the last preflight coordinates/time. Cadenced frame outliers remain separate
from renderer timer gaps. Original probes stop before diagnostic collection so
collection does not extend the original measurement window.

Missing mandatory realm/clock/frame evidence rejects diagnostic collection.
Eviction is explicit and forbids absence claims for lost intervals. Optional
GC/host data and GPU execution cannot exonerate a stall. Correlation is evidence
for a hypothesis, not automatic causal classification or permission to pass.

Controlled Electron tests inject main JavaScript blocking, renderer blocking,
external controller blocking and OS suspension of only the main process.
Separate realm probes identify the affected channel; process CPU distinguishes
the synthetic busy loop from synthetic descheduling. A trusted-pointer control
moves Devices after stable preflight and records the subsequent missed target.
These are isolated diagnostic controls, not operational SAR application or
Linux CI artifact qualification. Their source assertions require unchanged
gate rejection for 200/350/544.164511 ms RTTs and failed operator input even
when a host/controller explanation is attached.

## Controlled comparison and decision

**Coverage correction (ATTR-R06):** the initial diagnostic implementation
awaited setup before starting the original main RTT probe. Review found a
possible missed interval, particularly on restored tracking. The main probe
now starts at its original position immediately after renderer readiness,
before diagnostic setup; startup failure closes the inspector and drains the
probe with bounded cleanup. A wiring regression failed before this correction.
The original comparison below remains exploratory evidence and does not
verify the corrected startup interval. A fresh same-harness comparison completed below.

The planned A–B–B–A packaged comparison completed with the same diagnostic
harness, fresh profiles, unchanged CI workload and existing verdict limits.
A is master `302bdd04`; B is PR #19 `769669ba`. Every run preserved exact
8,664-position truth, restart, custody and the original gate verdict.

| Run | Inspector RTT max | Independent main timer max | Cadenced frame max | Independent renderer timer max |
| --- | --- | --- | --- | --- |
| A1 | 11.31 ms | 151.00 ms | 59.1 ms | 90.8 ms |
| B1 | 8.19 ms | 152.82 ms | 175.1 ms | 81.2 ms |
| B2 | 16.46 ms | 141.53 ms | 66.6 ms | 75.9 ms |
| A2 | 12.71 ms | 186.47 ms | 58.3 ms | 89.9 ms |

[Raw bounded observations and original verdicts](../../evidence/responsiveness-attribution/local-abba.json)
retain all four runs. These macOS arm64/Metal results do not reproduce the
Ubuntu x64/llvmpipe failure. A1 startup overlapped a 1.67-second focused test;
the other runs had no task-owned test/build work concurrent. Unrelated host
workloads were not stopped. Fixture dates are freshly anchored per run, while
workload shape/counts are identical. This is a bias-conscious local comparison,
not a controlled reproduction of the hosted environment or statistical proof
of equivalence. There is no demonstrated PR19 slowdown in these observations.

The corrected A–B–B–A comparison reused the same immutable packages with no
task-owned test/build work concurrent. All four original verdicts, exact
8,664-position truth, restart and mandatory diagnostic channels passed:

| Corrected run | Inspector RTT max | Independent main timer max | Cadenced frame max | Independent renderer timer max |
| --- | --- | --- | --- | --- |
| A1 | 24.89 ms | 156.59 ms | 82.8 ms | 83.9 ms |
| B1 | 16.16 ms | 148.72 ms | 66.9 ms | 73.4 ms |
| B2 | 11.51 ms | 160.03 ms | 67.5 ms | 81.8 ms |
| A2 | 10.77 ms | 161.11 ms | 67.0 ms | 83.8 ms |

[Corrected raw evidence](../../evidence/responsiveness-attribution/corrected-abba.json)
is the applicable local comparison for the final harness. The same platform
and fixture-clock limitations apply; this still does not explain Linux CI.

**PR #19 decision: remain draft; retain failed run 34515489481.** GPX-specific
causation is unsupported, and the evidence cannot exonerate the whole app or
host. No introducing product commit or production repair owner is established.
The smallest next experiment is an instrumented Linux run with the retained
channels; if it breaches, correlate intervals before selecting one targeted
counterfactual. Do not reinterpret this local pass as acceptance or blindly
rerun the old aggregate-only harness. This PR owns diagnostic attribution;
DON-254 owns qualification and any discovered production stall gets its own
smallest repair scope.

## Verification and integration

Full serial source passed 428 files / 4,383 tests in 479.42 seconds. Subsequent
affected validation passed 54 tests, including completeness and cleanup
red/green regressions. Lint and TypeScript pass; both application packages built.
The final two Electron control tests pass, with four separately observed stall
injections and the pointer-movement control. Source/evidence logs are under
`docs/evidence/responsiveness-attribution/`. No operator-visible behavior changed;
the operator manual therefore needs no change.

Independent review findings ATTR-R01–R05 led to preserving the original frame
measurement window, explicit retained-gate assertions, eviction/completeness
validation, and bounded remote cleanup after partial installation/collection
failure. ATTR-R06's additional wiring regression failed before correction,
then 55 focused tests and lint passed; corrected packaged comparison is above.
CI runs `34523115131` and `34523403661` were superseded by fixture and startup
coverage corrections and are not successful qualification evidence.
Both prior independent reviews are clean; exact identities and charters
are recorded in [the review receipt](../../evidence/responsiveness-attribution/reviews.json).

Both independent reviews cleared executable `798a6fd8` against `302bdd04`:
diagnostic safety/cleanup and evidence/causality. A supplementary delayed
500 ms main-block probe initially lost its Electron execution context; that
attempt is rejected, not timing proof. The synthetic fixture now retains its
BrowserWindow reference across allocation-heavy controls. The repeated probe
recorded 494.27 ms inspector RTT and 510.45 ms independent main timer; both
Electron control tests then passed again. This supports detection of that
injected main stall, not a cause for historical CI. No application/package/
soak-harness bytes changed in this fixture-only follow-up; earlier packaged
comparison evidence remains applicable. Both targeted reviewers cleared
`3fe6928adab456d75e206c44bb08de8bec7167a7`, retaining their prior unchanged-harness
reviews without restarting unrelated reviews or local suites.

Master was refreshed again after implementation and remains `302bdd04`, the
branch's exact base; no upstream rebase delta exists. Active PR #19 and PR #20
have overlapping pending coordination dispositions. Keep this report isolated
until those land, then integrate one concise pointer into handoff/workplan/
coordinated hazard records without overwriting their Train B/WAR-06 state.
DON-254 stays open. This named integration step is not a claim that the shared
records have already been updated.
