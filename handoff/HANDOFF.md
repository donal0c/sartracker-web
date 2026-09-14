# HANDOFF.md — Current state

Updated 2026-09-14. Read after `CLAUDE.md`.

## Current baseline and active work

Master is `2ab581e0acfa7e0e4be587ea0064e19bea4a7ee3`: Donal merged
[PR27](https://github.com/donal0c/sartracker-web/pull/27) on 2026-09-14.
Train D's participant completeness, audited legacy roster recovery (SAR-QA-022)
and stable Search Operations pagination are integrated. Removing participants
never clears required history; legacy recovery preserves the NULL snapshot and
appends audit evidence. See [Train D](../docs/assurance/findings/repair-train-d.md)
and [review disposition](../docs/assurance/findings/pr27-claude-review.md).
Its native qualification failure remains retained; merge is not release proof.

Active: WAR-11 / DON-7 / DON-76, draft
[PR28](https://github.com/donal0c/sartracker-web/pull/28), branch
`codex/war-11-offline-map-freshness`. Rebased onto the merged master.
Scope remains MAP-01/02/03 + AUD-11: validated package identity/content,
actual current-view tile checks, reader/raster invalidation and valid missing hatch.
The only rebase conflict was this handoff; shared main/preload/CI changes merged
automatically and require affected integration verification.

## Verification and next action

Claude review remediation is active; PR28 readiness is withdrawn and draft status
restored. Integrated CI34812540230 passed at `3ecb7b8a` (4,943 tests, six existing
skips, four browser flows and packaged map smoke), but does not cover the new
repairs. See [review disposition](../docs/assurance/findings/pr28-claude-review.md).
Local repairs and source/browser/independent review are complete; fresh exact-head
CI evidence remains required. No local Electron/build or merge is authorized.

Prior integrated head `3ecb7b8a` passed Linux CI34812540230: 467 files /
4,943 tests / six existing qualification skips, four browser flows and packaged
map smoke. Evidence ZIP10335243404 was digest/head/tree verified; A/B imagery
changed, passive/final removal had 289 transparent samples, final Check View was
0/15 missing and Not field ready, and child exit was clean (0/null).
This remains historical scoped Linux proof, superseded for the review repairs.

Current local fixes cover persisted-validation reuse, conditional settings mutation,
WAL preflight, bounded decoded-proof reuse, raster reconstruction recovery and
negative-result races. Stable correctness passes 468 files / 4,956 tests / six
existing skips; six synthetic Chromium flows, typecheck, lint and independent
reviews pass. The first full run's stale message expectation failure is retained.
Next: push this reviewed repair and verify fresh exact-head CI. No local Electron,
package build, merge or release. Default local actionlint previously timed out;
workflow-only parsing and all 32 shell steps checked serially passed.

Detailed history, clean red/green and all failed receipts remain in
[WAR-11 remediation](../docs/assurance/findings/war-11-offline-map-remediation.md).
Three macOS failures and Linux failures34776633574/34779414995/34782626004 remain
failed. The last was a stale workflow text assertion, corrected without runtime
change; its validation gap is recorded. The mixed-input browser run is excluded.

## Remaining limits

Release HOLD; DON-254 and DON-7/DON-76 remain In Progress. Strict `<200 ms`,
960k replay, tracking soak, archive lifecycle and installer/field qualification
are not established by the green map CI. Train D's deferred packaged gate is
NOT RUN. The 41 renderer diagnostics lack sufficient request attribution.
Original decoder crash PID80389 remains ours with native cause unconfirmed;
raw crash/process evidence stays private under `tmp/war-11/crash/`.

Retain DON-254's coverage result-bound race, baseline settings failures,
204.046 ms concurrent SQLite read and incomplete 239.509 ms attribution.
No private/licensed tiles or credentials were read; Windows, distribution,
provider and BCP-17 qualification remain separate. Follow the
[two-track queue](../docs/two-track-execution-workplan.md),
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md) and
[testing cadence](../docs/testing-and-review-cadence.md).
Older history is in [the archive](archive/pre-war06-repair-20260913.md).
