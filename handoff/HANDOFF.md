# HANDOFF.md — Current state

Updated 2026-09-13. Read after `CLAUDE.md`.

## Current baseline and active work

Master is `2b2bf8e605e27123c9e454598828d71cb7c062aa`: PR25 and PR26 are merged.
DON-267 is Done; DON-254 remains In Progress and release remains HOLD.
Repair Train D (`codex/repair-train-d`) owns AUD-08 / DON-271 participant
completeness and AUD-09 / DON-279 Search Operations pagination. It merges first;
parallel Train C map work rebases afterward. Both current-base regressions are
reproduced and repaired. New group selections retain immutable starting rosters;
legacy rows disclose reconstructed scope. Search pages use a durable scoped
generation and recover locally without clearing other evidence-read errors.
The [Train D record](../docs/assurance/findings/repair-train-d.md) owns proof.
Stable affected browser checks passed 23 tests, then eight participant tests
after a stricter checkpoint correction. Independent review confirms missing,
interior and same-boundary checkpoint cases now fail closed. One legacy null
roster with only earlier departure evidence is now unknown and unfinishable;
30 focused and 101 adjacent tests pass with independent native rechecks.
Browser checkpoint bounds and retired-area ID reuse now match native rejection;
44 browser/harness tests pass and the latter guard is independently reviewed.
Final full correctness passes 4,785 tests / 453 files with six existing exclusions;
23 affected Chromium flows and lint pass. Fresh package builds, but native
attempt 1 fails on a stale smoke locator after group removal and diagnostic
capture overflow. Electron exited cleanly with no new crash or residual process.
Harness locator and diagnostic collection corrections pass 22 focused tests;
the actual active-roster browser regression passes 2 tests after a recorded red.
Final independent harness review cleared diagnostics/CI and the cleanup-reserve
correction, which has four fake-child red/green cases. Implementation
`cc989877a850ed349269bdf4cb562dfd7c4846dc` is pushed in
[PR27](https://github.com/donal0c/sartracker-web/pull/27); its current checks and
review attestations control scoped merge readiness. Native attempt 1 remains FAILED.
First PR CI passed 4,793 tests but failed one stale unquoted-command assertion;
its test-only correction requires fresh exact-head CI. Application inputs are unchanged.
Three settings failures match clean master and
remain a separate retained candidate in the coordinated ledger.
Source-only reproduction also proves a pre-existing coverage result-bound race:
main inventory limit 1 versus later worker inventory 2 rejects valid chunks;
the fresh-limit control passes. DON-254 owns a high-priority bounded coverage
repair outside Train D, with exact provenance/design options in the ledger.
This remains a native diagnostic blocker and release HOLD.
WAR-06's implementation, retained diagnostics and remaining domain questions are
in [its remediation record](../docs/assurance/findings/war-06/claude-review-remediation.md).
Older history is in [the archive](archive/pre-war06-repair-20260913.md).

Merged PR25 is a test/tooling observer repair, not release qualification.
Its [review disposition](../docs/assurance/findings/legacy-recovery-review-followup.md)
and terminal PR receipt retain the source, CI and packaged evidence.

## Verification and next action

Complete exact-head PR checks and review attestations; retain attempt 1
as failed. Production hashes are unchanged since the full correctness cycle.
Do not repeat native runs on unchanged baseline blockers.
The scoped repair may proceed to PR with the native/release gap explicit;
only its new packaged proof is manual opt-in, and ordinary CI records NOT RUN.
Existing gates remain unchanged. Exact-commit reviews and CI still remain. The operator manual
reflects the progress/recovery rules.
Do not infer current readiness from earlier PR25 or pre-review Train D evidence.
Donal owns merge; no merge/release is authorized here.
Use [testing cadence](../docs/testing-and-review-cadence.md) and the single
[two-track queue](../docs/two-track-execution-workplan.md).

## Remaining limits

DON-254 remains In Progress and release HOLD. The 204.046 ms concurrent SQLite
read is unresolved; this observer repair does not establish operator-read latency
under backfill. Historical 239.509 ms attribution remains incomplete. The native
probe uses a second disposable store and injected production runner; it does not
qualify default application wiring or operator load. Strict whole-candidate
responsiveness, replay/soak, provider, field and publication remain separate.

Repair Trains C/D, applicable WAR-04 remediation and remaining team requests stay
in the [coordinated ledger](../docs/assurance/coordinated-work-ledger.md).
Time-unverified current positions driving stationary attention is still an open
domain question outside these changes.
