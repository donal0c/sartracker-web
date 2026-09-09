# HANDOFF.md — Current state

Updated 2026-09-09. Read after `CLAUDE.md`.

## Where we are

- Active: DON-256 first twelve-item Sar_4 UI batch on
  `codex/team-ui-feedback-batch-1`, base `3cdf555d`. Shared-renderer changes add
  persistent tracking awareness, compact mission controls, complete rail collapse,
  explicit device-list scrolling and a persisted contrast option. No native,
  schema, archive or tracking-pipeline changes. Source 398 files/4,143 tests,
  lint/build, 27 stable mission/UI tests and 23 independent screenshot reviews
  passed; both focused reviews resolved. [Evidence](../docs/ui-feedback-batch-1-evidence.md)
  records all twelve dispositions. Exact-head attestations/CI are tracked on
  the batch PR and DON-256; Donal retains merge authority.

- [PR #10](https://github.com/donal0c/sartracker-web/pull/10), programme PR6
  archive lifecycle, merged to `master` at `e0ead68852b10606551302b5104e409634c962e1`.
  DON-248, DON-252 and DON-253 are Done. All 95 external-review findings have
  fixes or explicit dispositions in the [complete ledger](../docs/breadcrumb-pr6-complete-review-ledger.md).
- Documentation cleanup records the final testing approach below. Start new work
  from current `master`; the archive PR does not need another review cycle.
- Next programme steps: WAR-04B's narrow merged-head refresh, then BCP-17 final
  candidate qualification before DON-255 publication. Use the
  [workplan](../docs/two-track-execution-workplan.md#next-task-order) and live Linear
  issues for scope. Merge is complete; release/field acceptance is not established.
  DON-247 and DON-264 remain separate reliability work.

## Testing approach to carry forward

Follow [Testing and review cadence](../docs/testing-and-review-cadence.md):
reproduce narrowly, fix and run affected tests, complete one stable source cycle,
exercise relevant UI/native boundaries, then normal CI. Reuse unaffected evidence
with explicit source identity. Broaden only for changed risks, failed evidence,
or release requirements; do not automatically restart the entire qualification.

## Verification and remaining limits

- Tested PR head `1b1f86ee`: [Linux CI](https://github.com/donal0c/sartracker-web/actions/runs/34324371898)
  passed 4,137 tests / 396 files, lint/build, 960k replay, packaged tracking,
  archive lifecycle and AppImage launch. Downloaded receipt independently passed
  exact-head/tree, teardown and privacy validation.
- Local source/build, four Chromium + three visual flows, four screenshot reviews
  and clean macOS packaged lifecycle passed. Detailed receipts and measurements
  live in the complete ledger; this is pre-merge engineering evidence.
- Prior GPX timing rejection remains unexplained but did not recur in focused
  local/Linux checks or final CI. Limits were unchanged; Linux frame maximum
  198.1 ms has narrow headroom below 200 ms. Temporary plaintext can remain after
  a crash until restart recovery; no forensic-erasure guarantee.
- Historical scale/interruption proof and the protected original fixture identity
  are in the [PR6 evidence](../docs/breadcrumb-pr6-evidence.md) and
  [archived handover](archive/pr6-closeout-history-20260909.md).
  Never open the original closed fixture with SQLite; copy it first.
