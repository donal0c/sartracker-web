# MAP-03 structural raster invalidation

Production baseline: `fda23be04dd27b0f26f9b10a4756ac56d64a4a6f`.
An unrelated pending GeoJSON request prevented global style readiness while the
official raster was already visible. Package removal withdrew readiness but left
289/289 sampled replacement pixels visible. Natural removal passed. The clean
durable browser baseline failed pending removal and replacement (2 failed, 1 passed);
the focused unit baseline failed 10 controls and passed 1.

The repair checks whether a style exists, then removes/recreates only the official
source and layer. It does not wait for global or source tile completion. Mutation
postconditions fail visibly; camera, overlay order and pending sources are preserved.

Final checks: 23 focused controls; four real Chromium/MapLibre/GPU flows; full
correctness 456 files / 4,849 passed / six existing qualification skips (502.56s).
TypeScript, targeted lint and independent map-safety review passed. Native bridge
responses are synthetic: these browser results do not qualify native filesystem use.

After the frozen full cycle, the workflow and new isolated Playwright configuration
add these four flows before packaging. The exact CI command passed locally in
18.6s; actionlint and independent workflow review passed. The receipt separately
binds this CI-only delta and the unchanged 1,173 earlier inputs.

`invalid-mixed-browser.log` is excluded from proof: a subordinate edited production
during that run, causing a transient parse error. Root restored the exact baseline
and became sole writer before the clean red run. `natural-removal-control.log` is
a passing control, not red evidence. Raw log bytes are preserved.

See [receipt.json](receipt.json) for hashes and limits. Both prior Linux failures,
three macOS failures and the original crash remain retained. Fresh remote CI is
required; no further local Electron launch/build occurred. Release HOLD remains.
