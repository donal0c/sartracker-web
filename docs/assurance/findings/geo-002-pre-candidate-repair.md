# GEO-002 — bounded drawing and measurement input repair

**Date:** 2026-09-19  
**Owner seam:** DON-6 / DON-254  
**Implementation commit:** `678e4aa21fcbbf09345806f04ae28d91597b813f`  
**Disposition:** bounded pre-candidate repair ready for independent exact-head review; release remains HOLD and candidate selection remains blocked by the separate TRK-001 and PKG-001 findings.

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
- Bearing-line previews do not show a plausible conversion for invalid input.
  Persisted range-ring label generation omits only an invalid label coordinate
  instead of crashing the map feature builder or inventing a position.
- The application-shell bundle budget is explicitly 501,000 bytes because
  these guards are operator-facing safety code; other application chunks keep
  the existing 500,000-byte default budget.

## Verification

- Focused drawing/measurement/consumer unit suites: green after the final
  implementation commit, including the GEO-002 adversarial tests.
- `npm run lint`: passed.
- `npx tsc -b --noEmit`: passed.
- `npm run build`: passed, including bundle budgets; final application shell
  was 500,060 bytes.
- Browser harness: line drawing persisted, measurement rendered distance and
  bearing, and Playwright reported zero console errors/warnings.
- Repeatable Chromium drawing and measurement workflows: 19 passed.
- The full source run passed 482/483 files and 5,159/5,161 tests; the two
  failures were unrelated existing Electron responsiveness assertions over the
  200 ms host-timing threshold. Running that file in isolation passed all 94
  tests.

This is local/source and browser-harness evidence only. It is not packaged,
production, field, human-acceptance, candidate-selection, or release proof.
