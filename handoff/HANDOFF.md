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

- `DON-254` / GEO-002: PR #40 head `3c76b32c054be7080a1a4f0b0a588cda4276a1a7`.
  Geometry distances are bounded, antimeridian area is handled, corrupt drawing
  payloads fail closed, edit/save errors retain provenance, and operator inputs
  expose numeric bounds where applicable.
- `DON-267` / TRK-001: continue verification on PR #41, then rebase or merge
  only through the normal owner-controlled review path.
- `PKG-001` and the WAR-01/BCP-17 release gates remain independent blockers.

## Verification snapshot

GEO-002 final-head focused drawing suites passed (12 files, 175 tests),
`npx tsc -b --noEmit`, ESLint, `npm run build` and the bundle budget passed,
and the Chromium drawing/measurement workflows passed (20/20). Hosted exact-
head CI run `35441016940` passed full correctness, bounded property/mutation,
rendered browser, Electron build/artifact, packaged smoke, and AppImage gates;
the strict responsiveness and several unrelated/optional packaged lanes were
skipped by the PR workflow. PR #40 remains open, non-draft, and mergeable but
blocked by the repository's owner-controlled merge authority. This evidence
does not qualify a beta candidate, production, field, or release.

Older detail remains in `handoff/archive/`.
