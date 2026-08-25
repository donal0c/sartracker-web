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
