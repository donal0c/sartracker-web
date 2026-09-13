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

Claude's review of `7fc4aa08` withdrew the earlier readiness verdict. Its six
blockers and additional cache/status findings are addressed in the
[remediation record](../docs/assurance/findings/war-06/claude-review-remediation.md),
including a follow-up cache-age retention fix. Live coordinates win; cached rows
and trails retain visible provenance without overwriting connection state.
Timer publication now preserves same-mission pause while fencing mission changes.
M1/M3b/M13 and the actual final timer guard have falsifying source-mutation proof.

Stable local correctness: 4,684 tests / 444 files, six existing timing exclusions;
focused 254 tests, three browser flows, lint/build and five-launch mac-arm64
packaged cache smoke pass. Local package inputs are hashed, not claimed as a
clean committed build. Earlier agent reviews were within the author-controlled
Codex run, not external approval. Known broader baseline browser failures and
native coverage/listener warnings remain recorded; release HOLD is unchanged.

[PR26](https://github.com/donal0c/sartracker-web/pull/26) requires green ordinary
CI on its final committed head. DON-267 and the PR carry the live head/CI receipt
and terminal Linux artifact inspection. Then it is ready for Donal's re-review;
Donal owns merge. No merge, release or new external approval is claimed here.

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
