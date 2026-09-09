# HANDOFF.md — Current state

Updated 2026-09-09. Read after `CLAUDE.md`.

## Where we are

- [PR #15](https://github.com/donal0c/sartracker-web/pull/15), Team Feedback
  Batch 2, is locally verified in `codex/team-ui-feedback-batch-2`,
  pinned to fetched master `c51e4b3537c4b026f7079dd40193a894cedcdd9f`.
  DON-215 and the workplan contain the contract. The implementation
  includes independent category/device visibility, a read-only replay map and
  the approved bounded native object-detail read (no schema/archive-format change).
  AUD-07/AUD-14 were added by central triage: hidden-hit selection and truthful
  history-failure wording both have current-code red/green regressions; the clue
  hide/show browser control and joined poller/database warning proof pass.
  Final source: 407 files / 4,179 tests passed. Affected browser: 37 passed;
  drawings: 14 passed; final visibility recheck and independent capture review pass.
  Five replay/search visual captures cleared independent review after rechecks.
  Packaged macOS live/archive geometry proof passes; measured frame maximum
  34.6 ms against the unchanged 200 ms gate. Both focused reviews cleared their
  findings. Final-SHA attestations and exact-head CI remain required before
  review-ready closeout. See [evidence](../docs/ui-feedback-batch-2-evidence.md).
  The PR checks/body and DON-215 hold final-head CI and review receipts.
  No merge, release or deployment is authorized.

- [PR #12](https://github.com/donal0c/sartracker-web/pull/12), WAR-04B, now
  integrates master `9c73c62d` at Donal's request. Its audit/package inventory
  remains pinned to `3cdf555d`; newer integration CI is recorded on the PR.
  IPC-003/macOS corrections and all three resolved review threads remain intact.
  [Report](../docs/assurance/findings/WAR-04B.md) retains evidence limits;
  release HOLD remains. Only handoff conflicted; product code matches upstream.
  CI rejected restore/current continuity at 226 ms and initial frames at
  219.5 ms with profiling disabled. Paired current-fix diagnostics are retained.
  A controlled cold-Mesa-cache reproduction supports CPU page rasterization
  for the Linux smoke: full local lifecycle passes at 16 and 4 CPUs, unchanged
  200 ms gates. The CI argument regression is red/green; 216 affected tests
  pass. All 400 source files / 4,157 tests pass, with five loopback-server
  suites rerun outside the local sandbox; lint/build and packaged visuals pass.
  An unrelated Chrome APT index mismatch was fixed by selecting Ubuntu's main
  package sources, retaining integrity checks. Normal Linux CI `34386382652`
  passes on `03b09a7e`: 400 files / 4,158 tests and all packaged gates.
  Downloaded receipt independently validates; frame maximum 117.5 ms,
  current-fix maximum 172 ms. PR is open, merge-ready and not merged.
  This documentation closeout reuses that byte-identical executable/test/
  workflow evidence; no new runtime run is claimed. See the
  [investigation](../docs/archive-ci-rendering-investigation.md); historical
  failures remain recorded and release HOLD is unchanged.

- DON-256's first twelve-item Sar_4 UI batch merged as
  [PR #11](https://github.com/donal0c/sartracker-web/pull/11) at `9c73c62d`.
  Tested upstream head `e384ea8a` has green CI `34345038450`; source
  400 files/4,155 tests, 89 affected browser/visual tests plus roster retry,
  and 27 screenshot reviews are retained in its
  [evidence](../docs/ui-feedback-batch-1-evidence.md). Persistent tracking,
  compact/collapsible controls and contrast changes are upstream UI work;
  their prior timing rejections are not claimed fixed by this integration.

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
