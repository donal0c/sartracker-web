# Qualification control-plane dry run

**Date:** 2026-09-17

**Issue:** `DON-254`

**Scope:** infrastructure rehearsal only. This is not BCP-17/WAR-12, product
qualification, candidate freeze, package proof, or release authority.

## Implemented boundary

- A compiled C00-C29 registry fails closed on missing/duplicate contracts and
  missing/duplicate release-critical hazard ownership.
- Candidate evaluation separates deterministic contract results, blockers and
  advisory visual-judge concerns. A judge pass cannot override a missing or
  failed deterministic contract.
- Source, fixture, artifact and validator inputs use exact byte identities.
- One result packet, oracle-blind advisory judge packet, append-only manifest,
  seal and separately written anchor are emitted with exclusive creation.
- Verification rejects post-seal mutation. Final-candidate execution is not
  exposed by the CLI; only an explicit non-candidate dry run is available.

## Local rehearsal

The clean source head `66716a9f16395ba253165a78abe1bf14646dcdd6`
(tree `43b6876c8158b313c5d57320a93116755b31e10b`) ran:

```text
npm run qualification:dry-run -- --output /tmp/sartracker-qualification-dry-run-2
```

The runner compiled 30 contracts and 40 uniquely owned release-critical
hazards, bound the source, registry, both validator scripts and the outing
fixture, wrote the packet/manifest/seal/anchor, and independently verified the
sealed bytes. It returned `DRY_RUN_ONLY` and `releaseEligible: false`; all 30
product contracts remain deliberately `not-run`. Manifest SHA-256:
`fb691ae5639351bc0640ef06921fbb88b6f3995c4e07d6fa2cda4f0a68ab28d3`.

Focused tests pass 5/5, including missing contract, duplicate hazard ownership,
judge non-authority and post-seal tamper controls. Lint passes.

## Remaining boundary

The local anchor only proves the interface. A final campaign must retain the
anchor outside the writable evidence bundle (recommended: protected CI
artifact plus its hash in `DON-254`). Runtime adapters still supply their own
contract receipts; this control plane does not turn old receipts into current
evidence. Candidate freeze and the expensive campaign remain separate later
steps.
