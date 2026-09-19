# HANDOFF.md — Current state

Updated 2026-09-19 during the bounded TRK-001 current-position repair.

## Current state

Live `origin/master` is `e5673c9c4fb1b8497d28f4871b793937f85ad2ef`, the PR39
merge. The active repair branch is
`codex/trk-001-current-position-repair`, based on that exact live head.
No merge, release, tag, publication, or candidate selection has been made.

PR #40 (`codex/geo-002-pre-candidate-repair`) now includes the bounded drawing
math and persisted-overlay repairs. PR #41 remains a separate tracking repair
branch and must not be merged through this branch.

## Active work

**TEST CANDIDATE FROZEN / SELECTED** means exact clean source SHA, intended
version, fixture/platform matrix, artifact names, rollback artifact and stop
conditions are recorded. It may remain on qualification HOLD and is not
release approval.

**QUALIFIED FOR PROMOTION** is later: BCP-17/WAR-12, the five WAR-01 exit
gates, exact-artifact checks, original-machine confirmation and all mandatory
same-byte publication evidence pass.

The current handoff does not authorise an exception to the repair boundary. Any
future Donal architecture decision must be explicit, named and separately
recorded; prose here cannot substitute for that decision.

The release-first dry-run remains `releaseEligible: false`; beta13 remains
HOLD while TRK-001, GEO-002, and PKG-001 are unresolved.

WAR-03, WAR-07, WAR-08, WAR-09 and WAR-10 remain useful post-beta hardening
charters, not blanket prerequisites to selecting beta13. A concrete P1/P2,
absolute blocker, silent evidence loss, corrupted evidence, false completeness,
hidden/delayed current position, privacy breach or unsafe main-process stall in
one of those scopes remains promotion-blocking and needs a separate repair PR.

## Active TRK-001 repair

The bounded implementation now starts the current-position producer before an
unresolved cache read, preserves current publication through a transient
participant-scope reload using only the last trusted mission scope, keeps
history/evidence admission fail-closed, rejects operational callbacks for
finished/finalized missions, and treats automatic recovery as paused so
last-known positions remain visible without a provider request. Disposal and
replacement custody boundaries remain unchanged.

Focused runtime coverage is green: 226 tests across polling-manager,
start-tracking-runtime, start-app-runtime, and mission-tracking-status-bridge;
WAR-06 cache-boundary coverage is 136/136. The final full source run passed
5,129/5,129 tests. Native Tauri coverage passed 58 tests with one documented
OS-keychain test ignored.

Browser-backed validation on the repair branch exercised mission start,
participant injection, paused tracking warning, reload recovery prompt, and
the recovery “tracking not live” state through the local browser harness. The
provider was intentionally unconfigured in that harness, so this is browser
behavior evidence, not live-provider or packaged Electron proof. The full
source run previously showed one unrelated contention-sensitive heartbeat
flake in isolation; the final run passed cleanly.

## Next actions and boundaries

Use the ledger/workplan as the current baton. Repair/recheck `TRK-001`
current-position priority, `GEO-002` finite/range math boundaries, and the
`PKG-001` same-profile long-duration hang before selecting a test candidate.
Then record the exact beta13 source/fixture/platform/rollback plan and keep
qualification HOLD until the five WAR-01 gates, BCP-17/WAR-12, `DON-247` and
same-byte publication evidence pass.

Do not mark the PR ready until the parallel GEO-002 work has merged and this
branch has been rebased onto that merge. Keep DON-254 In Progress, release
HOLD, and PKG-001's exact-beta13 same-profile gate unchanged.

## Verification snapshot

Live GitHub checks: origin/master `e5673c9c4fb1b8497d28f4871b793937f85ad2ef`;
no GEO-002 PR or merge was visible at stocktake; no open PRs were visible.
Linear: DON-267 remains In Progress, DON-254 remains In Progress, and release
HOLD remains unchanged. No browser, packaged, hosted, production, merge, or
release claim is made from the local checks above.
Read-only source/test inspection confirmed the current `TRK-001` and `GEO-002`
records; no expensive qualification, package soak, release tag or publication
was run.

Older detail remains in `handoff/archive/`.
