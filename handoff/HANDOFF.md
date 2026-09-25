# HANDOFF.md — Current state

Updated 2026-09-25. Detailed history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 is open as a draft at `d8cc1ae8`. Exact-head Linux run `36095861866` is
in progress. Independent review found a P2 in the packaged C01 proof: the
diagnostics and crash FIFO cases fail fast on the regular-file guard, so they
do not prove watchdog exit while startup I/O is still pending. Keep the earlier
`36085152426` failure as historical evidence; harness cleanup is not product
exit.

## Active work

An uncommitted follow-up makes the diagnostics probe block `logs/runtime.log`
while startup awaits its durable interrupted-operation record. The v4 receipt
requires a named 10-second diagnostics timeout and product exit code 1. Crash
log FIFO rejection is separately classified and records its error code; it is
not called a held gate. The manual describes the new evidence-file error.

Local verification passes: correctness (574 files; 5,894 passed; 25 skipped),
lint, production build, focused startup/receipt tests, `node --check`, and
`git diff --check`. The older Linux run is for `d8cc1ae8`, not this local
follow-up. Packaged Linux proof and review of the updated head remain pending.
`app.whenReady()` and synchronous SQLite open/migration remain outside the
interruptible watchdog. This work does not qualify C01 or clear the separate
Linux C19 261.161 ms outlier.

DON-179 remains **In Review** because opt-in upload and private retention are
outside this repair.

## Next actions

1. Commit and push the verified follow-up with DON-179 in the message.
2. Require exact-head Linux CI, including the C01 timeout receipt, and inspect
   downstream packaged steps.
3. Obtain fresh review on that exact head. Keep PR #47 draft until both clear;
   do not merge, tag, publish, or release.
