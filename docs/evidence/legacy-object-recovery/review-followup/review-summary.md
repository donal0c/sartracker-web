# PR 25 deep review — consolidated (DON-254)

Scope: 71 files, +3384/-124, but only ~930 lines of real change.
Production code unchanged (verified: empty diff across src/ electron/).

## My own verification (run locally on c93b6925)
- `npx tsc -b` clean; `eslint` clean on all six changed source files
- `tests/unit/legacy-recovery-completion.test.ts` + custody test: 14 passed
- migrated 50k object test: PASS, maximumHeartbeatGapMs = 11.54 ms
- migrated 500k event test: PASS, maximumHeartbeatGapMs = 12.54 ms
- independent real-clock control (300 ms synchronous block, no fake timers):
  observer reported > 200 ms -> the new gate genuinely still detects main-thread stalls
- CI: "Build and inspect Linux Electron artifacts" SUCCESS; mergeStateStatus BLOCKED (review required)

## Disproved agent claim
- "bounded() leaks an unhandled rejection when the timeout wins" -- FALSE.
  Promise.race attaches reactions to both inputs, so the late rejection is handled
  (swallowed), not fatal. Same reasoning clears observeLegacyRecoveryCompletion.

## Findings
See w1-smoke-script.md, w1-custody-oracle.md, w1-measurement.md, w1-claims-ci.md
for file:line detail. Ranked list in the session summary.
