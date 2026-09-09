# HANDOFF.md — Current state

Updated 2026-09-09. Read after `CLAUDE.md`.

## Where we are

- [PR #12](https://github.com/donal0c/sartracker-web/pull/12), WAR-04B, now
  integrates master `9c73c62d` at Donal's request. Its audit/package inventory
  remains pinned to `3cdf555d`; newer integration CI is recorded on the PR.
  The IPC-003/macOS review corrections remain intact. Prior `99934a2a` CI
  rejected source timing, then a 202.4 ms archive-create renderer frame; local
  203 ms continuity rejection also remains unexplained. No threshold changed.
  [Report](../docs/assurance/findings/WAR-04B.md) retains evidence limits;
  release HOLD remains. Only handoff conflicted; product code matches upstream.
  Integrated CI also rejected restore/current and create/frame timing. Removed
  its leftover temporary Chrome profiler from normal CI; opt-in diagnostics
  and all strict watchdog gates remain. Red/green workflow-to-runtime regression
  and 244 focused tests pass. Remaining review threads now reconcile PR6
  hazard controls, merged workplan status and release-bearing dev dependency
  policy. CI `34360407470` still rejected restore current continuity at 226 ms
  with profiling disabled; source/build/replay/tracking passed. Investigation
  now retains the largest correlated request/emission/map-update interval in
  the bounded failure receipt, separating polling cadence from delivery time.
  Its regression is red/green; 282 affected tests and lint pass. CI `34373548949`
  passed once, then rejected a 219.5 ms frame before archive invocation. A
  controlled cold-Mesa-cache reproduction now supports CPU page rasterization
  for the Linux smoke: full local lifecycle passes at 16 and 4 CPUs, unchanged
  200 ms gates. The CI argument regression is red/green; 216 affected tests
  pass. All 400 source files / 4,157 tests pass, with five loopback-server
  suites rerun outside the local sandbox; lint/build pass. Hosted CI is pending.
  See the
  [investigation](../docs/archive-ci-rendering-investigation.md); the older
  current-position rejection is not relabelled as a proven archive defect.

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
