# HANDOFF.md — Current state

Updated 2026-09-25. Detailed PR history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 remains draft at head `9c193155` on current master. Run `36074972856`
confirmed the C01 observer dismissed all three startup dialogs. The diagnostics
and crash-held cases then failed to exit with code 1 within 12 seconds; the
SQLite-held case exited with code 1. The harness killed the first two after
the observation bound, so those signals are not product exits. Original
mission/settings digests were unchanged. Full correctness, rendered regressions
and Linux packaging passed; later package checks were skipped after the C01
producer failure.

## Active work

The local fix adds `process.exit(1)` in a `finally` after the bounded startup
evidence wait and `app.exit(1)`, covering timed-out startup I/O that remains
pending. Its regression failed before the change. The startup suite passes
53/53, full correctness passes (5,878 passed, 25 skipped), and lint plus
`git diff --check` pass. The fix is not yet validated on packaged Linux.

The 10-second watchdog begins after Electron readiness and covers awaited
startup through the hidden-window renderer safety fence. `app.whenReady()` is
outside that deadline; synchronous SQLite open/migration still blocks Electron
main and cannot be interrupted. Do not claim complete C01 coverage. A utility
process owning the live store remains a separate follow-on.

DON-179 remains **In Review** because opt-in diagnostic upload/private
retention is outside this repair. The historical Linux C19 261.161 ms failure
against the 200 ms gate also remains unresolved; current-master evidence does
not explain or clear it. Beta 13 stays on HOLD.

## Next actions

1. Record the local fix and evidence on DON-179, then commit and push with the
   issue ID.
2. Run exact-head native Linux CI. Require all C01 held-gate cases to dismiss
   and exit with code 1 without harness signals; preserve run `36074972856` and
   its receipts as history.
3. Obtain fresh review on the resulting exact head. Keep PR #47 draft until
   checks and review clear. Do not merge, tag, publish, or release.
