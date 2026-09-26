# SAR Tracker Electron 0.1.0-beta.13.2 — preparation draft

**HOLD — NOT APPROVED FOR PUBLICATION OR DISTRIBUTION.**

This is incomplete release metadata, not a qualification report. Complete every
applicable section of `TEMPLATE.md` from exact-candidate evidence before guarded
publication. Pre-tag source validation is recorded below; no release-workflow
installer hash or Ubuntu result is asserted here.

- Version: `0.1.0-beta.13.2`
- Intended tag: `electron-v0.1.0-beta.13.2` (not created)
- Linear: DON-254 qualification; DON-255 publication decision
- Release-use classification: `ENGINEERING/TRAINING — NON-COUNTED`
- Validated source: `09343ee94b8d4f4347da416fdb6596a83e08624c` (tree
  `bba3dc8e0c74e7ca2ade28e92fdc3af9596c46b0`), Linux validation run 36255209914
- Tagged candidate commit / release-workflow run / qualified platform and profile: PENDING
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
The first repair PR run exposed two more flaky passes: immediate Escape could
arrive before dialog focus, and a background settings read could consume a test
fixture's one-shot roster error. Dialog focus is now assigned during commit; the
fixture models explicit unavailability until Retry. Original assertions are retained.

The next PR run exposed a final roster evaluation failure whose original raw
browser error was not captured. A separate controlled probe confirms a defect
in the old Playwright/Chromium driver that produces the same misleading navigation
message after the page function completes. The test toolchain is pinned to
Playwright 1.63.0, whose Chromium contains the upstream fix; an isolated app-free
driver regression passes and is now required alongside the unchanged SAR tests.
This synthetic red/green evidence does not prove the original SAR failure's cause.

After merge, the Repair Train D packaged smoke's expected-diagnostic check was
corrected (`09343ee9`, harness only): the canonical sanitizer redacts private `/tmp/`
paths, so the deliberate AUD-08 finish-fence refusal's stack frames lost their file
positions on CI. Frames are now admitted only in AUD-08, at most four, of the named
shapes, after the exact fence error. The sanitizer and product behaviour are unchanged.

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

## Pre-tag Linux validation (merged source)

Full `electron-linux-validation.yml` `workflow_dispatch`, `run_repair_train_d_smoke=true`.

| Run | Source | Result |
| --- | --- | --- |
| 36249965817 | `4e9c5371` (PR54 merge) | **FAILED, retained**: Train D close rejected sanitized finish-fence stack frames; AUD-08/AUD-09 passed; soak, archive and launch skipped |
| 36252807378 | `09343ee9` | **FAILED, retained**: archive lifecycle `current_fix_continuity_gate_breached`, verify 201 ms vs 200 ms; launch skipped |
| 36255209914 | `09343ee9` | PASSED every lane; receipts read |

Run 36255209914 receipts: strict <200 ms responsiveness, browser-driver contract,
Chromium 225/225 with flaky passes rejected, 960k replay, Train D (AUD-08, AUD-09,
restart; no failures), tracking soak, legacy recovery, archive lifecycle and AppImage
launch with graceful close. Artifacts (expire 2026-12-25T16:22:21Z):

| Artifact | ID | Digest |
| --- | --- | --- |
| electron-linux-artifacts | 10911110165 | `sha256:8ed0cbe7347cb38c9a1478cfe70d86435347c7bef35cf28b26dce90e96122d27` |
| electron-linux-validation-evidence | 10911435096 | `sha256:429aff646525e919e8264025714a03a87c08f71913d81e1d120ba84005f1ba10` |
| linux-correctness-evidence | 10910957774 | `sha256:5f1f3a05999e30da974f011566319007e7b310e032f9cc9283ecf561bb901d04` |
| linux-package-evidence | 10910950303 | `sha256:a188e4e5af522f55800e7c928537b2d1f814ede10bd7de4197726f9f9261a345` |
| validation-package | 10910381205 | `sha256:365596b810aee004000f1a3ab34cef71964cf9665253160411b26f57d4128dfa` |

These are **validation-workflow** installers, not release candidates:

The release workflow currently uses the same filename pattern, including
`-validation`. Workflow run identity and hashes distinguish the byte sets.

| File | SHA-256 |
| --- | --- |
| `sartracker-electron-validation_0.1.0-beta.13.2_linux_x86_64.AppImage` | `6a7ac24ff242d521aa39d141ca57266d693ab51229228f86a00561ccae99804e` |
| `sartracker-electron-validation_0.1.0-beta.13.2_linux_amd64.deb` | `96f003907a5bbc325632ee8ff2b767cc7381da93d77397d847167f9458bb40c5` |

Both share `app.asar` `6f350c02f544b9351d6227dd000008034b69fbdef85499436c216b62f16583d2`.
The release workflow's private-map filename guard patterns matched nothing in either
installer's package-safety inventory, the extracted `.deb` payload or its 4,803 asar
entries, and no packaged file carries an SQLite/MBTiles header. The release workflow
must still apply its own guard to its own installers.

Archive current-fix maximum gaps (ms; the gate fails at 200 or more):

| Phase | 09-17 green `58ea2900` | 36252807378 | 36255209914 |
| --- | --- | --- | --- |
| create | 103 | 132 | 127 |
| verify | 104 | **201** | 158 |
| restore | 128 | not reached | 189 |
| cleanup | 157 | not reached | 151 |

The later pass does not resolve the 201 ms breach.

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
- Regression gate: new adapter unit regressions, isolated browser-driver contract and retained full Chromium assertions;
  existing bcp17-final contracts still required
- Remaining uncertainty: original PR54 roster protocol failure remains unconfirmed;
  archive current-fix margin regression (201 ms retained breach, 189 ms passing
  restore) is unresolved, cause unproven (suspects: DON-267 scheduling, Playwright 1.63
  `_electron` instrumentation) and must be measured on Ubuntu under the unchanged gate;
  deferred synchronous mission-store startup isolation;
  DON-249/250/251 NOT_CLAIMED; PKG-001 original-machine/package proof remains required.

## Verification and acceptance — candidate pending

Complete exact Ubuntu technical validation first, obtain Donal's final controlled-
handover approval, then hand the exact testing bytes to Eamonn for C29 original-
machine acceptance. Technical readiness is not operational suitability. C29 signer
setup does not block Ubuntu checks. Public-byte verification follows separately
approved publication. Candidate tag/unpublished draft preparation is authorized;
publication and distribution are not approved.

The reviewed merged source `09343ee9` passed the complete Linux validation
workflow_dispatch (run 36255209914) after two retained failures. That run covers
`09343ee9` only. Its unchanged executable inputs are reusable for `e1ac888f`, whose
diff contains only `handoff/HANDOFF.md` and this external Markdown release note;
`e1ac888f` was not separately dispatch-tested. Documentation-only descendants do
not require a repeated dispatch. Executable changes require affected verification;
ordinary push CI omits strict responsiveness, 960k, Train D, tracking soak and
archive lifecycle. The tag-driven release run remains mandatory and automatically
creates the unpublished draft. C27 stays unattempted until its controls pass
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
