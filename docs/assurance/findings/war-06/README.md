# WAR-06 Tracking Lifecycle Evidence

This directory contains investigation-only evidence for the tracking lifecycle
audit. It is deliberately separate from production code and the shared
coordination records. The characterization tests describe current behavior at
the runtime publication boundary; they are not a repair or a release gate.

The tests use the real `startTrackingRuntime` orchestration and the production
mission-tracking status bridge. The helper also derives active and breadcrumb
device selection from the mission device store and keeps cache writes enabled
when reading cache. AUD-01 uses the real polling manager, delayed history
flush, and finish → idle → start mission transition while a harness-triggered
slow current request is in flight. AUD-02 uses the real poller-to-runtime
current-fix callback and genuine mission-wake coalescing while participant
scope is loading. The cache sibling models a cold relaunch with Mission B
already active reading the single global `tracking-cache.json` file. Provider
waits are controlled only to hold the reachable slow-response windows. The
remaining synthetic-provider, local-store, direct-publication and in-memory-
cache limits are conservative; the tests do not claim Electron, packaged, CI,
field, or release proof, and they do not repair production behaviour.

These are intentional-red characterizations: future production repairs must
invert the unsafe assertions into non-regression guards rather than weakening
them to empty-result assertions.

Run the bounded evidence tests with:

```bash
npm test -- tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts --no-file-parallelism
npm test -- tests/unit/assurance/war-06/negative-controls.test.ts --no-file-parallelism
```

The negative-control suite must report three GREEN current controls and three
RED failures at the named WAR-06 safety oracles. See [the evidence receipt](review-receipts.md)
and [the full report](WAR-06.md) for the exact-head and proof boundaries.
