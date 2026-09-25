# HANDOFF.md — Current state

Updated 2026-09-25. Detailed PR history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 is open and draft. The last exact-head Linux receipt is for remote head
`5e2d607`; run `36079044261` failed the C01 producer check: diagnostics and
crash-held dialogs were dismissed, but the app did not exit with code 1 within
12 seconds; the harness sent SIGKILL. The SQLite-held case exited with code 1.
Profile digests were unchanged. Packaged checks after the failed producer step
were skipped. Keep this receipt as history; harness cleanup is not product exit.
The repair is committed locally; exact-head CI and review have not yet run for
the new commit.

## Active work

Uncommitted local repair: after the bounded evidence-write wait, call
`process.exit(1)` directly; track concurrent diagnostics/crash-state reads as
distinct watchdog stages; ignore activate/window-close events until the first
operational window is shown; extend the product-exit observer to 20 seconds.
Focused startup/watchdog/producer tests pass (75/75), serial correctness passes
(5,880 passed, 25 skipped), lint and production build pass. Strict `npm test`
had an under-load 220.3 ms GPX responsiveness result and a 5-second unrelated
worker-import timeout; both affected tests passed alone. The isolated timing
result is diagnostic, not qualification.

The 10-second watchdog starts after Electron readiness and ends when the
operational window is shown. `app.whenReady()` and synchronous SQLite open or
migration on Electron main remain outside its interruptible boundary. Keep this
as an explicit C01 coverage gap; utility-process ownership of the live store is
separate work. The historical Linux C19 261.161 ms result also remains
unresolved. DON-179 remains **In Review** because opt-in remote upload and
private retention are outside this repair.

## Next actions

1. Commit and push the verified repair with DON-179 in the message.
2. Run exact-head Linux CI. Require all three held-gate cases to dismiss and
   exit with code 1 without harness signals; inspect every skipped downstream
   package check.
3. Obtain fresh review on the resulting exact head. Keep PR #47 draft until CI
   and review clear. Do not merge, tag, publish, or release.
