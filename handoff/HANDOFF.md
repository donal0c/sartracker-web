# HANDOFF.md — Current state

Updated 2026-09-25. Detailed history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47's behavior-bearing source changed after a 2026-09-25 multi-agent review
of `7fda435` found fatal/quit state, evidence-writer, fault-window and
held-gate classification defects (register IDs V01-V16). Review-fix source
`1dd316f2` supersedes the earlier `0e6db8a` evidence; its exact-source Linux
run `36136413925` passed. PR #47 is open, out of draft and mergeable. GitHub
shows `BLOCKED` because the "Protect master - Donal only" ruleset's `update`
rule admits only Donal's bypass; merging is Donal's decision via that bypass.
The [PR47 findings register](../docs/pr47-findings-disposition.md) records the
review outcome. Merging does not lift Beta 13 HOLD: do not tag, publish, or
release from this repair.

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

1. Donal decides whether to merge PR #47 (ruleset bypass required).
2. Keep Beta 13 on HOLD pending its separate candidate and release gates.
