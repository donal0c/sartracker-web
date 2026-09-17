# Qualification control-plane dry run

**Date:** 2026-09-17

**Issue:** `DON-254`

**Scope:** infrastructure rehearsal only. This is not BCP-17/WAR-12, product
qualification, candidate freeze, package proof, or release authority.

## Implemented boundary

- A compiled C00-C29 registry checks independently pinned inventories and fails
  closed on missing/duplicate contracts, hazards, programme changes and release
  gates.
- Candidate evaluation separates deterministic contract results, blockers and
  advisory visual-judge concerns. A judge pass cannot override a missing or
  failed deterministic contract.
- Source, fixture, artifact and validator inputs use exact byte identities.
- One result packet, oracle-blind advisory judge packet, append-only manifest,
  seal and separately written anchor are emitted with exclusive creation.
- Verification requires the external anchor and a closed set of regular files;
  it rejects post-seal mutation, extra files and symlink/path escape. Candidate
  mode is hard-disabled in the library and CLI until phase 6 is explicitly
  authorized and its receipt predicates are implemented.

## Local rehearsal

The clean source head `7fd1aab8636a686eea95533117a0aeabef6b5c89`
(tree `c106694d7e5bbebf41a922014b2a9164ec09516f`) ran:

```text
npm run qualification:dry-run -- --output /tmp/sartracker-qualification-dry-run-5
```

The runner compiled 30 contracts and 40 uniquely owned release-critical
hazards, bound the source, registry, both validator scripts and the outing
fixture, wrote the packet/manifest/seal/anchor, and independently verified the
sealed bytes. It returned `DRY_RUN_ONLY` and `releaseEligible: false`; all 30
product contracts remain deliberately `not-run`. Manifest SHA-256:
`9da042eb4fa3bf7121f07a935bcdf2a5f21251c35c4699ce9ce7a59a539f1936`.

Focused tests pass 8/8, including self-omitted canonical obligations, disabled
candidate execution, judge non-authority, mandatory anchor, closed evidence
set, child and directory symlink escape, and post-seal tamper controls. Lint
passes.

## Remaining boundary

The local anchor only proves the interface. A final campaign must retain the
anchor outside the writable evidence bundle (recommended: protected CI
artifact plus its hash in `DON-254`). Runtime adapters still supply their own
contract receipts; this control plane does not turn old receipts into current
evidence. Candidate freeze and the expensive campaign remain separate later
steps.
