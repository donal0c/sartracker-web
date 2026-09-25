# HANDOFF.md — Current state

Updated 2026-09-25. Detailed history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47's behavior-bearing source changed after a 2026-09-25 multi-agent review
of `7fda435` found fatal/quit state, evidence-writer, fault-window and
held-gate classification defects (register IDs V01-V16). The review-fix commit
supersedes the earlier `0e6db8a` source evidence (Linux run `36116343282`);
merge needs the new exact-head Linux workflow to pass. PR #47 is open and out
of draft. The [PR47 findings register](../docs/pr47-findings-disposition.md)
records the source-review outcome. The only archived review report is the
historical review of `5b4f0b25`, which found seven issues; it is not the clean
review of the repair source. Do not merge, tag, publish, or release from this
repair.

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

1. Confirm the exact-head Linux workflow for the PR #47 review-fix commit
   (held-gate `crash-write`, `diagnostics`, `crash`, `store` run there).
2. Keep Beta 13 on HOLD pending its separate candidate and release gates.
