# Beta13 testing preparation — 2026-09-25

Execution checklist, not qualification evidence. Owner: SAR coordination.
Issues: DON-254 qualification; DON-255 publication. Current source anchor:
`a703338a919159dd3a386671dba8aca969463255` (PR47 merged).

## Scope lock

Run the existing `bcp17-final` C00–C29 campaign for controlled engineering/training
with synthetic, replayed or disposable data and an independent operational primary.
Do not add functionality. Full map administration, broad WAR work and synchronous
mission-store process isolation are deferred. Retain their explicit limitations.
Existing performance, data-integrity and other applicable release gates remain.
Do not convert SCOPE_LIMITED to PASS or automatic release eligibility.

## Preparation evidence

- Isolated clean detached checkout created at the source above; the original
  workspace is dirty on an old PR2 branch and must not be switched or overwritten.
- `npm ci --ignore-scripts --no-audit --no-fund`: passed. Static tooling only;
  native and Electron runtime setup is not established by this command.
- Campaign compile passed using the checked-in candidate plan. Definition digest:
  `ff93d3b6aed86cc76773403f5b357a1d382e052dc39e5c7615ae13413e6b836d`.
  Receipt: `tmp/release-prep-20260925/campaign-definition.json` in this checkout.
  This definition has no final candidate inputs and is NOT the execution campaign.
- Preflight: command aborted with `blockers contains duplicates.` and emitted no
  JSON verdict. Direct read-only `validateBindingCoverage` inspection found 210
  entries including repeated artifact/fixture prerequisite messages. Preserve this
  failure; never call it a successful preflight or simply rerun until green.
- Reference-host SSH `donal@192.168.18.31` timed out twice (8 and 5 second bounds).
  Host power, network and current address need confirmation. No remote changes made.
- Master CI `36141017519` was in progress; no downloadable artifacts were listed
  when checked. Refresh before taking the next step.
- Source package version remains `0.1.0-beta.12.11`; Beta13 tag was absent.
  Latest published rollback is `electron-v0.1.0-beta.12.11`; do not reuse its
  evidence as Beta13 evidence. The beta12.10 draft is not this candidate.

## Ordered next actions and ownership

### Host access restored

SSH now succeeds. Linux x86_64, Node 22.22.2/npm 10.9.7, approximately 124 GiB
free, no competing SAR process observed; installed app is beta12.11. Cached
small/field-v1/field-v2/mission-5d-v2/mission-14d-v2 fixtures exist but have not
been rehashed or approved for this candidate. The session is Wayland with Xwayland
sockets. Xvfb is absent; bare SSH DISPLAY :0/:1 probes cannot authenticate.
Noninteractive sudo requires a password. Do not disable display access control.

Follow-up checks: authenticated `DISPLAY=:0` with the existing same-user
Xauthority file works (`xdpyinfo` passed); no access-control change was made.
User-namespace mount setup is denied. Admin assistance is needed for the actual
candidate .deb install and isolated disk-full test volume. Master CI
`36141017519` completed successfully. Preparation validation: four controller
test files, 65 passed / one Linux-only skip, full lint and production build/bundle
checks passed. Generated version output was restored after the build; CI must
generate the final source-bound identity. No campaign or release claim follows.

### Local preparation completed after the initial checks

The preflight reporting defect is repaired locally: `preflightBlocked` already
deduplicates generated messages, so preflight now passes its accumulated blockers
directly instead of rejecting repeated messages first. A focused regression failed
with the original exception and passes after the one-line change. Two controller
test files: 51 passed, one pre-existing skip. A subsequent CLI invocation returned
valid `ENVIRONMENT_BLOCKED` JSON with `releaseEligible: false` and 96 unique
blockers, including expected changed-source/validator, macOS-versus-Linux and
missing candidate inputs. This is NOT candidate readiness; the earlier immutable
definition is deliberately no longer current and must not be reused for execution.

Package and lockfile beta.13 metadata and an explicitly incomplete release-note
draft are prepared locally. They need normal review/merge before freeze. No tag,
CI dispatch, remote installation or release has been performed. The following
ordered actions retain the original preparation sequence; the narrow report fix
and initial metadata drafting are now completed locally, not merged.

1. **Completed: bounded setup and reporting repair.** Host access/display and
   disk-full volume are prepared; master CI passed. The duplicate-blocker repair
   and regression test are locally green. Preserve the NVIDIA host warning below.
   The original failing reproduction (now returns a blocked verdict) is:

   ```sh
   node scripts/qualification-control-plane.mjs compile --plan docs/assurance/qualification-campaign-plan.json --output tmp/release-prep-20260925/campaign-definition.json
   node scripts/qualification-control-plane.mjs preflight --campaign tmp/release-prep-20260925/campaign-definition.json --root tmp/release-prep-20260925
   ```

2. **Next: review/merge preparation, then freeze.** Package and lockfile are now
   `0.1.0-beta.13`; HOLD release-note draft and handoff/workplan are prepared.
   Complete the release template's pending evidence only after execution.
   Review/merge the bounded candidate-preparation changes before
   capturing the final SHA/tree. Do not fabricate final SHA or hashes in advance.
   Tag/release workflow actions require explicit release-candidate authorization;
   this preparation does not publish or distribute anything.

3. **Qualification owner: bind actual inputs.** Obtain successful exact-source CI
   archive/run/attempt/artifact identities and both installer hashes. Verify actual
   installed `.deb` identity separately. Supply candidate ID/version, runtime input
   manifest, release/rollback inputs and independent C29 authority/authorization.
   Use the existing runtime-input and artifact schemas; no invented placeholder
   identity is acceptable. Compile a NEW immutable campaign after all inputs exist.

4. **Reference host admission recheck.** Initial setup is complete (see below).
   At execution time reverify Linux x64, X11/display, required tools,
   native dependencies, at least the plan's 64 GiB free (and sufficient actual
   space for all source/archive/restore copies), idle resource lease and no
   competing SAR workload. Provision a separate bounded disk-full test volume;
   never fill the real user disk. Verify owned disposable profiles and cleanup.

5. **Fixture/input preparation.** Bind immutable source fixtures and oracles:
   paging-960k, paging-2m-1gib, paging-2m, paging-field-37gb, storage-mission;
   field-960k/field-2m/field-local-1gib/field-device-modes (or the permitted field
   fixture). Preserve 100 devices, 12 outings, exact counts/digests. Confirm private
   offline-map input and scoped GET-only live-config/live-selector availability
   without copying credentials into repository, reports or chat.

6. **Run qualification.** Start only after valid preflight, using the existing
   reviewed contract bindings. Run deterministic/source/browser checks, both Linux
   package tiers, scale/recovery/fault/soak tests, independent oracle-blind judging
   and evidence verification. Serialize package/performance/soak work on each host.
   Lightweight independent evidence review can overlap; competing load must not.
   Preserve every failed receipt. Changes invalidate affected/dependent evidence;
   broad shared-state changes require a full campaign restart.

7. **Human acceptance and publication boundary.** Arrange C29 original-machine
   training acceptance in parallel with automation, but use final exact artifacts.
   PKG-001/same-profile package comparison remains explicit; historical different
   machine observations are not closure. C27 draft decision is separate, then C00
   fresh public-byte verification and explicit controlled distribution approval.

## Stop/continue rule

### PR50 CI feedback loop repair

Retained failure: run `36145799283`, source `c13efa63`, completed correctness
5,964 passed, failed C10 renderer maximum frame gap exactly 200ms. This is not
SQLite/main-thread evidence. Do not erase the failed receipt or call it noise.

CI now separates correctness/browser, package production and packaged checks.
The original required-check name is a fail-closed aggregate of all three lanes.
Only the packaged lane depends on package production; it verifies source and
SHA256 of the transferred package and checks installer hashes before execution.
Failed packaged jobs can be rerun against the successful package in that run;
new source requires a new package. Evidence/transfer/installer uploads are
attempt-specific so failed receipts are retained. Final candidate provenance
distinguishes the successful run attempt from the package-producing attempt.
Earlier installers require retained live GitHub job metadata proving the latest
successful package job produced that attempt and the latest successful packaged
checks consumed that producer's source-bound, checksum-verified transfer. A newer
package job invalidates older installers. Exact artifact ID, run ID, source and
downloaded archive digest remain mandatory. Transfer includes the original `dist`
tree for packaged-versus-build byte comparisons; it is not rebuilt by the consumer.

Only development C10 known-at-time replay uses `--development-correctness-only`.
It retains timing and runs all live/archive geometry checks. Its receipt is
explicitly rejected by strict candidate validation even if timing is fast.
Default/candidate replay still requires `<200ms`; raw timing is written before
archive work, and the strict verdict is made after correctness checks. No threshold
was raised. Do not use development success as release qualification.

### Host preparation completed — 2026-09-25

With Donal's explicit administrator authorization, xvfb/xauth/xdotool are now
`install ok installed`; `xvfb-run -a sh -c "xdpyinfo >/dev/null"` exited 0.
`/mnt/sartracker-beta13-enospc` is mounted as a separate 32 MiB tmpfs, owned
by uid/gid 1000 with mode 0700. The mount is temporary and must be checked again
after reboot. No mission data or candidate application was installed or changed.

The apt command returned 100 while configuring unrelated NVIDIA packages:
linux-modules-nvidia-595-7.0.0-28-generic,
linux-modules-nvidia-595-generic-hwe-24.04, and nvidia-driver-595. Requested
test packages independently report installed and the display probe passes.
Retain the package-manager failure as host evidence; this does not establish
candidate .deb installation success. Do not repair drivers or reboot as part
of this preparation without separate authority.

Ordinary setup/test failures get a precise next action, not an indefinite loop.
Missing host or human authority is escalated specifically. A real application
defect gets the smallest reproduced repair and affected retest; unrelated findings
go to the existing backlog. No fabricated receipts, silent skips, timing-budget
relaxations, automatic publication, or claim that this checklist means release-ready.
