# SAR Tracker Electron 0.1.0-beta.13.4 — preparation draft

**HOLD — NOT APPROVED FOR PUBLICATION OR DISTRIBUTION.**

- Version: `0.1.0-beta.13.4`
- Intended tag: `electron-v0.1.0-beta.13.4`
- Linear: DON-254 qualification; DON-255 publication decision
- Release-use classification: `ENGINEERING/TRAINING — NON-COUNTED`
- Candidate commit, release run, installer hashes and Ubuntu qualification: PENDING
- Target: Linux x86-64 AppImage and genuinely installed Debian package.
- Scope: synthetic, replayed or disposable-data testing, never sole-source
  operational use. No Windows/macOS qualification claim.

## What changed

The qualification runner projects its retained `ui-screenshot` media kind into
the advisory judge's existing `image` vocabulary. Previously the package adapter
retained a valid screenshot that the packet builder then rejected, after the
deterministic receipt had been written. This could retain the controller's
resource lock and stop later work until explicit manual recovery.

Only the packet representation changes. Original capture metadata and hashes,
deterministic verdicts, privacy restrictions, unknown-kind rejection, and
persistence-failure ownership protections remain intact. No application,
coordinate, persistence or operator workflow change is included; the manual is
unchanged. The new version keeps package and qualification runner on one source.
Beta13.3's artifacts, campaigns and invalid attempts remain historical evidence.

## Regression provenance

- Record: DON-254 and [Ubuntu evidence](../assurance/beta13-ubuntu-execution-20260925.md).
- Trigger: beta13.3 C16 installed-package attempt
  `attempt-1790511628723-36d381ec` wrote an `INVALID_EVIDENCE` receipt/result,
  then failed before writing its advisory packet and retained its resource lock.
- Affected surface: qualification evidence assembly, not SAR operator behavior.
- Root cause: package capture retention and materialization accepted
  `ui-screenshot`; `buildJudgePacket` accepted only `image` and its other
  established media kinds. The later exception was masked as receipt persistence
  failure. Separate C16 workload-identity and process-observer failures remain
  invalid; this repair does not make the original attempt pass.
- Escape analysis: separate media-retention and packet tests did not exercise
  an actual retained package PNG through materialization into the judge packet.
- Repair and durable gate: that complete path now has a red/green regression;
  both retained kinds and all five prior packet kinds have compatibility checks,
  with unknown-kind rejection and no private-path/oracle disclosure.
- Verification: five focused suites pass (100 tests, one existing skip),
  including receipt-persistence and resource-lock failure controls. Full serial
  correctness passed593 files/6164 tests with27 skips; lint/build/budgets passed.
  Exact new release CI and Ubuntu qualification remain pending.
- Earlier findings: C26 missing producer report, C23/C16 process-observer
  failures, C02 recovery semantics, C10 paging, field archive timeout, strict
  archive 201ms breach and invalid C28 attempts are retained, not claimed fixed.
  See the [beta13.3 note](sartracker-electron-0.1.0-beta.13.3.md).

## Qualification and handover

All original205 bindings remain mandatory on the exact new candidate. Prior
source results are historical, never relabeled. Verify the CI ZIP and canonical
installer filenames, both installer hashes, genuine installed payload and the
complete Ubuntu programme after this candidate's release workflow passes.
The draft remains unpublished until separately authorized publication gates
and the smoke matrix are complete. C27 controls, C29 original-machine human
acceptance and Beta12.11 rollback requirements remain unchanged.
