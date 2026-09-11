# WAR-06 Tracking Lifecycle Evidence

This directory contains investigation-only evidence for the tracking lifecycle
audit. It is deliberately separate from production code and the shared
coordination records. The characterization tests describe current behavior at
the runtime publication boundary; they are not a repair or a release gate.

The tests use the real `startTrackingRuntime` orchestration. AUD-01 also uses
the real polling manager and delayed history flush; AUD-02 and the cache sibling
use the real mission finish → idle → start transition and participant-scope
hydration boundary. Controlled callbacks make the interleavings deterministic.
They do not claim Electron, packaged, CI, field, or release proof, and they do
not repair production behaviour.

Run the bounded evidence tests with:

```bash
npm test -- tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts --no-file-parallelism
```
