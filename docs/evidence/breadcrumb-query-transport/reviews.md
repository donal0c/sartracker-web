# Independent review disposition — PR23

Four independent Astra-low contexts reviewed accumulated source
`d20bae5fd8156a61e92a9b8fd68c87b2ca614a37..986a0d334d50951d70151cde7962f01ed6d05a78`.
These are read-only source reviews, not test runs or GitHub owner approval.

| Charter | Initial verdict | Disposition |
| --- | --- | --- |
| Broad life-safety / end-to-end | No actionable P1/P2/P3 | Fresh broad check required after correction below |
| Persistence / completeness | No actionable findings | Unchanged executable scope; retained across UI-generation correction |
| Concurrency / finalization | P2 stale runtime status publication | R1 below; focused recheck required |
| Renderer / input containment | Same P2 stale runtime status publication | R1 below; focused recheck required |

## R1: late history progress and cleanup can publish stale connection status

The progress callback compared an immutable runtime generation with its copy;
the predicate could never detect replacement. Its `finally` also refreshed
cached status unconditionally. A replaced runtime could overwrite its successor's
status while history cancellation settled.

[Red](stale-progress-red.log) reproduces both late publication paths (one call
each). Correction checks the active generation and accepting-updates state
before both progress and cleanup publication. [Affected runtime suite](stale-progress-green.log)
passes 92/92; [rendered transfer flow](stale-progress-browser-green.log) passes.
Scoped lint/typecheck pass. This changes UI status custody only: query protocol,
worker/IPC/store/selector/client, persistence and package transport inputs remain
unchanged. No expensive transport repeat is needed for this correction.

## Evidence limits

- Fixed total 30-second session timeout is retained; larger-profile qualification
  remains separate, with timeout failures explicit rather than partial success.
- Package digest normalizes signed zero; the focused client test independently
  checks `Object.is(value, -0)`. Shared selector oracle proves transport equivalence,
  not independent selector correctness.
- Package proof uses injected checkout client over real native boundaries,
  with controlled synthetic workload. Field and whole-candidate acceptance are open.

Final exact-head broad/focused recheck verdicts and Linux CI are recorded in the
[PR23 terminal receipt](https://github.com/donal0c/sartracker-web/pull/23).
This source record precedes those asynchronous checks and does not predeclare a pass.
