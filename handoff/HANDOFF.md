# HANDOFF.md — Current state

Updated 2026-09-09. Read after `CLAUDE.md`.

## Where we are

- WAR-11A is the active unmerged builder slice, based on master `c51e4b35`.
  Builder/app-builder-lib 26.0.12 → 26.16.1; Electron/SQLite/application code
  and the 200 ms gates are unchanged. The new package gate inspects actual
  AppRun paths, all installer/ASAR contents, payload identity and native SQLite.
  PR #14 CI `34397884713` passed 403 files / 4,200 tests and all packaged gates
  on `6c1df970`; downloaded hashes/receipts validate. External review then found
  an AppRun dialog-prefix bypass, so that head's readiness is withdrawn.
  Correction uses exact dialog commands, lock-derived runtime policy, explicit
  toolchain ownership, source receipt v2 and independently required receipt upload.
  Focused red/green checks pass. ELF truncation allegation did not reproduce;
  the parser stays unchanged. [WAR-11A](../docs/assurance/findings/WAR-11A.md)
  contains the full disposition ledger and historical local/CI proof limits.
  Next: correction-head source/package checks and independent rechecks, recorded
  on the PR. Keep unmerged; no release authority is granted.
  DON-146 owns this slice; DON-254/DON-255 retain final qualification/publication.

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
- Next programme steps: complete WAR-11A review, independently qualify native
  dependency/runtime upgrades, then BCP-17 final candidate qualification before
  DON-255 publication. Use the
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
