# HANDOFF.md — Current state

Updated 2026-09-25. Detailed PR history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 is open and draft at `719c371d`. Exact-head Linux run `36085152426`
failed the C01 producer step; later packaged checks were skipped. Diagnostics
and crash cases had been dismissed but did not exit with code 1; the store case
exited. Keep that receipt as history; harness cleanup is not product exit.

## Active work

Uncommitted C01 repair adds a retained, closeable post-readiness failure window,
rejects non-regular crash/diagnostics paths before reading, and hardens Linux
window observation against the verified X11 dismissal race. The 10-second
watchdog starts after Electron readiness and ends when the operational window
is shown. Focused tests (134, then 22 for the final observer change), serial
correctness (5,892 passed, 25 skipped), lint and production build pass. Local
Linux packaged development calibrations pass for diagnostics, crash and store;
they are not qualification evidence. Exact-head CI and review have not run for
these edits. DON-179 remains **In Review** because opt-in upload and private
retention are outside this repair.

The 10-second watchdog starts after Electron readiness and ends when the
operational window is shown. `app.whenReady()` and synchronous SQLite open or
migration on Electron main remain outside its interruptible boundary. Keep this
as an explicit C01 coverage gap; utility-process ownership of the live store is
separate work. The historical Linux C19 261.161 ms result also remains
unresolved. DON-179 remains **In Review** because opt-in remote upload and
private retention are outside this repair.

## Next actions

1. Commit and push the verified repair with DON-179 in the message.
2. Run exact-head Linux CI and inspect every skipped downstream package check.
3. Obtain fresh review on the resulting exact head. Keep PR #47 draft until CI
   and review clear. Do not merge, tag, publish, or release.
