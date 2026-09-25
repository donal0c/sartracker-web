# HANDOFF.md — Current state

Updated 2026-09-25. Detailed history and retained receipts are in the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
assurance records.

## Current state

### Release preparation update — 2026-09-25 after PR47 merge

PR47 is merged. Clean preparation checkout:
`/Users/donalocallaghan/workspace/vibes/sartracker-release-prep`, source
`a703338a919159dd3a386671dba8aca969463255`. The older open-PR47 status below
is superseded. Master CI `36141017519` was still running during preparation.
No candidate is frozen, tagged, qualified or published. Next action is the
bounded preparation checklist in `docs/assurance/beta13-testing-readiness.md`,
then the existing `bcp17-final` campaign, not another feature/WAR programme.

Campaign compile passed on the clean merged source. Candidate preflight aborted
with `blockers contains duplicates.` before producing a valid JSON verdict;
do not claim preflight PASS. Ubuntu SSH at the documented address timed out
twice. Final version/CI artifacts/runtime manifests and human acceptance inputs
remain unbound. Dependencies were installed with scripts disabled for static
inventory compilation only; this is not a runtime/native-addon setup.
Full mapping and synchronous mission-store process isolation remain deferred.
Local preparation changes are not committed/pushed or candidate evidence.

Follow-up: the duplicate-blocker preflight reporting defect is fixed locally
with a red/green regression. Two controller test files report 51 passed and one
pre-existing skip. CLI now emits honest ENVIRONMENT_BLOCKED JSON (96 unique
prerequisite/identity blockers); no gate was weakened. Package/lockfile beta.13
metadata and a HOLD release-note draft are prepared locally for review before
candidate freeze. The initial immutable definition is superseded by these edits.

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. PR47 is merged at `a703338a`.

PR #47's behavior-bearing source changed after a 2026-09-25 multi-agent review
of `7fda435` found fatal/quit state, evidence-writer, fault-window and
held-gate classification defects (register IDs V01-V16). Review-fix source
`1dd316f2` supersedes the earlier `0e6db8a` evidence; its exact-source Linux
run `36136413925` passed. Donal subsequently merged PR47.
The [PR47 findings register](../docs/pr47-findings-disposition.md) records the
review outcome. Merging does not lift Beta 13 HOLD: do not tag, publish, or
release from this repair.

## Active work

The repair starts one 10-second startup watchdog after Electron readiness and
covers awaited asynchronous startup through the renderer safety fence. Runtime
and crash-log I/O use an isolated utility process. Startup exits and fatal
relaunches are withheld unless a timed-out writer is confirmed stopped. The
held diagnostics, held crash-log `fsync`, SQLite lock, and non-regular crash
evidence Linux probes all passed their bounded product-exit and
profile-preservation checks. These are development mechanics receipts, not
C01 qualification.

The recorded scope decision defers live mission-store process isolation until
after Beta 13; it is an unresolved known limitation, not a passed check. Track
it in [post-Beta 13 mission-store isolation](../docs/post-beta13-mission-store-isolation.md).
`app.whenReady()` also remains outside this watchdog. Keep both boundaries
visible and do not claim complete C01 coverage. The historical Linux C19
261.161 ms event remains unresolved. DON-179 remains **In Progress** because
opt-in remote upload and private retention are outside this repair.

## Next actions

1. Review/merge the bounded Beta13 testing-preparation change; Donal owns merge.
2. Freeze the resulting clean source and exact CI artifacts, then execute the
   existing bcp17-final campaign. Never reuse the preliminary unbound definition.
3. Complete independent human acceptance and the separate publication decision.

Ubuntu access is restored: Linux x86_64, Node 22.22.2, approximately 124 GiB
available, installed beta12.11, no competing SAR process observed. Desktop is
Wayland with Xwayland sockets; SSH display probes currently lack authorization.
Xwayland display :0 was subsequently verified through the user's existing
Xauthority file, without changing access control. Xvfb is absent and
noninteractive sudo requires a password. Candidate .deb installation and bounded
disk-full-volume setup require administrator assistance; user-namespace mount
probe was denied. Master CI `36141017519` passed. Preparation validation:
65 tests passed, one Linux-only skip; full lint and production build/bundle checks
passed. Build-generated version metadata was restored, not committed as identity.

Host setup subsequently completed with Donal's explicit administrator authority:
xvfb/xauth/xdotool report installed, Xvfb display probe passes, and separate
32 MiB tmpfs `/mnt/sartracker-beta13-enospc` is mounted for bounded ENOSPC tests.
The apt command returned 100 for unrelated NVIDIA driver/kernel configuration
errors; requested tool status was independently verified. Preserve that host
warning and verify actual candidate .deb installation separately. No driver
repair/reboot, candidate installation, qualification or publication occurred.
