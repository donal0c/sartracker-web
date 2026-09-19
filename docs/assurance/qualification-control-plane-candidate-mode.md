# Qualification control plane — candidate mode

This document describes the executable controller added for `DON-254`. It is
qualification infrastructure, not a beta qualification result. The checked-in
`qualification-campaign-plan.json` is a reviewed C00–C29 adapter map; it is not
an exact candidate and it deliberately contains unresolved runtime/package
adapters. The synthetic plan is calibration-only.

## Safety boundary

`qualification:dry-run` remains explicitly non-release and returns
`DRY_RUN_ONLY` with `releaseEligible: false`.

Candidate execution requires a compiled immutable campaign definition. Compile
captures the clean source SHA/tree, contract-registry digest, validator module
digests, fixture digests, candidate artifact digests, adapter bindings and
preflight requirements. The definition is written once with exclusive create;
changing any bound input requires a new definition and a new campaign.

The controller fails closed when a mandatory adapter, receipt validator,
capability, exact artifact or identity is absent. Browser, exact CI AppImage
and installed `.deb` proof modes are separate. A local build never satisfies a
CI-artifact or installed-package binding. Existing receipts are never imported
as current evidence.

Every attempt has a unique immutable directory and linked retry identity. State
events are append-only. An interrupted attempt can resume only when its
definition and input digest are identical. A retry creates a new attempt and
retains the failed predecessor.

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

## Current beta13 boundary

The beta13 plan names the existing smoke/browser/validator surfaces and their
required proof modes, but its exact artifact identities and several executable
receipt adapters are intentionally not present in this PR. Compiling that plan
therefore produces a useful immutable plan only after exact candidate inputs
are supplied; preflight remains `ENVIRONMENT_BLOCKED` until every mandatory
row is resolved. This PR does not freeze a candidate, run BCP-17/WAR-12,
publish an artifact, test the original machine or change product code.
