# HANDOFF.md — Current state

Updated 2026-09-25. Release remains **HOLD**. PR50 and PR51 are merged;
refreshed base master is `3b27b1c586d02dfa2c3d0b019d8a73d878e5f918`.
Earlier pending-PR/Fable requirements are superseded by current authority.
No candidate is frozen or qualified; no tag/publication/distribution is authorized.

## Authority and active lanes

Donal authorized release-first stabilization and the existing `bcp17-final`
C00–C29 campaign. Small contained, verified fixes may go directly to master;
larger/safety-sensitive combined changes require a PR and independent review.
No new features, full mapping, broad WAR, database redesign or Claude/Fable.
Donal retains final release approval.

- Source/test/CI and canonical handoff/workplan: Astra task
  `01a0d9f5-7727-7060-ab59-4549f3a513c8`, isolated worktree `1608`.
- Sole Ubuntu installation/runtime/performance owner: Sol task
  `01a0d9f5-771a-7993-9e10-4ae1cbb1e3bb`; serialize host workloads.
- Artifact/fixture/campaign preparation: Luna task
  `01a0d9f5-774b-7f42-bfc5-dc94f4523e6c`; report findings to the integrator.
- Coordination: `01a023b0-f891-75f2-b0f3-7cb8b6b17abe`.

Do not alter the dirty original checkout or coordinator's release-prep checkout.
DON-254's historical Done state is not whole-candidate qualification; DON-255
remains downstream. Authority: DON-254 comment
`00ce69cd-ff6f-47f7-b6e9-fd3360fe509f`.

## Current repair and verification

Run `36174038700` passed correctness/package production, but C12 exceeded the
unchanged 300000-ms infrastructure deadline despite exit 0 and a written receipt.
Artifact `10880449533` is diagnostic input, not an admitted candidate.
Failed receipts remain in the coordinator's
`tmp/pr51-postmerge-failure/tmp/electron-validation-evidence/` directory.

Ubuntu confirmed Electron exited 0 while xdg-open/GNOME Text Editor retained
its stdout/stderr pipes, leaving Playwright `app.close()` pending. The bounded
C12 harness repair releases its output read ends only after physical Electron
exit, still awaits Playwright close, and rejects nonzero/signal/unobserved exit.
Application handoff, supervisor cleanup and timeout gates are unchanged.
Updated harness plus the same installer passed: exit 0, no timeout/error,
positive cleanup proof and zero descendants. This is diagnostic evidence only.
Raw Ubuntu evidence is under
`/home/donal/sartracker-beta13-diagnostic-3b27b1c5/tmp/`:
`ubuntu-c12-lifetime-console.log`, `ubuntu-c12-lifetime-evidence/`,
`ubuntu-c12-patched-execution.json` and `ubuntu-c12-patched-evidence/`.

Candidate admission also expected nonexistent `linux_x64` installer names.
Actual CI members use `linux_x86_64.AppImage` / `linux_amd64.deb`.
The corrected exact allowlist preserves workflow-specific manifest membership,
source/run/archive provenance, extraction guards and installer checksum checks.
The preparation audit found no other stale member consumer or attempt-lineage defect.

Both defects have red/green regressions. Final related Ubuntu tests passed 31/31,
including the close-error-listener delta. Filename/manifest tests
passed 37/37. `npm run lint` and `npm run build` passed; generated version metadata
was restored. `npm run test:correctness -- --no-file-parallelism` passed all
579 files: 5,972 tests passed and 26 platform-specific tests skipped. Ubuntu
ran `qualification-marker-attachment-close`, `qualification-owned-process` and
`qualification-owned-process-custody` unit files serially: 31/31 passed.
Independent native Luna review found no blockers. Release timing was not run.
Low-impact retained review boundary: output-pipe release may omit final buffered
diagnostic lines; receipt/physical exit checks remain. The pure inventory helper
is called only after strict provenance/version validation.

The final repair SHA and exact-head CI outcome are maintained in DON-254 comment
`7461fc0a-2f8c-40ec-840c-647f7690c3c8`; refresh that live closeout before candidate
admission. Recording CI status there avoids rebuilding unchanged source solely
to add the completed run's identity to these documents.

## Next actions and retained limits

1. Stable source verification, Linux delta and independent review are complete.
   Integrate this contained repair with explicit refspec; use the live DON-254
   closeout above for its pushed identity and CI outcome.
2. Follow fresh exact-head CI to completion. Old-installer/new-harness diagnostics
   and failed-run installers cannot satisfy final candidate admission.
3. Bind successful exact installers, runtime inputs, fixture hashes and human
   authorities; compile a new immutable campaign and execute the existing gates.
4. Independent human/original-machine acceptance and publication remain separate.

Sol also passed C28 routine (nine phases) and C26 duplicate-launch diagnostics
with the retained installer. Genuine installed-deb proof remains outstanding:
installed version is beta12.11 and noninteractive sudo is unavailable. Continue
other work; use supported administrator access, never alter authentication.
Historical schema-9 paging fixtures were rejected. Sol subsequently verified fresh
schema-13 960k/2m hashes, quick_check and 100-device/12-outing counts; final oracle
and campaign binding remain outstanding. Recheck the separate 32 MiB
`/mnt/sartracker-beta13-enospc` volume and preserve the earlier NVIDIA apt failure.

Live mission-store process isolation remains explicitly post-Beta13;
`app.whenReady()` is outside the startup watchdog. Historical C19 261.161-ms,
original-machine, live/provider/private-map, soak/custody and remaining campaign
obligations are not cleared. DON-179 remote upload/private retention remains
In Progress. Operator behavior is unchanged; no repair-specific manual change.

Historical detail: [pre-repair handoff](archive/2026-09-25-pre-c12-repair.md),
[Ubuntu diagnostic report](../docs/assurance/beta13-ubuntu-execution-20260925.md),
[active workplan](../docs/two-track-execution-workplan.md),
[testing readiness](../docs/assurance/beta13-testing-readiness.md).
