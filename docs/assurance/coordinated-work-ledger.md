# Coordinated Team, Audit, and WAR Work Ledger

Updated: 2026-09-13

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

## Current merged disposition

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
