# HANDOFF.md — Current state

Updated 2026-09-17. Read after `CLAUDE.md`.

## Baseline and active lane

`origin/master` is `c467f65db8036f1db23652fc0fc7c76369717885`, the merge of
[PR32](https://github.com/donal0c/sartracker-web/pull/32). There are no open
pull requests. The post-merge `master` workflow
[`35199520928`](https://github.com/donal0c/sartracker-web/actions/runs/35199520928)
is still running; do not describe the merged baseline as green until it
completes successfully.

PR32 closed the scoped Repair Train D follow-up. Its validated implementation
head was `58ea29005b17a34e69f52ad44966a42f9c63d0aa` with tree
`c890c1fd2f713a195b2ec56132e4ac6c7b38e954`. Required Linux workflow
`35177287167` passed source, strict responsiveness, rendered/browser, package,
Train D receipt, tracking-soak, archive-lifecycle and AppImage boundaries.
Ordinary PR workflow `35179847412` also passed. Later PR32 commits were
documentation-only and preserved the qualified executable/test/configuration
trees.

## Current coordinated queue

The three streams are one queue; parallel work requires disjoint production
ownership.

1. **Deep audit:** thirteen of fourteen confirmed `AUD-*` groups are repaired
   and merged. Only `AUD-12` (Clear Alias retains the saved alias) remains, a
   P3 store/controller/UI repair suitable for the next coherent UI batch.
2. **Team requirements:** the highest-priority unfinished workflow is the
   private Discovery-map raw-source-to-MBTiles preparation and distribution
   path (`DON-144`/`DON-7`/`DON-76`). Also retained are Search Area manual label
   placement (`DON-214`), map export/print (`DON-216`), external-resource model
   (`DON-217`), evacuation/gear-log ownership (`DON-218`), privileged Settings
   and mission unlock/recovery (`DON-219`–`DON-221`), multi-day layer grouping
   (`DON-100`), and the later Marker Details simplification.
3. **WAR:** WAR-01, WAR-13A, WAR-04, WAR-04B, WAR-02A, WAR-02B, WAR-06 and
   several WAR-11 repair trains are complete/merged. WAR-04's three
   settings/startup findings (`WAR04-SET-01..03`) and three diagnostics/privacy
   findings (`WAR04-PRV-01..03`) remain confirmed repair inputs. WAR-03,
   WAR-07, WAR-08, WAR-09 and WAR-10 remain unexecuted. WAR-05 needs the real
   Mint machine/tester. WAR-12 is the final frozen-candidate qualification and
   WAR-13B starts only after an internal beta is published.

The recommended next production repair is a bounded WAR-11 train for the six
confirmed WAR-04 settings/startup and diagnostics/privacy defects. A disjoint
WAR-03 coordinate/geodesy test-hardening slice may run in parallel. Do not run
the official-map administration/distribution implementation concurrently with
the settings repair until exact file/state ownership proves they do not overlap.

## Limits and next action

Release, deployment, BCP-17/WAR-12, official-map distribution, field and human
acceptance remain HOLD/unproven. The historical macOS unpaired
`coverage-revision-moved` diagnostic remains retained and unallowlisted. The
strict `<200 ms` predicate remains unchanged; merge evidence is not a release
qualification claim.

Linear was reconciled live on 2026-09-17. `DON-254` had been marked Done before
its own BCP-17 completion contract was met; it is reopened In Progress with a
comment preserving PR32's scoped evidence and the remaining final-candidate,
machine, field and publication gaps. `DON-271` and `DON-279` are correctly Done.
Map owners `DON-7`/`DON-76` and machine qualification `DON-247` are In Progress;
`DON-144` is Todo; the other retained team issues remain Backlog/Todo as named.

Next: wait for post-merge `master` CI, then
start only the chosen chunk(s) from the [two-track queue](../docs/two-track-execution-workplan.md)
and [coordinated ledger](../docs/assurance/coordinated-work-ledger.md). Do not
start WAR-12 until feature freeze and all release-blocking findings have a
policy-valid disposition.

Older history: [pre-Train C archive](archive/pre-train-c-20260914.md) and
[earlier archive](archive/pre-war06-repair-20260913.md).
