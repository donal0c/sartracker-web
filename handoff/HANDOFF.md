# HANDOFF.md — Current state

Updated 2026-09-18 after PR38 merge and bounded release-first triage.

## Baseline and disposition

`master` is `e69485724044337fb5fee94bfbe5871916fdabf1`, the merge of PR38
from exact head `92a4f680facc98fb2aa6871228616f6f0cb809e4`. Required Linux
workflow `35390687670` passed at that exact PR head. PR38 was
documentation/control-plane evidence only; it did not change product code,
qualify a candidate, declare a freeze, or authorize release.

`DON-254` is **In Progress**. Release remains **HOLD**. Test-candidate
selection is **BLOCKED / not declared** by the current-head triage of
`TRK-001`, `GEO-002` and the retained `PKG-001` prolonged package
non-interactivity finding. These need separate bounded repair/decision work;
no product repair is included in this reconciliation PR.

## Release-first decision

**TEST CANDIDATE FROZEN / SELECTED** means exact clean source SHA, intended
version, fixture/platform matrix, artifact names, rollback artifact and stop
conditions are recorded. It may remain on qualification HOLD and is not
release approval.

**QUALIFIED FOR PROMOTION** is later: BCP-17/WAR-12, the five WAR-01 exit
gates, exact-artifact checks, original-machine confirmation and all mandatory
same-byte publication evidence pass.

`reconciliationMergeSha` is now
`e69485724044337fb5fee94bfbe5871916fdabf1`. The dry-run remains
`releaseEligible: false`.

WAR-03, WAR-07, WAR-08, WAR-09 and WAR-10 remain useful post-beta hardening
charters, not blanket prerequisites to selecting beta13. A concrete P1/P2,
absolute blocker, silent evidence loss, corrupted evidence, false completeness,
hidden/delayed current position, privacy breach or unsafe main-process stall in
one of those scopes remains promotion-blocking and needs a separate repair PR.

## Next actions and boundaries

Use the ledger/workplan as the current baton. Repair/recheck `TRK-001`
current-position priority, `GEO-002` finite/range math boundaries, and the
`PKG-001` same-profile long-duration hang before selecting a test candidate.
Then record the exact beta13 source/fixture/platform/rollback plan and keep
qualification HOLD until the five WAR-01 gates, BCP-17/WAR-12, `DON-247` and
same-byte publication evidence pass.

No product code, manual, BCP-17/WAR-12 execution, release/tag/publish, or merge
is in scope for this documentation/control-plane chunk.

## Verification snapshot

Live GitHub checks: PR38 `MERGED`; head `92a4f680facc98fb2aa6871228616f6f0cb809e4`;
merge `e69485724044337fb5fee94bfbe5871916fdabf1`; workflow `35390687670`
`success`; no open PRs at stocktake. Linear: `DON-254` remains In Progress;
`DON-247` remains open; `DON-255` remains downstream publication work.
Read-only source/test inspection confirmed the current `TRK-001` and `GEO-002`
records; no expensive qualification, package soak, release tag or publication
was run.

Older detail remains in [pre-Train C history](archive/pre-train-c-20260914.md)
and [pre-WAR-06 history](archive/pre-war06-repair-20260913.md).
