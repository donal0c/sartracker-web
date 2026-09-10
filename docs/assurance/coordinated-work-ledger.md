# Coordinated Team, Audit, and WAR Work Ledger

Updated: 2026-09-09

Status: active coordination record. The canonical execution order remains
`docs/two-track-execution-workplan.md`; this ledger prevents the three current
sources of work from being lost, duplicated, or qualified in the wrong order.

## Governing decision

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

## Deep-audit finding disposition

| Finding | Priority | Current disposition | Coordinated owner / timing | Required proof before closure |
| --- | --- | --- | --- | --- |
| `AUD-07` hidden evidence remains selectable | P2 | **Implemented in PR #15; awaiting merge** | DON-215 / Team Feedback Batch 2; fix `42f9f305`, integrated executable `e60dc43e` | Required hit-test visibility and per-object replay limitations; red/green, rendered interaction and bounded review proof in [batch evidence](../ui-feedback-batch-2-evidence.md); final Linux CI `34462624720` passed |
| `AUD-14` failed history retrieval coexists with “All mission history shown” | P2 | **Implemented in PR #15; awaiting merge** | DON-215 / Team Feedback Batch 2; fix `42f9f305`, integrated executable `e60dc43e`; authorized durable request-target extension | Structured completeness survives empty failures, deselection, pause and restart; red/green, packaged restart/pause and bounded review proof in [batch evidence](../ui-feedback-batch-2-evidence.md); final Linux CI `34462624720` passed |
| `AUD-13` overlapping reloads can stop tracking while Live remains shown | P1 | **Repair train A — tracking safety and liveness** | `DON-267` / `DON-254`; start after the active team batch if its runtime/visibility work overlaps; feed and sharpen `WAR-06` rather than waiting for every WAR audit | Native loopback red/green interleaving, current-position continuity/status truth, targeted packaged proof, concurrency review |
| `AUD-02` out-and-back route falsely appears stationary | P2 | **Repair train A** | `DON-269`; join `TRK-004` / `WAR-06` and preserve the team-confirmed 20-minute rule | Counterexample regression, accuracy/jitter controls, rendered warning clear/raise proof |
| `AUD-03` stationary projection broadly rescans mission history | P1 | **Repair train A** | `DON-269` / `DON-254`; same stationary/current-position seam and release-blocking scale issue | Documented 100-device workload, operation bound and renderer frame maximum below the hard 200 ms gate |
| `AUD-01` legal GPX extension fields overwrite canonical evidence/add a coordinate | P1 | **Repair train B — GPX evidence fidelity and lifecycle** | `DON-274` / `DON-254`; start after Team Feedback Batch 2 because Review/replay presentation is changing | XSD-valid source-to-SQLite-to-replay identity test; no invented coordinate/time/elevation; native/package boundary proof |
| `AUD-10` native GPX parser drops CDATA values | P2 | **Repair train B** | `DON-274`; same parser/source-fidelity contract as `AUD-01` | Browser/native parser parity and exact persisted evidence regression |
| `AUD-05` ending an outing during successful GPX import leaves stale importing UI | P2 | **Repair train B** | `DON-274` / `DON-270`; same import receipt/lifecycle settlement boundary | Deterministic import/outing interleaving, truthful completion state, native SQLite proof |
| `AUD-04` equal map-style writes cause continuous idle redraw | P2 | **Repair train C — map interaction/rendering** | `DON-264` / `DON-254`; coordinate with `WAR-04` map remediation and start after the active visibility/map batch | Causal browser performance test, quiet-idle control, no lost overlay synchronization, frame-budget proof |
| `AUD-06` repeated Go To can be ignored/lose its target during style loading | P2 | **Repair train C** | `DON-6` / `DON-254`; same map target/style lifecycle | Red/green repeated navigation and style-load tests plus rendered target verification |
| `AUD-11` built-in no-coverage PNG is invalid | P2 | **Repair train C** | `DON-7` / `DON-76`; combine with the WAR-04 map qualification/freshness train without conflating it with imported-tile corruption | Real image-decoder oracle and fail-visible no-coverage workflow |
| `AUD-12` Clear Alias retains the alias | P3 | **Repair train C or next bounded UI batch** | `DON-6`; include only if the chosen train already owns the layer catalog, otherwise keep separately queued | Store/controller red/green test and visible cleared state |
| `AUD-08` re-added-group backfill reports complete with a required member pending | P2 | **Repair train D — mission progress/review correctness** | `DON-271` / `DON-254`; align with `MIS-003` and do not weaken Finish refusal | Native participant/backfill regression proving progress cannot lead completion truth |
| `AUD-09` backup invalidates Search Operations pagination and blocks recording | P2 | **Repair train D** | `DON-279` / `DON-254`; Mission Review/pagination lifecycle after Team Feedback Batch 2 | Native backup/page-generation red/green proof and rendered recovery without a full Review reset |

The audit's additional measured concerns are not silently discarded. Attachment
base64 frame cost, Traccar oversize-response buffering, GPX hit-test cost,
membership-scan growth, repeated-hour Search Pass selection, backup-close join,
pending Search Pass double-submit, async mission-scope races, and the clock
authority for stationary advice remain hypotheses or bounded optimization leads.
The relevant WAR slice must retrace them; only confirmed violations enter a
repair train.

## Coordinated execution order

1. Complete Team Feedback Batch 2, including current-head dispositions for
   `AUD-07` and `AUD-14`, then merge only after its normal review/proof contract.
2. Run repair train A first. A false Live state and mission-scale stationary
   stall are release-blocking current-position hazards.
3. Run repair train B next. False or dropped GPX source evidence is a
   release-blocking custody and replay hazard.
4. Run repair trains C and D in the safest order for the code then on master;
   they may run in parallel only if their final file/state ownership is proven
   disjoint.
5. Continue prerequisite-satisfied WAR investigation/test-foundation slices
   around these trains. Already-confirmed audit findings are inputs, not reasons
   to postpone repair until the complete WAR programme ends.
6. Reconcile every repaired row into the hazard register and Linear. Then run
   BCP-17/WAR-12-style exact-candidate qualification once, after feature freeze.
   Any candidate code fix creates a new candidate and invalidates affected
   evidence.

## Current stream state

- Team requirements: Batch 1 is merged. Batch 2 is active and owns per-device
  visibility plus Mission Preview/Review evidence completeness and
  discoverability, now including `AUD-07` and `AUD-14`.
- Deep audit: fourteen confirmed groups are triaged above; twelve remain in
  four repair trains pending exact-head reproductions and reconciliation into
  the cited existing Linear owners.
- WAR: WAR-01, WAR-04, WAR-04B, and WAR-13A are merged. WAR-04's nine confirmed
  map/settings/privacy defects remain additional WAR-11 remediation inputs.
  Remaining WAR investigation/test slices continue according to prerequisites;
  WAR-12/final candidate qualification remains last.
