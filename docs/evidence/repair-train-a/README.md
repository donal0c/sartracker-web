# Repair Train A evidence

See [the repair record](../../assurance/findings/repair-train-a.md) for causes,
review dispositions, source identity and proof limits.

- `native-base-red.json`, `policy-red.log`, `projection-red.log`: fresh failures
  on base `083f504753089abfcce9decdee8348dc069f03b8`.
- `native-rejected-capacity.json`, `renderer-rejected-current-only.json`:
  rejected intermediate candidates. They are not final-head failures or passes.
- `retired-fallback-{red,green}.log`: independently discovered A-R8 and repair.
- `capacity-*.json`: matched base/candidate controls for A-X1, the unchanged
  eight-payload storage-backpressure limit. No loss after writes resume.
- `packaged-{stable,changing-roster}.json`: `e38c55b4` local native loopback results,
  bound by `local-source-binding-e38c55b4.json`.
  Synthetic profile paths and body text were omitted from these copies; event
  ordering, source IDs and evidence health remain. Full raw files stay local.
- `local-source-binding.json`: changed source/test Git blobs plus the unsigned
  A-R9 macOS arm64 ASAR SHA-256. Version build stamp is explicitly excluded.
- `packaged-a-r9-warning.json` and `retained-rejection.png`: rebuilt A-R9 package;
  current coordinates continue, the old response cannot clear the selected
  rejection warning, and anomaly evidence is recorded.
- `renderer-final.json`: every incremental 100×5,000 renderer sample, including
  long tasks, callback-clock and frame-timestamp gaps. The gate uses the larger
  maximum and includes the frame immediately before the operation. Earlier
  timestamp-only receipt is `renderer-prior-frame-timestamps.json`. Cold fixture
  preparation is excluded. Missing post-operation callbacks fail the final gate;
  callback boundaries and complete gap arrays are retained. The earlier callback
  run remains `renderer-callback-before-coverage-guard.json`.
- PNGs: actual rendered warning clear/new episode and reconnect Last known state.
- Final source/browser/lint logs: command results; trailing blank lines removed.
- [Linux CI receipt](linux-ci-receipt.md): clean application-head source/package
  binding, archive hard gates, tracking truth and retained renderer outliers.

These synthetic local checks do not establish live-provider, field, Windows,
Linux, signed-distribution or frozen release-candidate acceptance. Normal Linux
PR CI has its own clean exact-head source and artifact receipts.
