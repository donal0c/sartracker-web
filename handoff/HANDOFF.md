# HANDOFF.md — Current state

Updated 2026-09-13. Read after `CLAUDE.md`.

## Current baseline

Fresh `origin/master` is `deedab27483ad4fe1ca998a4d68afd555f4e2337`, including
merged PR23 bounded history transport and merged PR24 WAR-02B property/mutation
controls. PR24's final head is `946545a5e807779752d5eb18090462041ef3fe5b`.
Earlier PR1/PR4/PR17 tracking repairs remain merged and valid. PR19 GPX repairs,
PR20 WAR-06 investigation, PR21 attribution and PR22 gate separation are merged.
Detailed historical receipts and retained failures are in
[the pre-repair archive](archive/pre-war06-repair-20260913.md) and their linked reports.

## Active work

- **DON-267 — WAR-06 production mission-scope repair**, branch
  `codex/don-267-war06-mission-scope-repair`, based on the fresh baseline above.
  Only WAR-06-AUD-01, WAR-06-AUD-02 and WAR-06-CACHE-SIBLING are reopened:
  delayed history, deferred participant hydration and global cache reuse across
  missions. Linear is In Progress; its 2026-09-13 bookkeeping comment preserves
  the original completed fixes. [Repair contract/evidence](../docs/assurance/findings/war-06/mission-scope-repair.md).
- **DON-254 — separate legacy recovery responsiveness repair**, branch
  `codex/don-254-legacy-recovery-responsiveness`, also starts at `deedab27`.
  Linear is In Progress. The ~239 ms recovery path and strict `<200 ms`
  qualification remain distinct from the merged PR23 transport repair.

The two repair streams may proceed in parallel with disjoint production ownership.
Intended merge order: DON-267 mission-scope repair, then DON-254 recovery repair
reconciled onto that master. Donal owns both merges. Final qualification follows
the combined candidate and all remaining release-blocking dispositions; no release,
deployment or SAR-team contact is authorized here. The sole queue remains
[the two-track workplan](../docs/two-track-execution-workplan.md).

## Next actions and verification

DON-267 local repair and two independent source reviews are complete. Original
three routes and review-added races retain red/green proof. Final focused checks
pass 232 tests, both browser mission-switch flows, lint and package build. The
serial source cycle before the last adapter/cache refinement passed 4,662 tests
with six named timing exclusions; final-head ordinary CI remains the merge gate.
Actual mac-arm64 packaged restart/cache smoke passed all five launches: A cache
recovers, B rejects A/legacy caches, and fresh B displays and persists. Four broader
browser failures reproduce on untouched baseline; native coverage-worker warnings
remain recorded. See the repair record for exact inputs, attempts and limits.
The reviewed repair is [PR26](https://github.com/donal0c/sartracker-web/pull/26).
Require green ordinary CI on its final head; live head/CI receipts are in DON-267.
Donal owns merge after that gate passes.

Use [testing and review cadence](../docs/testing-and-review-cadence.md): retain
failures, diagnose before repeating, serialize heavy checks, and reuse unchanged
evidence honestly. Documentation-only reconciliation does not restart runtime gates.

## Remaining limits

Release **HOLD** remains. Strict 200 ms responsiveness, replay/soak, live-provider,
field and final-candidate qualification are separate from ordinary PR correctness.
Historical timing failures remain retained; no unrelated repair erases them.
Repair Trains C/D and applicable WAR-04 remediation remain tracked in the
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md). Remaining team
requests (maps, labels, export, external resources, evacuation, privileged settings
and multi-outing organization) remain outside these two repairs.
Time-unverified current positions driving stationary attention remains an unresolved
domain question outside this mission-scope repair.
