# HANDOFF.md — Current state

Updated 2026-09-17. Read after `CLAUDE.md`.

## Baseline and active lane

`origin/master` is `6abde36e1e293f8731784fe3fab293f11ce5e7eb`. PR32 is draft,
open, and still HOLD/not merge-ready. Its current head is
`159ca3478fbe607c54b19f9c8a4fef549a851678` with tree
`f9b2cfa2fa085ea68a37b99634c7a9b19cf9ff2a`.

The DON-254 remediation now has bounded participant-scope admission, one
consistent participant-mission resolver, checkpoint-only projection refresh,
shutdown backfill draining, no checkpoint-only poll storm, strict Train D
diagnostic classifiers, durable-device admission, and automatic continuation
through fixed two-hour backfill chunks. Continuation requires a durable
checkpoint read-back showing cursor progress and stops when no incomplete
checkpoint remains; no diagnostic or timing gate was relaxed.

## Verification and next action

Local exact-head source evidence: TypeScript build, changed-file lint, and diff
checks pass; the complete `start-tracking-runtime` unit file is 100/100; full
correctness is 477/477 files, 5,058 passed, 6 skipped. The new red-first
regression proves a 2-hour-plus-tail participant window advances to its next
chunk without another poll. PR-only run `35166410504` passed the previous
exact code head `55c3b808`; current-head PR validation is running as
`35170877817`.

Manual exact-head run `35168001952` on `55c3b808` passed all source, build, and
earlier packaged gates, then failed at packaged AUD-08: it timed out waiting
for a successful device-11 history request enclosing the re-add window because
the first 2-hour request ended about six seconds early. The same receipt also
failed the independent diagnostic result after repeated deliberate device-22
503 retries. The new continuation fix is intended to remove the first failure
without widening the diagnostic allowlist; the required packaged workflow must
be rerun on `159ca347` (or the next exact clean head) and its receipt must pass
independently.

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
