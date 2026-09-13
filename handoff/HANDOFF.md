# HANDOFF.md — Current state

Updated 2026-09-13. Read after `CLAUDE.md`.

## Current baseline and active work

Master is `8f93f8d1cc4554178706e23401ecd496d1193195`: PR26 WAR-06 mission-scope
repair is merged, following PR23 transport and PR24 property/mutation work.
WAR-06's implementation, retained diagnostics and remaining domain questions are
in [its remediation record](../docs/assurance/findings/war-06/claude-review-remediation.md).
Older history is in [the archive](archive/pre-war06-repair-20260913.md).

PR25 / DON-254 on `codex/don-254-legacy-recovery-responsiveness` is a test/tooling
repair. It observes real production worker completion/exit, then independently
checks stored evidence, with strict 200 ms and final-tail gates. The latest review
follow-up fixes recursive evidence binding, pins the audit oracle to a real store
write in ordinary tests, removes the GPX self-poll, isolates native restart timing,
and adds CI report validation and relevant master-push verification.
[Current review disposition](../docs/assurance/findings/legacy-recovery-review-followup.md).

## Verification and next action

The latest [PR25 terminal receipt](https://github.com/donal0c/sartracker-web/pull/25)
binds the final source/CI head, native artifact, custody proof and merge readiness.
Earlier `c93b6925` proof is historical after this follow-up; its evidence README
and manifest distinguish source snapshots from current inputs. Do not infer
readiness from old READY comments. Donal owns merge; no merge/release is authorized.

Local stable correctness passes 447 files / 4,731 tests with the same six
qualification-only skips. Focused custody/report controls and separated native
restart intervals pass. The terminal PR receipt records final strict affected
timings, build/lint and exact-head CI/artifact checks; require it before READY.
Operator behavior is unchanged; no manual edit.
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
