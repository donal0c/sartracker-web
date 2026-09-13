# HANDOFF.md — Current state

Updated 2026-09-13. Read after `CLAUDE.md`.

## Current baseline and active work

Master is `2b2bf8e605e27123c9e454598828d71cb7c062aa`: PR25 legacy-recovery
observer repair is merged, following PR26 WAR-06, PR23 transport and PR24 assurance.
WAR-06's implementation, retained diagnostics and remaining domain questions are
in [its remediation record](../docs/assurance/findings/war-06/claude-review-remediation.md).
Older history is in [the archive](archive/pre-war06-repair-20260913.md).

Active here: WAR-11 / DON-7 / DON-76 on `codex/war-11-offline-map-freshness`.
Draft [PR28](https://github.com/donal0c/sartracker-web/pull/28), source head
parent `fda23be04dd27b0f26f9b10a4756ac56d64a4a6f`, covers MAP-01/02/03 and AUD-11 only: package identity and
content validation, actual required-view tile checks, reader/raster invalidation,
and the repaired missing-coverage hatch. Train D owns mission truth; do not edit
its production seams. Its merge and subsequent rebase precede final map PR readiness.

## Verification and next action

Map work is not merge-ready. Baseline defects and synthetic controls are retained
under `docs/evidence/war-11-map/baseline/`; current findings and remaining proof are
in [the WAR-11 record](../docs/assurance/findings/war-11-offline-map-remediation.md).
Three macOS packaged attempts remain failed; attempt 3 proved replacement rendering
and passive withdrawal but failed the final removed-package Check View. The later
negative-result repair has unit/browser proof. All exits were clean; no fourth local
native run is authorized. Broader browser results remain 24 passed / three tracking
failures reproduced on the clean base. Linux CI `34776633574` failed initial rendering
at the wrong camera; its reviewed harness correction preserves the 10-second gate.
Prior counts, receipts and camera-test provenance gaps are in the WAR-11 record.

Linux CI `34779414995` then failed passive removal: replacement B pixels remained
despite withdrawn readiness. Its exact native event cause was not recorded.
A real Chromium reproduction confirmed global style readiness can starve raster
eviction while an unrelated source is pending. The structural repair now removes
the official source/layer without waiting for tile completion, with explicit
mutation postconditions. Clean red: two browser failures / one control pass;
10 unit failures / one pass. Final green: 23 focused controls, four browser flows,
456 files / 4,849 correctness tests / six existing qualification skips (502.56s).
The frozen 1,174 inputs matched at completion. A separately bound CI-only delta
adds the four browser flows before packaging; exact command, actionlint and
independent map-safety/workflow reviews pass. Evidence and invalid mixed-run
provenance are in the WAR-11 record. Fresh remote CI is still required.
No further local Electron/build. Next: push this verified repair/evidence and obtain exact-head CI on draft PR28,
then integrate Train D after its merge and recheck affected inputs.
The source is committed/pushed; no merge or release has been made. The manual now
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
