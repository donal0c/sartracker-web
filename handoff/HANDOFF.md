# HANDOFF.md — Current state

Updated 2026-09-26 (evening). Release remains **HOLD**; no tag, draft or publication.
PR54 merged at `4e9c53710d8930094afe80861c91e361ced354f8` (cause/verification ledger:
`docs/releases/beta13-browser-gate-repair.md`). Master
`09343ee94b8d4f4347da416fdb6596a83e08624c` (harness-only Train D allowlist fix) passed
the full Linux `workflow_dispatch` with `run_repair_train_d_smoke=true`: run
**36255209914**, every lane green and receipts read (strict <200 ms, driver contract,
Chromium 225/225 flaky-rejecting, 960k, Train D AUD-08/AUD-09/restart, soak, legacy
recovery, archive lifecycle, AppImage launch). Beta13 and Beta13.1 tags stay immutable.

Two dispatch failures are **retained**; the later green run does not resolve them:
- 36249965817 @ `4e9c5371`: Train D close rejected sanitized finish-fence stack frames
  (the `/tmp/` path redaction removed file:line tails). Product behaviour was correct;
  `09343ee9` binds sanitized frames to the admitted fence error, sanitizer unchanged.
- 36252807378 @ `09343ee9`: archive lifecycle `current_fix_continuity_gate_breached`,
  verify phase **201 ms** against the unchanged 200 ms gate. Cause unproven.

**Open risk:** archive current-fix margin has thinned. Max gaps (create/verify/restore/
cleanup, ms): 09-17 green `58ea2900` 103/104/128/157; failed run 132/201/–/–; green run
127/158/189/151. The renderer poll (50 ms cadence) lagged ~100 ms while main stayed
≤83 ms. Suspects since 09-17: DON-267 scheduling (`776985d2`, `2b59cf77`) and the PR54
Playwright 1.63 `_electron`/CDP instrumentation. Needs a bounded DON-254 performance
follow-up; never relax the gate. Ubuntu must prioritise archive verify/restore timing.

Run 36255209914 installers are **validation-workflow** bytes
(`sartracker-electron-validation_0.1.0-beta.13.2_*`), not release candidates: AppImage
`6a7ac24f…99804e`, `.deb` `96f00390…bb40c5`, shared `app.asar` `6f350c02…83d2`.
The private-map guard patterns found nothing in both installers' inventories or the
`.deb` payload/asar. Release-workflow installers do not exist until a tag's release
run passes. Run 36255209914 covers `09343ee9` only: the exact commit to be tagged,
even if docs-only, must itself pass the complete Linux validation workflow_dispatch
(`run_repair_train_d_smoke=true`); ordinary push CI omits required lanes.
Full identities: `docs/releases/sartracker-electron-0.1.0-beta.13.2.md`.
No final candidate is frozen or qualified. Donal authorized candidate tag and
unpublished draft after verified source; publication/distribution need final approval.

## Authority and active work

Donal authorized release-first stabilization and the existing `bcp17-final`
C00–C29 campaign. Small contained verified fixes may go directly to master;
the current browser persistence/layout repair requires a PR plus independent
exact-head review. Do not merge without Donal's authority.
No new features, full mapping, broad WAR or database redesign. Donal explicitly
authorized the bounded release-path audit fixes and coordinator-arranged Claude
independent review of their stable exact head on 2026-09-26; no general Claude/Fable delegation.
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

PR52/53 source, browser, review and CI evidence is recorded in those PRs and
DON-254; none is final tagged-candidate qualification. The private minZoom9 map
scope remains bound; detail-only minZoom>12 remains fail-closed and out of scope.

Merged-source Linux dispatch is complete (above). Next: Donal's tag decision with
the retained 201 ms failure on record, a new write-once candidate tag, then release
CI. Only after release CI
create the authorized unpublished draft and bind its exact release-workflow installers and
all technical inputs to one immutable campaign, and execute applicable technical
rows serially. The 201 other technical variants may run after admission. C27 must
remain unattempted until repository-control prerequisites pass or an authentic
acceptance was sealed into the original inputs: `NEEDS_HUMAN_DECISION` makes
technical handover NOT_READY, and a later PASS cannot erase that retained attempt.
Optional acceptance/key inputs cannot be added after compilation; live control
fixes can be re-observed without changing sealed inputs. Choose that path before
sealing; no control/settings/signature change is authorized. Public-byte C00
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
Same-campaign C29 continuity requires the reviewed public authority, authorization
and profile identities sealed before compilation; a keyless technical campaign
cannot later add them while retaining its technical receipts. This prepares
authority only: training, handover approval and the human signature still occur
later. CoS is resolving the minimal prebinding inputs; do not freeze a tag or
campaign until the reviewed-plan implications are settled. No lifecycle redesign
or new acceptance prerequisite for technical execution is authorized.
Donal authorized final Debian administrator installation; coordinator owns secure
transient authentication. Ubuntu CLI/display probes passed, but GitHub OAuth was
canceled unapproved. Public metadata works unauthenticated; artifact/draft access
needs supported authentication. The Ubuntu report records exact boundaries.
Currently installed beta12.11 is not substitute proof. Recheck the separate
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
