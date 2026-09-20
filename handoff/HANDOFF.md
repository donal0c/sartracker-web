# HANDOFF.md — Current state

Updated 2026-09-20 during DON-254 candidate-enablement implementation.

## Current state

Release remains **HOLD**. BCP-17 is incomplete. No candidate freeze,
qualification run, merge, tag, publication or promotion is authorized here.

Verified base: PR42 merge `bd301484561fac372ef7c95090ab5d9cc21533f3`,
from head `5cddbb1f086191539c7c771ea82d9b73bacd8c77`; its exact-head Linux CI
`35454420736` passed. PR40/GEO-002 and PR41/TRK-001 are merged at
`c916ced9` and `27687b53`. These are merge evidence, not candidate qualification.
DON-254 is In Progress; PKG-001 and WAR-01/BCP-17 remain separate blockers.

## Active work and next actions

Draft [PR43](https://github.com/donal0c/sartracker-web/pull/43) on
`codex/beta13-candidate-adapters`, based on PR42. Four independent reviews at
`bab0ddb5` produced fourteen accepted findings. Rechecks of `065e2c8b`
identified further failure-path custody gaps; remediation is implemented.
Current-head source checks, independent rechecks and green Linux CI remain the
delivery gate, recorded on the PR and DON-254; merge requires Donal's decision.

Design: [candidate-enablement-design](../docs/assurance/candidate-enablement-design.md).
Historical gap inventory:
[candidate-adapter-inventory](../docs/assurance/candidate-adapter-inventory.md).
The [two-track workplan](../docs/two-track-execution-workplan.md) remains the queue.

Producer integration is under repair after the first Linux development matrix.
All 124 package bindings compile and require
separate AppImage/deb scenarios. C01 held-startup/physical-disk-full producers,
C09 packaged import interruption, C02 lifecycle, C10 replay scale/outing,
C18 fault matrix, C19 historical/default migrations and C20/C22 large-archive
producers are implemented. The independent archive oracle reconciles all30
tables and exact startup-pause/finish events on small development copies. Missing
harnesses are implementation work, not external prerequisites. Future exact
candidate/version/CI artifacts, Linux installed host, private maps/live input
and named human acceptance remain external execution inputs.

The scoped C12 product fix is now implemented locally: Linux archive-review
attachments use a file-URL external desktop handoff, while other platforms keep
the existing path handoff. Keep package version and release metadata for the
later candidate-freeze step. Do not promote local development, source/browser
or unpacked evidence into exact Linux candidate proof until the new exact-head
CI run passes.

Fresh Linear verification on 2026-09-20 confirms DON-249/250/251 remain Backlog:
background integrity/resource arbitration, mission-state-aware oversized recovery,
and bounded telemetry retention/index policy remain separate product owners.
C19 (and those C24 operation phases) cannot be qualified by adding probes alone.
These are product-capability blockers, not missing host inputs or waived checks.
Source-controlled admission holds now prevent campaign/prepublication PASS
from successful subset probes; removing them requires the owning product work.
DON-264's console-only persistent overlay failure likewise remains a product gate.

## Approved decisions

- C29 is mandatory pre-release acceptance on the original machine with training
  data. Postpublication WAR-13B field shadow remains separate. No acceptance
  was generated; an advisory model result cannot supply it.
- C27 draft checks precede a separate Donal publication decision. C00 fresh
  public downloads are mandatory before distribution; mismatch requires
  withdrawal/rollback. Publication alone is not completion.
- REL-004: C27 requires passing GitHub safeguards or separate signed acceptance
  of the exact candidate and observed gaps. Policy approval is not acceptance
  of today's gaps, C29 acceptance or publication authority. Read-only evidence
  at22:02UTC still showed absent approval/thread-resolution enforcement,
  required status checks, secret scanning and push protection. Before/after
  observations and signature expiry/scope checks are implemented.

## Verification snapshot

Current local development evidence:
- C13 coordinate/bearing/measurement flow and independent geometry checks passed.
  C05/C06 loopback provider→store→UI checks passed fixTime ordering, deduplication,
  acknowledgement and stale/disconnected/recovered states; screenshots inspected.
- C28 routine/revision journeys passed nine phases; earlier double-finish failure
  retained. C12 development16 passed attachment/archive/restore custody and four
  persisted marker names; earlier empty-dialog evidence remains rejected.
- C14 `c14-cli-1` correctly fails: persistent overlay error is console-only,
  matching open DON-264. Failure-window screenshot retained; recovery and cleanup
  passed. Generic basemap warnings cannot satisfy this predicate.
- C10 scale-producer small development mechanics passed seven source/archive
  replay streams (0/1,600/3,200 points), concurrent-write cursor rejection and
  cleanup. Source integration/mutation tests passed; this is not scale proof.
- C10 201-outing development flow passed live/archive 100+100+1 pagination and
  rendered last-ID search; screenshot and independent retained SQLite checked.
- C19 development default startup migrated schemas 1–12 and preserved original
  fields; schema6 is explicitly synthetic compatibility, others historical-source
  fixtures. A real SIGKILL at300/50,000 legacy baselines recovered all50,000 and
  survived another restart; three retained databases independently agreed.
- C02 pending-finalize development interruption reached the real snapshot phase,
  killed the app, then showed the durable evidence-loss warning. Retry safely
  refused with ARCHIVE_EVIDENCE_HEALTH_BLOCKED and no finalized audit event.
  This passes the narrow safe-refusal predicate, not successful finalization.
- C01 development FIFO diagnostics/crash holds and SQLite exclusive-lock hold
  produced no actionable response within5s; raw negative receipts preserve
  process identities and originals. These are product-gap observations, not PASS.
- C18 development worker-crash, corrupt-temp, busy-WAL and stale-mirror mechanics
  preserved the good mirror. Permission denial and two genuine concurrent domain
  writes now have actual development evidence and passing focused validators.
- C09 full development13 passed75,008-point import/replacement/concurrency
  custody and exact8MiB pending/retained forced-kill recovery on the default store.
- C03 development7 passed12-outing/midnight, true later-received earlier-fix
  exclusion and selected-device scope. C17 development2 retained a nested-array
  synthetic secret in support export; independent raw re-scan confirms FAIL.
- C11 scoped development `c11-family-dev-receipt-2` retained the full report,
  all1,000pages/50,000rows and clean teardown. Independent raw-file validation
  checked every fixed ID, assignment and outcome; copies and hashes are retained.
  The original development2 timeout occurred later in archive finalization,
  after search-pass creation and mission-finalize request. That retained archive
  hang remains unresolved; removing unrelated archive work from C11 does not
  pass or explain the original full producer attempt.
- C04/C24 source barriers now bind earliest arrival of each new exact position,
  not a later repeat response. C24 development21 completed6/6batches and exact
  8,728rows, two archive cycles and failure recovery, plus all nine competing
  operation phases. Its independent helper validator correctly fails the missing
  overlay warning (DON-264); screenshot inspected. Raw reports and earlier failed
  harness attempts are retained. This is development mechanics, not qualification.

The `5bf844f9` producer-remediation local cycle passed562files /5,761tests, with24skips
(six prescribed timing exclusions plus Linux-only cases on macOS). Lint/build
passed. Strict responsiveness qualification was not run. Earlier failures and
native crashes remain retained, including macOS CODESIGNING Invalid Page.

Logs/failures remain in `tmp/candidate-enablement/`. Electron/Node SQLite addon
builds must use separate coordinated windows: fresh-inode signing recovered
local Electron loading. Confirm actual SQLite open after restoring Node.
All Electron development processes are closed. Node22 ABI127 was restored and
an actual SQLite SELECT1 passed. Exact-head Linux CI and independent remediation
rechecks remain required; local results cannot establish merge readiness or
future candidate qualification.

Review remediation adds Linux subreaper/pidfd ownership, identity-bound leases,
supervisor deadlines/parent-death cleanup, adapter quarantine and lock retention
when cleanup or canonical receipt persistence is unproven. Native Linux mechanics
passed detached cleanup and timeout during actual hashing. C04 development passed
6/6batches/8,728rows with actual operation-bound cancellation stages. These are
development checks, not qualification. Failed CI `35482891762` (campaign-test
setup timeout) and `35486189960` (synchronous sentinel setup) remain retained;
their harness repairs passed later source checks. `35488610748` was cancelled
as superseded, not passed or failed. Full history and review dispositions remain
in the design document's PR43 review-remediation section and PR/Linear comments.

CI `35489521926` at `8f4e77fe` failed eight of18 producer cases. Its scoped
harness repairs passed source/development checks and independent rechecks.
The next CI `35492584673` at `5bf844f9` passed562files/5,778tests (seven skips),
lint/build/browser, packaging/native SQLite and renderer attestation, then
passed15/18 producer cases. All18 proved zero descendants; later packaged
smokes were skipped. Both failed runs and raw receipts remain retained.
C10's WebGL launch configuration and C21's physical-ASAR hash path are repaired.
Both passed bounded checks against the CI Debian application extracted in an
amd64 Bookworm container; this is not installed Ubuntu or candidate proof.
C12 reached attachment opening after successful archive restoration but still
timed out. In a container control, real Mousepad displayed the restored bytes
and its owned PID exited; the pre-cleanup diagnostic still showed
`openAttachment` pending56,608ms, then app.close completed. The cause was the
Linux `shell.openPath` handoff promise remaining pending after the viewer opened.
The approved narrow fix is implemented in
`electron/archive-review-desktop-opener.cjs`: Linux uses
`shell.openExternal(file://...)` and propagates launcher rejection;
macOS/Windows retain `shell.openPath`. Red/green opener, staging and source
tests pass. Exact-head run `35498928827` proves the packaged C12 producer now
passes with the replacement bytes opened and zero owned descendants. That run
still failed overall: C10 recorded a strict 266.7 ms frame gap, and C21 loaded
the repository Node-ABI-127 SQLite addon inside Electron ABI-143, producing
invalid evidence. Follow-up fixes preserve both predicates: C10 adds the
existing packaged background scheduling flags while keeping `<200 ms`, and C21
loads its controller from the packaged ASAR with the controller included by
the builder. A fresh exact-head CI run is required before PR43 can leave draft
state.
Separately, C10 now rejects success receipts containing renderer errors or
unexpected request failures; only explicitly blocked HTTP(S) is exempted.
Focused red/green and unpacked Mac development passed. The follow-up local
The post-C12 source cycle passed563files/5,769tests (24skips), TypeScript, lint
and build. The C21 packaged-controller regression is red then green (11
focused tests); C10/C21 follow-up lint is green. A fresh full source cycle and
exact-head manifest are required for the new follow-up before PR43 can leave
draft state.

Older PR41/PR42 receipts remain in their merged PR/Linear records and
`handoff/archive/`; they do not cover current edits.
