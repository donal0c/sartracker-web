# HANDOFF.md — Current state

Updated 2026-09-17. Read after `CLAUDE.md`.

## Baseline and active lane

`origin/master` is `6abde36e1e293f8731784fe3fab293f11ce5e7eb`. PR32 is draft,
open, and still HOLD/not merge-ready. Its current head is
`932b96780ca2f90ab618f169074beee0e46e734f` with tree
`41398941f823fad64b5855f08364d37d7bf5929c`.

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
PR-only run `35170961888` passed the previous exact head `6f046668` but skipped
strict responsiveness and packaged Train D, so it is not package qualification
for the current head.

Manual exact-head run `35172295699` on `6f046668` passed all source, build,
rendered, and packaging gates, then failed packaged AUD-08 because the UI kept
the group projection at `2/2` pending even though device 11's durable
checkpoint had completed. Its receipt also failed diagnostics after the timeout
caused repeated deliberate device-22 retries. The projection fix and bounded
four-frame finish-fence allowance are now on `932b9678`; the required Linux
packaged workflow must be rerun on this exact clean head and its receipt must
pass independently. A local macOS packaged smoke reached AUD-08/AUD-09 but
hit an unpaired `coverage-revision-moved` diagnostic, which remains a failure
and is not Linux qualification evidence.

## Limits

Release remains on HOLD. Do not mark PR32 ready, merge, release, deploy, or
contact the SAR team from this handoff. Installer/field acceptance, official
map distribution, and human acceptance remain unproven. No credentials or
licensed map bytes were read. Linear was not mutated because no Linear
connector is available in this task.

Follow the [two-track queue](../docs/two-track-execution-workplan.md),
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md), and
[testing cadence](../docs/testing-and-review-cadence.md). Older history:
[pre-Train C archive](archive/pre-train-c-20260914.md) and
[earlier archive](archive/pre-war06-repair-20260913.md).
