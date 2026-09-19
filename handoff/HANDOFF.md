# HANDOFF.md — Current state

Updated 2026-09-19 after merging the rebased TRK-001 repair.

## Current state

`origin/master` is `27687b53823aaba6f772d1b3376e0cd86763c874`, the merge commit
for PR #41 / TRK-001, following PR #40 / GEO-002 at `c916ced9`. PR #41's exact
source head was `529cef5098497ae3f29c574011b088c4aa92ac11`. Release remains
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

Older detail remains in `handoff/archive/`.
