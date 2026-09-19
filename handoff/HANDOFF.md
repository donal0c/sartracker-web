# HANDOFF.md — Current state

Updated 2026-09-19 after the GEO-002 and TRK-001 repair pass.

## Current state

`origin/master` is `e5673c9c4fb1b8497d28f4871b793937f85ad2ef`. Release remains
**HOLD** and no beta candidate, merge, release tag, or publication is
authorised by this handoff.

PR #40 (`codex/geo-002-pre-candidate-repair`) now includes the bounded drawing
math and persisted-overlay repairs. PR #41 remains a separate tracking repair
branch and must not be merged through this branch.

## Active work

- `DON-254` / GEO-002: PR #40 head `a7a496409bcaea034dd81e65866bb0954cc5cca8`.
  Geometry distances are bounded, antimeridian area is handled, corrupt drawing
  payloads fail closed, edit/save errors retain provenance, and operator inputs
  expose numeric bounds where applicable.
- `DON-267` / TRK-001: continue verification on PR #41, then rebase or merge
  only through the normal owner-controlled review path.
- `PKG-001` and the WAR-01/BCP-17 release gates remain independent blockers.

## Verification snapshot

GEO-002 final-head focused drawing suites passed (5 files, 122 tests),
`npx tsc --noEmit`, ESLint, `npm run build` and the bundle budget passed, and
the serialized Chromium drawing workflow passed (15/15). The final-head whole
source run encountered three unrelated parallel-sensitive Electron/fixture
failures; each affected file passed in isolation. These are local
source/browser results only; CI, packaged artifact, hosted, merge, and release
evidence are still absent.

Older detail remains in `handoff/archive/`.
