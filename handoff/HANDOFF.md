# HANDOFF.md — Current state

Updated 2026-09-19 during DON-254 qualification-controller enablement.

## Current state

`origin/master` is `1f9184cf416144767f26fc7b00b302787cf0a91e`, the post-merge
TRK-001 receipt commit following PR #41 / TRK-001 and PR #40 / GEO-002 at
`c916ced9`. PR #41's exact source head was
`529cef5098497ae3f29c574011b088c4aa92ac11`. Release remains
**HOLD** and no beta candidate, release tag, publication, or promotion is
authorised by this handoff.

PR #40 (`codex/geo-002-pre-candidate-repair`) and PR #41
(`codex/trk-001-current-position-repair`) are merged.

## Active work

- `DON-254` / GEO-002: PR #40 is merged at `c916ced9`. Geometry distances are
  bounded, antimeridian area is handled, corrupt drawing payloads fail closed,
  edit/save errors retain provenance, and operator inputs expose numeric bounds
  where applicable.
- `DON-267` / TRK-001: PR #41 merged at `27687b53` from exact head
  `529cef50`. Accepted empty live
  current snapshots fence late cache, live status is not clobbered by cache,
  recovery has one operator warning, and retained participant scope fails closed
  after a bounded hold.
- `PKG-001` and the WAR-01/BCP-17 release gates remain independent blockers.
- `DON-254` candidate-mode enablement is implemented in the qualification
  controller, with the checked-in beta13 C00-C29 plan remaining explicitly
  blocked on unresolved exact runtime/package adapters and candidate artifacts.
  The synthetic calibration path is infrastructure evidence only; no candidate
  is frozen and no BCP-17/WAR-12 campaign has run.
- The DON-254 PR branch is ready for review. Its final local calibration run
  returned the intentional `FAIL` on synthetic C01 with `releaseEligible: false`;
  the real beta13 plan compiled with `releaseEligible: false` and preflight
  returned `ENVIRONMENT_BLOCKED` with exit code 2.
- The PR #42 review repair closes source SHA/tree comparison, immutable
  definition and registry correspondence, C00-C29 candidate coverage, exact
  append-only resume ordering, sealed-attempt mutation, capture path escape,
  lease ownership, CLI dispatch, calibration binding coverage, and campaign-
  root filesystem checks. No candidate or release gate is weakened.

## Verification snapshot

The rebased TRK-001 source suite passed 483 files / 5,203 tests on the first
post-rebase run. The final follow-up run passed 482 files / 5,202 tests and
hit one contention-sensitive Electron responsiveness assertion in an unrelated
evidence-versioning test; that file passed isolated with 94/94 tests. Focused
tracking tests passed 229/229, Chromium tracking ingest health passed 3/3,
TypeScript and ESLint passed, and `npm run build` passed the application bundle
budget at 499.99 kB. The final hosted exact-head run passed the full correctness
gate, production bundle budget, rendered regressions, Electron artifact build,
packaged map/GPX/native coverage checks, tracking soak, and evidence upload.
This is merge evidence only; release and beta qualification remain separate
claims.

The qualification-control-plane slice now has 22 focused tests; the two
affected controller files pass 22/22. The review-repair full source run
covered 484 files / 5,217 tests with one known non-slice observation: the
official-map fixture was stale relative to the generated runtime tree. The
application TypeScript check and production build passed; rebuilding the
generated tree made the isolated official-map file pass 27/27 with the bundle
budget at 499.99 kB. These are source/build checks, not candidate or release
evidence.

Older detail remains in `handoff/archive/`.
