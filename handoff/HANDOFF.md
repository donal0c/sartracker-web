# HANDOFF.md — Current state

Updated 2026-09-14. Read after `CLAUDE.md`.

## Current baseline and active work

Master is `cda87aa03f27eb69532ae9506aa9e719cef7e364`, including merged PR27
(Train D) and PR28 (official-map freshness). Refreshed against origin on
2026-09-14. Earlier PR28 draft/review statuses are historical.

Repair Train C is active on `codex/repair-train-c`: AUD-04 equal overlay
writes and AUD-06 repeated Go To/style-loading target loss. Current-style
getter guards preserve real overlay changes; active target ownership survives
pending acknowledgement. New navigation cancels stale basemap camera restores.
No layer-catalog files are needed, so AUD-12 remains deferred. DON-264's broader
persistent-warning feature and DON-6's full parity acceptance remain open.

## Verification and next action

Red/green evidence and accepted review corrections are in
[Train C](../docs/assurance/findings/repair-train-c.md).
Focused source tests, three synthetic rendered map regressions, five existing
overlay browser flows and review-strengthened navigation rechecks pass.
Owner inspected the rendered target screenshots. The initial full source run
was interrupted for the review-discovered stale camera restoration defect;
the final stable source cycle passes 471 files / 4,970 tests with six existing
qualification skips. Lint, TypeScript/build/bundle budgets, workflow syntax and
independent source/evidence reviews pass. Exact-head CI remains required.
Commit/push and open the PR, then verify CI; Donal owns merge.

## Remaining limits

Release remains HOLD. Strict `<200 ms`, replay/soak, installer/field and
official-map distribution qualification are separate. Train D's deferred
packaged gate remains NOT RUN. Earlier map/native failures and diagnostic
attribution gaps remain retained; this renderer repair does not close them.
Electron coverage IPC, service-worker registration, mission-store enumeration
and diagnostic custody remain owned by the parallel native-runtime task.

See the [coordinated ledger](../docs/assurance/coordinated-work-ledger.md),
[two-track queue](../docs/two-track-execution-workplan.md), and
[testing cadence](../docs/testing-and-review-cadence.md).
The previous handoff and its detailed historical failures are retained
[here](archive/pre-train-c-20260914.md).
