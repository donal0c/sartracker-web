# HANDOFF.md — Current state

Updated 2026-09-26. Release remains **HOLD**; no final candidate is qualified.
Donal merged PR55 at `6a29a57a42395d8f239b0862a7ce626e67c73189`.
Its reviewed head `5f546b45` passed Linux CI **36265017480**, native ownership
controls and one matching AppImage lifecycle diagnostic. Actual main-process
interruption and descendant cleanup are now verified. The second main exited
SIGTRAP during forced harness teardown: retained and unexplained, not graceful
window-close evidence. Independent source review found no ownership blocker.

## Active source and testing build

Donal resumed work after the stop and authorized the normal grouped direct-master
push to supersede merged-source run **36271106551** for instrumented C10 bytes.
Preserve that run and record its actual terminal state; do not change concurrency
settings or gates. No additional PR ceremony or documentation-only full rebuilds.

- C10 diagnostic `d62f85f5`, integrated as `8bb4bc62`: opt-in, failure-only
  generation/eligible-position/eligible-track expected-versus-observed counts.
  Public IPC error, paging rules, workload and deadlines remain unchanged.
  The original 093 live-middle failure at offset182000→183000 remains unexplained.
  Fresh packaged diagnostic evidence is required; source tests are not that proof.
- Field selector `16768356`, integrated as `3a0769a5`: explicitly admits the
  original generator-v2/schema13 ≥3.7GB fixture and all-position archive custody.
  Its formerly failing preflight passed on the unchanged 093 app. That one run
  then exhausted the unchanged 60-minute limit after finish/backup, with no
  ciphertext or producer receipt. Cleanup passed; failed profile/DBs retained.
  Continued watchdog summaries and CPU do not identify the stalled operation.
  No blind retry or substitution with the different v6 paging fixture.
- C02: original app.quit attempt failed the independent unclean-recovery oracle.
  Native-window correction `8b71fb54` then failed in Playwright's beforeunload
  default auto-accept with “No dialog is showing”; no lifecycle receipt exists.
  Checkout1608 retains two dirty helper/test files with a partial observer fix.
  No Claude dispatch occurred. Preserve that patch; it is not integrated or
  accepted runtime proof, and does not delay the C10 application build.

Astra owns source/build integration in managed `archive-fixture-contract`;
original C02 work remains in `1608`. Sol alone owns serial Ubuntu execution.
CoS coordinates. Do not alter the dirty original checkout or coordinator checkout.
No new workload should use the superseded uninstrumented build.

## Verification snapshot

C10 stable source cycle passed 587 files / 6,077 tests / 26 skips (589.26s),
lint, TypeScript/build and bundle budgets. Eight affected suites passed76 tests;
independent native review accepted. Field source passed49 focused tests and
review; preflight additionally passed packaged diagnosis. Integration preserves
those executable blobs and resolves documentation-only conflicts. Combined
verification passed7 affected suites/95 tests, targeted lint and diff checks.
These diagnostics/harness changes do not alter operator UI.

PR55 patched controls:13 Python tests; native Linux ownership suite6 pass,
3 Mac-only skips. Matching5f AppImage lifecycle: current-fix maxima104/110/167/174ms,
strict200ms gate unchanged; real-main SIGKILL, residual removal and zero descendants
verified. Full identities and the unexplained forced-teardown SIGTRAP are retained
in the Ubuntu report. Ordinary push CI is not strict timing qualification.

Historical merged093 full Linux dispatch **36255209914** passed every lane,
including strict responsiveness, Chromium225/225 flaky-rejecting,960k, Train D,
soak, legacy recovery, archive lifecycle and AppImage launch.
Documentation-only descendants reuse unchanged executable evidence, not a new
exact-head runtime claim. Retain failures **36249965817** (sanitized Train D stack,
fixed by093) and **36252807378** (archive verify201ms; cause unproven).
Archive current-fix margin remains a DON-254 concern; never relax200ms.

## Authority and qualification boundaries

Donal authorized bounded reviewed fixes directly to master and PR55 merge.
No tag, publication/distribution, settings change, waiver or hidden gate bypass
is part of this integration. DON-254's historical Done state does not qualify
the candidate; DON-255 is downstream. DON-179 remains open.

Sequence: Ubuntu technical validation, approval for controlled handover to Eamonn,
then C29 acceptance on the original team machine. C29 signer is not required to
start technical testing; C29 itself remains mandatory and pending.
Technical READY_FOR_APPROVAL authorizes neither publication nor distribution.
CoS owns resolving minimal same-campaign authority/profile prebinding before
sealing. Optional acceptance/key inputs cannot be added after compilation.
C27 remains unattempted until controls pass or authentic acceptance is already
sealed into the original reviewed inputs; NEEDS_HUMAN_DECISION blocks handover.
Live controls may be re-observed. No control/settings/signature change is authorized.
Public-byte C00 follows actual approved publication. No cross-campaign promotion.

Private map/config, schema12 storage baseline and beta12.11 rollback installers
are prepared; do not request again. Original private map zoom8–16 is rejected
(actual9–16); only the separately hashed minZoom9 metadata derivative is authorized.
Its earlier complete diagnostic passed, but final admission must bind derivative
and private lineage in immutable inputs. No private map bytes/locations/screenshots
enter repository evidence. C05 consent permits only existing configured account
and selected tracker GET-only, executed by Sol; live proof remains pending.
C29 human/original-machine acceptance cannot be inferred from Ubuntu evidence.
Retain full applicable C00–C29 variants, package tiers, fixed soaks and failed receipts.

## Next actions

Push the verified grouped diagnostic source and hand Sol its exact CI installer
identities for the bounded C10 attribution run. Keep C02 correction and field
stage diagnosis separate; no blind reruns. Inspect terminal CI results and the
affected packaged evidence before further candidate decisions.
Use validation-workflow hashes, not installer names, to identify testing builds:
release and validation currently share filenames. Release-workflow bytes require
their own tag-driven successful run and unpublished draft; no final tag is frozen.

Evidence and history: [Ubuntu report](../docs/assurance/beta13-ubuntu-execution-20260925.md),
[active workplan](../docs/two-track-execution-workplan.md),
[testing cadence](../docs/testing-and-review-cadence.md),
[PR54 repair ledger](../docs/releases/beta13-browser-gate-repair.md),
[pre-repair history](archive/2026-09-25-pre-c12-repair.md).
