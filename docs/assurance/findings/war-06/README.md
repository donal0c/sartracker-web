# WAR-06 Tracking Lifecycle Evidence

This directory contains investigation-only evidence for the tracking lifecycle
audit. It is deliberately separate from production code and the shared
coordination records. The characterization tests describe current behavior at
the runtime publication boundary; they are not a repair or a release gate.

The tests use the real `startTrackingRuntime` orchestration. AUD-01 also uses
the real polling manager, delayed history flush, and finish → idle → start
mission transition while a replacement current request is in flight. AUD-02
uses the real poller-to-runtime current-fix callback and the same production
mission-wake coalescing path while participant scope is loading. The cache
sibling models a cold relaunch with Mission B already active reading the single
global `tracking-cache.json` file. Provider waits are controlled only to hold
the reachable slow-response windows. They do not claim Electron, packaged, CI,
field, or release proof, and they do not repair production behaviour.

These are intentional-red characterizations: future production repairs must
invert the unsafe assertions into non-regression guards rather than weakening
them to empty-result assertions.

Run the bounded evidence tests with:

```bash
npm test -- tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts --no-file-parallelism
```
