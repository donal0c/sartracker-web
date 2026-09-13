# DON-254 follow-up B review disposition

Base: `deedab27483ad4fe1ca998a4d68afd555f4e2337`.
All reviews use Codex agents; no external reviewer service is involved.
The coordinator owns causal interpretation and acceptance.

## Initial independent review

The independent causal review found no evidence justifying a production
reconstruction change. The reproduced synchronous inspection stall and its
off-thread counterfactual support a test-observer repair. That does not assign
the original 239.509 ms native cause or qualify the application for release.

The independent broad review identified three helper failure-path defects:

| ID | Finding | Disposition |
| --- | --- | --- |
| B-R1 | Count/startup/close can await a missing worker response without an owned deadline. | Fixed: five-second defaults, fault controls and physical worker joins. |
| B-R2 | Worker replies lack runtime shape, identity and request correlation validation. | Fixed: ready/count identity, sequence, shape and value validation; malformed/duplicate controls. |
| B-R3 | An already recorded worker failure can be swallowed by close. | Fixed: retained first failure, including idle errors and failure/close races. |

The broad review also distinguishes the unchanged source timer boundary from
shutdown: its final partial interval and inspector close are not new source
timing assertions. The supplemental packaged timer must cover its final partial
interval, physical production worker completion, native close and reopen.

## Final review state

Independent packaged-script review identified missing controller deadlines,
cleanup failure reporting, incomplete completion validation, a source oracle
that could miss matching corruption, partial source binding and failure
fixtures outside CI uploads. The coordinator corrected those findings. The
same nonauthor reviewer then found no actionable regression: 60-second waits,
original 4,500 polling cap, bounded failure cleanup/physical join, exact seeded
marker/full baseline digests, positive real worker identity, explicit binding
limits, restart hash checks and CI-retainable synthetic failures are present.
The workflow only appends the targeted native smoke; existing qualification
routing is unchanged. That exact script passed the local packaged proof.

A second nonauthor custody/oracle review found the original 50k fixture,
readiness gates, strict timing predicates and restart semantics preserved.
Its one finding was missing phase JSON when an early timing assertion fails.
The coordinator added bounded phase reporting around the unchanged assertions;
the reviewer rechecked and closed it. The later diagnostic observation is
explicitly separate from the original measured assertion value.

The final independent helper recheck is clear: no actionable finding or
accidental regression. All 19 controls pass, including the real SQLite open/read
failures and actual 250 ms main-thread block. The coordinator rejected an
intermediate handback that had dropped those controls and had not injected a
truly idle fault; the final review checked their restoration, independent
startup deadlines and physical-exit synchronization. Request deadlines cannot
synchronously pre-empt uninterruptible native I/O; the helper awaits the owned
worker's actual exit and does not claim a hard OS-level kill guarantee.

The cumulative disposition consists of the nonauthor broad helper/script review
and independent nonauthor custody/oracle review above. Reviewers did not run
heavy suites. Local execution receipts and final source hashes are alongside
this file; the PR terminal receipt records the exact-head CI/readiness decision.
