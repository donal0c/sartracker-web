# HANDOFF.md — Current state

Updated 2026-09-23. Use this file as the current baton; older release snapshots
in the workplan and assurance ledgers are historical where they conflict.

## Current state

Release remains **HOLD**. PR45 is merged documentation/control-plane evidence;
it did not qualify or release Beta 13. No Beta 13 candidate is frozen, and no
qualification run, tag, publication, or team distribution has occurred.

This work prepares a reviewable DON-254 change for the user's bounded Beta 13
claim: controlled team testing with synthetic, replayed, or disposable data and
an independent primary source. The prepared private MBTiles route is in scope;
map administration and raw licensed-source packaging remain next-release work.
No application behavior is added by this change.

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

- Current worktree branch: `codex/beta13-release-scope-control`, based on clean
  `origin/master` `f2fd1216b64f6363150dbaa0a8fa961f52789345`.
- Prepare a review-ready PR for the fixed claim-scope handling, admission
  predicates, tests and planning/assurance reconciliation. Independent fresh
  review found no remaining actionable issue after the C27 `NOT_RUN` admission
  correction. The branch PR and exact-head CI remain to be created and checked.
- PR45 is merged at `f2fd1216…`; its master Linux validation run
  `35892396753` completed successfully at that exact SHA. This is baseline
  evidence only, not Beta 13 candidate qualification.
- Linear connector reauthentication failed for DON-249/250/251/254/264. Their
  live status/comments were not verified or changed; do not infer issue state.
- Do not contact SAR team members, start qualification, tag/publish, promote,
  or claim field/operational readiness as part of this work.

## Verification snapshot

Final local source checks on this worktree: the eight focused qualification
control-plane suites passed (80 passed, 1 skipped); `npm test --
--no-file-parallelism` passed (569 files, 5,835 passed, 19 skipped); `npm run
lint` passed; `npm run build` passed TypeScript, Vite and bundle budgets;
`git diff --check` and the campaign-plan JSON parse passed. Build noted the
repository's existing six-month-old Browserslist data. The generated version
file was restored after build. These results do not qualify a candidate.

## Next actions

1. Finish focused tests and static checks; inspect the complete diff.
2. Get an independent fresh review of the exact final head and address findings.
3. Push and open the requested PR; wait for its exact-head checks and approvals.
4. Confirm `DON-254`/related Linear state once connector authorization works;
   until then, leave those states explicitly unverified.

Detailed earlier receipts remain in [handoff/archive](archive/) and the
[two-track execution workplan](../docs/two-track-execution-workplan.md).
