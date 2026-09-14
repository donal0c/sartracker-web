# Repair Train D — participant completeness and Search Operations

**Superseded readiness:** the [PR27 Claude follow-up](pr27-claude-review.md)
withdraws earlier readiness and records the approved SAR-QA-022 recovery and review
corrections. Evidence below is historical; no merge or release readiness is implied.

Current status (2026-09-14): Donal merged
[PR27](https://github.com/donal0c/sartracker-web/pull/27) as
`2ab581e0acfa7e0e4be587ea0064e19bea4a7ee3` from reviewed head `39eed654`.
The implementation/evidence below begins at historical `cc989877a850ed349269bdf4cb562dfd7c4846dc`
on base `2b2bf8e605e27123c9e454598828d71cb7c062aa`; later review corrections
remain in the linked disposition. Merge does not establish packaged qualification.
Owners: DON-271 / AUD-08 and DON-279 / AUD-09; DON-254 retains qualification.
Train C can now integrate the merged Train D baseline. Release HOLD remains.

## Exact-master packaged follow-up — 2026-09-14

Manual workflow `34860711436` ran on exact merged master
`6abde36e1e293f8731784fe3fab293f11ce5e7eb` / tree
`302e684ec4c60ad66a0afb45898e2a552e3cf974`. It reproduced the retained AUD-08
observation: native IPC reported the re-added group at 1/2 completed while the
renderer continued to display 2/2 pending. The native completeness calculation
and Finish refusal were therefore correct; the missing refresh notification was
the production defect at the tracking/participant projection seam.

The bounded repair refreshes the participant runtime after a durable checkpoint
write, guarded so a stale backfill cannot switch the view to another mission. A
red unit regression in `tests/unit/start-tracking-runtime.test.ts` failed before
the callback and passes after it. A repaired local macOS arm64 package records
`aud08=pass` and `aud09=pass`, with screenshots showing the visible 1/1 complete
state and the Search Operations backup surface. Restart remains **NOT_PROVEN**:
the same receipt failed its existing diagnostic custody gate on deliberate
provider-503/retry and close-time transport warnings before restart. The
diagnostic gate was not weakened, and this local result is not Linux CI,
release, or field qualification.

The original exact-master workflow receipt, local receipt and screenshots remain
retained outside the repository. Exact-head CI, independent review, and a clean
complete Train D run remain required before qualification or merge.

PR32's exact-head run `34866228521` passed correctness, strict responsiveness,
rendered regressions, build, and 960k replay, but failed before Train D in the
unrelated packaged native-runtime control because two launch-time Vulkan stderr
entries were rejected by the existing diagnostic custody gate. Source/package
identity was exact and clean; the Train D validator and scenario were skipped.
This is retained as an environment/diagnostic-gate boundary, not as a product
failure or allowlist change.

## Latest exact-head manual qualification — 2026-09-14

The required manual workflow [`34877445512`](https://github.com/donal0c/sartracker-web/actions/runs/34877445512)
ran on exact clean head `9bd9adc9d38ee573a152ee42c57c13b8da04c803` / tree
`fc107e851cc07dc9ee3b7b2c475dee862025e7f8`. All pre-Train-D gates passed,
including strict `<200 ms`, and the receipt's packaged scenarios all passed:
`AUD-08=pass`, `AUD-09=pass`, `restart=pass`, `scenarioResult=pass`.

The overall receipt remains failed because `diagnosticResult=fail`. The restart
close observed the exact renderer warning `Tracking history stopped before
transport completed`, which is an expected teardown cancellation but is not yet
covered by the narrow Train D allowlist. The same restart also emitted the two
known Linux Electron Vulkan startup stderr lines (`vkCreateInstance() failed: -9`
and `Failed to create and initialize Vulkan implementation.`), previously
retained as an environment/diagnostic-custody boundary in the native-runtime
gate. The source/tree attestation is exact and clean; no product scenario failed,
and no timing, diagnostic, release or field gate was relaxed. Train D packaged
qualification is therefore **NOT_PROVEN**, not green or merge-ready. The full
receipt is retained under `/tmp/sar-train-d-ci-34877445512-xowlWF`.

The current harness commit `9bd9adc9` is locally verified by 26/26 affected unit
tests, changed-file lint, TypeScript build and diff checks. The next bounded gate
is an explicit decision on the teardown-cancellation classification and the
separate Linux Vulkan diagnostic boundary, followed by another exact-head manual
run if those boundaries are resolved. No merge, release, deployment or team
contact follows from this receipt.

## Contract and risk

SAR-QA-001/002/008 require complete mission history, immediate current positions
and honest progressive loading. SAR-QA-014/015 preserve coordinator-owned,
non-overlapping outings and explicit participant/group selection with late adds.
SAR-QA-018 reserves search outcomes to the coordinator; SAR-QA-020 preserves
finalized evidence. The raw transcript and indexed Q&A remain authoritative.

AUD-08 must count the whole starting roster of each selection independently of
membership deltas. A pending required checkpoint must never become a complete
progress claim. Review found the existing backend Finish refusal insufficient
when required checkpoints are missing or cover only an interior interval. New
selections retain immutable starting IDs; historical rows need explicit safe
reconstruction. No coordinate, current-position or provider scheduling change
is intended.

AUD-09 must fence pages on relevant retained Search Operations mutations while
preserving backup audit and replay history. Sort-key changes must still expire
continuations. A failed list owns its error, retains it while retrying, and can
recover through First/Search without a whole Review reset. Other failed lists
and unrelated Review errors must not be cleared. Recording remains blocked
until failed evidence reads recover; finalized/read-only fences remain intact.

Search Operations cursors are now v3: v2 encoded the broader replay generation
and must not be accepted merely because a new scoped counter happens to match.
Live stores add the derived counter beside the existing replay counter. Older
immutable two-column archive/query sources retain their legacy replay-counter
fallback; their v3 continuations still bind mission, kind, search and generation.
The archive scratch path recognizes exact legacy versus expanded trigger sets,
and rejects altered new trigger definitions. Archive-cleanup triggers remain
unchanged. These compatibility boundaries require focused independent review.

## Current-head red evidence

- `tests/unit/aud08-readded-group-backfill.test.ts`: native selected group A is
  removed and re-added with A+B; completing only B reports 1/1 rather than 1/2.
  Expanded sole-member, changed-roster, late-membership and restart cases are
  retained in the same regression suite.
- `tests/unit/assurance/aud-09-backup-search-pagination.test.ts`: native
  store/page workers retain 26 unchanged areas and `mission_backup_synced`, but
  reject the first-page continuation after `syncBackup('interval')`.
- `tests/unit/start-mission-review-runtime.test.ts`: first-page continuation
  failure cannot recover locally because the error is global and First is a
  no-op. New regression failed before the renderer change.
- `tests/unit/aud09-browser-page-generation.test.ts`: browser generation also
  incorrectly expires on a backup audit event; red before its scoped change.

Historical audit: `output/deep-codebase-audit-2026-09-07/report.md` in the original
checkout, AUD-08/AUD-09 and its persistence reports. Those old receipts are
hypotheses until the above current-head reproductions, not new native proof.

## Verified so far and remaining proof

Escape analysis: AUD-08's earlier happy-path progress checks used first-time
membership events, where delta and full roster happen to match. They did not
assert the denominator after remove/re-add with unchanged and new members.
AUD-09's cursor tests advanced the generic replay counter explicitly to model
evidence edits; they did not pair unchanged area rows with the real backup
worker/audit path. Runtime recovery checks did not show that searching again
left the global write-blocking error behind. The new native and rendered
regressions exercise these actual boundaries rather than only counter changes.

Source history attributes AUD-08's delta-only count predicate to
`b7591572d780063c4eed9347cdbb6e8de8616130` and AUD-09's general replay-generation
fence to `5cbd93e91d8c67275edc9b02e1db1ea5540c77c9` (`git log -S` and commit
inspection). Those historical commits were not executed in this repair run;
last-known-good runtime evidence is not established. The historical
2026-09-07 audit and current baseline both exhibit these defects; neither
receipt demonstrates field data loss. Current-head proof confirms misleading
progress and interrupted Review recording. The initial reproductions did not
bypass Finish; the independent review cases below subsequently did.

## Merge-blocking review reproductions

Root independently reran the review's disposable native-store cases before
further production edits: (1) deleting a selected member's checkpoint leaves
progress 0/1 yet Finish succeeds; (2) retaining only a completed interior window
reports 1/1 and Finish succeeds despite uncovered required history; (3) a legacy
null snapshot with same-add-timestamp member/left events and no checkpoint
reports inferred 0/0 and Finish succeeds. These are P1 acceptance blockers.
The repair must share complete interval/scope truth between progress and Finish,
require contiguous coverage across the entire selection window, and block
unknown legacy scope. Same-boundary legacy candidates must be conservatively
retained because participant rows have no event sequence. Native and browser
regressions must retain all three cases and the successful complete-window case.
Native initial selection also accepts omitted `member_device_ids` as an empty
roster, unlike the browser mirror. Root reproduced snapshot `[]` and successful
Finish. Missing roster input must be rejected while explicit `[]` remains a
known empty selection.

The final focused review additionally reproduced a null legacy snapshot with
only a departure event before insertion: event presence incorrectly converted
unknown membership to inferred 0/0 completion. Empty inferred candidate sets
now remain unknown. Browser checkpoint writes also normalize timestamps and
enforce the native mission-start, fixed-window and cursor bounds. The retained
red log is `/tmp/sar-train-d-aud08-left-window-red.log` (four failures);
`/tmp/sar-train-d-aud08-final-review-green.log` passes 30 focused tests including
direct helper and both store consumers. Adjacent suites pass 101 tests in
`/tmp/sar-train-d-aud08-adjacent-green.log`. Independent disposable native
post-fix probes confirm unknown counts and Finish refusal for departure-only
history while preserving the three original blockers. The wider verification
and failed packaged attempt are recorded below.

AUD-09 review found the browser mirror deleted a drawing without retiring its
stable search-area projection. Root's regression observed `retired_at: null`
and version 1 after deletion. The mirror now retains the retired projection with
an incremented version, removes it from active pages and expires the old cursor.
The follow-up review found same-ID re-add could then resurrect that retained
area, unlike native rejection. An early retired-ID guard now rejects before
mutation; the regression asserts the entire prior harness state is unchanged.
The browser generation plus harness suites pass 44 tests in
`/tmp/sar-train-d-retired-area-green.log`; the rejected baseline behaviour is
retained in `/tmp/sar-train-d-retired-area-red.log`.

Packaged-harness review is also blocking before first execution: cleanup errors
must force failure, unexpected diagnostics must gate the result, run/cleanup
deadlines must be bounded, and CI must independently validate the terminal
receipt. Successful history requests must prove B's required bounds; mirror
path identity, SQLite integrity, generation and audit retention must survive
restart. Disposable credentials are removed on success. Native Search Operations
proof is explicitly IPC pagination across backup/restart; rendered local recovery
and recording belong to the separately identified Chromium tests. No native
operator-recording claim is implied by the IPC proof.

Cross-lane intake, locally confirmed: WAR-11 reproduced three settings browser
failures on clean baseline `2b2bf8e`; D reproduced all three on its working tree
in `/tmp/sar-train-d-preexisting-settings.log` (screenshots/context in
`test-results/train-d-preexisting-settings`). DON-229 lacks `requestedFromEarliest`,
DON-228 records zero history requests, and large hosted history shows two known
fixes instead of 14,500. The unchanged tracking
runtime rejects missing `persistTrackingPositionsBulk`/`persistTrackingHistoryBatch`
with "Durable history request recording is unavailable." Train D does not add
those harness methods or alter that runtime. This source predicate is inspected;
the error was not captured as live console evidence in this run. The matching
baseline failures remain a separate bounded harness repair candidate. The whole
browser suite is not green and no release qualification is claimed.

Renderer focused tests: 42 passed across runtime, read-only controls and browser
generation. Rendered Chromium regression `repair-train-d-review.spec.ts` passes:
actual sort-key mutation, visible error, disabled entry, First retry from page 1,
draft preservation and a newly recorded assignment without closing Review.
Screenshots were inspected for the error/retry and recovered entry surfaces.
This is browser/synthetic evidence, not packaged SQLite or field proof.

Focused native proof passes: participant regression 9, native/Tauri participant
stores 22, participant runtime/scope 32, browser harness 41, native Search
Operations pages 13, and archive scratch 9. Archive tests
assert exact legacy/expanded trigger names, a real old two-column source, and
tampered canonical SQL rejection. Lint passes. The two new Chromium regressions
and 20 existing participant/Review/Search Pass flows pass on owned port 1437.
An earlier browser run failed because development hot reload split the test's
dynamically imported harness singleton from the app; restarting the owned server
restored both flows without product/test changes. The failed log is retained.

The first full correctness run exposed the seed fixture's old exact hash.
Regenerating it from isolated baseline source and current source produced old
`9b4fc843fe6454da17739c089f4d5b3faed975873e54fa7655bf94f6850596c9` and new
`fbf4f7e6fed1493b46349303ccdd096568eda5696d54bab17e6fa5b5e56fa00b`.
Read-only comparison of every existing column in all 49 tables was identical;
the trigger set grows from 111 to 126. The exact hash stays pinned, supplemented
with explicit roster/counter schema assertions. Its affected suite passes 10/10.
That full cycle ended at 451 files, 4,748 passed, one corrected fixture-hash
failure and six qualification-only skips. A clean rerun was deliberately
interrupted when the review identified the above P1 defects; it is not green
evidence for the further repair. The already built macOS package is likewise
superseded and must be rebuilt after the completion predicate changes.

The final frozen integrated focused set passes 172 tests across 15 files in
`/tmp/sar-train-d-integrated-focused.log`; full lint passes. Independent broad
production and focused production reviews have no remaining material findings
on this working diff. The initial terminal validator's 13 tests cover separate
replay/scoped counters, restart identity, provider request shape, diagnostics
and bounded cleanup. Early window listeners cannot establish capture before
Playwright exposes the application/window; no broader startup claim is made.
The 1,421 input-file freeze manifest is `tmp/train-d-frozen-inputs.json`.
Its SHA-256 is
`f9ca33d8440a38b49ae89db394063ed04f4e84cc42f418717a353684f6e26dcb`.

Fresh full serial correctness passes 453 files and 4,785 tests, with six existing
qualification exclusions, in 488.69 seconds:
`/tmp/sar-train-d-correctness-frozen.log`. All 1,421 frozen hashes match afterward.
This is source correctness evidence; strict responsiveness was not run.

The final affected Chromium run passes 23 tests on a freshly restarted owned
Vite instance (`/tmp/sar-train-d-browser-frozen.log`, 36.6 seconds). Screenshots
in `test-results/train-d-frozen-browser` show pending 1/2 progress, unknown
legacy scope, Finish refusal and retained draft/recovered recording. This
remains browser-harness evidence, separate from the failed packaged attempt.

Fresh macOS package build passes. Attempt 1 (`tmp/train-d-native-attempt1`)
fails at a stale initial-selection picker locator after group removal; no
re-add/controlled hold was reached. Initial native backfill completed and the
group removal persisted. The package ASAR/input hashes matched. Electron PID
73878 (parent 73853) exited 0 without signal; the sole original crash report
and post-run process inventory were unchanged/clear. Diagnostic capture also
failed closed: blocked basemap requests exceeded bounded samples, with two
console entries and one network entry not retained. Per-entry timestamps were
absent. Service-worker, coverage and listener diagnostics remain under exact
source attribution; no retrospective expected-only classification is valid.
The failed receipt, screenshots, readonly SQLite summary and diagnostic summary
are retained. No native success or PR readiness is claimed.

The scoped merge decision remains separate from native/release qualification.
Only the newly added Train D smoke/validator pair requires an explicit manual
`run_repair_train_d_smoke=true` workflow input (default false). All pre-existing
PR/push checks are unchanged. Ordinary runs explicitly record Train D packaged
smoke **NOT RUN**, because baseline diagnostic blockers remain under DON-254.
Manual invocation retains strict nonzero failure on scenarios, diagnostics,
cleanup or receipt errors. There is no `continue-on-error` or diagnostic
allowlist relaxation. Actionlint passes for the workflow.

The corrected harness passes 22 focused tests, including separate scenario and
diagnostic results, diagnostic ordering/reconciliation, exact expected-resource
classification and bounded cleanup. The actual post-selection roster locator
has Chromium red/green proof: two tests pass in
`/tmp/sar-train-d-locator-green.log`. Production inputs remain unchanged since
the full correctness cycle; only the smoke helper/script/tests, this browser
regression and the opt-in CI configuration changed afterward.

Final cleanup review found that scenario work could consume the shutdown budget.
The 240-second overall deadline now reserves 20 seconds for cleanup and protects
the last 10 seconds from orderly-close waits. TERM and KILL share the remaining
absolute deadline; exhausted cleanup records failure without adding time.
Four caller-helper fake-child tests cover cooperative exit, TERM, KILL fallback
and exhausted-budget custody, including an untouched unrelated child. They fail
before the caller helper is implemented and pass afterward (22/22 total):
`/tmp/sar-train-d-cleanup-red.log`, `/tmp/sar-train-d-cleanup-green.log`.
Full lint, syntax and actionlint pass; independent affected recheck has no
remaining findings. Reviewed helper SHA-256:
`94d7b6ff47e289f90cf80062acacdf2c710493d97e2a99224bde9449f5f9b1ec`;
smoke script:
`3fc2458e719beddbd5fab33407f5d808727f0c71465e83a9ab18e11530c98ef6`.

Exact-commit review attestations and exact-head CI remain required for scoped
merge readiness. Packaged re-add/backup/restart remain unverified and are
required for native qualification, not this explicitly scoped merge decision. The strict
<200 ms gate is unchanged. BCP-17, replay/soak, live-provider/field acceptance,
and publication qualification are not performed by this repair train.

CI run 34776427518 at `6a4dee3b` failed one workflow source assertion, with
4,793 tests passing and six exclusions. The test expected an unquoted
`HEAD^{tree}` argument; actionlint had required quoting it in the workflow.
The focused local run reproduces this failure. Only the assertion is corrected
to require the actual quoted argument; command behavior and application inputs
are unchanged. The failed full run is retained; fresh exact-head CI is required.
