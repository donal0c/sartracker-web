# HANDOFF.md — Current state

Updated 2026-09-13. Read after `CLAUDE.md`.

## Current baseline and active work

Master is `2b2bf8e605e27123c9e454598828d71cb7c062aa`: PR25 legacy-recovery
observer repair is merged, following PR26 WAR-06, PR23 transport and PR24 assurance.
WAR-06's implementation, retained diagnostics and remaining domain questions are
in [its remediation record](../docs/assurance/findings/war-06/claude-review-remediation.md).
Older history is in [the archive](archive/pre-war06-repair-20260913.md).

Active here: WAR-11 / DON-7 / DON-76 on `codex/war-11-offline-map-freshness`.
Uncommitted scope is WAR-04 MAP-01/02/03 and AUD-11 only: package identity and
content validation, actual required-view tile checks, reader/raster invalidation,
and the repaired missing-coverage hatch. Train D owns mission truth; do not edit
its production seams. Its merge and subsequent rebase precede final map PR readiness.

## Verification and next action

Map work is not merge-ready. Baseline defects and synthetic controls are retained
under `docs/evidence/war-11-map/baseline/`; current findings and remaining proof are
in [the WAR-11 record](../docs/assurance/findings/war-11-offline-map-remediation.md).
Browser readiness/movement/removal flow passes. Native decoder recovery passed once
with observed clean exit; the combined packaged settings/worker/SQLite/raster path
has not been fully qualified. Two initial packaged attempts failed global
idle/loaded harness checks. After reviewed harness corrections (15 focused tests),
attempt 3 proved replacement B rendering, 15/15 checked tiles and Field ready,
then passive removal withdrew raster and readiness before revalidation. It FAILED
the final removed-package operator Check View: the mounted result remained
Current view not checked. All three Electron exits were 0 with no new crash report.
No fourth native attempt is authorized. Unit and Chromium red-first proof identified
negative-result loss after a redundant tile error; the scoped repair passes
12 focused controls and the real renderer flow, with independent review. Final
serial correctness passes 456 files / 4,829 tests in 477.61 seconds, with six
existing qualification-only skips. All 1,173 frozen inputs matched afterward.
Broader browser checks are 24 passed / 3 pre-existing tracking failures, reproduced
on clean base and retained in the WAR-11 record; do not describe that suite as green.

Next: reconcile records, commit/push the scoped
PR and obtain exact-head CI/review. Preserve
the failed native gate and separate proven stages in any scoped PR.
No commit, push, merge or release has been made for this map work. The manual now
distinguishes package validation from checked-view coverage; native proof remains open.
Use [testing cadence](../docs/testing-and-review-cadence.md) and the single
[two-track queue](../docs/two-track-execution-workplan.md).

## Remaining limits

DON-254 remains In Progress and release HOLD. The 204.046 ms concurrent SQLite
read is unresolved; this observer repair does not establish operator-read latency
under backfill. Historical 239.509 ms attribution remains incomplete. The native
probe uses a second disposable store and injected production runner; it does not
qualify default application wiring or operator load. Strict whole-candidate
responsiveness, replay/soak, provider, field and publication remain separate.
The unchanged strict threshold is `<200 ms`. WAR-11 has not read private licensed
tiles or credentials and does not qualify licensed distribution, Windows, or BCP-17.

The 2026-09-13 17:38 Electron crash was our decoder harness launch (PID 80389).
The bare-`require` evaluation failed before decoding; teardown/evaluation overlap
is an unconfirmed hypothesis. Corrected PID 95071 passed and exited 0 without a new
crash report. Original raw crash/process evidence remains local under `tmp/war-11/crash/`.

Repair Trains C/D, applicable WAR-04 remediation and remaining team requests stay
in the [coordinated ledger](../docs/assurance/coordinated-work-ledger.md).
Time-unverified current positions driving stationary attention is still an open
domain question outside these changes.
