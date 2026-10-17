# DON-312 renderer allocation churn — 17 Oct 2026 (Mac)

## Attribution (from the 17 Oct fixed-package soak, `tmp/don325-fixed/`)

- Renderer RSS ~1.1–1.2 GB at peak, but used JS heap swung 243 → 625 → 262 MB
  within the final 480-batch drain. Retained tracking state was small (~38k
  line vertices). The peak was allocation churn raising the heap high-water
  mark, not retained data.
- Main JS heap stayed 20–40 MB while main RSS was 550–610 MB, so the main side is
  native (per-task worker isolates/SQLite connections are the next hypothesis).
- Renderer drain allocation: 49.8 GB sampled. Top frames: `getNewestBreadcrumbByDevice`
  (DON-328, two `Date` objects per breadcrumb) 12.6%; stationary-attention Turf
  `distance(point, point)` chain ~16%.

## Change

- `newest-known-fix.ts`: parse each timestamp once with `Date.parse`; no `Date`
  construction. Same selection rules; regression gate counts zero constructions
  (red on old code: 4,160; green: 0).
- `src/lib/haversine-distance.ts`: allocation-free haversine, bit-identical to
  Turf metres (5,000-pair equivalence test), validates WGS84 input.
  `stationary-attention.ts` uses it.
- `tracking-geojson.test.ts` DON-212 reuse test now asserts the intent (only the
  changed current position is parsed; breadcrumb history is reused) instead of
  a raw `Date.parse` count.

## Same-workload soak (one serial run, no other heavy process)

Harness `scripts/electron-tracking-soak.mjs` SHA-256 `6db329b5…6c25` (identical
to the 17 Oct baseline), `--profile normal --profile-renderer-drain`, 32 devices,
480 batches, one restart. Package ASAR SHA-256
`b0f5e3c94a29bba3c9357750e114e0f0d16dd8881c7ff4346ec25f4c77eab4f2`.

| | 17 Oct fixed | This change |
|---|---:|---:|
| Peak process-tree RSS | 2,217,132,032 FAIL | 1,821,671,424 PASS |
| Per launch | — | 1,333,985,280 / 1,821,671,424 |
| Renderer drain allocation | 49.8 GB | 39.2 GB |
| Independent main-loop max (L1/L2) | 226 / 165 ms | 233 / 203 ms |
| IPC main max | 188 ms | 297 ms |
| Positions exact / integrity | yes / ok | yes / ok |

Verdict still FAIL on main-loop timing. Main stalls cluster 15–19 s into launch 1
(startup history catch-up, DON-313); this change is renderer-only. One run is not
a distribution; installed Ubuntu budget evidence remains owed.

## Verification

- Full correctness 630 files: one failure (the DON-212 count test above), fixed
  and re-run green (14/14); all others passed (6,620 passed, 27 skipped).
- Chromium: stationary-attention, devices-workspace, map, full-mission-flow,
  participants, focus-mode, map-idle-redraw, v1-regression — 57/57 passed.
- Lint and `tsc --noEmit` clean on changed files.
