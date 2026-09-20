# DON-254 candidate enablement

This slice starts at PR42 merge `bd301484561fac372ef7c95090ab5d9cc21533f3`.
It prepares qualification machinery; it neither selects nor qualifies beta.13.

## Expected behaviour and acceptance criteria

- Every mandatory C00-C29 variant resolves to a reviewed executable adapter and
  deterministic validator. Process success alone never establishes a contract.
- A contract passes only when **every** mandatory variant has valid, sealed,
  definition-bound evidence. Failed attempts remain visible and blocking.
- Source, browser, CI AppImage, genuinely installed deb and human evidence retain
  their separate meanings. Synthetic calibration cannot enter candidate mode.
- Runtime handoff supplies the clean post-merge SHA/tree, candidate version,
  CI provenance, exact package bytes, installation/runtime identity, fixtures and
  necessary environmental inputs. Missing inputs block with explicit reasons.
- Receipt validation checks the actual independent oracle, coverage, terminal
  completion, identity and capture bytes. Missing observations, malformed or
  conflicting evidence, wrong tiers and changed bytes fail closed.
- C29 requires externally supplied named human/original-machine evidence; no
  generated acceptance result. C27 retains the downstream DON-255 decision.
- No product repairs, operational qualification, tag, publication or deployment
  occur in this slice. Existing responsiveness thresholds remain unchanged.

## Verification plan (recorded before production edits)

First reproduce gaps using focused negative tests. Cover wrong/missing adapters
and validators, all mandatory variants, tier substitution, missing or mismatched
candidate/artifact identities, malformed external evidence, interrupted attempts,
changed files, and independent verdict revalidation. Exercise CLI compile,
preflight, run, verify and verdict with isolated calibration inputs; never label
these as beta qualification. Run affected suites, the serial correctness suite,
lint/build and exact-head Linux CI. Complete one independent broad review plus
three risk-focused reviews, remediate accepted findings and recheck affected
boundaries before marking the PR ready.

## Version and release metadata decision

Keep `package.json`/lockfile version and release metadata unchanged here. The
workplan's Phase 2 candidate-freeze procedure explicitly selects
`0.1.0-beta.13`, artifact names, fixtures and rollback together. The release
workflow checks that tag and package version agree before building. Therefore
the version and release-note preparation must precede the future exact candidate
SHA/CI build, in the candidate-freeze step; this enablement PR's SHA is not a
preselected candidate. Never substitute this PR's base or head for its future
merge SHA, or reuse beta12.11/local hashes as beta.13 identity.

## Required exact-candidate handoff

The later freeze step supplies an explicit clean source SHA/tree after version
and release-note preparation is merged. The enablement PR cannot contain its
own eventual merge SHA. A local configuration must supply data and owned paths,
not substitute arbitrary commands, validators or weakened budget values for
reviewed bindings. Changing any input creates a new immutable campaign.

CI provenance must be independently read from GitHub for the supplied run and
artifact ID: repository, workflow path, run ID/attempt, completed-success state,
exact `head_sha`, artifact ID/name, expiry state and archive digest. Download
that artifact from the matching run, verify its archive digest, then derive
the inner AppImage/deb/SHA256SUMS identities from those verified bytes. An
asserted `ciRunId` or a locally computed installer hash alone is insufficient.
Never confuse GitHub's artifact ZIP digest with the contained installer digest.
For example, PR42's inspected run is a `pull_request` run at its PR head; its
artifacts do not become post-merge beta.13 artifacts because master merged it.

Runtime configuration must separately bind:

- source checkout and all executed adapter/validator modules;
- exact CI AppImage and CI deb installer, package version and ASAR/native bytes;
- each scenario's immutable source fixture, size/workload and independent oracle;
- reference host/platform/architecture and display/process capabilities;
- controller-owned output/profile/fixture roots and bounded resource budgets;
- private-map/live-GET configuration only for the relevant authorized variant;
- external authority/session inputs for pre-release C29 training acceptance.

The deb **file** is not installation evidence. Installed proof additionally
requires successful package-manager state, matching installed version and
architecture, actual installed file identities compared with the verified deb
payload, and the launched process executable/ASAR matching that installation.
An extracted deb or `linux-unpacked` directory cannot satisfy this boundary.
AppImage proof must launch the exact verified AppImage and bind the resulting
runtime; a sibling unpacked executable is not equivalent proof.

The data-only runtime handoff, fresh CI archive inspection, installed payload
comparison and observed package process identity are implemented in
`runtime-inputs.mjs`, `candidate-artifacts.mjs` and `package-runtime.mjs`.
Their local tests are infrastructure evidence. No installer, private profile,
live provider or actual installed-machine proof is populated by this document.

## Starting investigation (historical)

At the start, PR42's registered adapters were calibration-only. Several proposed package rows
name browser/source commands, and the existing verdict aggregates by contract
rather than requiring every mandatory variant. These are enablement gaps, not
evidence that a product contract has passed or failed. Detailed adapter inventory
and verification results will be recorded as implementation proceeds.

The executable plan now requires each packaged scenario separately on the CI
AppImage and installed Debian build. The binding retains its package-specific
variant identity; only its fixed producer scenario is normalized. C02 includes
five interruption/close paths, C18 seven backup faults, and C03/C11/C17 dedicated
family probes. A successful sibling cannot cover a missing package or scenario.

PR CI additionally runs a bounded unpacked-package producer-development plan.
It never creates candidate receipts or release eligibility. Held-startup checks
separate infrastructure mechanics from the observed product predicate: a real
bounded negative may verify the probe while retaining `observedPredicateStatus:
FAIL`. Large fixtures, physical ENOSPC, long soaks, private/live inputs and named
human acceptance remain separately executed qualification obligations.

## Approved C29 separation (2026-09-19)

Donal approved separating mandatory pre-release original-machine/training
acceptance (C29) from post-publication WAR-13B field shadow. C29 uses only
synthetic, replayed or disposable training data and requires named external
human acceptance on the exact installed candidate on the original machine.
It never counts toward the WAR-13B field scorecard. Tier G retains all
qualification, DON-255 and publication admission gates for field shadow.
Record exact candidate identity for both; no cross-build transfer of acceptance.

Decision source in the candidate-enablement task: Codex asked, “Should we
separate pre-release original-machine/training acceptance from post-publication
WAR-13B field shadow? I recommend that distinction, without counting training
as field evidence.” Donal replied, “Let's go with your recommendation.”
This is authorization for the contract distinction, not a human acceptance
receipt, qualification run, publication approval or field-admission decision.

`team-evidence.mjs` is integrated with a pending human request, immutable
authorized signer configuration, attachment custody and signed ingestion under
the campaign resource lock. Tests use generated keys and synthetic declarations;
they are not human acceptance. A valid signature establishes who made an
attestation, not that an unobserved session happened. Missing files and invalid
submissions remain retained invalid attempts rather than disappearing.

## Retained local evidence

### Product capabilities remain separate implementation owners

The C19 specification explicitly retains DON-249, DON-250 and DON-251 as
separate owners. Live Linear inspection on 2026-09-20 confirmed all three are
Backlog. Existing migrations can be exercised through normal application
startup; background integrity arbitration, state-aware oversized recovery and
bounded telemetry retention cannot be established by probes when the product
does not yet implement them. `product-capabilities.mjs` therefore records
source-controlled candidate admission holds for C19 and the affected C24
phases. These holds block both the campaign and prepublication verdict even
when every implemented subset probe passes. They are not environment inputs,
human-waivable exceptions or evidence that a test was executed. Their owners
must implement the capability and reviewed qualification coverage before the
holds are removed. This PR does not implement those product changes.

DON-264 remains a separately observed negative C14 result: persistent overlay
failure is console-only. Unlike the absent capabilities above, this behavior
has a runnable probe and must fail its actual operator-warning predicate.

### REL-004 decision, 2026-09-19

The QA plan treated repository safeguards as open-blocking while the coordinated
ledger's earlier triage deferred them. Codex asked Donal which rule C27 should
enforce and recommended blocking readiness unless safeguards pass or Donal
supplies explicit signed risk acceptance. Donal replied, “Let's go with your
recommendation.” The rule is now enforced by fresh before/after observations
and the separate exact-candidate signature validator. This is not acceptance of
the current observed gaps, a C29 attestation, or authorization to publish.

The routing registry was also reconciled against the canonical QA hazard map:
REL-004 belongs to C27, not soak C25. Every primary owner must be one of the
canonical required contracts; primary routing never removes sibling obligations.

`tmp/candidate-enablement/` retains red and green controller logs. Reproduced
failures cover missing sibling variants, foreign-campaign receipts, changed
preflight inputs, candidate calibration substitution, borrowed leases, changed
receipt proof tiers and changed validator bytes. Preliminary independent review
also reproduced masking of INVALID_EVIDENCE/NEEDS_HUMAN_DECISION/CLEANUP_BLOCKED
by a passing sibling; all three now have red/green regressions. The narrow
reviewer rechecked that repair without further P1/P2 findings. This is not an
exact-head PR review.

An earlier focused run passed 50 tests; that snapshot's lint and production build passed.
The first wider source run overlapped development of the sibling-status tests
and encountered their red state; it is retained as development evidence, not a
green stable-source claim. An earlier stable serial correctness run passed
481 files / 5,220 tests, with six declared correctness-mode exclusions. Strict
responsiveness qualification was not run. Later adapter edits invalidate that
snapshot as a current full-suite claim. An isolated synthetic Git checkout also
exercised the real CLI: calibration returned the intentional C01 FAIL with
CLEANED lease; plan compilation succeeded; candidate preflight returned
ENVIRONMENT_BLOCKED for host, candidate, adapter, validator and artifact gaps.
These are infrastructure/source results only.

The initial stable local correctness run passed 552 files and 5,687 tests, with the
six prescribed correctness-mode exclusions. Lint and the production build passed.
Current development receipts include the complete 50k C11 raw-page oracle and the nine C24 competing
operation phases. C17's raw secret leak and C14/C24's missing visible overlay
warning remain negative product observations. Exact-head Linux CI and four
independent reviews are required on the delivery PR before merge readiness;
none of these source/development results qualifies a candidate.

## PR43 review remediation

Four independent reviews at `bab0ddb5ab35782935c5fede0cb07f491d8ac3c4`
identified fourteen actionable findings. The revisions bind C18 variant identity,
C14 exact feature membership, C20/C22 observed source/cleanliness, C05 runtime
custody, C00's canonical installed launcher and C29's exact parsed authority bytes.
C01 physical-disk-full success now also requires removal of both owned fillers
and disposable profiles. Failures and the original review reports remain retained.

Process ownership now uses a Linux Python subreaper with pidfd signalling and a
private bounded protocol. Detached and double-forked descendants must be reaped
before cleanup can pass; unsupported hosts fail before producer launch. A fixed
outer worker bounds soak preparation, execution and retention together. Unproven
cleanup quarantines the resource lock, including when writing the failure receipt
also fails; lease cleanup then requires explicit manual recovery. Lease publication
is atomic and ownership includes boot/process-start identity.

C04 stage records now contain actual operation/request IDs, timestamps, ordered
events and outcomes; a query that already settled cannot claim an in-flight stage.
Bounded descriptor reads enforce JSON/image limits while reading, and failed
capture retention cannot silently disappear. Actual native Linux container tests
covered detached descendants, cancellation, protocol failure and a soak-worker
timeout during artifact hashing. These are mechanics checks, not Linux x64
candidate qualification. The macOS C04 development rerun completed six batches
and 8,728 rows with observed cancellation stages; its raw report and screenshot
remain under `tmp/candidate-enablement/c04-review-remediation-dev-1/`.

Initial hosted CI `35482891762` failed one test's 120-second full-campaign setup
deadline (5,686 passed). The regression now compiles one actual reviewed C19
binding and one C24 binding while retaining the source-recheck and all three
product-capability holds. The failed run is not erased or treated as passed.
The producer-development step's deadline now covers its fixed aggregate command
budgets plus cleanup and evidence headroom; product responsiveness limits remain
unchanged. Replacement exact-head CI and independent remediation rechecks remain
required before PR readiness.

Post-remediation serial correctness passed554files /5,714tests with21skips:
six prescribed timing exclusions and Linux-only cases on macOS. Lint and build
passed; the build-generated version file was restored, leaving product/version
trees unchanged. Logs are `tmp/candidate-enablement/remediation/final-*`.

Independent rechecks of `065e2c8b` found additional failure-path gaps: controller
death and internal supervisor exceptions, non-soak resource quarantine, code-only
worker failures, and canonical receipt persistence. The next revision gives the
Linux supervisor its own monotonic deadline and parent-death signal, carries
unproven cleanup through every owned adapter, and validates definition-bound
code-only soak failures without requiring nonexistent raw reports. The redundant
parent soak receipt write is removed. Canonical persistence errors retain the
resource lock and return a fixed recovery error without secondary receipt writes.

Hosted CI `35486189960` failed the Linux sentinel test: synchronous `sleep 30`
blocked until the unrelated sentinel had already exited. It recorded5,727passed,
one failure and seven skips; later package steps did not run. The test now starts
and closes that sentinel asynchronously. The earlier full-campaign setup timeout
did not recur. Both failed CI logs remain retained; neither is qualification or
passing delivery evidence. Final stable-source checks and exact-head rechecks
remain required for this revision.

Final second-remediation local correctness passed559files /5,737tests with24skips
(six timing exclusions and Linux-only cases on macOS), followed by lint and build.
The frozen1,405-file executable/test manifest remained unchanged after restoring
only build-generated version metadata. Native Linux mechanics passed17owned-process
tests, including controller death/freeze and the unrelated-PID regression; that
regression fails against the previous supervisor. Actual worker preparation again
timed out while hashing the sparse artifact and proved zero descendants. These
results remain source/development evidence. Logs: `second-final-*`,
`oracles-supervisor-identity-green.log`, `pid-regression-old-red.log` and
`soak-preparation-timeout-linux-final-3.log` under the remediation directory.
Exact-head independent re-attestation and hosted CI remain the PR readiness gate.

The `745b471b` final rechecks found two further P2 predicates: C01 ignored
producer/held-gate cleanup failures, and an exited producer sampled after its
deadline could be recorded as on time. Both have failing regressions followed
by focused green checks. C01 now requires empty producer failure accounting,
removed FIFO holds and a positively closed, identified SQLite lock holder.
The supervisor treats completion first observed after its deadline as timeout.
The controlled-clock test reproduces the original race without timing luck.
Hosted run `35488610748` was deliberately cancelled when these executable
corrections superseded its head; it supplies no passing delivery claim.

The final predicate revision passed559files /5,744tests with the same24declared
skips in542.37seconds, then lint and build. All1,405frozen executable/test files
matched after restoring generated version metadata. The native Linux17-test
owned-process suite includes both direct Python regressions; C01/package focused
checks passed48tests. Affected independent working-tree rechecks are clear.
Logs are `third-final-*`, `c01-held-cleanup-*`, `supervisor-deadline-race-*` and
`linux-owned-deadline-final.log`; committed-head rechecks and CI follow.

### First Linux producer-development integration

Run `35489521926` at `8f4e77fe` passed559source files/5,761tests with seven
skips, lint/build/browser checks and artifact inspection. Its18-case development
matrix failed eight checks; all cases reported zero descendants and cleanup was
not blocked. Later packaged smoke was skipped. Retained evidence is under
`tmp/candidate-enablement/remediation/ci-8f4e77fe-evidence`; the full and failed
CI logs remain alongside it. This failed run is not candidate qualification.

Confirmed harness defects include C16's uninitialized session receipt, C21/C23's
unavailable main-context `require`, C23's unnormalized IPC error envelope,
C26's nonexistent stderr finalizer, and C28's extra C11-only fields and replay
timestamp captured before imports. C10 development additionally reproduced
Chromium/Node transcendental rounding differences in generated polygon bytes;
the producer now sends host-generated input to Chromium while retaining the
independent oracle. C10's Linux blank screen and C12's Linux archive/open failure
remain unresolved; added error retention is diagnostic, not a passing repair.

Local Electron development `c10-development-fixed` passed exact live/archive
geometry with five fragments and16.6ms maximum frame gap. `c28-development-fixed`
completed all nine bridge/store phases, including two static GPX points and
three dated track points; its independent validator rejects only source/package
identity. The active-frame screenshot still shows the idle renderer before
refresh, so it is not proof of an active operator UI. C12 development passed
attachment custody. C21 source calibration passed with gaps; C23 observed both
real IPC guards and cleanup but remains invalid as packaged evidence. C16's Mac
startup-window timeout is retained, not treated as a successful lifecycle run.
All development Electron processes were closed and Node ABI127 restored with
an actual SQLite SELECT1 before source verification resumed.

C01's observer now polls its owned native dialog during the fixed5s window,
with bounded xdotool/xprop commands and retained observation times. A forced
kill alone never proves a timed-out response; a dialog first observed after the
bound remains negative. Deterministic clock tests cover in-bound, late and
natural-exit observations. C16 now joins its owned app through the existing
bounded close utility, escalates only that child and fails closed on forced,
failed or unobserved cleanup before attempting a restart. Launch and cleanup
errors are retained together. These repairs replace the rejected intermediate
forced-kill classification and fire-and-forget termination proposals.

Independent affected review found C28 also needed to bind the replay response
to the exact requested mission and knowledge time. The producer now rejects a
stale valid timestamp before reusing it for archive review. Its regression was
red, then the three affected files passed45tests. No independent replay,
attachment, security or startup predicate was relaxed.

The stable producer-remediation cycle passed562files/5,761tests with24declared
skips in539.70seconds, then TypeScript, lint and build/bundle checks. All1,409
frozen executable/test files matched after restoring generated version metadata.
Logs: `producer-final-*` under the remediation directory. Affected independent
reviews are clear; the C28 response-time finding was fixed and rechecked. The
previous C10/C12 Linux failures still require new exact-head execution before
PR readiness; no local check or review replaces that gate.
