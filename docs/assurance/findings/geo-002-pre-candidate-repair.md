# GEO-002 — bounded drawing and measurement input repair

**Date:** 2026-09-19
**Owner seam:** DON-6 / DON-254
**Implementation commits:** `678e4aa21fcbbf09345806f04ae28d91597b813f`, `49088dbd`, `67a6140e`, `75a2a352`, `cb316985f21b2ff86746487e9c094bd8f6540b2f`, `83180d034046ab569257814991d4f75c9d898986`
**Disposition:** bounded pre-candidate repair is implemented and independently reviewable at the PR head; release remains HOLD and candidate selection remains blocked by the separate TRK-001 and PKG-001 findings.

## Finding and boundary

The public drawing math accepted non-finite and out-of-range WGS84 coordinates,
out-of-range bearings, and unsafe distances/radii. Circle and sector point
generation also accepted an unbounded segment count, so `segments=Infinity`
could keep a synchronous loop running indefinitely. The measurement runtime
passed map-click and hover values directly into those math functions. This
repair is limited to that GEO-002 boundary; it does not claim WAR-03 geometry
qualification, packaged qualification, field acceptance, or release readiness.

The existing true/magnetic contract is preserved: Ireland declination remains
−4.5°, and the inclusive 0–360° bearing representation remains accepted. The
segment limit is an implementation safety bound of 4,096, well above the
existing 64-point circle and 36-point sector defaults; it is not a new
operator or search-policy limit.

## Red reproduction retained

- Adversarial math tests were added before the production guards. They cover
  NaN, positive/negative Infinity, global WGS84 range violations, invalid
  bearings, negative/non-finite distances and radii, zero radii, non-integer
  segment counts, and counts above the bound.
- A child-process probe exercises `geodesicCirclePoints(..., Infinity)` so an
  unbounded loop cannot hang the Vitest worker; the repaired boundary exits
  with a `RangeError`.
- Runtime regressions cover invalid drawing sketch/dialog points, invalid
  measurement first/second/hover points, visible measurement errors, and the
  invalid persisted range-ring label consumer.

## Repair

- `drawing-math.ts` now validates finite WGS84 coordinates in `[-180, 180] ×
  [-90, 90]`, bearings in `[0, 360]`, non-negative endpoint/measurement
  distances, positive radii, and integer segment counts in `[1, 4_096]` at
  public geometry boundaries.
- Drawing and measurement runtimes reject unsafe map values before retaining
  them or creating preview/persisted geometry. Validation failures remain
  visible to the operator; they do not become silent successful operations.
- Persisted drawing overlays validate every GeoJSON coordinate tree before
  creating live features; invalid persisted geometries are omitted rather than
  reaching MapLibre. Manual range-ring generation is capped at 64 rings and
  the dialog exposes the same bound.
- Bearing-line previews do not show a plausible conversion for invalid input.
  Persisted range-ring label generation omits only an invalid label coordinate
  instead of crashing the map feature builder or inventing a position.
- Public measurement-label formatting rejects invalid bearings before producing
  a plausible-looking label, and text-label persistence rejects non-finite or
  out-of-range anchor coordinates for both create and move paths.
- The existing 500,000-byte application-shell budget is retained. The final
  application shell is 499,885 bytes; the base commit measured 499,135 bytes.
- The independent review follow-up makes drawing failures visible in the
  toolbar when no dialog is open, rejects out-of-range finite bearing inputs
  in both public magnetic/true conversion functions, and adds browser coverage
  for the visible drawing rejection.

## Verification

- Focused drawing/measurement/consumer unit suites: 12 files, 165 tests passed
  after the final implementation commit, including the GEO-002 adversarial
  tests and the drawing-toolbar visibility regression.
- `npm run lint`: passed.
- `npx tsc -b --noEmit`: passed.
- `npm run build`: passed, including the unchanged bundle budgets; final
  application shell was 499,885 bytes.
- Repeatable Chromium drawing and measurement workflows: 20 passed,
  including the invalid-sketch-point visible-alert regression.
- A prior full source run on review head `60e07781` passed 481/483 files and
  5,165/5,167 tests; its two failures were unrelated existing Electron
  responsiveness assertions over the 200 ms host-timing threshold. The
  current PR exact-head CI full correctness gate is the merge-readiness
  authority and must be green before merge readiness is claimed.

This is local/source and browser-harness evidence only. It is not packaged,
production, field, human-acceptance, candidate-selection, or release proof.
