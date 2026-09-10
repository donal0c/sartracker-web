# HANDOFF.md — Current state

Updated 2026-09-10. Read after `CLAUDE.md`.

## Where we are

- [PR #15](https://github.com/donal0c/sartracker-web/pull/15), Team Feedback
  Batch 2, remains draft on `codex/team-ui-feedback-batch-2` (DON-215).
  Donal's review rejected the previous local all-clear at `2386e7db`.
  Review remediation: per-object replay limitations; required hit-test
  visibility and hidden-marker creation protection; durable checkpoint-based
  coverage completeness; real loader/worker regressions; corrected optimistic
  visibility cascade; mission-switch isolation; recovering map-source warnings.
  Final stable source passes 409 files / 4,209 tests; lint/build and 31 affected
  browser flows pass. Packaged macOS request-target restart/pause and live/archive
  geometry proofs pass (50 ms frames); inspected map retains one offline warning.
  Tracking CI-profile soak passes 8,664 positions/two launches, main max 42.4 ms;
  it predates only final warning deduplication/formatting. Local synthetic proof.
  Donal approved independent live Breadcrumbs/Mission History controls and durable
  history request targets, including migration/writes. Both are implemented locally:
  nullable additive checkpoint columns retain requested bounds before dispatch,
  separate from acknowledged contiguous history. No-new-fix failure/restart and
  independent-controls regressions pass. Focused reviewers cleared prefix continuity,
  overlapping admission failures and tile recovery. Remediation is verified locally;
  Runtime commit `42f9f305` passed Linux CI `34447132522`, including 960k replay,
  tracking, archive lifecycle and AppImage launch. Downloaded terminal evidence
  independently validates exact source/tree, custody, teardown and privacy.
  Archive current-fix max 192 ms (8 ms headroom); frames 93.1 ms. This docs-only
  closeout reuses the unchanged executable/test/workflow tree. Gate wiring stays deferred.
  Review details: `tmp/pr15-review/`.
  CI `34398992302` attempts 1/2 failed hosted x64 archive continuity at
  242/210 ms; their cause remains unexplained despite the new-head pass. The
  200 ms gate is unchanged, and no release/field acceptance is established.
  Same-head macOS lifecycle passed (66 ms); isolated four-CPU Linux ARM64 passed
  (173 ms), which does not establish hosted x64 correctness or causality.
  The owned `sar-batch2-linux` container is stopped; receipts are in
  `tmp/batch2-linux-source` and the [evidence](../docs/ui-feedback-batch-2-evidence.md).
  Current master `d02d8a61` (merged PRs #13/#14) is integrated for merge readiness.
  PR #14 conflicted only in this handoff; PR #13 only in the workplan.
  Source behavior is unchanged by these integrations.
  Combined source passes 415 files / 4,271 tests, lint and production build.
  Integration CI `34458799719` passed source/build/package/replay/tracking, then
  failed archive continuity at 206 ms. Draft remains; no same-head CI retry.
  Linux-only archive smoke now bounds Mesa rendering to two workers after local
  contention diagnostics; 282 boundary tests and lint pass. Same-package cold-cache
  two-worker lifecycle passes (current max 171 ms). Hosted causality is unresolved;
  the unchanged 200 ms gate and fresh new-head CI still decide readiness. See the
  [investigation](../docs/archive-ci-rendering-investigation.md#pr-15-integration-bounded-software-renderer-concurrency).
  Final integration results are recorded on PR #15 and DON-215; no merge or release.
  PR #13 adds only coordination documentation; both its queue and this batch's
  acceptance contract are retained. Executable/test/workflow trees remain identical
  to integration `35dd1c83` before the explicit Linux worker-bound adjustment.


- WAR-11A merged as [PR #14](https://github.com/donal0c/sartracker-web/pull/14)
  at `35cff87d`; final Linux CI `34413097593` passed. Builder 26.16.1 adds
  installer/ASAR inventory, AppRun policy, native SQLite and clean-source checks.
  Electron/application runtime and the 200 ms gates remain unchanged.
  [WAR-11A](../docs/assurance/findings/WAR-11A.md) retains its evidence ledger.
  DON-254/DON-255 still own final qualification/publication.

- **Three-stream coordination is locked (2026-09-09):** SAR-team feedback,
  confirmed deep-audit defects, and WAR hardening share the
  [coordinated work ledger](../docs/assurance/coordinated-work-ledger.md).
  Team Feedback Batch 2 owns only `AUD-07` and `AUD-14`; twelve other confirmed
  audit findings are grouped into four later repair trains. BCP-17/final
  qualification waits for release-blocking repairs and applicable WAR-04
  remediation, then runs against one frozen exact candidate.

- [PR #12](https://github.com/donal0c/sartracker-web/pull/12), WAR-04B, merged
  at `c51e4b35`. Final executable evidence is CI `34386382652` on `03b09a7e`:
  400 files / 4,158 tests and all packaged gates; downloaded receipt validates.
  Cold-Mesa/source corrections remain. Historical 203/226 ms current-fix and
  219.5 ms frame failures remain in the [report](../docs/assurance/findings/WAR-04B.md)
  and [investigation](../docs/archive-ci-rendering-investigation.md).


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
- Next programme steps: finish PR #15 integration, independently qualify native
  dependency/runtime upgrades, then BCP-17 final candidate qualification before
  DON-255 publication. Use the
  [workplan](../docs/two-track-execution-workplan.md#next-task-order) and live Linear
  issues for scope. Merge is complete; release/field acceptance is not established.
  DON-247 and DON-264 remain separate reliability work.

## Testing approach to carry forward

Donal reaffirmed on 2026-09-10: documentation-only pre-merge conflict resolution
does **not** trigger repeat tests, builds, browser/package smoke or CI dispatch.
Verify the diff and reuse prior evidence; a new merge SHA alone invalidates none
of it. Before repeating expensive validation, name the executable change or
separate failure that warrants that specific check. See the cadence below.

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
