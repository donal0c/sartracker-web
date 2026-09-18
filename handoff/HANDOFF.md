# HANDOFF.md — Current state

Updated 2026-09-18. Read after `CLAUDE.md`.

## Baseline and active lane

`origin/master` is `f7798a19589b5d907408080dc65e2d2739767130`, the merge of
[PR36](https://github.com/donal0c/sartracker-web/pull/36). PR35 and PR36 are
merged; the current reconciliation is being prepared on
`codex/post-pr36-release-readiness` as a documentation/control-plane PR.

PR35 merged at `ea4b92eb82646b12b2d8ad2307e242ed8049d35c` from head
`990a7f16885984e40b53c3261f9de23e17a104ab`. Its exact-head Linux workflow
`35242591823` passed the repaired legacy recovery boundary. The earlier exact
head `d76bd61f7c3cfc43f102007ea7de7ef579495184` receipt
`35221533225` failed the unchanged strict `<200 ms` predicate during first
launch; its `512.449076 ms` main-loop maximum and all failure artifacts remain
retained.

PR36 merged at `f7798a19589b5d907408080dc65e2d2739767130` from head
`ed3c69f342a9a9f3bc60d7fb1390743f59210ad0`. Required Linux workflow
`35332400799` passed at the exact head. It verifies the best-effort worker-side
PASSIVE checkpoint, real-worker receipt handling, parent `-wal` observation,
and packaged legacy recovery observer proof. It is repair/merge evidence only:
the workflow intentionally did not execute the complete BCP-17/WAR-12 release
matrix, including strict 960k replay, field-scale, soak, archive, or original-
machine proof.

## Current disposition

The SQLite checkpoint/contention blocker is fixed at the PR36 repair boundary.
Checkpoint contention is now non-fatal telemetry; genuine reconstruction
failures remain fail-closed. The retained
[close-path finding](../docs/assurance/findings/legacy-recovery-close-path-20260917.md)
records both the failed PR35 receipt and the later passing receipt. The strict
`<200 ms` predicate is unchanged.

Release and candidate freeze remain **BLOCKED / not declared**. All five
WAR-01 absolute blockers remain `open-blocking` pending exact candidate exit
evidence. WAR-03, WAR-07, WAR-08, WAR-09 and WAR-10 have no current bounded
investigation receipt or authoritative disposition and therefore cannot be
treated as cleared or safely deferred. The qualification dry run remains
`releaseEligible: false`; it proves control-plane plumbing, not product
qualification. `DON-254` is In Progress and `DON-247` original-machine
qualification remains open.

The current authoritative reconciliation is in
[the coordinated ledger](../docs/assurance/coordinated-work-ledger.md) and
[the two-track workplan](../docs/two-track-execution-workplan.md). The
candidate-freeze procedure there is a merge-ready procedure, not a claim that
a candidate has been frozen.

## Freeze prerequisites and next action

Before BCP-17/WAR-12, the team must close or policy-validly disposition every
confirmed P1/P2 and all five WAR-01 absolute blockers, complete the missing WAR
investigations, and produce one exact candidate receipt. The eventual
reconciliation PR merge SHA must be filled into the candidate record after
merge; neither this PR head nor its pre-merge base may be substituted.

The intended next candidate is `0.1.0-beta.13`, tag
`electron-v0.1.0-beta.13`, using the exact CI-built AppImage, installed `.deb`,
`SHA256SUMS`, declared fixture identities/checksums, Linux matrix, rollback
artifact and fail-closed stop conditions recorded in the workplan. No beta13
candidate or artifact exists yet. The last published beta12.11 remains the
rollback reference, not current qualification evidence.

## Verification snapshot

For the PR36 repair branch, the retained local evidence is 55 focused
checkpoint/runner/report tests, four real-worker cases, the full source suite
(`5,122/5,122`), TypeScript build, lint, bundle budgets and a rebuilt macOS
packaged diagnostic smoke. The exact merged PR36 Linux workflow is
`35332400799`. These are scoped repair and local diagnostics; they do not
replace candidate, field, human-acceptance or production evidence.

Older detail is archived in [pre-Train C history](archive/pre-train-c-20260914.md)
and [pre-WAR-06 history](archive/pre-war06-repair-20260913.md).
