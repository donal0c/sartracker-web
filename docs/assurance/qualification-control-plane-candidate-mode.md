# Qualification control plane — candidate mode

This document describes the executable controller added for `DON-254`. It is
qualification infrastructure, not a beta qualification result. The checked-in
`qualification-campaign-plan.json` is a reviewed C00–C29 adapter map; it is not
an exact candidate. Runtime handoff values remain deliberately absent until the
separate candidate-freeze decision. The synthetic plan is calibration-only.

## Safety boundary

`qualification:dry-run` remains explicitly non-release and returns
`DRY_RUN_ONLY` with `releaseEligible: false`.

Candidate execution requires a compiled immutable campaign definition. Compile
captures the clean source SHA/tree, contract-registry digest, validator module
digests, fixture digests, candidate artifact digests, adapter bindings and
preflight requirements. The definition is written once with exclusive create;
changing any bound input requires a new definition and a new campaign.

An exact rerun of compilation is idempotent when the existing definition bytes
match; a changed plan or source identity must use a new output path. Source
comparison includes SHA, tree and dirty state, including untracked files.

The controller fails closed when a mandatory adapter, receipt validator,
capability, exact artifact or identity is absent. Browser, exact CI AppImage
and installed `.deb` proof modes are separate. A local build never satisfies a
CI-artifact or installed-package binding. Existing receipts are never imported
as current evidence.

Every attempt has a unique immutable directory and linked retry identity. State
events are append-only. An interrupted attempt can resume only when its
definition and input digest are identical. A retry creates a new attempt and
retains the failed predecessor.

Sealed attempts cannot be resumed. The campaign lease records host and PID and
is not handed to another live process; stale or foreign ownership requires
explicit cleanup. Baseline TCP ports are probed rather than recorded as an
assumption, and the free-space check is made against the campaign root's
filesystem.

Evidence is a closed regular-file set with SHA-256 identities, campaign and
attempt correlation, an external anchor, and independent verification. Symlink
roots, path escape, extra files, changed bytes, missing anchors and
cross-attempt identity fail verification. Cleanup removes only controller-owned
disposable roots; an uncertain cleanup is quarantined as `CLEANUP_BLOCKED`.

The advisory judge sees only an oracle-blind packet of capture identities. Its
result is schema- and packet-bound and cannot override deterministic failure,
missing evidence, identity failure or environment blocking.

## Commands

From a clean checkout:

```text
npm run qualification:dry-run -- --mode dry-run --output <directory>

npm run qualification:calibration -- --root tmp/qualification-calibration

npm run qualification:compile -- \
  --plan docs/assurance/qualification-calibration-plan.json \
  --output tmp/qualification-calibration/campaign-definition.json

npm run qualification:preflight -- \
  --campaign tmp/qualification-calibration/campaign-definition.json \
  --root tmp/qualification-calibration

npm run qualification:run -- \
  --campaign tmp/qualification-calibration/campaign-definition.json \
  --root tmp/qualification-calibration \
  --contract C00 --variant synthetic-pass

npm run qualification:resume -- \
  --campaign tmp/qualification-calibration/campaign-definition.json \
  --root tmp/qualification-calibration --attempt <attempt-id>

npm run qualification:ingest-judge -- \
  --attempt tmp/qualification-calibration/attempts/<attempt-id> \
  --result <oracle-blind-judge-result.json>

npm run qualification:verify -- \
  --attempt tmp/qualification-calibration/attempts/<attempt-id> \
  --anchor tmp/qualification-calibration/anchors/<attempt-id>.anchor.json

npm run qualification:verdict -- \
  --campaign tmp/qualification-calibration/campaign-definition.json \
  --root tmp/qualification-calibration
```

The verdict vocabulary is `PASS`, `FAIL`, `INVALID_EVIDENCE`,
`ENVIRONMENT_BLOCKED`, `NEEDS_HUMAN_DECISION`, `ABORTED_SAFE` and
`CLEANUP_BLOCKED`. The candidate `verdict` command exits non-zero for a
non-`PASS` result. The calibration command reports its intentionally expected
`FAIL` as data and returns normally; even a calibration `PASS` is never release
eligible.

The checked-in calibration command intentionally produces a deterministic
failure plus an advisory judge pass, so its expected verdict is `FAIL` and its
purpose is to prove that judge advice cannot override deterministic evidence.
It runs every mandatory calibration binding, including interrupted/resumed
evidence, and cleans up its lease before returning.

## Current beta13 boundary

The beta13 plan binds reviewed source/browser inventories and package, live,
identity, release and externally signed human adapters. Adapter development and
full-family coverage review are still in progress. Exact candidate inputs are
not supplied by this work. Preflight remains `ENVIRONMENT_BLOCKED` until every
mandatory binding and input is resolved. This PR does not freeze a candidate,
run BCP-17/WAR-12, publish an artifact or test the original machine.

## Data-only runtime handoff

The future candidate plan supplies `runtimeInputPath`, `candidateId`, `version`,
`externalHuman` and `release` without replacing reviewed bindings or commands.
Runtime JSON uses schema `sartracker-candidate-runtime-inputs-v1` and exactly
the fields `schema`, `ci`, `installedExecutablePath` and `fixtures`, with optional
`enospcMount` for the mandatory physical disk-full probes. That field must name
an existing canonical absolute directory. It does not create or approve a
volume: the producer independently requires a distinct filesystem no larger
than64MiB and fills only its newly created owned subdirectory. Missing or
unsuitable input remains blocked; synthetic thrown errors do not count.
`ci` is the `sartracker-candidate-ci-artifacts-v1` manifest with the verified
archive, two installer roles (`ci-appimage`, `ci-deb`), version and provenance
(`sourceSha`, `runId`, `runAttempt`, `artifactId`). File identities contain
absolute `path`, `bytes` and `sha256`. GitHub metadata and installed payloads
are checked afresh; local hashes or a downloaded deb do not prove installation.

Fixture roles currently include `storage-mission`, its optional separately
bound `storage-mission-manifest`, and scale roles `paging-960k`, `paging-2m`,
`paging-2m-1gib`, `paging-field-37gb`. The 2m headroom fixture and one-GiB
storage workload are separate: the existing 2m fixture is smaller than one GiB.
Scale admission requires 100 primary-mission devices and twelve outings plus
the named total fixture row/file-size floor. The reviewed BCP generator's twelve
legacy-mission rows are counted explicitly; this paging producer proves every
primary-mission row, while legacy behavior has separate regression coverage.
Source fixtures are copied
into disposable owned roots and rehashed; raw paging evidence is retained and
stream-validated against an independently opened source database. The reviewed
plan requires 64 GiB free before admission for retained large-archive copies; this is a prerequisite, not runtime
resource qualification.

`live-config` is the one directory-valued fixture role. It contains exactly
`credentials.json` and `settings.json`, regular non-symlink JSON files bounded
to one MiB each. Its identity is the SHA-256 of sorted manifest records
`name\0bytes\0sha256\0`, with total byte count. `live-selector` is a separately
bound regular file. Live access is GET-only. Private configuration, full logs,
positions and live screenshots are excluded from retained/model evidence;
only the allowlisted HMAC stage oracle and sanitized process facts remain.
Mandatory C05 synthetic browser evidence supplies that family's advisory visual
review, so this separation does not waive the family obligation.

Package execution requires Linux x64, the reviewed Playwright dependency,
an X11 `DISPLAY`, and `unzip`, `unsquashfs`, `dpkg-deb`, `dpkg-query`, `xdotool`
and `xwininfo`. Static availability is not a successful application launch.
Every actual package process is independently tied to executable and ASAR
bytes. Direct-child and descendant cleanup are bounded and checked.

## Human and release phases

Donal clarified the execution order on 2026-09-25: Ubuntu technical validation,
approved controlled handover to Eamonn, then original-machine human acceptance.
C29 is `posthandover`; missing signer setup does not block technical preflight.
The controller checks authority before a C29 attempt and requires completed
technical checks before issuing its pending request; controlled handover still
needs separate approval. Public-byte C00 applies after actual publication and is
not invented for an unpublished controlled handover. The existing signed-envelope
session-kind string remains unchanged for compatibility, not as a publication-order rule.

`technicalHandover` reports `READY_FOR_APPROVAL` only after all applicable C00–C28
prepublication variants pass with the reviewed residual scope and no technical or
integrity failures. It leaves publication, distribution and operational eligibility
false. C29 and fresh public-byte C00 remain separately visible; neither is forged
or waived. Full evidence completion still requires human acceptance. Definitions,
source/artifact/input digests and retained attempts stay immutable: this change
does not add later authority to a sealed technical campaign or transfer its results.
The overall campaign verdict and CLI exit code continue to report incomplete
qualification while C29 or public-byte C00 is missing. Read the separate
`technicalHandover.status` for technical readiness; do not reinterpret a nonzero
whole-campaign result as a pass or discard its pending rows.

Registry hazard ownership is a single primary routing owner, not permission to
skip the other required contracts in QA-plan section 4.2. The routing test
checks every primary owner against that canonical many-contract map. In
particular REL-004 is owned by C27 repository-control admission, not C25 soak;
stationary attention is TRK-004/C06, and skipped incremental history is
TRK-003/C05. All mandatory C00-C29 variants still govern campaign admission.

C29 issues a pending training request; it never generates acceptance.
`externalHuman` supplies `authorityPath` and `authorizationPath`. The public
authority contains only `signerId`, `machineId`, `profileSha256`, `dataClass`,
an Ed25519 `publicKey`, and its reviewed `trustedPublicKeySha256` digest.
Candidate mode requires that digest to be present and binds both authority paths
and the digest to the reviewed campaign plan; a campaign cannot nominate its
own signing key. Private signing keys never enter the controller.
The named signer supplies the signed envelope and evidence attachment for the
fresh request. Invalid/stale submissions and missing attachments are retained.
Training acceptance is distinct from postpublication WAR-13B field shadow.

C27 runs after other technical checks, with C29 allowed to remain pending. It
requires fresh draft metadata, exact tag/artifact/checksum bytes, tag-driven
release CI provenance before and after transfers, and independently downloaded
prior rollback artifacts. It cannot authorize publication. After Donal's
separate publication decision, C00 requires unauthenticated fresh public
downloads before team distribution. Public mismatch requires withdrawal or
rollback; authenticated draft downloads cannot satisfy that step. Both phase
outcomes are exposed, and publication alone never completes qualification.

C27 also retains fresh repository rules, exact-head checks, associated review
metadata and secret-scanning configuration before and after inspection. Donal's
2026-09-19 policy requires safeguards to pass or a separate signed REL-004
acceptance; missing acceptance yields `NEEDS_HUMAN_DECISION`. This approval of
the policy did not accept current gaps. Optional immutable runtime fixture roles
`release-risk-authority` and `release-risk-acceptance` supply bounded JSON files.
The authority is independently approved and pinned before compilation and
contains only `signerId: "donal0c"`, the Ed25519 public key, and its
`publicKeySha256` digest. The release definition carries the same reviewed
digest, and runtime risk inputs must match it byte-for-byte. Never take a
verification key from the acceptance itself or supply private signing material.
The signed payload schema in `scripts/qualification/repository-risk.mjs` binds
repository, C27/REL-004, exact source/tag/release/assets, every observed gap,
rationale, compensating controls and a maximum seven-day expiry. It explicitly
sets `publicationAuthorized: false`. Any changed candidate or additional gap
requires a new decision; C29 cannot substitute for it. The controller does not
generate or sign acceptance. Retained replay checks the original observation
times rather than extending the decision's validity.

Linux CI also runs bounded producer development checks against its unpacked
build. Those reports explicitly say `qualificationExecuted: false` and are not
sealed campaign receipts, installed-deb evidence, AppImage qualification or
release admission. Failed logs and frames remain available for diagnosis.
