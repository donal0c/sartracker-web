# HANDOFF.md — Current state

Updated 2026-09-17. Read after `CLAUDE.md`.

## Baseline and active lane

`origin/master` is `6abde36e1e293f8731784fe3fab293f11ce5e7eb`. PR32 is open and
merge-ready within its scoped repair boundary. Its latest branch commits are
documentation-only descendants of the validated implementation head
`58ea29005b17a34e69f52ad44966a42f9c63d0aa` with tree
`c890c1fd2f713a195b2ec56132e4ac6c7b38e954`; no source, test, or configuration
changes were made after that qualification.

The DON-254 remediation now has bounded participant-scope admission, one
consistent participant-mission resolver, checkpoint-only projection refresh,
shutdown backfill draining, no checkpoint-only poll storm, strict Train D
diagnostic classifiers, durable-device admission, and automatic continuation
through fixed two-hour backfill chunks. Continuation requires a durable
checkpoint read-back showing cursor progress and stops when no incomplete
checkpoint remains. The participant refresh now reloads the durable participant
projection and checkpoints without entering the loading state, guarded against
an overlapping full mission refresh. The Train D finish-fence stack allowance
is exact and bounded at four frames; no generic diagnostic, 503, or timing gate
was relaxed.

## Verification and next action

Local exact-head source evidence: TypeScript build, changed-file lint, and diff
checks pass; the participant runtime unit file is 32/32, the tracking runtime
unit file is 100/100, and full correctness is 477/477 files, 5,058 passed, 6
skipped. The red-first regressions prove durable-device admission, 2-hour-plus-
tail continuation, and participant projection refresh without a loading flap.

Required Linux packaged workflow `35177287167` passed on the exact clean
implementation head `58ea29005b17a34e69f52ad44966a42f9c63d0aa`. Full
correctness, WAR-02B, strict responsiveness, production build,
all rendered/browser gates, Linux packaging, packaged mission replay, native
runtime/renderer/coverage controls, map freshness, GPX custody, breadcrumb
causal proof, restart/recovery, participant progress and Search Operations
backup, tracking soak, archive lifecycle, AppImage smoke, and independent Train
D receipt validation all passed. The uploaded receipt reports `result=pass`,
AUD-08/AUD-09/restart=`pass`, `diagnosticResult=pass`, no blockers or failures,
and an exact-head clean-tree proof for `58ea29005b17a34e69f52ad44966a42f9c63d0aa` / tree
`c890c1fd2f713a195b2ec56132e4ac6c7b38e954`.

This is sufficient evidence for PR32's scoped merge decision. The later
documentation-only descendants do not invalidate the executable/test evidence
under the repository's testing cadence; they preserve the qualified source and
test trees.

The earlier manual macOS smoke's unpaired `coverage-revision-moved` diagnostic
remains a failure and was not re-allowlisted; it is not Linux qualification
evidence. The hosted packaged result is bounded smoke evidence only, not BCP-17,
release, field, timing, or human-acceptance qualification.

## Limits

PR32 is merge-ready, but do not merge it from this handoff. Release, deployment,
BCP-17, installer/field acceptance, official map distribution, and human
acceptance remain on HOLD/unproven. The historical macOS unpaired
`coverage-revision-moved` diagnostic remains retained and unallowlisted. No
credentials or licensed map bytes were read. Linear was not mutated because no
Linear connector is available in this task.

Follow the [two-track queue](../docs/two-track-execution-workplan.md),
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md), and
[testing cadence](../docs/testing-and-review-cadence.md). Older history:
[pre-Train C archive](archive/pre-train-c-20260914.md) and
[earlier archive](archive/pre-war06-repair-20260913.md).
