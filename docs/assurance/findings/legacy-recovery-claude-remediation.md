# PR25 Claude review remediation — DON-254

Reviewed head: `c122e51c872da655b607372a1f9b1e2a7d149223`, based on merged
WAR-06 `8f93f8d1`. The earlier READY verdict is withdrawn until this changed
test/tooling slice completes verification. Production remains unchanged.

## Selected design

Use the existing production runner's `completion`, which settles on physical
worker exit and requires a completion message. Both the 50,000-object and
500,000-event tests capture the real handle through the existing injection seam.
An elapsed-time-only 10 ms heartbeat measures that wait, including its final
partial interval. Stopped/invalid completion and real worker errors fail visibly.
The observer has a named 50-second deadline within the unchanged 60-second test;
this is an observation deadline, not an OS guarantee of native worker termination.
The mission store retains production teardown ownership.

SQLite verification runs independently after measurement stops: the exact object
COUNT must be 50,000; provenance pending COUNT and incomplete-event COUNT must
both be zero. This deliberately replaces the former 4,500/8,000 poll loops;
it does not claim their poll budgets are unchanged. Fixture sizes, SQL predicates,
early open/write gates, fail-closed behavior, restart cursor checks and strict
`<200 ms` acceptance remain intact. No production completion signal alone is
accepted as proof of correct persisted data.

The 332-line inspector protocol, its worker, diagnostics helper and their tests
are removed. The new TypeScript observer and its controls have a strict root
project reference, so ordinary build/CI typechecks them. The packaged probe adds
independent custody verification of the newly created marker and reruns baseline
checks after mutation. Its report hashes the new oracle as an executable input.

## Finding dispositions

| Review item | Disposition |
| --- | --- |
| 1: sibling synchronous poll | Accepted shared test risk. Both tests now use real completion and post-timing SQLite verification. A sibling risk did not disprove the recorded object-test attribution. |
| 2: near-vacuous gate | Rejected premise: off-thread production work should leave main responsive; reintroduced main work still consumes the same wall-clock interval and can breach 200 ms. The real blocked-main control rejects 261.544 ms, including the final partial interval. This does not prove all sub-200 regressions unacceptable; the agreed budget is 200 ms. |
| 3: mutation custody | Accepted. Baseline preservation was real but did not prove the new marker's custody. Validate its actual ID, exact single sequence-1 created/complete version, full state and linked audit event, plus post-mutation baseline assertions. Missing/duplicate/wrong-sequence, mismatched state and wrong audit link have falsifying controls. |
| 4: termination deadline | Accepted limitation. Thread termination cannot promise a hard native-I/O deadline; the unbounded inspector join is removed with that subsystem. Observation reports its own deadline without awaiting an auxiliary inspector exit. Production store teardown remains separate and is not advertised as an OS-level bound. |
| 5: final partial interval | Accepted and repaired. A deterministic red control measured zero without the final sample and 250 ms with it; the same strict predicate rejects the result. |
| 6: instrumentation overhead | Accepted unnecessary perturbation. CPU/GC/span work is removed from the gated callback; only clock sampling and maximum calculation remain. No diagnostic duration is subtracted from the gate. |
| 7: failure masking | Accepted structural risk. Nested inspector/diagnostic cleanup is deleted. Completion errors retain their exact identity, diagnostic output occurs before rethrow, and both observer timers are cleared. |
| 8: discarded late error | The primary failure was intentionally retained, but secondary context could be lost. The auxiliary worker/protocol is removed; no first-failure overwrite or speculative retry is added. |
| 9: transient error / leaked inspector | The query failure path was terminal by design, and the parent requested termination; retry was not an established requirement. The separate inspector and this path are deleted. Production errors remain visible and fail closed. |
| 10: startup fallthrough | Startup failure could fall through to handler registration, but the parent only issued counts after ready, so the asserted normal count path was not established. Deletion removes the ambiguous worker lifecycle entirely. |
| 11: readonly WAL portability | No affected restored/read-only/different-UID workload was demonstrated for these owned temporary fixtures. Unit inspection now uses the original database opener after real writer exit. The packaged controller remains a read-only inspector of its own writable disposable fixture; no new mounted-artifact/platform claim is made. |
| 12: accumulated RPC time | Accepted diagnostic risk. Poll/RPC accumulation is removed. A named observation deadline precedes the existing 60-second outer timeout; no workload or threshold is relaxed. |
| 13: busy-spin and cleanup | Accepted. The new parallel-suite busy-spin and all auxiliary worker handles are removed. Fake-clock controls run in the suite; a real blocking-wait falsifier is run separately with heavy work serialized. The production test already joins the store before deleting its fixture. |
| 14: completion simplification | Accepted. It substantially reduces the harness while retaining an independent persisted-data oracle. `monitorEventLoopDelay` is not substituted: an explicit final sample makes the completion-before-next-tick edge directly testable. |
| 15: duplicated/dead diagnostics | Accepted. Both copies and the unused synchronous inspection API are removed; the two tests share the small completion observer. |
| CI TypeScript coverage | Accepted. `tests/support/tsconfig.legacy-recovery.json` is referenced by the root build and covers the new TypeScript helper and controls. |

## Verification and limits

Focused strict recovery: both original full-size fixtures pass, 12.619 ms object
and 12.655 ms event heartbeat maxima. Eight completion controls pass, including
tail, worker failure, stopped/invalid result and named deadline. The separate real
blocked-main control rejects 261.544 ms. These are local evidence, not final
qualification. The original 239.509 ms historical cause remains unassigned.

The latest PR25/Linear terminal receipt binds the final source cycle, native
mutation proof, reviews and exact-head CI. Retained earlier failures and proofs
keep their original identities; they do not qualify this changed slice. Release
HOLD, live-provider, field, whole-candidate replay/soak and publication boundaries
are unchanged.

Local native mutation proof passes with recovery/close/restart main maxima
55.356/60.181/55.653 ms, complete new-marker state/audit custody and two clean
code-zero app exits. The existing macOS ASAR was reused with all six implicated
production files verified equal; the changed probe and custody oracle are hashed
separately. This is explicitly a dirty-source local probe, not a fresh combined
clean-source package claim. Exact-head Linux CI builds the combined artifact.

The first full-source attempt was interrupted because a temporary custody-oracle
rebreak overlapped it; that log is retained and is not a pass. The stable source
cycle follows restoration. Custody rejection evidence is explicitly a controlled
rebreak (five expected failures), not a reconstructed historical native failure.

Stable local source: 446 files / 4,698 passed / six unchanged qualification-only
skips, 471.65 seconds; lint and root build/bundle budgets pass. A final nonauthor
review requested explicit different-thread evidence: both real unit paths now
log parent ID 0 and completed worker IDs 1/3 and assert inequality. Their affected
strict recheck passes at 13.826/11.540 ms; this assertion-only strengthening follows
the full source cycle rather than being mislabelled as part of that earlier run.
The durable blocked-main control also passes (258.625 ms rejected). The native
probe records Electron main's actual thread ID and asserts worker inequality.
