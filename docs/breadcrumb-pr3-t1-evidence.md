# Breadcrumb PR-3 T1 Evidence

## Binding

- Tested code head: `d1e884ba2c881551fe49c72f0716e4e6032341e6`
- Exact PR-2 base: `7021fc1ef33e6da5c91c96cd86e836fc3754f48f`
- Ubuntu package source checkout: clean `codex/breadcrumb-pr3-complete-coverage` at the tested code head
- Linux x64 packaged `app.asar` SHA-256: `ed399ddcb2f71cbf84b6ce2ab2018daa65d2ee3dd79442b8fc5bf0fa0357a319`
- Linux x64 packaged executable SHA-256: `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
- Ubuntu host: `donal-Precision-5570`, Linux `7.0.0-28-generic`, x64

This record binds the pre-G3 T1 qualification to the code tree above. Later
documentation-only commits do not invalidate it. A later migration or ingest
write-path change must repeat the affected heavy row under the accepted plan.

Post-T1 commit `f4b1e3575fbbf6ad7ef1c1f2e55349707f79ca47` made the
mission-model release default explicit as `false` without changing resolution
behavior. Its red test observed the missing export as `undefined`; the focused
mission-model/coverage flag set then passed 4/4 with TypeScript and lint. This
posture-only extraction does not touch a heavy-proof invalidation surface and
allows the G3 commit to change only the two default booleans.

## Deterministic software and browser gates

- Unit: `npm run test` — 257 files / 1,983 tests passed.
- Static: `npm run lint`, `npx tsc -b --pretty false`, and Node syntax checks for
  both changed coverage CommonJS modules passed.
- Contract/build: exact Dots contract 10/10, production build, and bundle budgets passed.
- Chromium: `npm run test:e2e:chromium` — 157/157 passed. The only console noise
  was the deliberate HTTP 503 recovery scenario.
- Coverage visuals: four Playwright workflows produced six critical entries;
  all six passed `visual:review --fail-on critical`. Aggregate report:
  `visual-review-2026-08-24T22-04-02Z.json`.
- Packaging: one unsigned macOS arm64 package and the exact-head Linux x64
  package completed, including the native `better-sqlite3` rebuild and bundle gates.

## 3.704 GB v9 to v10 migration

The retained PR-2 schema-v9 derivative of the immutable field fixture was
copied into a new isolated user-data directory. The cached source was not opened
for write. Before migration the copy was 3,704,819,712 bytes, SHA-256
`a3e4d1938e64e52af5e82856d189f983a581ddba48a77f4f026470583765e5bb`,
with integrity `ok`, 2,040,000 positions, and 32 participants.

The exact packaged Electron runtime opened the exact packaged mission-store
module with `ELECTRON_RUN_AS_NODE=1`. Schema v9 to v10 migration plus store open
took 16.557 ms. After close:

- schema version was 10 and integrity was `ok`;
- all 2,040,000 positions and all 32 participants remained;
- `coverage_chunks`, `coverage_missions`, and `coverage_invalidations` were empty;
- rejected index `idx_positions_mission_timestamp` was absent;
- the database was 3,704,868,864 bytes, SHA-256
  `ea18699a9f4b7112acac586b816b1adea352c6fcfdf0db14a14c40550f28d40a`.

This proves the migration is bounded and additive on the field-size input; it
does not claim a field-size coverage build or renderer run.

## Packaged CI tracking soak

The single permitted packaged CI-scale soak ran on the active Ubuntu desktop
session with Mesa llvmpipe via ANGLE/OpenGL. The wrapper's first invocation
exited before launching the app because `xvfb-run` is not installed; the actual
run used the already-active `:0` session and passed.

- 6/6 accelerated batches and 8,664/8,664 source-exact positions passed;
- exact position digest:
  `449c9e14f5dee0b202df48cffbb24e1a7d5d3439c3d52121f7c6127bba7d1fde`;
- one restart passed; both launches exited 0; renderer crashes: 0;
- SQLite integrity `ok`; WAL busy/log/checkpoint frames: 0/0/0;
- main-process maximum 5.586 ms and renderer maximum 66.9 ms against 250 ms gates;
- all four real operator interactions were classified healthy; internal action
  maximum 28.2 ms and external action maximum 81.315 ms;
- peak process-tree RSS was 1,004,056,576 bytes;
- redundant telemetry growth slope was zero;
- coverage ledger line item after the soak: one mission row, change sequence 9,
  32 chunk rows, zero invalidations, and 20,480 bytes across coverage tables/indexes.

Report SHA-256:
`1b724e3a95776b2bacbc3a7f796df840f75715112657216a1d56e13b516409fd`.
The host copy is at
`~/sartracker-pr3-d1e884b/tmp/beta-artifacts/tracking-soak-ci/electron-tracking-soak-report.json`.

## Standing evidence and proof limits

G2 remains bound to measured SHA `8eff87b724ae6b4ffa9123479a8982d1d08f47ef`:
the later CommonJS/browser interop correction changed module exposure, not the
measured Candidate-B query, segmentation, source, or tile strategy. No G2 row
needed repetition.

By design, T1 did not run a packaged 960k or 2M coverage workload, a packaged
forced-kill matrix, Windows, field hardware, GPX, replay, search passes,
archives, or custody. The coordinator-owned unpublished post-merge 960k Ubuntu
checkpoint remains T3 and is outside this implementation task.

## G3 ratification

Donal approved the recommended combined posture on 2026-08-25 at exact pushed
pre-flip head `d05c7876963a9104755615018151d1fc281f5e5b`: mission model
and complete coverage default on together, no budget amendment, explicit build
overrides retained, and rollback by reverting the single final flip commit.

## Exact-production-path review remediation

The first exact-head review wave at `20ee295b8b0e914e7939768880c93641a17e2df4`
found blocking gaps between the G2 Candidate-B harness and the production path:
initial catalog delivery was not progressive, renderer activation was not part
of delivery attestation, worker generations were not fully fenced, steady
manifest/claim reads could rescan mission evidence, coverage writes used
per-chunk autocommits, and several evidence/scope/runtime failures did not
immediately revoke Complete. Red tests reproduced each condition before the
production changes in `a687746`, `29a1e14`, and `d39732e`; the focused coverage
set then passed 150 tests and the full unit suite passed 257 files / 1,997 tests.

A targeted Ubuntu production-path qualification then used the real
`createElectronMissionStore`, the production read-only coverage worker, the
production Candidate-B tile worker, and the immutable PR-2 fixtures. It was not
a packaged GUI run and did not repeat the G2 A/B/C matrix. The first 2M run at
`20ee295` failed the ratified five-second first-useful gate at 6,438.024 ms.
Red test `enumerates each participant device with one indexed positions
traversal` recorded that enumeration prepared one positions scan per
device-period rather than per device. Commit `d39732e` changed lazy initial
enumeration to one indexed chronological traversal per participant device,
preserving the canonical half-open outing resolver and exact per-period source
digests.

Exact corrective code head `d39732ee22e8d981c5e51a7fd008fca4dafc6657`
passed both scales on the Ubuntu reference host:

| Fixture | Delivered | Manifest ready | First useful | Complete geometry | Main max gap | Claim posture |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,164.608 ms | 2,295.381 ms | 5,819.168 ms | 21.807 ms | Correctly blocked only by fixture `backfill_incomplete` |
| 2M | 1,999,988 / 1,999,988 | 4,203.931 ms | 4,390.900 ms | 11,679.395 ms | 23.055 ms | Correctly blocked only by fixture `backfill_incomplete` |

The 1.5 GiB/2.5 GiB G2 memory budgets were not remeasured by this targeted
Node qualification; the standing G2 renderer/package measurements remain the
memory proof. Machine-readable failure and corrective reports, with a checksum
manifest, are committed under `output/pr3-production-qualification/`. A later
history-only reorder that restores the approved two-boolean flip as the final
commit must retain an identical production-code tree; final exact-head gates
and five independent reviews still apply.

## Final pushed-code gates

The approved two-boolean flip was restored as isolated commit `b9bad64`, whose
diff contains only the mission-model and complete-coverage release defaults.
On exact pushed code head `b9bad6446faf055ccd603afa60272ac3de46fbb3`:

- serial unit: 257 files / 1,998 tests;
- lint, TypeScript, every changed CommonJS syntax check, exact Dots 10/10,
  production build, and bundle budgets passed;
- Chromium: 157/157;
- coverage visual Playwright: 4/4; fresh independent Opus critical review: 6/6,
  report `visual-review-2026-08-25T07-27-22Z.json`;
- unsigned macOS arm64 and Ubuntu x64 packaging passed, including native
  `better-sqlite3` rebuilds;
- exact production path on Ubuntu: 959,988/959,988 delivered, 2,233.531 ms
  first useful, 5,677.181 ms complete, 24.426 ms main gap at 960k; and
  1,999,988/1,999,988 delivered, 4,472.030 ms first useful, 11,774.783 ms
  complete, 30.982 ms main gap at 2M. Both claims were correctly blocked only
  by the fixture's intentional `backfill_incomplete` marker.

Final production report SHA-256 values on the Ubuntu host are
`dd85cb1a4cc6c32c35dde8c6f4eabab11b87a5cc8dc1e0533dfe02e8262d5c83`
(960k) and
`9c5c3d09a773f101c9644a65d7fe3dd769ddd70919ce473612bb5b9554043cfd`
(2M). Normalized committed copies live under the matching `b9bad64...`
directory in `output/pr3-production-qualification/`; the checksum manifest
binds their repository bytes. The subsequent closeout commit changes only
this evidence record, handoff/workplan status, and those normalized reports;
it does not change the qualified production tree.
