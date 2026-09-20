# HANDOFF.md — Current state

Updated 2026-09-20 for the completed DON-237 diagnostics/support-export repair.

## Current state

Release remains **HOLD**. BCP-17 is incomplete. No candidate freeze,
qualification run, merge, tag, publication or promotion is authorized here.

PR44 ([DON-237](https://linear.app/donal-oc/issue/DON-237)) is non-draft and
mergeable at exact head `d78a0c76a9d1efb265e70ecd586c723695274ead`, directly
on PR43's merge base. The repair recursively sanitizes renderer and Electron
diagnostics, closes legacy `/private`/`/tmp`/`/var` path leakage, and makes the
C17 development receipt independently bind export paths, retained hashes,
canary manifest and bounded rescans. The prior exact-head review of the earlier
repair head found no actionable P0/P1/P2 findings. Hosted Linux run `35537304260` passed the
full workflow, including the C17 proof at job `106148526794`. Its retained
artifact is `electron-linux-validation-evidence-d78a0c76a9d1efb265e70ecd586c723695274ead`;
the C17 receipt is `PASS`, `valid:true`, `zeroCanary:true`, with 11 canaries,
zero exact/adversarial matches, output hash
`352df5721a26415d64d81fd3c7115cc510b8074e66ac3692f091773b27c27969`, and
manifest hash `416d8c2d7d9c1d196076ec21cbe0622b5703311ae644ad0c9c8994b8191907a0`.
The receipt correctly retains `coverageComplete:false` and is not qualification or
release evidence. A fresh exact-head independent review is the remaining review
closeout before human merge review.

DON-254 and DON-255 remain open; PKG-001, WAR-01 and BCP-17 remain separate
release blockers. Do not merge PR44, close the issues, qualify a candidate, tag,
publish or promote from this work.

## Active work and next actions

Active work is PR44, not PR43. PR43's earlier candidate-enablement evidence is
historical and remains below for traceability; it does not describe the current
DON-237 repair state.

Design: [candidate-enablement-design](../docs/assurance/candidate-enablement-design.md).
Historical gap inventory:
[candidate-adapter-inventory](../docs/assurance/candidate-adapter-inventory.md).
The [two-track workplan](../docs/two-track-execution-workplan.md) remains the queue.

Next action: complete the fresh exact-head independent review, update DON-237
with the retained run/job/artifact evidence, and leave merge/release decisions
to the authorized human boundary. The C17 receipt retains
`coverageComplete:false` with the intentional `recursive-adversarial-corpus`
and `bounded-output-scan-identity` gaps.

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
  exclusion and selected-device scope. DON-237 closes the C17 nested-array
  support-export leak and legacy private/system path leak in source/Electron
  paths. Hosted exact-head run `35537304260` passed C17 and the full packaged
  workflow; its receipt remains development evidence, not qualification.
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
rechecks remain historical evidence; the final hosted result is merge-review
evidence only and cannot establish candidate qualification or release readiness.

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
Focused red/green and unpacked Mac development passed. The post-C12 source
cycle passed 563 files / 5,769 tests (24 skips), TypeScript, lint and build.
The C21 packaged-controller regression is red then green (11 focused tests).
Exact-head CI `35501281140` at `4334e4e` now proves C12 and C21 producers, but
C10 still fails its unchanged strict frame predicate at 216.6 ms; renderer
errors and unexpected request failures are empty. The retained failure is in
`tmp/candidate-enablement/remediation/ci-4334-evidence/`. A bounded follow-up
adds the existing Linux `--disable-gpu-rasterization` control to C10 through a
tested launch-argument helper; the `<200 ms` threshold and receipt predicate
remain unchanged. Fresh source verification, exact-head review and Linux CI
are required before PR43 can leave draft state. The fresh exact-head Luna
review of `0284d62e` is clear with no actionable P0/P1/P2 finding; its report
is `tmp/candidate-enablement/reviews/c10-raster-c12-c21-exact-head-review.md`.

Exact-head CI `35503736804` at `0284d62e` is green. The local source cycle is
564 files / 5,772 passed / 24 declared skips, with TypeScript, lint, build and
manifest freeze/check green. Hosted C10 recorded a 166.8 ms maximum frame gap
with empty renderer and unexpected-request-failure diagnostics; its 201-outing
replay also cleaned up. Packaged C12 restored and opened both attachment
variants with matching hashes; packaged C21 completed its 25-case corpus with
valid=true, no failure reasons or coverage gaps, and no secret-canary findings.
Every producer left zero owned descendants. The strict responsiveness and 960k
qualification envelope steps were intentionally skipped by this producer
development workflow. PR43 is now suitable to leave draft state for Donal's
merge review; no merge, freeze, tag, publication or candidate qualification has
occurred. Release holds remain unchanged.

The review-remediation local verification on 2026-09-20 passed the focused
qualification/control suites (8 files, 71 tests; then 4 files, 55 tests), the
full Vitest suite serialized (568 files, 5,798 passed, 19 skipped), `npm run
lint`, `npm run build`, and 17 rendered Chromium archive-review/mission-review
tests. One parallel full-suite run hit the existing strict responsiveness check
at 200.2 ms; the serial full suite passed. No Linux packaged or installed-deb
qualification was claimed locally. The six non-blocking review suggestions
(script lint coverage, full C21 independent corpus custody, always-on soak
surfaces, manual lock-release verb, harness exclusion from the operator image,
and producer-development workflow gating) remain follow-up work; they do not
change the release HOLD.

Older PR41/PR42 receipts remain in their merged PR/Linear records and
`handoff/archive/`; they do not cover current edits.
