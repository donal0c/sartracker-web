# HANDOFF.md — Current state

Updated 2026-09-25. Release remains **HOLD**. Master
`00f1a8a9af4c57436f152c3cc1a51d69190da9e6` passed exact-source CI
[36179770541](https://github.com/donal0c/sartracker-web/actions/runs/36179770541).
No final candidate is frozen or qualified; no tag/publication/distribution is authorized.

## Authority and active work

Donal authorized release-first stabilization and the existing `bcp17-final`
C00–C29 campaign. Small contained verified fixes may go directly to master;
the combined preparation now uses `codex/beta13-input-qualification` and requires
a PR plus independent exact-head review. Do not merge without Donal's authority.
No new features, full mapping, broad WAR, database redesign or Claude/Fable.
DON-254 comment `00ce69cd-ff6f-47f7-b6e9-fd3360fe509f` records current authority;
its historical Done state is not whole-candidate qualification. DON-255 is downstream.

- Source/test/CI and canonical records: Astra `01a0d9f5-7727-7060-ab59-4549f3a513c8`, worktree `1608`.
- Sole Ubuntu installation/runtime/performance owner: Sol `01a0d9f5-771a-7993-9e10-4ae1cbb1e3bb`, worktree `3226`.
- Preparation audit is finished; use its report, not its older handoff snapshot.
- Coordinator: `01a023b0-f891-75f2-b0f3-7cb8b6b17abe`.

Do not alter the dirty original checkout or coordinator's release-prep checkout.
Serialize Ubuntu workloads through Sol.

## Verified baseline and diagnosed deltas

The master repair fixed C12's viewer-held output pipes after Electron exited,
and exact installer names (`x86_64.AppImage` / `amd64.deb`). Retained exact-CI
C12 evidence confirms exit 0, no timeout/error and zero descendants. Source,
browser and packaged CI jobs passed; this is development verification, not
sealed campaign qualification. Earlier failed run `36174038700` and artifact
`10880449533` remain diagnostic evidence. Successful installer artifact:
`10884001990`; full hashes and closeout are in DON-254 comment
`7461fc0a-2f8c-40ec-840c-647f7690c3c8`.

Current reviewed-PR scope:
1. Separate v6 `bcp-960k-paging`, `bcp-2m-paging` and `bcp-field-37gb`
   synthetic-complete fixtures. Existing v5 mixed-backfill profiles remain intact.
   Field data models explicitly labelled historical position audit echoes;
   every echo links to one real primary fix. No padding or gate relaxation.
2. C08 provenance repair: preserve stored `live`/`cache` through both coverage
   SQL branches and the worker envelope; narrow the page type to its seven
   actual fields. The independent oracle remains unchanged.
3. Separate private-map C15 valid/offline/readiness supplement for both package
   tiers, independent PNG decoding and closed sanitized receipts. Keep the
   synthetic fault matrix. No product map changes or private map screenshots.

Sol admitted the three new fixture files independently. The field file is
5,320,654,848 bytes, SHA-256
`43cbe38949bdcb3b419c1a745a8f36aee8d4ec62cb55a219babcf8922dd25ed2`:
3,999,988 primary fixes + 12 legacy, 100 devices, 12 outings, two complete
backfill checkpoints, exact one-to-one audit links, integrity/quick checks good,
no sidecars. This is input preparation only. Retain both C08 failures: original
v5 incomplete backfill, then ready-v6 first-page missing `data_origin` in the
old package. Exact repaired-package paging remains pending.

Private-map diagnostics retain the original input rejection: metadata says zoom
8–16, actual tiles 9–16; the product correctly rejects it. A separately hashed
metadata-only disposable derivative is authorized for positive-path diagnostics,
with unchanged tile bytes and explicit provenance; never certify the original.
That derivative (`16e55b8e…ec8b233`) passed the full old-installer diagnostic:
31,729 independent PNG decodes, exact registration/serve/render, 15/15 required
local tiles and Field ready, no external map requests, clean process/profile exit.
Final admission must explicitly bind the derivative in a new immutable campaign
with owner-private lineage; C29 acceptance remains separate.

## Verification and next actions

Full serial correctness passed 580 files / 6,013 tests, with 26 documented skips;
lint, type check, production build/bundle budgets and browser coverage 7/7 passed.
The first full run found one positional SQL fixture insert incompatible with the
updated test schema; reproduced, repaired with named columns, then full rerun green.
Ready-fixture/C08/private-map focused checks and independent reviews passed.
Final committed-head review and PR CI remain pending. Current changes add no
operator controls or workflow; the manual remains applicable.

Finish the exact-head review, open the reviewed PR, and wait for exact-head CI. After
authorized merge, bind the final successful installers and all inputs to one
immutable campaign; execute all mandatory rows and retain failures.

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
