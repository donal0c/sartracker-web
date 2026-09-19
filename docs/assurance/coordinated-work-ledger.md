# Coordinated Team, Audit, and WAR Work Ledger

Updated: 2026-09-18

Status: active coordination record. The canonical execution order remains
`docs/two-track-execution-workplan.md`; this ledger prevents the three current
sources of work from being lost, duplicated, or qualified in the wrong order.

## Governing decision

**PR27 follow-up:** earlier Train D readiness is withdrawn. Donal approved audited
legacy-roster recovery (SAR-QA-022); independent native/shared and UI/IPC reviews
are clear on the repaired working tree. Full correctness passes 4,825 tests / 458
files (six existing exclusions); affected Chromium passes 26/26. Exact-head checks
and reviews remain the next boundary. See [review disposition](findings/pr27-claude-review.md).

SAR Tracker now has three linked delivery streams:

1. confirmed SAR-team requirements and UI feedback;
2. confirmed bug/performance findings, including the 2026-09-07 deep audit; and
3. whole-application resilience work (`WAR-*`).

They are not independent backlogs. Work may proceed in parallel only when the
production ownership seams do not overlap. A confirmed P1/P2, silent evidence
loss, false completeness claim, corrupted evidence, hidden/delayed current
position, or mission-scale main/renderer stall is resolved before BCP-17 and
the next team beta. Expensive whole-candidate qualification runs only after all
required repairs merge.

The deep audit inspected master `0ca331ff816800e83134142cb109903e5d2c2992`
and an early PR10 snapshot. Its report is
`output/deep-codebase-audit-2026-09-07/report.md`. On 2026-09-09 the coordinator
compared the principal implicated files with master
`c51e4b3537c4b026f7079dd40193a894cedcdd9f`; all but
`src/features/runtime/start-app-runtime.ts` were blob-unchanged, and that
runtime file had no demonstrated repair for `AUD-13`. This is strong triage
evidence, not a substitute for reproducing each defect on the exact repair
head.

## Intake and completion rules

- Every audit finding is retraced red on its exact implementation head before
  production code changes. An old reproduction is not silently promoted to
  current-head proof.
- An active PR absorbs a finding only when it shares the same invariant,
  production seam, tests, and review boundary. Otherwise the finding stays in
  the next coherent repair train.
- A WAR investigation references the audit ID and current disposition instead
  of rediscovering or renaming it. New findings return here as `confirmed`,
  `hypothesis`, or `cleared`.
- Repairs are grouped by safety boundary, not one PR per finding and not one
  catch-all PR. P1/P2 findings block that repair train and final qualification.
- Each repaired row records the Linear owner, fix SHA, before/after proof,
  escape analysis, durable regression gate, residual uncertainty, and any
  packaged/field confirmation still required.
- Team-domain meaning comes only from the raw/indexed Q&A. No audit or WAR task
  may invent a new operational requirement.

## Post-PR38 release-first reconciliation and bounded triage — 2026-09-18

PR38 merged into `master` at
[`e69485724044337fb5fee94bfbe5871916fdabf1`](https://github.com/donal0c/sartracker-web/commit/e69485724044337fb5fee94bfbe5871916fdabf1),
from exact head `92a4f680facc98fb2aa6871228616f6f0cb809e4`. Required Linux
workflow [`35390687670`](https://github.com/donal0c/sartracker-web/actions/runs/35390687670)
passed at that exact PR head. PR38 is documentation/control-plane evidence
only: it does not fix a product hazard, qualify a candidate, declare a freeze,
or authorize release. The retained failed PR35 receipt
[`35221533225`](https://github.com/donal0c/sartracker-web/actions/runs/35221533225)
and later passing receipt
[`35242591823`](https://github.com/donal0c/sartracker-web/actions/runs/35242591823)
remain unchanged evidence.

The preceding exact merge anchors remain retained: [PR35](https://github.com/donal0c/sartracker-web/pull/35)
merged at `ea4b92eb82646b12b2d8ad2307e242ed8049d35c`, and [PR36](https://github.com/donal0c/sartracker-web/pull/36)
merged at `f7798a19589b5d907408080dc65e2d2739767130`. These remain historical
repair boundaries; PR38's actual reconciliation merge is
`e69485724044337fb5fee94bfbe5871916fdabf1`.

This is not a release or candidate qualification. PR36's required workflow
did not run the complete strict timing, scale, soak, archive, field,
original-machine or human-acceptance matrix. The qualification control-plane
dry run remains explicitly `releaseEligible: false`.

### Release-first state vocabulary

**TEST CANDIDATE FROZEN / SELECTED** means one exact clean source SHA,
intended version, declared fixtures/platforms, artifact names, rollback
artifact and stop conditions are recorded. Qualification may still be HOLD;
this state is never release approval. **QUALIFIED FOR PROMOTION** means that
BCP-17/WAR-12, all five WAR-01 exit gates, exact-artifact checks,
original-machine confirmation, publication/rollback evidence and every other
mandatory receipt have passed for the same bytes. Exact-candidate evidence is
not a prerequisite to selecting the test candidate, and a freeze must never be
represented as qualification or promotion.

### Confirmed P1/P2 reconciliation

The following confirmed P1/P2 groups have merged repair-boundary evidence in
the repair records and merged PRs #15, #17, #19, #26–#28, #30–#32 and #34.
Their scoped fixes are not silently promoted to final-candidate closure; each
still requires the exact-candidate recheck or packaged/field proof named by its
row and by the WAR-01 overlay.

| Groups | Current disposition |
| --- | --- |
| `AUD-01` (P1), `AUD-02` (P2), `AUD-03` (P1), `AUD-04` (P2), `AUD-05` (P2), `AUD-06` (P2), `AUD-07` (P2), `AUD-08` (P2), `AUD-09` (P2), `AUD-10` (P2), `AUD-11` (P2), `AUD-13` (P1), `AUD-14` (P2) | **Repaired boundary awaiting exact-candidate qualification.** The scoped fixes are merged and their source/native/browser/package receipts remain valid within scope; they do not cover the exact beta13 artifact, every failure mode, or field acceptance. `AUD-11` specifically retains its failed packaged map receipt; the later source/browser repair is not relabelled as packaged proof. `AUD-12` remains P3 and post-beta unless new evidence changes its severity. |
| `WAR-06-AUD-01`, `WAR-06-AUD-02`, `WAR-06-CACHE-SIBLING` (P1) | **Repaired boundary awaiting exact-candidate qualification.** PR26 merged the bounded lifecycle/cache repair; the retained evidence does not prove the whole application, long-duration, package, field or strict release matrix. |
| `WAR04-SET-01..03` and `WAR04-PRV-01..03` | **Repaired boundary awaiting exact-candidate qualification.** PR34 merged the settings/startup/privacy repair. Retained timing and privacy receipts remain scoped evidence only; they do not close the five WAR-01 absolute blockers or the candidate matrix. |

No repaired P1/P2 is being accepted as post-beta debt. Its current disposition
is “repaired boundary awaiting exact-candidate qualification.” A concrete new
P1/P2 or safety-critical defect found during triage or qualification returns to
a separate repair PR and blocks promotion.

### Current-head bounded blocker triage

This is a short read-only triage of the records and current production seams on
`e69485724044337fb5fee94bfbe5871916fdabf1`; it is not execution of WAR-03,
WAR-07, WAR-08, WAR-09 or WAR-10 and does not replace exact-candidate proof. No
checks were executed for this triage; the triage below is source and record
inspection only.

| Item | Current evidence and judgment | Disposition |
| --- | --- | --- |
| `TRK-001` delayed/hidden current position | The current hazard row remains accurate: pre-window startup, renderer cold-start, participant/error, reload drain/replacement, pause and automatic-recovery paths can leave current position delayed, withheld or without an active request path. Existing tests cover bounded pieces but do not close the held-gate paths. | **Confirmed unresolved production blocker requiring a separate repair before candidate selection.** Smallest coherent chunk: current-position priority through startup/reload/replacement/recovery, with held-gate regressions and visible bounded failure. Owner seam: DON-267/DON-179/DON-250; complexity 9/10; recommended model Luna x-high. |
| `GEO-002` unsafe bearing/distance/measurement input | Current `drawing-math.ts` still accepts non-finite and out-of-range coordinates/bearings, and `segments=Infinity` can make the synchronous point loops unbounded. Existing tests cover negative radius/distance and degenerate bearing only; `start-measurement-runtime.ts` passes clicked values directly to the math boundary. | **Confirmed unresolved production blocker requiring a separate repair before candidate selection.** Smallest coherent chunk: finite/range validation at the public math boundary, bounded segment validation, red/green adversarial tests and affected drawing/measurement consumer review. Owner: DON-6/DON-254; complexity 6/10; recommended model Luna x-high. |
| `PKG-001` prolonged package non-interactivity | Retained DON-247 field evidence records Mint `.deb` controls becoming non-interactive around 182 hours while a different PCLinuxOS AppImage profile remained responsive. The profile split prevents causal attribution, but the operator-visible failure itself is not closed. | **Confirmed unresolved production blocker requiring a separate repair before candidate selection.** Smallest coherent chunk: same-profile AppImage/installed-`.deb` reproduction with report-only hang capture, causal attribution and bounded recovery/repair; owner DON-247; complexity 9/10; recommended model Luna x-high. |
| Merged P1/P2 groups above, including `AUD-11`, WAR-06 and WAR-04 settings/privacy | Current master contains the named scoped repairs. No checks were executed for this triage; source inspection only found no new current-head production failure beyond the triage blockers above. Exact beta13 bytes, package, scale, field and human-acceptance evidence remain absent. | **Repaired boundary awaiting exact-candidate qualification.** Do not call these findings closed from PR merge or from the dry run. |
| WAR-01: silent evidence loss; false `Complete`/`100%`; corrupted evidence; unbounded mission-scale main work | The merged controls and negative tests provide bounded repair evidence, but the required packaged fault, exact-scale, archive/restore, interruption, field and strict-responsiveness proof has not run on beta13. No new current-head data-loss, false-completeness, corruption or main-stall reproduction was created by this triage. | **Repaired boundary awaiting exact-candidate qualification.** These remain `open-blocking` qualification gates after candidate selection; they are not evidence that a test candidate is already qualified. |
| Other unscored `unenforced-invariant` rows (`MAP-001`, `EVD-003`, `PKG-002`, `REL-001`, `REL-002`, `REL-004` and `OPS-001`) | The bounded source/record inspection found control gaps, not a new confirmed current-head production failure beyond the three blockers above. Existing owners, warnings and exact qualification requirements remain authoritative. | **Lower-severity/post-beta hardening with rationale.** Retain explicit owners and qualification/field gates; do not describe these as cleared or silently use them to waive a mandatory receipt. |
| `GEO-001` (`evidence-tier-gap`) | The bounded source/record inspection found a coordinate transform/parser/format evidence gap, not a new confirmed current-head production failure beyond the three blockers above. Existing owners and exact qualification requirements remain authoritative. | **Lower-severity/post-beta hardening with rationale.** Retain the `DON-238`/`DON-6` evidence boundary; do not describe the gap as cleared or silently use it to waive a mandatory receipt. |

### WAR-01 absolute blockers

All five remain `open-blocking`; no policy-valid deferral has been granted:

1. **Delayed or hidden current position** (`TRK-001`, with `DON-267`/
   `DON-179`/`DON-250`/`DON-241`): merged polling/reconnect and scoped tracking
   repairs exist, but startup, reload, pause/recovery, freshness and final
   candidate proof remain incomplete.
2. **Silent evidence loss** (`EVD-004`, `PST-001`/`PST-002`,
   `DON-268`/`DON-249`/`DON-250`): fault controls and tests exist, but no
   complete packaged EIO/ENOSPC, abrupt-death, power-loss-equivalent or field
   proof exists for the candidate.
3. **False Complete or 100%** (`RPL-001`, `MIS-003`, `DON-276`/`DON-271`):
   participant and coverage repairs are merged, but exact beta13 960k/2M and
   full no-skip lifecycle proof has not run.
4. **Corrupted evidence** (`EVD-001`/`EVD-005`, `RPL-003`/`RPL-004`, archive
   owners): source identity, archive and recovery controls are merged, but
   final restore/replay, power-loss, cross-machine and field proof has not run.
5. **Unbounded mission-scale work on Electron main** (`IPC-003`,
   `PST-003`/`PST-004`/`PST-005`, `DON-249`/`DON-250`/`DON-251`): worker and
   bounded-path controls exist, but exact field-scale proof and the unchanged
   strict `<200 ms` gate remain unresolved.

The hazard register is the row-level authority; this overlay records the
current release disposition and does not rewrite its historical receipts.

### Unexecuted WAR investigations

`WAR-03`, `WAR-07`, `WAR-08`, `WAR-09` and `WAR-10` are each **not covered /
superseded, insufficient evidence**. The repository has no current bounded
investigation receipt or authoritative issue disposition for these slices.
Existing coordinate golden tests and unrelated repair evidence are partial
signals only and do not clear WAR-03. They are retained as post-beta hardening
charters rather than blanket prerequisites to selecting a test candidate. A
concrete P1/P2, absolute blocker, silent evidence loss, corrupted evidence,
false completeness, hidden/delayed current position, privacy breach or unsafe
main-process stall found in one of these scopes remains promotion-blocking and
requires a separate repair PR.

### Recovered WAR-03/07/08/09/10 launch charters

The following is a recovery of the original programme scopes, not a new WAR
programme and not execution evidence. It was reconstructed from the current
row-level hazards in [`hazard-register.md`](hazard-register.md), the active
queue in [`two-track-execution-workplan.md`](../two-track-execution-workplan.md),
and the exact prior coordinator task history `01a052c8-a981-7793-bbee-d146aaff9e4d`
(2026-08-30), with the whole-application resilience source also retained in
tasks `01a04c34-db62-7681-a4fa-eadf9481e90a` and
`01a04c2e-166e-7122-9aab-fb2897a9f1ec`. The task records are provenance for
scope recovery only. These app task IDs are not repository-backed and may not be
retrievable by a future agent; the repository-backed hazard register and live
Linear issue state remain the acceptance authorities.

All five launches are analysis-first and read-only. They may produce a ledger,
reproduction, test-plan or separately authorised test-tooling PR, but they do
not silently repair production code, change the hazard register to “cleared”,
or turn local/CI/packaged evidence into field, human-acceptance or production
proof. A confirmed P1/P2, absolute blocker, silent evidence loss, corrupted
evidence, false completeness claim, or unsafe main-process stall stops the lane
and gets a separate repair PR. This charter records no architecture exception;
any future Donal decision must be explicit, named and separately recorded.

#### WAR-03 — coordinate and geodesy proof

- **Original objective:** harden proof around WGS84↔ITM↔TM65 round trips across
  the Irish envelope and named tolerances; Irish Grid parse/format identities
  and square-boundary behavior; nonfinite and out-of-range rejection at every
  public coordinate boundary; declination direction/sign, bearings, distance,
  LPB geometry, and bounded fuzzing of accepted coordinate text without
  redefining product formats.
- **Safety invariants and hazards:** `GEO-001` must preserve EPSG:2157 and
  corrected EPSG:1641 negative-Y datum semantics, keep TM65 display-only, and
  reject NaN/Infinity/out-of-range input. `GEO-002` must preserve true↔magnetic
  declination (`-4.5°` true to magnetic), reject invalid coordinates/bearings/
  radii/distances/segments, and keep geodesic measurement behavior.
- **Boundary with current triage:** the finite/range public-input and bounded-
  segment repair for `GEO-002` is separately tracked above as a pre-candidate
  blocker, not deferred into this WAR-03 charter. WAR-03 retains the residual
  post-beta proof: WGS84↔ITM↔TM65 round-trips, Irish Grid parse/format and
  square-boundary behavior, declination direction/sign, and geodesic/fuzzing
  evidence not closed by that repair.
- **Production ownership:** `src/lib/coordinates.ts`,
  `src/features/coordinates/coordinate-tool.ts`,
  `src/features/drawings/drawing-math.ts`, and
  `src/features/measurements/start-measurement-runtime.ts`; existing unit and
  coordinate-converter/measurement E2E suites are the first test seams.
- **Red and negative controls:** property-based round trips and boundary
  tolerances; parser fuzzing within the accepted grammar; square-boundary and
  sign-reversal cases; explicit NaN, Infinity, range, bearing, radius,
  distance, and segment rejection; counterexamples must retain the input,
  expected invariant and exact implementation head.
- **Completion/disposition:** a test-first hardening PR plus updated hazard
  dispositions only if implementation is separately authorised; otherwise a
  read-only evidence ledger with every counterexample and residual gap. Any
  changed coordinate behavior is escalated before repair; no UI redesign or
  parity claim is in scope.
- **Complexity/model:** `5/10`; recommended `GPT-5.6 Sol`, medium reasoning.
  Independent transform/parser/geometry lanes are safe to parallelise after
  the analysis boundary.
- **Overlap:** shares coordinate contracts with no other WAR lane; do not absorb
  unrelated measurement UI or release qualification. Source: coordinator task
  `01a052c8-a981-7793-bbee-d146aaff9e4d`, charter row “Coordinate and geodesy
  proof”, cross-checked against `GEO-001`/`GEO-002`.

#### WAR-07 — Electron shell and IPC audit

- **Original objective:** inventory every preload/main IPC channel and worker
  runner for payload bounds, mission scope, generation ownership, sender trust,
  and main-isolate cost; attack renderer reload/close/crash, app quit, second
  instance and stale worker replies; instrument and attribute or bound the
  retained PR4 timing outlier; revalidate after archive IPC landed.
- **Safety invariants and hazards:** `IPC-001` requires exact sender
  validation, fixed bounded preload channels, context isolation/sandbox,
  navigation/new-window denial, renderer-scoped cancellation and no raw GPX
  bytes in the renderer. `IPC-002` requires singleton and durable unclean
  state before relaunch, an awaited renderer drain, an unexpected-loss fence
  and fail-visible recovery. `IPC-003` requires size-dependent work to be
  cancellable, timeout-bounded, bounded in shape, writer-prioritised and
  joined when poisoned, without blocking Electron main.
- **Production ownership:** `electron/main.cjs`, `electron/preload.cjs`,
  `electron/coverage-ipc.cjs`, `electron/breadcrumb-query-ipc.cjs`,
  `electron/mission-review-read-query-ipc.cjs`,
  `electron/mission-replay-query-ipc.cjs`,
  `electron/outing-fix-summary-ipc.cjs`, `electron/gpx-renderer-boundary.cjs`,
  `electron/file-system.cjs`, `electron/mission-archive-ipc.cjs`,
  `electron/archive-review-ipc.cjs`, and
  `electron/renderer-teardown-coordinator.cjs`; worker/main seams are the
  breadcrumb line/dot runners and workers, coverage query/tile runners and
  workers, outing-summary runner/worker, mission-review runner/worker,
  `electron/gpx-evidence-import-runner.cjs`,
  `electron/gpx-evidence-import-worker.cjs`,
  `electron/legacy-evidence-backfill-runner.cjs`,
  `electron/legacy-evidence-backfill-worker.cjs`,
  `electron/mission-replay-runner.cjs`, `electron/mission-replay-worker.cjs`,
  `electron/search-operations-page-runner.cjs`,
  `electron/search-operations-page-worker.cjs`,
  `electron/mission-replay-query-ipc.cjs`,
  `electron/mission-store.cjs`, and
  `src/features/runtime/install-app-runtime-teardown.ts`.
- **Red and negative controls:** malicious or wrong sender; malformed,
  over-sized, path-like or secret-bearing payload; held renderer drain;
  reload/close/quit/crash/duplicate launch; stale generation reply; worker that
  never exits; response over bound; main-loop timing outlier; and archive-IPC
  revalidation. Retain the original timing receipt even if a later rerun
  passes.
- **Completion/disposition:** an IPC surface inventory, attack ledger,
  lifecycle result and residual-risk statement. This is an investigation, not
  a repair. Any P1/P2 or absolute blocker gets a separate repair PR. No
  exhaustive inventory or scale proof may be claimed from the existing T1–T4
  receipts alone.
- **Complexity/model:** `8/10`; recommended `GPT-5.6 Sol`, high reasoning.
  Independent IPC, worker and shell lanes are safe to parallelise only when
  the final ownership ledger has one root owner per channel.
- **Overlap:** `IPC-003` touches the store/worker boundary also audited by
  WAR-10; GPX renderer boundary touches WAR-08. WAR-07 owns trust, lifecycle
  and main-isolate attribution; it must not absorb evidence-fidelity or
  persistence remediation. Source: coordinator task
  `01a052c8-a981-7793-bbee-d146aaff9e4d`, charter row “Electron shell and IPC
  audit”, cross-checked against `IPC-001`–`IPC-003`.

#### WAR-08 — operator-evidence surfaces audit

- **Original objective:** audit markers, clues, casualties, drawings/search
  areas, layers/visibility, helicopters, GPX consumers and measurement
  surfaces. Prove that stored coordinate/evidence identity is what map, review,
  export and operator workflows present within declared tolerance; make hiding
  an explicit display choice that never mutates or implies deletion; use focused
  Playwright/visual checks where DOM assertions are insufficient. UI taste and
  the final QGIS parity decision are out of scope.
- **Safety invariants and hazards:** `EVD-001` requires persisted WGS84
  coordinates, stable IDs/types/revisions and fields to remain equal across
  shaping, rendering, selection, filtering and review. `EVD-002` requires
  deterministic, inspectable scope-bound visibility with omitted/static state
  disclosed and no mutation. `EVD-003` is a separately owned persistent
  map-health warning gap under `DON-264`, not silently absorbed. `EVD-005`
  requires immutable, collision-safe attachment identity and archive inclusion.
  `RPL-005` is an adjacent search-pass/outcome identity seam.
- **Production ownership:** marker and helicopter runtime/GeoJSON shaping;
  GPX parser/read/start/renderer boundary; layer effective visibility, map
  filters and overlays; evidence-version/store/review/replay tabs;
  `electron/file-system.cjs`, attachment store, archive attachment review,
  drawing persistence and search operations only where the surface is being
  compared.
- **Red and negative controls:** source-vs-map/review/export mismatches;
  hide/show/filter toggles preserving database records; duplicate/colliding or
  mutated attachments; out-of-order/revised/undated GPX points; failed
  persistent overlay sync; and screenshot/visual checks of the actual operator
  surface. A console-only `EVD-003` failure remains a finding, not a pass.
- **Completion/disposition:** an evidence ledger with each surface and hazard
  explicitly dispositioned. A bounded low-risk repair requires its own PR;
  deeper findings go to the next repair train. No QGIS parity, visual taste or
  packaged/field closure may be inferred from a local browser pass.
- **Complexity/model:** `6/10`; recommended `GPT-5.6 Sol`, high reasoning.
  Separate markers/layers/drawings/GPX/helicopter lanes can be parallelised
  after the source-of-truth contract is fixed.
- **Overlap:** WAR-07 retains IPC trust/lifecycle ownership; WAR-09 owns the
  independent truth oracle; WAR-10 owns persistence/migration/recovery. WAR-08
  may consume their receipts but must not duplicate their implementation.
  Source: coordinator task `01a052c8-a981-7793-bbee-d146aaff9e4d`, charter row
  “Operator-evidence surfaces audit”, cross-checked against `EVD-001`–`EVD-003`,
  `EVD-005` and `RPL-005`.

#### WAR-09 — independent mission-truth oracle

- **Original objective:** provide an independent verifier from source/GPX or
  provider evidence through SQLite to claims. It must compare identities,
  `fixTime`, coordinates, rejection decisions, counts, watermarks and
  completeness without importing production read models or repairing data.
  Seed deleted, duplicated, retimed and inflated-watermark faults and prove the
  oracle fails; post-soak/replay/restore checks are useful extensions, while
  the current pre-candidate queue does not permit silently deferring the lane.
- **Safety invariants and hazards:** `RPL-001` must prevent false Complete or
  100% claims when selected revisions, fresh renderer delivery, ledger
  acceptance, evidence health or worker completion are absent. `RPL-002` must
  keep replay historical, versioned and time-bounded. `RPL-004` must detect
  incomplete/corrupt/mutable/inaccessible archives and restore failures.
  `RPL-005`, `MIS-003`, `EVD-001` and `EVD-004` are input-contract seams where
  the oracle must expose loss or incompleteness rather than repair it.
- **Production ownership:** read-only copies or schema-only independent
  queries over `electron/mission-store.cjs` output; source/GPX fixture loaders;
  coverage/progress/ledger, replay/search and archive-review claims. The oracle
  must not become another production read model or write path.
- **Red and negative controls:** missing, duplicate, retimed and wrong-identity
  source records; coordinate and `fixTime` mismatch; inflated watermark;
  incomplete participant/evidence counts; corrupt or truncated archive/restore;
  and seeded stale-generation claims. Assert deterministic fail-closed verdicts
  and retain fixed-cost comparison/digest evidence.
- **Completion/disposition:** analysis ledger first. An oracle implementation,
  seeded-fault suite or tooling PR needs its own explicit test-tooling change;
  it cannot be smuggled into this documentation PR. Completion is a tool
  receipt plus seeded-fault proof and a disposition for each consumed hazard;
  the tool never auto-repairs.
- **Complexity/model:** `7/10`; recommended `GPT-5.6 Sol`, high reasoning.
  Ultra-depth is conditional because one root owner must control oracle
  semantics and verdicts.
- **Overlap:** consumes WAR-08 surface contracts and WAR-10 persistence/archive
  shape; serialize semantic decisions with both, while fixture/query work can
  be prepared independently. Source: coordinator task
  `01a052c8-a981-7793-bbee-d146aaff9e4d`, charter row “Independent mission-truth
  oracle”, cross-checked against `RPL-001`, `RPL-002`, `RPL-004`, `RPL-005`,
  `MIS-003`, `EVD-001` and `EVD-004`.

#### WAR-10 — persistence, migration and recovery audit

- **Original objective:** after archive/finalization shape landed and alongside
  the WAR-07 dependency, attack transaction/crash atomicity, WAL/checkpoint,
  backups, every supported migration, interrupted migration, newer-schema
  refusal, retention and growth budgets. Reconcile `DON-249`, `DON-250` and
  `DON-251` without duplicate work. No schema redesign, multi-GB `VACUUM` or
  archive-format change belongs in the audit. A structural mission-store
  finding stops for coordinator/Fable/Donal architecture planning.
- **Safety invariants and hazards:** `PST-001` requires atomic WAL writes,
  transactional preserving migrations and unchanged refusal of newer schemas.
  `PST-002` requires serialised off-main backup, fixed-cost validation, unique
  temp plus atomic rename, prior-mirror retention and surfaced failure.
  `PST-003` requires cancellable/off-main integrity checks that do not re-freeze
  main. `PST-004` requires explicit growth/retention/archive/recovery budgets
  without silent purge. `PST-005` requires bounded, resumable oversized-store
  startup without discarding originals. `MIS-001`, `RPL-004` and `IPC-003` are
  lifecycle, archive and worker-boundary cross-checks.
- **Production ownership:** `electron/main.cjs`,
  `electron/mission-store.cjs`, SQLite backup runner/worker/snapshot sanity,
  autosave status, migration/backfill code, mission finalization/archive and
  review/outing query runners.
- **Red and negative controls:** interruption between sync/rename; WAL
  reader/writer/checkpoint contention; EIO/ENOSPC and failed backup validation;
  every supported migration and newer-schema refusal with byte preservation;
  growth slopes, latency and startup held-gate tests; oversized legacy store;
  close/recovery and archive restore. Run on copies and never destructively
  alter the source profile.
- **Completion/disposition:** migration matrix, fault ledger and explicit
  hazard/Linear dispositions. No repair is hidden in this audit. A structural
  store finding is blocked for Donal/architecture planning; an ordinary P1/P2
  becomes a separate WAR-11 repair PR. No production or field closure follows
  from a unit-only or one-package result.
- **Complexity/model:** `9/10`; recommended `GPT-5.6 Sol`, extra-high
  reasoning. Migration, WAL, backup and recovery lanes may be parallelised only
  on isolated copies with one owner for the final disposition.
- **Overlap:** depends on WAR-07’s main/worker inventory and shares archive
  claims with WAR-09; it owns persistence truth, not IPC trust or oracle
  semantics. Source: coordinator task `01a052c8-a981-7793-bbee-d146aaff9e4d`,
  charter row “Persistence, migration and recovery audit”, cross-checked
  against `PST-001`–`PST-005`, `MIS-001`, `RPL-004` and `IPC-003`.

#### Launch order and safe-parallelism matrix

The safe default is: **WAR-03 first; WAR-07 and WAR-08 in parallel after their
analysis boundaries are agreed; WAR-09 after WAR-08’s source/evidence contract
is frozen; WAR-10 after WAR-07 and its archive/persistence boundary is explicit.**
WAR-03 can run beside either lane because its production ownership is disjoint.
WAR-07 and WAR-08 can run together only if WAR-08 excludes IPC trust/lifecycle
implementation and both record the GPX boundary explicitly. WAR-09 and WAR-10
may prepare read-only fixtures/copies in parallel, but semantic verdicts and
shared archive claims are serialised. No lane may modify the same production
file or claim another lane’s evidence.

| Pair / sequence | Safe? | Boundary |
| --- | --- | --- |
| WAR-03 with WAR-07 or WAR-08 | Yes | Coordinates/geometry are disjoint from shell, IPC and evidence-surface ownership. |
| WAR-07 with WAR-08 | Conditional | Separate IPC trust/lifecycle from evidence fidelity; name GPX renderer ownership before launch. |
| WAR-08 then WAR-09 | Yes, ordered | Freeze the stored/displayed evidence contract before oracle semantics. |
| WAR-07 then WAR-10 | Yes, ordered | WAR-10 needs the current worker/main and teardown inventory. |
| WAR-09 with WAR-10 | Read-only preparation only | Isolate DB copies; serialise archive/completeness verdicts and any implementation. |

The launch packets must name the assigned owner, exact source head, read-only
inputs, stop condition, retained red receipts, and next disposition before work
starts. This section restores the charter; it does not authorise BCP-17/WAR-12,
a release, a freeze, or any product-code change.

### Candidate-selection decision

Test-candidate selection is **BLOCKED / not declared** by the current-head
triage's three concrete production/operational blockers: `TRK-001`, `GEO-002`
and `PKG-001`. Each requires a separate bounded repair before selection. No
Donal architecture decision authorising selection with an unrepaired blocker
has been made in this record; a future exception would need a separate,
explicit decision naming the blocker, selection consequence, qualification and
promotion prohibition, and approving authority. This is distinct from
qualification HOLD: the five WAR-01 absolute blockers, exact-candidate evidence, the dry-run's
`releaseEligible: false`, open `DON-247` original-machine qualification and the
absence of beta13 artifact/fixture hashes remain qualification/promotion gates
after a candidate is selected. WAR-03/WAR-07/WAR-08/WAR-09/WAR-10 are not
blanket pre-candidate gates, but concrete findings in their scopes remain
promotion-blocking. The merge-ready procedure, including
`reconciliationMergeSha`, version, artifact names, Linux matrix, rollback and
fail-closed stop conditions, remains in the [two-track workplan](../two-track-execution-workplan.md).

## Historical post-PR32 coordinated disposition — 2026-09-17

`origin/master` is `67300313ab2bc800f9522f54e8de443fcb97fcae`, the merge of
PR33. The bounded WAR-11 settings/privacy repair is active from that exact
baseline. Release, deployment, BCP-17/WAR-12, official-map distribution, field
and human acceptance remain HOLD.

The original deep-audit ledger now has thirteen of fourteen confirmed groups
repaired and merged. `AUD-12` is the only unrepaired original group and remains
a P3 alias-clearing UI/store defect. Repair Trains C and D, including
`AUD-04`, `AUD-06`, `AUD-08`, `AUD-09` and the WAR-11 offline-map repair for
`AUD-11`, are merged; the historical rows and failed receipts below remain
evidence, not current open-PR state.

WAR-04 contributes six confirmed production-repair inputs:
`WAR04-SET-01..03` (credential/bootstrap and atomic settings consistency) and
`WAR04-PRV-01..03` (diagnostics/support-output privacy and recursive
allow-listing). A bounded WAR-11 candidate now takes all six joined probes from
red to green and adds ordinary regressions; exact-head review, CI and merge are
still required. See
[the repair record](findings/war-11-settings-privacy-repair.md). WAR-03
coordinate/geodesy proof may run beside it because its test ownership is
disjoint. The team map administration/distribution lane
(`DON-144`/`DON-7`/`DON-76`) must not be implemented in parallel with that
Settings train until exact overlap is checked.

Remaining team requirements are `DON-144`/`DON-7`/`DON-76`, `DON-214`,
`DON-216`–`DON-221`, `DON-100`, and the later Marker Details simplification.
Remaining unexecuted WAR slices are WAR-03, WAR-07, WAR-08, WAR-09 and WAR-10;
WAR-05 is external-machine dependent, WAR-12 is final-candidate qualification,
and WAR-13B is post-publication field execution. Live Linear reconciliation on
2026-09-17 reopened `DON-254` In Progress because the BCP-17 completion contract
remains unmet; a Linear comment binds PR32's scoped evidence and the remaining
final-candidate, machine, field and publication gaps. `DON-271` and `DON-279`
remain Done; `DON-7`/`DON-76` and `DON-247` are In Progress; `DON-144` is Todo.

The canonical workplan now contains the locked route to the next team beta:
reconcile the baseline, repair the six settings/privacy findings, reconcile and
dry-run the model-judged qualification control plane, disposition remaining
assurance findings, freeze one candidate, execute BCP-17/WAR-12 on its exact CI
artifact, confirm that same artifact on the original machine, then publish it
through `DON-255`. The map raw-source administration workflow, `AUD-12` and
lower-severity retained UI work do not block this beta unless new evidence
changes their severity. No separate release queue is created here.

## Historical merged disposition

2026-09-14 exact-master Train D follow-up: origin/master is
`6abde36e1e293f8731784fe3fab293f11ce5e7eb` with tree
`302e684ec4c60ad66a0afb45898e2a552e3cf974`. Manual workflow `34860711436`
reproduced AUD-08's renderer/native projection split: persisted participant
truth was 1/2 while the renderer displayed 2/2. The repair adds a bounded
tracking-to-participant refresh callback, covered by a red/green runtime
regression. Local repaired packaged evidence records AUD-08 and AUD-09 pass;
restart is not proven because the existing diagnostic custody gate rejected
deliberate provider-503/retry and close-time transport warnings. This historical
note predates the current PR32 blocker-remediation pass, which deliberately
changes the Train D diagnostic classifiers while retaining the global
fail-closed gate and strict responsiveness threshold. Exact-head CI and review
are required before any merge decision. PR32's exact-head run `34866228521`
passed through replay and the pre-packaged controls, then failed at the
unrelated packaged native-runtime diagnostic gate on two launch-time Vulkan
stderr entries; Train D was skipped and remains not proven in Linux CI.

Latest required manual Train D run `34877445512` is exact-head clean at
`9bd9adc9d38ee573a152ee42c57c13b8da04c803` / tree
`fc107e851cc07dc9ee3b7b2c475dee862025e7f8`. All three packaged scenarios pass
(`AUD-08`, `AUD-09`, restart), but the receipt is failed because the diagnostic
gate rejects one expected restart teardown-cancellation warning and the two
known Linux Electron Vulkan startup stderr entries. Classify this as a bounded
harness/environment diagnostic boundary, not a product scenario failure; retain
the exact receipt and keep Train D packaged qualification, merge and release
**NOT_PROVEN/HOLD**. No gate was relaxed.

The follow-up manual run `34902500983` ran on exact clean PR32 head
`51e5a7eb6a05fc75bc6382c73cf7245da9dfa364` / tree
`b48c51919a499d15129b64f5c79ecb428dd0da45`. It passed strict `<200 ms`,
AUD-08, AUD-09, restart, `scenarioResult`, `diagnosticResult`, the independent
receipt validator, and the receipt records `diagnosticBlockers=[]` / `result=pass`.
The overall workflow failed later at the unchanged packaged archive-lifecycle
continuity gate: `current_fix_continuity_gate_breached`, measured cleanup gap
205 ms. Retain the exact failure JSON under
`/tmp/sar-train-d-ci-34902500983-9FmgLG`; this is an independent liveness
blocker, not a Train D product failure or permission to change the strict gate.
At that historical stage, PR32 remained draft/open and merge/release
**NOT_READY/HOLD**; the current scoped merge disposition is recorded below.

## Current PR32 merge disposition — 2026-09-17

PR32 is **merge-ready within the scoped repair boundary** on validated
implementation head `58ea29005b17a34e69f52ad44966a42f9c63d0aa` / tree
`c890c1fd2f713a195b2ec56132e4ac6c7b38e954`. Required manual workflow
`35177287167` passed the strict source, rendered, packaged, Train D receipt,
tracking-soak and archive-lifecycle boundaries; the exact clean receipt reports
`result=pass`, AUD-08/AUD-09/restart pass, `diagnosticResult=pass`, and no
blockers or failures. Ordinary PR workflow `35179847412` also passed. The
documentation-only descendants after the qualified implementation head do not
invalidate this evidence under the testing-and-review cadence, and no
executable, test or configuration input changed.

Release, deployment, BCP-17, final-candidate, installer/field and human
acceptance remain HOLD. The historical macOS unpaired
`coverage-revision-moved` diagnostic remains retained and unallowlisted. Donal
owns the merge decision; this ledger does not authorize an automatic merge.

2026-09-14 native follow-up: PR30 is merged at `58c65641` after PR27/PR28.
PR31 is rebased onto it. Claude review superseded earlier readiness and green
CI34845492157. The [review disposition](findings/pr31-claude-review.md) records
repaired snapshot progress, lifecycle fanout, worker bounds/join and stderr
custody, with 5,045 source tests, seven browser flows and rebuilt macOS native
control passing locally. Fresh exact-head checks control readiness.
DON-254's [native-runtime repair](findings/native-runtime-repair.md)
owns the four retained diagnostic/runtime rows below, including proved physical
worker-exit custody on cancellation. The original source/native proof and reviews
are retained; all 82 focused native tests pass after the documentation-only conflict
resolution, and range-diff preserves the runtime patch. Historical
failures remain retained, DON-254 stays In Progress, and release remains HOLD.
The older PR28-active paragraphs are superseded only as to merge state.

Current baseline is `2ab581e0acfa7e0e4be587ea0064e19bea4a7ee3`: Donal merged
[PR27](https://github.com/donal0c/sartracker-web/pull/27) on 2026-09-14, after
PR25/PR26. DON-267 is Done; DON-254 remains In Progress and release HOLD.
Train D's AUD-08 / DON-271 and AUD-09 / DON-279 implementation is integrated.
Its [record](findings/repair-train-d.md) and review disposition retain earlier
source/browser proof and failed native attempt. Packaged qualification remains
deferred, not passing. PR28 map work is rebased onto this master and awaits
affected integration CI/review. The strict <200 ms gate and final-candidate
qualification remain separate. Earlier open-PR/status statements below are
historical receipts, superseded by this reconciliation.

Separate follow-up candidate: the DON-229, DON-228 and large hosted history
settings browser tests fail on both WAR-11's clean `2b2bf8e` baseline and D's
working tree. D evidence: `/tmp/sar-train-d-preexisting-settings.log` and
`test-results/train-d-preexisting-settings`; WAR-11 baseline evidence:
`tmp/war-11/browser-baseline` in its worktree, output digest
`fe6e6d4113f8d81ed7cada2d4d126316ac41eac5f7d4a758b9ad226515dd3636`.
Investigate missing durable history persistence in the browser harness as a
bounded follow-up; this is not part of either current repair or a green full
browser/release claim. [Observed assertions](findings/repair-train-d.md).

Train D packaged attempt 1 also retains separate diagnostic candidates:
unconditional service-worker registration under `file://`, per-request coverage
IPC lifecycle listener accumulation, and a coverage cardinality/snapshot race.
The relevant standalone files match `2b2bf8e`; coverage sections in
`mission-store.cjs` are unchanged. Source-only reproduction reads `maxChunks=1`,
adds an outing before the worker reads, and obtains the exact enumeration
rejection for two valid chunks; a fresh same-state `maxChunks=2` control passes.
Logs: `/tmp/sar-train-d-coverage-worker-red.log` and
`/tmp/sar-train-d-coverage-worker-green.log`.
These diagnostics are not allowlisted or accepted. Attempt 1 remains failed,
including capture overflow whose missing entries cannot be classified later.
Native proof and PR readiness remain open; see the Train D record and receipt.

| Retained diagnostic / owner | Exact source and provenance | Impact and next bounded action |
| --- | --- | --- |
| High-priority coverage result-bound race; DON-254 coverage worker follow-up | `mission-store.cjs:3549` reads limits before the worker snapshot; `coverage-query-result-attestation.cjs:63` computes cardinality; `coverage-query-result-envelope.cjs:395` rejects two valid chunks against an earlier limit of one. Coverage files match clean master `2b2bf8e`; changed mission-store coverage blocks are unchanged. Native signature: `Coverage enumeration result is invalid: item list is invalid.` | Fail-closed coverage failure, not false completion; timing race reproduced source-only with a fresh-state passing control. Evaluate a stable bounded envelope with inventory/change-sequence validation, or one consistent metadata snapshot. Do not allowlist or expand Train D scope. |
| Packaged service-worker registration; DON-254 packaging/runtime follow-up | `src/lib/register-service-worker.ts:9` registers `/sw.js` under `file://`, producing the exact `Service worker registration failed` warning naming `file:///sw.js`; this file and `public/sw.js` match clean master. | Caught startup registration failure. No claim that separate native offline-map paths fail. Gate remains unclean; restrict registration to supported web contexts in a separately tested repair. |
| Coverage request listener pressure; DON-254 runtime/lifecycle follow-up | `electron/coverage-ipc.cjs:228` attaches `destroyed`/`render-process-gone` listeners per in-flight request and removes them in `finally`; file matches clean master. Exact signatures report 11 listeners on each event. | Concurrent listener pressure is proven; a persistent leak is not. Review shared owner cancellation and bounded request concurrency, without raising the warning threshold. |
| Unassigned script-fetch error and teardown cancellation; DON-254 diagnostics follow-up | Generic script-fetch error has empty URL and no timestamp; association with service-worker failure is inference only. AbortError stack matches unchanged coverage runner/IPC cancellation code, after timeout/close in retained ordering. | Preserve unassigned error separately. Cancellation is proven but teardown causality lacks per-entry timing. Capture source/phase/time before further classification. Neither explains the independently confirmed absent-locator timeout. |

`tmp/train-d-native-attempt1/diagnostic-baseline-provenance.json` records exact
baseline/current file hashes; the receipt is a dirty working-source package,
not a clean-master packaged reproduction. The failed run's missing overflowed
entries and absent event timestamps remain explicit evidence limits.

Historical baseline is `deedab27483ad4fe1ca998a4d68afd555f4e2337`: PR24/WAR-02B
is merged after PR23. DON-267 and DON-254 are In Progress in Linear; historical
Done statements below describe previous receipts. Original DON-267 PR1/PR4/PR17
fixes remain merged and valid. Only WAR-06-AUD-01/AUD-02/CACHE-SIBLING are active
under reopened DON-267. The [production repair record](findings/war-06/mission-scope-repair.md)
owns their new red/green evidence; the investigation report remains historical proof.
Claude's review of PR26 at `7fc4aa08` withdrew the earlier readiness verdict.
The [remediation record](findings/war-06/claude-review-remediation.md) now owns
cache/live merge, truthful status, retained cache health and actual timer mutation
proof. Earlier review/test receipts below are historical, not current acceptance.
Two parallel streams have disjoint production ownership: mission-scope tracking/cache
on `codex/don-267-war06-mission-scope-repair`, and separate legacy recovery on
`codex/don-254-legacy-recovery-responsiveness`. Intended merge order is DON-267,
then DON-254 reconciled onto that master. Donal owns merge. Release HOLD and all
retained strict 200 ms failures remain; qualification is later on the combined candidate.

PR22, PR20, diagnostic-only PR21, PR19, and PR23 are merged. PR19 merged at
`d20bae5fd8156a61e92a9b8fd68c87b2ca614a37` after reconciliation against
`f4d1f3214ddc82b0df043c85a340b3872ba90a80`. It retains the independent
PR22 main-event-loop probe, the unchanged strict `<200 ms` release predicates,
and every historical timing failure; its richer realm/pressure/pointer
evidence cannot qualify or exonerate the application. Local focused/full
correctness checks, lint/build/bundle budgets, and three real Electron controls
pass for PR21; CI `34683600517` and independent review cleared that candidate.
PR19’s ordinary CI and four final accumulated-diff reviews are complete. Its
[repair record](findings/repair-train-b.md) separates historical and current
proof. DON-254 remains the final-candidate qualification owner and was reopened
In Progress on 2026-09-13; qualification remains incomplete and release remains HOLD.
PR23 is merged to `origin/master` at
`1fac099a9f581448a5a607a063e2a8b77fa9b151` from final implementation head
`45420208`; its terminal receipt records the bounded lossless transport,
background-throttling, reload-cleanup and inactivity-watchdog repairs. The
[transport receipt](../evidence/breadcrumb-query-transport/receipt.md) and
[PR23 receipt](https://github.com/donal0c/sartracker-web/pull/23) retain its
exact-head proof and historical limits. Follow-up B, the separate ~239 ms
legacy recovery path, and unchanged strict `<200 ms` qualification remain
outstanding. Follow-up B's [current evidence](findings/legacy-object-recovery-responsiveness.md)
supports removing synchronous test inspection from the measured thread, with
production unchanged. Claude remediation uses real worker completion/exit and
post-timing persisted-data checks, closes final-tail and mutation-custody gaps,
and removes the auxiliary inspector protocol. [Disposition](findings/legacy-recovery-claude-remediation.md).
Its final
source cycle passes; the PR terminal receipt binds CI. WAR-06 PR26 merged at
`8f93f8d1`; PR25 is reconciled onto it, with both packaged CI checks retained.
The [second review follow-up](findings/legacy-recovery-review-followup.md) adds
complete evidence custody, real-store audit contract controls, GPX observer
isolation, separate native timers and an independently checked CI report.
It supersedes the c93b6925 READY verdict until the new terminal receipt.
The unresolved 204 ms concurrent read remains an explicit qualification gap.
The combined-head PR receipt controls readiness; frozen-candidate qualification follows. No release
acceptance is claimed. Older Done labels below are historical receipts,
superseded by DON-254's reopening.

## Deep-audit finding disposition

Repair Train A PR #17 merged at `302bdd040976bd370271cf5866549fa2a7e05ff5`;
its application head is `713461bf`.
Four exact-head reviews, local 427/4,377, native omission/custody and Linux CI
`34496976736` attempt 2 pass. Archive maximum is 193 ms. Attempt 1's 224 ms
failure remains unexplained; soak renderer 499.9 ms and external action 374.58 ms
remain DON-254 qualification evidence. No reliable strict-200 or release claim.
See [current disposition](findings/repair-train-a-remediation.md).
The [repair record](findings/repair-train-a.md)
holds before/after evidence, accepted review repairs and rejected runs. Existing
DON-267/DON-269 own the work; DON-254 retains final-candidate qualification.
WAR-02A and every other train remain separate. These rows are not closed by
implementation alone.

| Finding | Priority | Current disposition | Coordinated owner / timing | Required proof before closure |
| --- | --- | --- | --- | --- |
| `AUD-07` hidden evidence remains selectable | P2 | **Merged in PR #15 at `083f5047`** | DON-215 / Team Feedback Batch 2; fix `42f9f305`, integrated executable `e60dc43e` | Required hit-test visibility and per-object replay limitations; red/green, rendered interaction and bounded review proof in [batch evidence](../ui-feedback-batch-2-evidence.md); final Linux CI `34462624720` passed |
| `AUD-14` failed history retrieval coexists with “All mission history shown” | P2 | **Merged in PR #15 at `083f5047`** | DON-215 / Team Feedback Batch 2; fix `42f9f305`, integrated executable `e60dc43e`; authorized durable request-target extension | Structured completeness survives empty failures, deselection, pause and restart; red/green, packaged restart/pause and bounded review proof in [batch evidence](../ui-feedback-batch-2-evidence.md); final Linux CI `34462624720` passed |
| `AUD-13` overlapping reloads can stop tracking while Live remains shown | P1 | **Merged in PR #17 at `302bdd04`; WAR-06 recheck active** | `DON-267` Done / `DON-254`; application `713461bf` | Native reconnect/current continuity, retryable cleanup, admission and accepted-fix/rejection SQLite custody pass; four reviews and matching Linux CI pass. [Remediation](findings/repair-train-a-remediation.md) |
| `AUD-02` out-and-back route falsely appears stationary | P2 | **Merged in PR #17 at `302bdd04`; WAR-06 recheck active** | `DON-269` Done; `TRK-004` / `WAR-06`; twenty-minute rule retained | Route, accuracy/jitter, exact elapsed and acknowledgement through noise-return pass; three rendered flows and independent review clear. [Remediation](findings/repair-train-a-remediation.md) |
| `AUD-03` stationary projection broadly rescans mission history | P1 | **Merged in PR #17 at `302bdd04`; WAR-06 recheck active** | `DON-269` Done / `DON-254`; final qualification remains separate | Real interleaved 100×5,000 accumulator bound passes; guarded incremental renderer maximum 78.5 ms <200 with post-operation samples. Cold-load and broader soak outliers remain outside this proof. [Remediation](findings/repair-train-a-remediation.md) |
| `WAR-06-AUD-01`, `WAR-06-AUD-02`, `WAR-06-CACHE-SIBLING` lifecycle/cache boundary | P1 | **Claude findings addressed locally; final-head CI and Donal re-review required** | `DON-267` In Progress; PR26 from `deedab27`; DON-254 owns separate recovery/qualification | Stable local 4,684 tests / 444 files, six existing timing exclusions; focused 254, three browser flows, lint/build and five-launch mac-arm64 cache smoke pass. M1/M3b/M13 and final timer predicate mutants fail the new observable assertions. Same-run Codex reviews are not external approval. Native coverage/listener warnings and earlier baseline browser failures remain recorded. PR26/DON-267 carry final-head CI and Linux terminal receipt; Donal owns merge, release HOLD remains. [Remediation](findings/war-06/claude-review-remediation.md) · [Historical investigation](findings/war-06/WAR-06.md) |
| `AUD-01` legal GPX extension fields overwrite canonical evidence/add a coordinate | P1 | **Merged in PR19 at `d20bae5f`** | `DON-274` Done / `DON-254` Done in Linear; original red/green at `302bdd04`, reconciliation base `f4d1f321` | Canonical source-to-SQLite/replay, exact bytes/digest and native/browser proof in [Train B record](findings/repair-train-b.md); historical saved interpretations remain B-ADJ-01 |
| `AUD-10` native GPX parser drops CDATA values | P2 | **Merged in PR19 at `d20bae5f`** | `DON-274` Done; same parser/source-fidelity contract as `AUD-01` | Browser/native corpus parity, exact persisted/restarted evidence; [Train B record](findings/repair-train-b.md) |
| `AUD-05` ending an outing during successful GPX import leaves stale importing UI | P2 | **Merged in PR19 at `d20bae5f`** | `DON-274` Done / `DON-270` original completed history; generation-owned import settlement, stale-page/error containment | Red/green interleavings, truthful completion and native custody; [Train B record](findings/repair-train-b.md). Late-refresh failure now retains the settled import error |
| `AUD-04` equal map-style writes cause continuous idle redraw | P2 | **Claude-review corrections locally verified; new-head CI required** | `DON-264` / `DON-254`; branch `codex/repair-train-c` from merged PR28 | [Review disposition](findings/pr30-claude-review.md): missing-layer continuation and structural equality red/green; quiet/idle remains 0 writes and 0 renders. [PR checks](https://github.com/donal0c/sartracker-web/pull/30/checks); strict frame-latency qualification remains separate |
| `AUD-06` repeated Go To can be ignored/lose its target during style loading | P2 | **Claude-review corrections locally verified; new-head CI required** | `DON-6` / `DON-254`; same map target/style lifecycle | [Review disposition](findings/pr30-claude-review.md): both camera orderings, bounded request lifetime, teardown and failure/retry verified. Stable source 4,999 tests; six browser cases pass. [PR checks](https://github.com/donal0c/sartracker-web/pull/30/checks) |
| `AUD-11` built-in no-coverage PNG is invalid | P2 | **WAR-11 bounded repair active; not closed** | `DON-7` / `DON-76`; only MAP-01/02/03 + AUD-11, separate from Train C's other rows | Real decoder and synthetic hatch controls pass; packaged attempt 3 proves replacement/readiness and passive removal but final Check View fails. Subsequent negative-result repair has browser/unit proof only; [exact disposition](findings/war-11-offline-map-remediation.md) |
| `AUD-12` Clear Alias retains the alias | P3 | **Repair train C or next bounded UI batch** | `DON-6`; include only if the chosen train already owns the layer catalog, otherwise keep separately queued | Store/controller red/green test and visible cleared state |
| `AUD-08` re-added-group backfill reports complete with a required member pending | P2 | **Repair train D — mission progress/review correctness** | `DON-271` / `DON-254`; align with `MIS-003` and do not weaken Finish refusal | Native participant/backfill regression proving progress cannot lead completion truth |
| `AUD-09` backup invalidates Search Operations pagination and blocks recording | P2 | **Repair train D** | `DON-279` / `DON-254`; Mission Review/pagination lifecycle after Team Feedback Batch 2 | Native backup/page-generation red/green proof and rendered recovery without a full Review reset |

WAR-11 preserves all three failed packaged runs and the original decoder-test crash
whose native cause remains unconfirmed. No fourth native attempt or rebuild is
authorized. Current negative-result repair retains fail-closed output after a
redundant tile failure; view/source/package changes and positive proof still
invalidate. Bare tile-failure events carry no source/package-generation identity;
do not claim event attribution. The final source cycle/review controls scoped PR
readiness; packaged qualification and release remain HOLD. Draft PR28's Linux
CI `34776633574` failed initial map rendering at the wrong camera zoom after
source/build/package/SQLite/GPU checks passed; subsequent packaged gates skipped.
A harness-only style-restoration sequencing correction passes 39 focused tests
and exact-diff review; fresh CI remains required. Preserve its original
10-second readiness deadline and the separate macOS failure evidence;
no further local Electron launch or rebuild is authorized.

Subsequent Linux CI `34779414995` failed passive removal with stale replacement
raster. A real Chromium pending-source reproduction confirmed an independent
MAP-03 defect: global style readiness could starve official-raster eviction.
Structural availability and explicit mutation postconditions repair it without
waiting for other sources. Clean red/green, 23 focused controls, four browser
flows, independent safety review and full 456-file / 4,849-test correctness pass
(six existing qualification skips) are retained. A separately reviewed CI-only
delta gates these flows before packaging. Fresh exact-head CI remains required;
PR28 stays draft and DON-7/DON-76 remain In Progress. Exact native event cause
of that failed run remains unrecorded.

Update 2026-09-14: subsequent pre-rebase CI34783712783 at `e2a31ed6` passed
4,849 tests, four browser flows and the packaged map smoke. Downloaded exact
head/tree-bound evidence showed replacement content, no sampled stale pixels
after removal, final 0/15 missing / Not field ready and clean child exit. Prior
failures remain retained. PR27 is now merged as `2ab581e0`; PR28 is rebased onto
that master and undergoing affected integration verification before fresh CI.
The 41 insufficiently attributed renderer diagnostics and skipped strict/scale/
soak/archive qualifications remain limits; scoped map proof is not release proof.

The audit's additional measured concerns are not silently discarded. Attachment
base64 frame cost, Traccar oversize-response buffering, GPX hit-test cost,
membership-scan growth, repeated-hour Search Pass selection, backup-close join,
pending Search Pass double-submit, async mission-scope races, and the clock
authority for stationary advice remain hypotheses or bounded optimization leads.
The relevant WAR slice must retrace them; only confirmed violations enter a
repair train.

## Coordinated execution order

1. Team Feedback Batch 2 and Repair Train A are merged. Retain their exact-head
   proof limits and the unexplained timing failures for final qualification.
2. Repair Train B is merged in PR19 at `d20bae5f`; its terminal CI
   `34694049815` passed and its historical proof/failures remain in the
   [Train B record](findings/repair-train-b.md). Merged WAR-06 remains
   evidence-only. PR23's follow-up A bounded lossless canonical breadcrumb
   transport is also merged at `1fac099a`; separate follow-up B legacy
   recovery (~239 ms) and unchanged strict `<200 ms` qualification remain.
   Release HOLD remains.
3. Keep Repair Trains C and D tracked for the safest order on subsequent master;
   they may run in parallel only if their final file/state ownership is proven
   disjoint.
4. Continue prerequisite-satisfied WAR investigation/test-foundation slices
   around these trains. Already-confirmed audit findings are inputs, not reasons
   to postpone repair until the complete WAR programme ends.
5. Reconcile every repaired row into the hazard register and Linear. Then run
   BCP-17/WAR-12-style exact-candidate qualification once, after feature freeze.
   Any candidate code fix creates a new candidate and invalidates affected
   evidence.

## Current stream state

- WAR-02A is merged in PR #16 at `4076975d`. Its additive test-foundation lane
  started from fetched master `083f5047`.
  [Contract/evidence](war-02a-test-infrastructure.md) covers deterministic
  scheduling, real-file/SQLite call-boundary faults and historical teardown and
  backup red controls. Its tests/helpers do not own Repair Train A files or
  regressions. Source 422 files / 4,325 tests, lint/build and helper types pass;
  final affected 65 tests pass, and all independent reviews clear executable
  head `18bd374f`. [PR #16](https://github.com/donal0c/sartracker-web/pull/16)
  records accepted CI and merge evidence.
  DON-254 retains final qualification, and no hazard or audit finding is closed.

- Team requirements: Batches 1 and 2 are merged. Remaining Sar_4 work is
  explicitly retained in `DON-144`/`DON-7`/`DON-76`, `DON-214`, and
  `DON-216`–`DON-221`, plus `DON-100` and the later Marker Details
  simplification. `DON-215` is reconciled to Done in Linear to match merged
  PR #15.
- Deep audit: fourteen confirmed groups are triaged above; eight are repaired
  in merged PRs #15/#17/#19 and six remain in Repair Trains C–D. Repair Train B
  and PR23 follow-up A are merged; their historical proof and failures remain
  linked above. The current queue is separate follow-up B and later strict
  `<200 ms` qualification. Current-head red reproduction still controls
  whether each remaining repair is valid.
- WAR: WAR-01, WAR-04, WAR-04B, WAR-11A, WAR-13A, and WAR-02A are merged.
  WAR-06 now has an active DON-267 production mission-scope repair; its original
  investigation remains historical evidence. WAR-04's nine confirmed
  map/settings/privacy defects remain additional WAR-11 remediation inputs.
  Remaining WAR investigation/test slices continue according to prerequisites;
  WAR-12/final candidate qualification remains last.
