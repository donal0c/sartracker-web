# HANDOFF.md — Current state

Updated 2026-09-10. Read after `CLAUDE.md`.

## Where we are

- **WAR-02A test foundation is in progress** from fetched master `083f5047`
  (merged PR #15). Additive helpers/tests are isolated under
  `tests/unit/assurance/war-02a/`; production and Repair Train A are untouched.
  Source at `de7d15bf`: 422 files / 4,325 tests, lint/build. Final affected 65
  tests and helper types pass; both red controls remain proven. [PR #16](https://github.com/donal0c/sartracker-web/pull/16)
  remains draft: broad review cleared; mixed-failure red-gate finding is corrected
  with regressions, pending final exact-head reviews. [Evidence](../docs/assurance/war-02a-test-infrastructure.md).
  DON-254 remains qualification owner; no package/provider/soak proof or merge.

- [PR #15](https://github.com/donal0c/sartracker-web/pull/15), Team Feedback
  Batch 2 (DON-215), merged at `083f5047`, including PRs #13/#14. Its retained
  [batch evidence](../docs/ui-feedback-batch-2-evidence.md) covers application
  `42f9f305`, source 415 files / 4,271 tests, affected browser/visual and packaged
  restart/pause/tracking checks. Linux CI `34462624720` passed on `e60dc43e`;
  downloaded receipts bind native SQLite, custody, teardown and privacy.
  Current-fix/frame maxima 188/110.3 ms remain below unchanged 200 ms limits.
  Prior 242/210/206 ms hosted failures remain unexplained; the bounded Mesa
  configuration pass is not a causal fix or field acceptance. The
  [investigation](../docs/archive-ci-rendering-investigation.md) retains evidence.
  New geometry/E2E gate wiring remains deferred. No release acceptance is claimed.

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
- Next programme steps: Repair Train A and disjoint WAR test foundations;
  independently qualify native
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
