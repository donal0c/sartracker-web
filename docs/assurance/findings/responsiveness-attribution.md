# Responsiveness attribution — DON-254

Investigation started 2026-09-10. This record has entry pointers in handoff and
the workplan without replacing active Repair Train B or WAR-06 state. No gate,
production behavior, release, merge decision, or field acceptance is changed by
this harness work.

## Current PR21 reconciliation

PR #22 and PR #20 are merged into current `master` at
`e989e8922ea105657a18a03ca442ae88e6c9d548`. The PR #21 candidate is being
reconciled from that exact base. Its richer controller/main/renderer/pressure/
pointer evidence is diagnostic only. PR #22's independent main-event-loop
probe and the existing archive/current-fix/frame predicates remain the
authoritative strict timing gates; no threshold, failure, or release rule is
changed here. Release remains **HOLD**.

The candidate deliberately retains historical contradictory failures, including
the 205 ms archive continuity breach and the 544.164511 ms PR #19 RTT, as
qualification evidence. A diagnostic collection result is never treated as a
release pass, and a PR-mode correctness/control pass is not beta or production
proof.

## Current decision and provenance

PR #19 remains a failed qualification candidate. Its retained run cannot
establish either a main-process application stall or a harmless host delay.
The 544.164511 ms observation is an external inspector round trip, with two
samples at or above its unchanged 200 ms limit. That rejection is binding.

The instrumented Linux run passed the original workflow but exposed a separate
measurement gap: inspector RTT stayed below 79 ms while the main process's own
50 ms timer recorded callback gaps of 217.08, 512.35 and 345.73 ms. This is not
universal sub-200 ms acceptance. The responsible application operation and
the scheduling contribution remain unresolved.

The historical PR #19 source snapshot was based on
`302bdd040976bd370271cf5866549fa2a7e05ff5`; PR #19 is draft at
`769669baf5d47ee9aa157c90746f6e406778d554`, tree
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

Missing mandatory realm/clock/frame evidence rejects diagnostic completeness;
review remediation records `collected: false` with a fixed reason and partial
channels, preserving the original operational verdict instead of throwing.
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
The instrumented Linux result below now supplies the next evidence boundary.
Do not reinterpret the local or Linux original-gate pass as acceptance or blindly
rerun the old aggregate-only harness. This PR owns diagnostic attribution;
DON-254 owns qualification and any discovered production stall gets its own
smallest repair scope.

## Instrumented Linux result and remaining causal boundary

Run [34525215816](https://github.com/donal0c/sartracker-web/actions/runs/34525215816)
passed at executable head `971a07de7a4f5bbe1ea2060a5ebdb259d843b08c`, tree
`a22c006210776573709683b685799135373e413b`. Source, package and archive records
agree; the package's generated version change was restored by the workflow.
The downloaded evidence artifact is `10172367386`. Its digest, report digest,
installer hashes and bounded observations are retained in
[the Linux receipt](../../evidence/responsiveness-attribution/linux-ci-971.json).

Lint, the full source suite, builds, normal 960k qualification, native artifact
inspection, llvmpipe attestation, packaged soak, archive lifecycle and AppImage
launch/close all passed. Soak retained exact position custody and zero operator
interaction errors. Archive current-fix / main watchdog / frame maxima were
166 / 90.45 / 98.9 ms, below those unchanged 200 ms gates.

**ATTR-M06: the inspector gate can under-detect ordinary timer-service delay.**
Its Linux maximum was 78.99 ms, yet the independently installed main timer
observed the following callback intervals. These are 50 ms timer gaps, not
measurements of continuous JavaScript blocking:

| Launch | Main callback gap | Process CPU during interval | Overlapping recorded GC |
| --- | --- | --- | --- |
| 1 | 217.08 ms | 233.97 ms | None retained |
| 1 | 512.35 ms | 496.15 ms | 36.44 ms |
| 2 | 345.73 ms | 307.25 ms | 32.26 ms |

Controller timer maxima stayed below 60 ms. Controller starvation therefore
does not explain these particular gaps. Main-process CPU was substantial;
it includes other threads and does not identify the blocking call path.
Launch 1's wider scheduler windows show concurrent run-queue waiting, about
67.72 ms over 500 ms and 134.20 ms over 1,002 ms around the two gaps. Those
windows cannot assign an exact share of either delay to host scheduling.
Recorded cgroup throttling counters were zero. Recorded GC durations explain
only a small fraction of the longer gaps; asynchronous GC observation and
unlogged work remain limitations. No GPU timeline was captured.

Both launches collected mandatory channels. Launch 2 explicitly evicted 47
pressure samples, including the early gap's scheduling context. The bounded
storage log also retains only its tail. Missing early phase records cannot
exonerate storage work. Frame maximum was 533.3 ms and independent renderer
timer maximum 408.3 ms; the soak's existing 1,000 ms freeze gate is distinct
from the archive's 200 ms gate. Neither threshold was changed.

The confirmed defect in measurement is treating inspector RTT as proof of
ordinary event-loop responsiveness. The component-level cause of the main
timer gaps remains open. Prompt inspector servicing during other activity
and timer starvation are hypotheses, not established mechanisms. No
introducing application commit is identified, and this base-derived run
does not identify the cause of PR #19's historical 544 ms RTT breach.

DON-254's next bounded diagnostic slice should capture a main-thread CPU
profile and operation boundaries around this same Linux workload, retaining
all existing gates and independent timers. Compare tracing off/on to measure
observer overhead before attributing a call path. Then choose one targeted
counterfactual from that evidence; do not rerun qualification hoping for green.
This is an explicit remaining investigation, not a claimed production fix.

## Verification and integration

The historical executable review records above are retained as provenance, not
as current-head approval. The current reconciled tree's local checks are
recorded separately: the full correctness suite passed 437 files / 4,478 tests
with six qualification-only skips; focused attribution/soak regressions passed;
lint and the production build/bundle budgets passed; and all three real Electron
controls passed. The strict responsiveness suite was not run by the correctness
lane and remains a separate release gate. Source/evidence logs are under
`docs/evidence/responsiveness-attribution/`. No operator-visible behavior
changed; the operator manual therefore needs no change.

Independent review findings ATTR-R01–R05 led to preserving the original frame
measurement window, explicit retained-gate assertions, eviction/completeness
validation, and bounded remote cleanup after partial installation/collection
failure. ATTR-R06's additional wiring regression failed before correction,
then 55 focused tests and lint passed; corrected packaged comparison is above.
CI runs `34523115131` and `34523403661` were superseded by fixture and startup
coverage corrections and are not successful qualification evidence.
The earlier independent reviews are historical and exact-head-bound to their
recorded executables. Current-head independent reviews must bind the final PR21
SHA after this reconciliation; their receipts will be added alongside the
historical [review receipt](../../evidence/responsiveness-attribution/reviews.json).

Historical independent reviews cleared executable `798a6fd8` against
`302bdd04`:
diagnostic safety/cleanup and evidence/causality. A supplementary delayed
500 ms main-block probe initially lost its Electron execution context; that
attempt is rejected, not timing proof. The synthetic fixture now retains its
BrowserWindow reference across allocation-heavy controls. The repeated probe
recorded 494.27 ms inspector RTT and 510.45 ms independent main timer; both
Electron control tests then passed again. This supports detection of that
injected main stall, not a cause for historical CI. No application/package/
soak-harness bytes changed in this fixture-only follow-up; earlier packaged
comparison evidence remains applicable. Historical targeted reviewers cleared
`3fe6928adab456d75e206c44bb08de8bec7167a7`, retaining their prior unchanged-harness
reviews without restarting unrelated reviews or local suites.

Historical reviewers also cleared exact executable `971a07de` after ATTR-R06 and
independently inspected the downloaded Linux evidence. They confirmed the
contradictory timing observations and unresolved component-level cause.
The final evidence closeout changes documentation only. Per the testing cadence,
it reuses the green executable CI run above; facts, JSON, links, diff and
unchanged executable trees are checked instead of repeating runtime suites.

The current integration base is `e989e8922ea105657a18a03ca442ae88e6c9d548`.
Active PR #19 and PR #20 have overlapping coordination dispositions; PR #20's
merge is not a timing qualification. Review remediation adds entry pointers to
handoff and the workplan; detailed hazard disposition still belongs to their
coordination owners. DON-254 stays open.

## User review remediation

The review identified gaps not covered by the earlier independent reviews.
CI `34525215816` did not run `test:e2e:chromium` or the new Electron spec;
its green result must not be cited as proof of those tests.

| Finding | Correction |
| --- | --- |
| ATTR-R07: Electron spec selected by display-free release Chromium project | Move to `tests/e2e/electron/`, exclude from Chromium, add `electron-controls` project and run it under Xvfb with Linux runtime dependencies in Linux validation. POSIX suspension control runs on Linux/macOS; Windows exercises the other controls. |
| ATTR-R08: diagnostic failures throw or disappear during abnormal close | Preserve original operational verdict; record explicit failure reason and surviving channels. Use an independent 12-second collection budget, parallel bounded reads, idempotent stop and a post-cleanup receipt on normal/abnormal exits. |
| ATTR-R09: pressure FIFO loses early causal context | Progressively decimate across the entire run while keeping first/latest observations. Report stride, maximum spacing and discarded count. A fourteen-day synthetic retention test proves bounded whole-run coverage, not fine-grained pressure coverage around every stall. |
| ATTR-R10: inconsistent wall stop clock | Snapshot controller once before cleanup and freeze the realm's wall stop timestamp. |
| ATTR-R11: duplicated hit-testing and target knowledge | Hit-test once per event; share measured interaction target identities with the observer. Unknown preflight or missing expected target explicitly invalidates diagnostic completeness. |
| ATTR-R12: half-converted inspector ID | Use captured ID consistently for pending registration, send, timeout and send failure. |
| ATTR-R13: findings not discoverable from onboarding | Add handoff/workplan pointers without rewriting other lanes. |

Risk is confined to test selection and diagnostic lifecycle/retention. Production,
coordinates, persistence, original safety verdicts and numeric thresholds are
unchanged. Five targeted regressions first failed; affected unit tests and real
Electron controls pass locally. The full source run passed 4,392 tests and
failed one archive Git-custody test because `git ls-files` still named the
unstaged moved Electron spec; direct capture reproduced `ENOENT`. Staging the
rename restored the tracked-file inventory; all 30 tests in that suite passed
with the affected suites (94 total). The rejected run is retained, not relabelled
green. Lint/build and three real Electron controls pass, including transport
disconnection with an explicit failure record. A same-package macOS CI-profile
soak passed original gates and exact 8,664-position custody; both launches had
complete attribution and the standalone post-cleanup receipt. File hashes and
logs are in [local remediation evidence](../../evidence/responsiveness-attribution/review-remediation/local-receipt.json).
The wired Linux control run is verified below. Earlier Linux evidence remains
historical and does not prove these executable changes.

The narrow follow-up review also found stale preflight ownership after a
completed close and a missing-heartbeat default on abnormal cleanup. Two more
red-first tests now cover clearing ownership on click/cancel and explicit
diagnostic incompleteness when original heartbeat collection has not finished.

### Remediation CI disposition

[Run 34532256680](https://github.com/donal0c/sartracker-web/actions/runs/34532256680)
at executable `693b1c30275311c61c6bb9cfdc9800e78cb0408f` passed 429 source files /
4,393 tests, all three Electron controls under Xvfb, lint/build, normal 960k
qualification and packaged tracking soak. The original soak verdict and exact
custody passed; both launch attribution records are complete and match the
standalone post-cleanup receipt. Launch 2 retains its first/latest pressure
samples across the whole run, with stride 2, 297 retained of 592 observed and
maximum spacing 1,008.96 ms. Decimation still limits fine-grained causality.

**Overall CI remains failed:** the unchanged archive cleanup continuity gate
recorded 205 ms against the strict 200 ms limit. Its terminal failure receipt
was verified and process/profile cleanup completed. AppImage launch was not
run after this rejection. Archive application/harness paths are unchanged by
the remediation. The interval comprises 168 ms between emitted/requested
source samples plus a 37 ms increase in delivery lag (16 to 53 ms); this does
not identify the introducing operation or waive the continuity failure.

Soak inspector RTT maximum was 86.99 ms, independent main callback maxima
596.55 / 329.30 ms, controller maxima below 63 ms and frame maximum 449.9 ms.
The timing contradiction remains unresolved. The review findings are addressed;
qualification and component-level timing causation are not. No blind rerun or
gate change was made. [Exact receipt and retained failure](../../evidence/responsiveness-attribution/review-remediation/linux-ci-receipt.json)
bind the evidence artifact `10175001360` and step results. Historical
source/targeted reviews at `693b1c30` were clean; that is distinct from the
failed whole-workflow verdict and does not approve the current PR21 head.
