# WAR-06 Tracking Lifecycle Evidence

This directory contains investigation-only evidence for the tracking lifecycle
audit. It is deliberately separate from production code and the shared
coordination records. The characterization tests describe current behavior at
the runtime publication boundary; they are not a repair or a release gate.

The tests use the real `startTrackingRuntime` orchestration and a controlled
poller/storage boundary. They do not claim Electron, packaged, CI, field, or
release proof.

Run the bounded evidence tests with:

```bash
npm test -- tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts --no-file-parallelism
```
