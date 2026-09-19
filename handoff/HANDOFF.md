# HANDOFF.md — Current state

Updated 2026-09-19 after the GEO-002 and TRK-001 repair pass.

## Current state

`origin/master` is `e5673c9c4fb1b8497d28f4871b793937f85ad2ef`. Release remains
**HOLD** and no beta candidate, merge, release tag, or publication is
authorised by this handoff.

PR #40 (`codex/geo-002-pre-candidate-repair`) is merged. PR #41 remains a
separate tracking repair branch and must not be merged through this branch.

## Active work

- `DON-254` / GEO-002: PR #40 head `867a5819`. Geometry distances are bounded,
  antimeridian area is handled, corrupt drawing payloads fail closed, edit/save
  errors retain provenance, and operator inputs expose numeric bounds where
  applicable.
- `DON-267` / TRK-001: PR #41 repair head is `4219fb11`. Accepted empty live
  current snapshots now fence late cache, live status is not clobbered by cache,
  recovery has one operator warning, and retained participant scope fails closed
  after a bounded hold.
- `PKG-001` and the WAR-01/BCP-17 release gates remain independent blockers.

## Verification snapshot

Both branches passed `npx tsc --noEmit` and ESLint with zero warnings.
GEO-002 passed `npx vitest run tests/unit` (483 files, 5,190 tests) and the
serialized Chromium drawing workflow (15/15). TRK-001 passed the full local
unit suite (483 files, 5,131 tests) and serialized Chromium tracking ingest
health (3/3). These are local source/browser results only; CI, packaged
artifact, hosted, merge, and release evidence are still absent.

Older detail remains in `handoff/archive/`.
