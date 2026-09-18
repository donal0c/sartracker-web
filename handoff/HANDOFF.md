# HANDOFF.md — Current state

Updated 2026-09-18. Read after `CLAUDE.md`.

## Baseline and disposition

`origin/master` is the PR37 merge
`6b0b5e0cd8ce7c58060afd740ada8a0343ca655e`, from exact head
`1640edb2dfd558c0d26d40e41b1d6c516dea4a28`. Required Linux workflow
`35380031004` passed at that exact head. PR37 is documentation/control-plane
reconciliation evidence only; it does not fix product hazards, qualify a
candidate, declare a freeze, authorize release, or start BCP-17/WAR-12.

`DON-254` is **In Progress**. Candidate freeze and release remain
**BLOCKED / not declared**. The five WAR-01 absolute blockers remain
`open-blocking`; WAR-03, WAR-07, WAR-08, WAR-09 and WAR-10 remain unexecuted
with no bounded receipt or authoritative disposition. The qualification dry run
remains `releaseEligible: false`; `DON-247` original-machine qualification is
still open.

## Active work and recovered charter

The original WAR-03/07/08/09/10 scopes, hazard IDs, ownership seams, red
controls, completion rules, complexity/model recommendations and provenance are
recorded in [the coordinated ledger](../docs/assurance/coordinated-work-ledger.md).
They were recovered from current hazard rows, the active workplan and prior
coordinator task history; they are not new programme scope and none is accepted
as executed evidence. Launches are analysis-first/read-only. P1/P2 or absolute
blocker findings require a separate repair PR or Donal architecture decision.

Recommended order: WAR-03 first; WAR-07 and WAR-08 in parallel only with
explicitly disjoint ownership; WAR-09 after the evidence contract is frozen;
WAR-10 after the WAR-07 worker/main boundary is explicit. Read-only fixture
preparation may overlap, but shared semantic and archive dispositions are
serialised.

## Next actions and boundaries

Use the ledger/workplan as the current baton. Complete the five WAR-01 exit
proofs, the five recovered WAR dispositions, confirmed P1/P2 rechecks, exact
candidate qualification, original-machine confirmation and same-byte
publication evidence before any freeze or release claim. The candidate procedure
now records
`reconciliationMergeSha=6b0b5e0cd8ce7c58060afd740ada8a0343ca655e`; do not
substitute PR37's head or workflow SHA.

No product code, manual, BCP-17/WAR-12 execution, release/tag/publish, or merge
is in scope for this documentation/control-plane chunk.

## Verification snapshot

Live checks confirmed PR37 `MERGED`, exact head `1640edb2dfd558c0d26d40e41b1d6c516dea4a28`,
merge `6b0b5e0cd8ce7c58060afd740ada8a0343ca655e`, workflow `35380031004`
`success`, and no open PRs at the time of reconciliation. Documentation checks
are `git diff --check`, stale-current-baseline search, and link/identifier
inspection; product test suites are intentionally not rerun for this docs-only
change.

Older detail remains in [pre-Train C history](archive/pre-train-c-20260914.md)
and [pre-WAR-06 history](archive/pre-war06-repair-20260913.md).
