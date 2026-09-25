# HANDOFF.md — Current state

Updated 2026-09-25. Release remains **HOLD**. PR52 merged at
`b1bc51a2ed5e479b8eeaaf21b759001f2a208838`; exact-source CI
[36192361874](https://github.com/donal0c/sartracker-web/actions/runs/36192361874) passed.
No final candidate is frozen or qualified. Donal authorized candidate tag and
unpublished draft after verified source; publication/distribution need final approval.

## Authority and active work

Donal authorized release-first stabilization and the existing `bcp17-final`
C00–C29 campaign. Small contained verified fixes may go directly to master;
the sequencing correction uses `codex/beta13-staged-admission` and requires
a PR plus independent exact-head review. Do not merge without Donal's authority.
No new features, full mapping, broad WAR, database redesign or Claude/Fable.
DON-254 comment `75075194-78a0-4782-be1d-73f86e794e50` records the clarified sequence;
its historical Done state is not whole-candidate qualification. DON-255 is downstream.

Donal clarified the sequence through CoS on 2026-09-25: complete Ubuntu technical
validation first, then controlled handover to Eamonn after approval, then C29
acceptance on the original team machine before any operational-suitability claim.
Do not require Eamonn's signer to start technical testing. C29 remains mandatory
and pending; technical readiness is only `READY_FOR_APPROVAL`, never qualification
or publication/distribution authority. All applicable C00–C28 variants, package
tiers, exact provenance, 200 ms thresholds, fixed soaks and retained failures stay.

- Source/test/CI and canonical records: Astra `01a0d9f5-7727-7060-ab59-4549f3a513c8`, worktree `1608`.
- Sole Ubuntu installation/runtime/performance owner: Sol `01a0d9f5-771a-7993-9e10-4ae1cbb1e3bb`, worktree `3226`.
- Preparation audit is finished; use its report, not its older handoff snapshot.
- Coordinator: `01a023b0-f891-75f2-b0f3-7cb8b6b17abe`.

Do not alter the dirty original checkout or coordinator's release-prep checkout.
Serialize Ubuntu workloads through Sol.

## Verified baseline and diagnosed deltas

The earlier C12 viewer-held-pipe and installer-name repair passed exact CI with
exit 0, no timeout/error and zero descendants. Failed run `36174038700` remains
retained; full prior identities are in the Ubuntu report and DON-254 comment
`7461fc0a-2f8c-40ec-840c-647f7690c3c8`. Development proof is not qualification.

PR52 merged separate v6 paging-ready fixtures (960k/2m/field), preserved C08
stored live/cache provenance through SQL/IPC, and added a separate private-map
C15 supplement for both package tiers. Existing mixed-backfill regressions,
synthetic map faults and independent oracles remain; no product map change.

Sol independently admitted all three fixtures; field is 5.32 GB, 3,999,988 primary
fixes + 12 legacy, 100 devices/12 outings, complete backfill and exact audit links.
Full hashes are in the Ubuntu report. Retain both C08 failures: incomplete v5
backfill, then missing stored provenance in the old package. Repaired PR-CI
AppImage diagnostic passed: 959,988 primary rows,
1,500 pages, 1,300 chunks and independent exact sequence oracle; cleanup passed.
This is not final tagged-candidate qualification.

Retain original private-map rejection: declared zoom8–16 versus actual9–16.
Only the separately hashed metadata-only derivative is authorized, with unchanged
tile bytes and private provenance; never certify the original.
That derivative (`16e55b8e…ec8b233`) passed the full old-installer diagnostic:
31,729 independent PNG decodes, exact registration/serve/render, 15/15 required
local tiles and Field ready, no external map requests, clean process/profile exit.
Final admission must explicitly bind the derivative in a new immutable campaign
with owner-private lineage; C29 acceptance remains separate.

## Verification and next actions

PR52 full correctness (6,013 tests), lint/type/build, browser coverage 7/7,
independent review and CI passed. Final merged zoom-clamp delta passed review
and 26 focused tests; detail-only minZoom>12 remains fail-closed and outside the
bound minZoom9 map scope.

Staged admission: `npm run test:correctness -- --no-file-parallelism` passed
580 files / 6,019 tests (26 existing skips) on unchanged final code/test hashes;
52 focused checks passed (one skip). `npm run lint` and `npm run build` passed.
The inbuilt browser verified the rendered manual's controlled-handover guidance.
Independent native working-tree review accepted the boundary; exact-head review
and CI readiness are recorded in the PR and DON-254, not candidate qualification.

Finish staged-admission tests/review/PR CI. After authorized merge, create the
authorized tag/unpublished draft, bind the exact release-workflow installers and
all technical inputs to one immutable campaign, and execute applicable technical
rows serially. C27 inspects the draft after other technical rows; public-byte C00
only follows actual approved publication. Eamonn's C29 acceptance follows approved
handover and cannot be inferred from Ubuntu evidence. No cross-campaign promotion
or late mutation of sealed inputs is introduced.

Prepared inputs now include private offline map, schema-12 storage baseline,
private live config/selector and verified public beta12.11 rollback installers.
Do not request these files again. Donal explicitly confirmed C05 reuse of the
existing configured Traccar account and selected tracker on 2026-09-25, strictly
GET-only and executed by Sol after preflight/candidate binding (DON-254 comment
`af5f3aa6-5cd3-40c0-8947-4c327d3a5a3e`). No writes or expanded targets; keep
credentials/target values private. Consent is cleared; live proof remains pending.
C29 named original-machine/human acceptance remains required.
Genuine beta13 installed-deb execution needs a supported authenticated administrator
session; currently installed beta12.11 is not substitute proof. Recheck the separate
32 MiB ENOSPC volume before use; never alter authentication.

Campaign definitions/runtime paths/raw logs stay in controlled private custody.
Only closed sanitized map component evidence and its candidate-binding summary
are shareable; no map bytes, locations or screenshots enter repository evidence.
Full C00–C29 runtime/scale/soak/custody obligations remain. Live mission-store
process isolation is post-Beta13; `app.whenReady()` remains outside the startup
watchdog. DON-179 private retention/upload work is still open.

Evidence and history: [Ubuntu report](../docs/assurance/beta13-ubuntu-execution-20260925.md),
[active workplan](../docs/two-track-execution-workplan.md),
[testing readiness](../docs/assurance/beta13-testing-readiness.md),
[pre-repair history](archive/2026-09-25-pre-c12-repair.md).
