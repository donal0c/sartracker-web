# HANDOFF.md — Current state

Updated 2026-09-25. Detailed history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47's behavior-bearing source is at
`0e6db8a26b62327055d76f1b61782e6d600caa96`. Exact-source Linux run
`36116343282` passed, and an independent review of that source found no
actionable findings. The PR is ready for review. Later PR commits are
documentation-only; verify the latest push-triggered workflow before merging.
The complete disposition is in the [PR47 findings register](../docs/pr47-findings-disposition.md),
and the source review is retained under assurance. Do not merge, tag, publish,
or release from this repair.

## Active work

The repair starts one 10-second startup watchdog after Electron readiness and
covers awaited asynchronous startup through the renderer safety fence. Runtime
and crash-log I/O use an isolated utility process. Startup exits and fatal
relaunches are withheld unless a timed-out writer is confirmed stopped. The
held diagnostics, held crash-log `fsync`, SQLite lock, and non-regular crash
evidence Linux probes all passed their bounded product-exit and
profile-preservation checks. These are development mechanics receipts, not
C01 qualification.

The recorded scope decision defers live mission-store process isolation until
after Beta 13; it is an unresolved known limitation, not a passed check. Track
it in [post-Beta 13 mission-store isolation](../docs/post-beta13-mission-store-isolation.md).
`app.whenReady()` also remains outside this watchdog. Keep both boundaries
visible and do not claim complete C01 coverage. The historical Linux C19
261.161 ms event remains unresolved. DON-179 remains **In Progress** because
opt-in remote upload and private retention are outside this repair.

## Next actions

1. Keep Beta 13 on HOLD pending its separate candidate and release gates.
