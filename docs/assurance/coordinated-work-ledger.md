# Coordinated Team, Audit, and WAR Work Ledger

Updated: 2026-09-10

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
| `WAR-06-AUD-01`, `WAR-06-AUD-02`, `WAR-06-CACHE-SIBLING` lifecycle/cache boundary | P1 candidate | **Investigation evidence repaired in PR #20; production hazard remains open** | `DON-267` / `DON-254` (**In Progress**); WAR-06 branch `codex/war-06-tracking-lifecycle`; final evidence commit `dc3ea822` rebased on `3db57a79` | Three passing real-runtime characterizations: polling-manager delayed flush, mission finish → idle → start with current-fix hydration, and unkeyed cache hydration. Prior reviews `5175815340` and `5176300059` are pre-rebase provenance; two new exact-head read-only reviews are CLEAN on `10781e2d`; ordinary CI `34632732266` passes. No production fix or closure. PR-mode timing/replay/packaged skips remain explicit gaps; require Astra retrace before any production identity guard, then red/green current-position/stationary/persistence/browser/package proof. Retain unresolved strict `<200 ms` failures; PRs #19/#21 remain draft. [WAR-06 report](findings/war-06/WAR-06.md) |
| `AUD-01` legal GPX extension fields overwrite canonical evidence/add a coordinate | P1 | **Repair Train B active from `302bdd04`** | `DON-274` / `DON-254`; current-head reproduction required despite DON-274's earlier programme completion | XSD-valid source-to-SQLite-to-replay identity test; no invented coordinate/time/elevation; native/package boundary proof |
| `AUD-10` native GPX parser drops CDATA values | P2 | **Repair Train B active** | `DON-274`; same parser/source-fidelity contract as `AUD-01` | Browser/native parser parity and exact persisted evidence regression |
| `AUD-05` ending an outing during successful GPX import leaves stale importing UI | P2 | **Repair Train B active** | `DON-274` / `DON-270`; same import receipt/lifecycle settlement boundary | Deterministic import/outing interleaving, truthful completion state, native SQLite proof |
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

1. Team Feedback Batch 2 and Repair Train A are merged. Retain their exact-head
   proof limits and the unexplained timing failures for final qualification.
2. Run Repair Train B now. False or dropped GPX source evidence is a
   release-blocking custody and replay hazard. WAR-06 may run in parallel only
   as an investigation-only lifecycle audit with disjoint production ownership.
3. Run Repair Trains C and D in the safest order for the code then on master;
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
- Deep audit: fourteen confirmed groups are triaged above; five are repaired
  in merged PRs #15/#17 and nine remain in Repair Trains B–D. Repair Train B is
  active; current-head red reproduction still controls whether each repair is
  valid.
- WAR: WAR-01, WAR-04, WAR-04B, WAR-11A, WAR-13A, and WAR-02A are merged.
  WAR-06 is active as an investigation-only tracking-lifecycle audit. WAR-04's nine confirmed
  map/settings/privacy defects remain additional WAR-11 remediation inputs.
  Remaining WAR investigation/test slices continue according to prerequisites;
  WAR-12/final candidate qualification remains last.
