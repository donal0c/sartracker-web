# SAR Tracker Electron 0.1.0-beta.13.2 — preparation draft

**HOLD — NOT APPROVED FOR PUBLICATION OR DISTRIBUTION.**

This is incomplete release metadata, not a qualification report. Complete every
applicable section of `TEMPLATE.md` from exact-candidate evidence before guarded
publication. No candidate SHA, installer hash or Ubuntu result is asserted here.

- Version: `0.1.0-beta.13.2`
- Intended tag: `electron-v0.1.0-beta.13.2` (not created)
- Linear: DON-254 qualification; DON-255 publication decision
- Release-use classification: `ENGINEERING/TRAINING — NON-COUNTED`
- Candidate identity / qualified platform and profile / CI run: PENDING
- Scope: controlled synthetic, replayed or disposable-data testing. Not
  sole-source operational software.
- Distribution target: Linux x86-64 AppImage and actually installed Debian package;
  both require independent exact-byte qualification. No Windows/macOS claim.

## What changed

Includes the merged breadcrumb and mission-history programme and the reviewed
release-gate repairs. This replacement fixes the layer tree's scroll constraint,
isolates warning presentation test data from real overlay recovery, and restores
the browser testing history adapter. Browser request/chunk receipts are saved
atomically before acknowledgement; capped rows never supply a durable restart
cursor. Native persistence is unchanged. See the operator manual for browser limits.

Qualification now compares the exact Debian-encoded version (`0.1.0~beta.13.2`)
with the source candidate through a strict mapping, including the real installer
control field before extraction. Release installers retain for 90 days; actual
expiry and campaign margin must still be checked. Source and release CI both run
all Chromium cases, reject flaky passes and preserve failure evidence.

## Preserved rejected candidates

- Beta13 remains at `2d4f436add40ed9c279488c9ac4e3cb267c5cee2`. Release
  run 36223196332 attempt 1 failed the AUD-03 20-second count-oracle deadline under
  parallel suite contention; same-source serial CI passed. Beta13.1 aligned the
  release command with the established serial correctness gate.
- Beta13.1 remains at `2ff4d5742649da016a52c0e682f404d17df8c5dd`. Release
  run 36225417118 attempt 1 passed correctness, strict responsiveness and build,
  then Chromium 220/225. No package or draft was produced by either rejected run.
  [The five-failure ledger](beta13-browser-gate-repair.md) preserves causes,
  reproductions, repairs, verification and the source-CI coverage gap.

No workload, count oracle, timeout, retry policy or strict 200 ms threshold was
weakened. This candidate requires its own successful tag-driven workflow.

## Regression provenance

- Classification: Regression correction
- Linear issue: DON-254; reconcile linked regression owners before publication
- Affected release(s): Beta13.1 source/browser gate; wider programme inventory PENDING
- Last known good: PENDING; rollback availability is not proof
- First known bad: Beta13.1 for the combined browser failures; wider inventory PENDING
- Root cause: five-failure ledger; wider programme records PENDING
- Escape analysis: selected source-CI browser gates omitted the affected spec files
- Before/after evidence: ledger records unchanged-source red and repaired browser green;
  exact-candidate Ubuntu qualification PENDING
- Regression gate: new adapter unit regressions and retained full Chromium assertions;
  existing bcp17-final contracts still required
- Remaining uncertainty: deferred synchronous mission-store startup isolation;
  DON-249/250/251 NOT_CLAIMED; PKG-001 original-machine/package proof remains required.

## Verification and acceptance — candidate pending

Complete exact Ubuntu technical validation first, obtain Donal's final controlled-
handover approval, then hand the exact testing bytes to Eamonn for C29 original-
machine acceptance. Technical readiness is not operational suitability. C29 signer
setup does not block Ubuntu checks. Public-byte verification follows separately
approved publication. Candidate tag/unpublished draft preparation is authorized;
publication and distribution are not approved.

Before this tag is created, the reviewed merged source must pass the complete
Linux validation workflow_dispatch, including strict responsiveness, tracking soak,
960k, archive lifecycle and launch. Exact-final-head Linux Chromium 225/225 is
required before recommending merge. C27 stays unattempted until its controls pass
or authentic acceptance was sealed with the original inputs. A retained
NEEDS_HUMAN_DECISION blocks technical handover despite a later PASS; acceptance
inputs cannot be injected after compilation. No controls, waivers or authentication
workarounds are changed by this repair.

Record all applicable C00–C29 contracts, source/browser and independent rendered
UI checks, exact CI package provenance, Ubuntu AppImage and installed `.deb`,
scale/soak/fault/recovery checks, approved live GET-only confirmation, private-map
smoke, C29 human acceptance, beta:verify and release workflow proof. Failed or
absent evidence cannot become a pass. Complete install instructions, warnings,
checksum table and pre-share checklist from TEMPLATE.md after qualification.

## Deferred scope and rollback

No full map administration, raw licensed-source distribution, synchronous database
ownership redesign or blanket WAR completion claim. Use the prepared private
MBTiles route. Retain Beta12.11 rollback identities and verify profile compatibility
on disposable copies. C27 remains a separate human/control gate; until approval,
do not send this build to the team.
