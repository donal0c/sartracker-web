# HANDOFF.md — Current state

Updated 2026-09-25. Detailed history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 is open as a draft. The earlier Linux run `36098634511` failed the C01
candidate producer check because Electron stayed alive after the operator
dismissed the fault window. The follow-up on `ace6dc0` fixed that exit path;
Linux run `36110808782` was still running on that commit when the fatal-log
rejection edge was found, so it does not verify the current follow-up.

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

Fresh review found that a rejected crash-log write could leave fatal handling
unhandled before the operator dialog. The handler now treats both evidence
writes as best effort and says when saving could not be confirmed. The new
regression first failed with the missing dialog and unhandled rejection; the
complete startup test file now passes (60/60), as does lint. Previous helper,
packaging, and probe evidence is recorded in the workplan; the new follow-up
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
