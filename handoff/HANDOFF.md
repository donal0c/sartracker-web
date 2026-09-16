# HANDOFF.md — Current state

Updated 2026-09-16. Read after `CLAUDE.md`.

## Baseline and active lane

Current `origin/master` is `6abde36e1e293f8731784fe3fab293f11ce5e7eb` with tree
`302e684ec4c60ad66a0afb45898e2a552e3cf974` (PR31 merged). PR32's current exact
head is `cbf6d7d9602d9b1d891a630d20cfdb696fd5dd9d`, tree
`a221e7a239fd6f635af892fa3b4e09f3eeafc09e`. Earlier PR31/native-runtime and
Train D failures remain historical evidence in the linked assurance records.

The current remediation adds a bounded participant-scope admission deadline,
uses the participant-scope mission resolver consistently, refreshes only
backfill checkpoints without entering the full participant loading state, drains
backfill before shutdown evidence settlement, and suppresses checkpoint-only
immediate poll requests. The packaged Train D diagnostic classifiers were also
changed deliberately: device-22 history warnings are exact and occurrence-
bounded, device-11 503s remain failures, the exact device-11 scope-closure
control is separately constrained, and the unpaired coverage-revision
allowance was removed. The global unexpected-diagnostic gate and strict `<200
ms` threshold were not relaxed.

## Verification and next action

Manual exact-master workflow `34860711436` (head
`6abde36e1e293f8731784fe3fab293f11ce5e7eb`) reproduced the original failure at
packaged AUD-08: the native store was `1/2`, but the renderer remained `2/2`;
AUD-09 and restart were not reached. A red unit regression reproduced the same
refresh seam, then passed after the callback repair.

Local repaired macOS arm64 package evidence (`/tmp/sar-train-d-local-666c`)
shows `aud08=pass` and `aud09=pass`, including the visible `complete for 1/1`
state and Search Operations backup proof. That receipt predates the current
classifier/runtime remediation and is not current-head qualification evidence.

Source checks on the remediation working tree: focused participant/tracking/
Train D tests pass 158/158, changed-file lint, TypeScript build and diff checks
pass. The full unit suite completed 5,078/5,079 tests; its sole failure was an
existing host-timing observation at 258.3 ms, and the isolated 93-test file
rerun passed. Required manual run `34902500983` is evidence for the previous
clean code head only; it passed its Train D receipt but then failed in the
unrelated packaged archive-lifecycle smoke:
the unchanged strict continuity gate recorded `current_fix_continuity_gate_breached`
with a 205 ms cleanup gap. Failure evidence is retained under
`/tmp/sar-train-d-ci-34902500983-9FmgLG`, including
`tmp/breadcrumb-pr6-packaged-archive-smoke/electron-archive-lifecycle-smoke-failure.json`.
Do not relax that gate or relabel the workflow green. The required packaged
workflow must be rerun on the new clean remediation head; the old positive Train
D receipt cannot qualify this changed tree, especially after removing the
unpaired coverage-revision allowance. PR32 remains draft/open and not
merge-ready; Donal owns merge, and no merge, release, deployment, or team contact
is authorized by this handoff.

## Limits

DON-254 remains In Progress; release HOLD. The current Train D receipt is
positive, but the manual workflow remains failed by the archive-lifecycle
continuity blocker above. Installer/field acceptance and official-map
distribution remain outside this lane. Pre-attachment renderer diagnostics
remain unobserved; capture timestamps are not event-origin timestamps.
The historical 204.046 ms concurrent read, incomplete 239.509 ms attribution,
baseline settings/browser gaps, and WAR-11 macOS/CI failures remain retained.
No credentials or licensed map bytes were read.

Follow the [two-track queue](../docs/two-track-execution-workplan.md),
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md), and
[testing cadence](../docs/testing-and-review-cadence.md).
Older history: [pre-Train C archive](archive/pre-train-c-20260914.md) and
[earlier archive](archive/pre-war06-repair-20260913.md).
