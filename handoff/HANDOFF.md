# HANDOFF.md — Current state

Updated 2026-09-25. Detailed history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 is open as a draft. The earlier Linux run `36098634511` failed the C01
candidate producer check because Electron stayed alive after the operator
dismissed the fault window. Follow-ups fixed the product-exit path and the
fatal-handler rejection loop. A fresh review then found that a stuck evidence
write could still delay the fatal dialog; the current patch bounds that wait
and terminates the isolated writer after timeout. Linux run `36112169249` is on
the preceding commit `33ec6ef` and cannot verify this final patch.

## Active work

The local repair isolates runtime/crash log I/O in a utility process, starts the
10-second watchdog after Electron readiness, and reaps a stuck writer before
`app.exit(1)`. Helper readiness gets the same ten-second allowance. Helper
bootstrap errors use the visible failure path; a failed helper never triggers
crash-log writes on Electron main. Final-source Linux packaged development
probes passed: held diagnostics exited code 1/no signal/no harness kill
(10,078 ms after dismissal); held crash-log `fsync` wrote the failure record,
left no temp file, and exited code 1 (886 ms). Both are development mechanics
checks, not exact-head CI or C01 qualification.

Fatal handling now contains rejected log writes and bounds writes which never
settle, then tells the operator when crash evidence could not be confirmed. Red
regressions reproduced both missing-dialog paths; the complete startup test
file now passes (61/61), as do lint, syntax, and diff checks. Previous helper,
packaging, and probe evidence is recorded in the workplan; this final patch
still needs exact-head Linux CI and fresh review.

The preceding full strict suite passed (`--maxWorkers=4`: 5,937 passed / 19
skipped); its earlier attempt recorded 216 ms in the existing 200 ms
mission-evidence responsiveness guard, while the isolated test and the
subsequent full run passed. No responsiveness threshold changed.

`app.whenReady()` and synchronous SQLite open/migration remain outside the
interruptible watchdog. The separate Linux C19 261.161 ms outlier remains
unresolved. DON-179 remains **In Review** because opt-in upload and private
retention are outside this repair.

## Next actions

1. Require exact-head Linux CI and inspect downstream packaged checks.
2. Obtain fresh review on that exact head. Keep PR #47 draft until both clear;
   do not merge, tag, publish, or release.
