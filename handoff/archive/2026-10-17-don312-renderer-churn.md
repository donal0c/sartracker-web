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

## DON-313 follow-up: bounded snapshot pieces (branch `don-313-snapshot-pieces`)

Main CPU profile of the first 30 s (attribution only; profiler inflates timing):
~18 s of main-thread time in `responsive-mission-writer` → `addPositionsBulk`,
mostly native statement `run`. Long bursts came from `persistTrackingSnapshot`:
after a restart the key cache is empty, so one snapshot sent every unseen fix in
one unbounded `persistTrackingPositionsBulk` call (one transaction). Fix: pieces
of 256 (`HISTORY_PIECE_ROW_BUDGET`), keys cached only after all succeed, failed
piece → existing evidence-loss path and full retry. Electron path only; the
legacy browser `addPositionsBulk` branch is unchanged (DON-200 test).

Three serial soaks, ASAR `fe51beaa…5852` (run 1 with renderer drain sampling):

| Run | Peak RSS | Main-loop L1 / L2 | IPC main max | Verdict |
|---|---:|---:|---:|---|
| 1 | 2,068,905,984 | 161 / 179 ms | 166 ms | PASS |
| 2 | 1,855,635,456 | 178 / 245 ms | 278 ms | FAIL |
| 3 | 1,986,363,392 | 339 / 192 ms | 806 ms | FAIL |

All runs: 691,224 positions exact, integrity ok, memory under budget. Startup
catch-up stalls are now ≤178 ms in every run. Remaining stalls are mid-run and of
two kinds: blocked (run 3 L1 339 ms gap with 6 ms process CPU — synchronous
I/O such as a FULL-sync commit/checkpoint, or host pause) and busy (run 2 L2
245 ms). macOS has no pressure/schedstat counters (null), so blocked-stall
cause needs the Ubuntu box (PSI). Not yet a distribution-backed pass.
