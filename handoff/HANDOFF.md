# HANDOFF.md — Current state

Updated 2026-09-19 after rebasing TRK-001 onto the merged GEO-002 repair.

## Current state

`origin/master` is `c916ced954bcd9e43900f55612a11a80138c8d72`, the merge commit
for PR #40 / GEO-002. PR #41 / TRK-001 is at exact head `73f119f2` on
`codex/trk-001-current-position-repair`; GitHub is the source of truth for its
current review and merge state. Release remains **HOLD** and no beta candidate,
release tag, publication, or promotion is authorised by this handoff.

PR #40 (`codex/geo-002-pre-candidate-repair`) is merged. PR #41 remains a
separate tracking repair branch and must not be merged through this branch.

## Active work

- `DON-254` / GEO-002: PR #40 is merged at `c916ced9`. Geometry distances are
  bounded, antimeridian area is handled, corrupt drawing payloads fail closed,
  edit/save errors retain provenance, and operator inputs expose numeric bounds
  where applicable.
- `DON-267` / TRK-001: PR #41 exact head is `73f119f2`. Accepted empty live
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
budget at 499.99 kB. The first hosted run measured 500007 bytes, so the
recovery warning was shortened without changing its meaning and the exact head
was updated. These are local source/browser/build results; hosted CI, packaged
artifact, merge, and release evidence remain separate claims.

Older detail remains in `handoff/archive/`.
