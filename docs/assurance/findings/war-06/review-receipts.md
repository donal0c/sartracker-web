# WAR-06 evidence receipts

Date: 2026-09-11
Executable evidence commit: `d96e51c85b6ba98642036ab31ed08e1976256bec`
Evidence base: `3db57a7942b32beef0d13cc4e8484a5bb492dfa4`
Scope: route fidelity, falsifiability, cleanup and provenance. No production
repair or release qualification is claimed.

## Re-derivable local receipt

The primary current receipt is executable from the checkout; it does not
depend on an opaque reviewer transcript:

```text
npm test -- tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts --no-file-parallelism
  3 tests passed
npm test -- tests/unit/assurance/war-06/negative-controls.test.ts --no-file-parallelism
  1 test passed; 3 GREEN current controls; 3 RED named safety oracles
```

`scripts/assurance/war-06-prove-red.mjs` runs each route once with the current
harness and once with a test-only visible-publication erase. The green run
must pass the named characterization; the controlled run must fail at a
`WAR-06 ... safety oracle`, with no collection, suite, timeout or cleanup
failure accepted.

The exact routes and their limits are recorded in [WAR-06.md](WAR-06.md). The
production bridge, active-device selection, breadcrumb-device selection and
write-enabled cache configuration are in the characterization helper itself.
Remaining synthetic-provider, local-store, direct-publication and in-memory-
cache limits are conservative and explicit.

## Historical reviewer trace

The earlier Codex sub-agent IDs `01a0920a-1bad-7822-91dd-036ef71eee08` and
`01a0920a-1df8-7680-a683-e967b6e97c98` are retained only as historical trace
from the preceding executable head. They are not treated as approval or as a
re-derivable current review artifact. The current assurance claim is grounded
in the commands and negative-control contract above, plus the exact-head CI
record below.

## Exact-head CI

The executable-head workflow receipt is [run 34650688441](https://github.com/donal0c/sartracker-web/actions/runs/34650688441),
bound by the workflow to `d96e51c85b6ba98642036ab31ed08e1976256bec`. It passed
lint, 435-file/4,462-test ordinary correctness, web build and bundle budgets,
Electron artifact build/inspection, native SQLite and Mesa checks, and AppImage
smoke. The workflow explicitly skipped strict responsiveness, normal-envelope
replay, packaged tracking soak and packaged archive lifecycle checks; those
remain qualification gaps and are not release proof. PR checks remain the
external cross-check: [PR #20 checks](https://github.com/donal0c/sartracker-web/pull/20/checks).
