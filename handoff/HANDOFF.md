# HANDOFF.md — Current state

Updated 2026-09-23. Use this file as the current baton; older release snapshots
in the workplan and assurance ledgers are historical where they conflict.

## Current state

Release remains **HOLD**. PR45 is merged documentation/control-plane evidence;
it did not qualify or release Beta 13. No Beta 13 candidate is frozen, and no
qualification run, tag, publication, or team distribution has occurred.

PR #46 is merged at `d48ea1c562233630fc383e0ee21107167dd5d584`. Its successful
Linux workflow (`35915952562`) is baseline only. DON-254 remains `Done`, while
its latest issue note records two C17 coverage gaps: adversarial recursive
sanitization and bounded output identity. The current follow-up addresses only
those evidence gaps; it does not qualify BCP-17 or change release state.

DON-249/250/251 remain separate, unimplemented capabilities and are recorded as
`NOT_CLAIMED`, not passed or waived. The complete C00-C29 matrix and applicable
C19/C24 probes remain mandatory. Only successful applicable probes may yield
`SCOPE_LIMITED`; failed or missing evidence still blocks. The phase and campaign
cannot become `PASS`/`QUALIFIED` from this scope, and `releaseEligible`,
publication, or rollout authority remains false.

The release sequence is: close bounded defects and required evidence; freeze
the exact candidate/version and CI artifacts; run applicable `bcp17-final`;
complete C29; obtain the separate C27 publication decision; after publication,
verify fresh public bytes with C00; then decide controlled team distribution.
`war12-hardening` remains later after WAR-11. Any exact-candidate P1/P2 finding
or WAR-01 absolute blocker remains blocking. None of the five WAR-01 blockers
is waived: delayed/hidden current position, silent evidence loss, false
Complete/100%, corrupted evidence, or unbounded mission-scale work on Electron
main. C17 coverage residuals, C01, C11, DON-264, PKG-001, C29, C27 and C00 keep
their distinct gates.

## Active work and blockers

- Current worktree branch: `codex/don-254-c17-evidence`, based on PR #46's
  merged `origin/master` commit `d48ea1c562233630fc383e0ee21107167dd5d584`.
- The follow-up adds a fixed hostile-value corpus for renderer and Electron
  sanitizers, descriptor-only traversal that does not invoke getters, and
  independently bounded/hash-bound output and source-corpus receipts. Draft PR,
  fresh exact-head review, and Linux packaged proof are pending.
- PR #46 workflow `35915952562` succeeded at its exact merge SHA. It skipped
  strict timing/960k, participant backup, Train D validation, tracking soak,
  and archive lifecycle; it is baseline evidence only.
- Linear DON-254 is `Done`; the follow-up is evidence work and does not change
  that status. BCP-17 qualification and release remain on HOLD.
- Do not contact SAR team members, start qualification, tag/publish, promote,
  or claim field/operational readiness as part of this work.

## Verification snapshot

Local follow-up checks: focused C17 suites passed (35 tests); lint, build, and
`git diff --check` passed. `npm run test:correctness -- --no-file-parallelism`
passed before the final source-receipt shape correction; the affected focused
suite passed after it. The generated version file was restored after build.
Exact-head Linux packaged validation and independent review remain pending.

## Next actions

1. Create and review the narrow draft PR; wait for its exact-head Linux
   packaged C17 proof and independent review.
2. Record the exact evidence in the handoff and a DON-254 comment. Do not merge,
   run candidate qualification, tag, publish, or contact the SAR team.

Detailed earlier receipts remain in [handoff/archive](archive/) and the
[two-track execution workplan](../docs/two-track-execution-workplan.md).
