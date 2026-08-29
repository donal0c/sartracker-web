# SAR Tracker Whole-Application Assurance Charter

## Status and scope

This charter is the WAR-01 assurance baseline for the complete existing SAR
Tracker application at PR5 merge commit
`eec92812b783a795c093f37268b295dd2179a3af`. It covers production code outside
the Breadcrumb and Mission-History Programme as well as the merged
`DON-274`/`DON-277`/`DON-278`/`DON-279` evidence and replay boundaries from PR5
head `f5ba8647131950dde457e50ce36fe0b8ded7337d`.

The companion [hazard register](hazard-register.md) records what the repository
actually controls, what the inspected tests prove, where the proof stops, and
which existing Linear issue owns the nearest follow-up. It is an assurance map,
not a claim that every listed risk is a defect or that the application is
qualified for live incidents.

This slice changes documentation only. It does not alter production code,
tests, workflows, dependencies, release configuration, product semantics, or
Linear ownership. It also does not manufacture new package, live-provider,
long-soak, or field evidence.

### Merged PR5 reconciliation

GitHub PR #5 merged as
`eec92812b783a795c093f37268b295dd2179a3af` from final source head
`f5ba8647131950dde457e50ce36fe0b8ded7337d`. WAR-01 re-opened the landed schema
v12 migration, GPX source/worker/receipt/revision boundaries, immutable versions
of mutable mission objects, data-known-at-time Replay queries and IPC, stable search-area /
assignment / pass records, attachment custody and archive inclusion, renderer
projections, browser parity, and their relevant tests. The affected register
rows now describe those merged controls and their remaining proof limits.

The proof boundary is exact. The accepted four-review PR5 wave applies to its
recorded earlier heads, including `c1ad54b8` for persistence/concurrency and
`467e7b39` for renderer/broad review. It is prior-head evidence, not an
exact-head independent review of `f5ba8647`. Donal authorized the final
casualty-treatment/preload/workflow correction to use a focused correction,
test, and package pass instead of restarting those four reviews. Exact-head
Linux run `33260131951` was green for `f5ba8647`. Its package build, native
SQLite/Mesa inspection, packaged tracking soak, launch, and graceful-close
steps are `T4` only for the exact artifact flows they drove. The indexed
960,000-position Replay and 50,000-point GPX qualification imported checkout
modules directly, so those scale controls remain `T2` integration evidence
despite running in the same CI job. The run does not convert the prior-head
reviews into final-head reviews or prove release, live-provider, long-duration
field, archive-security, or restore-and-replay behavior.

The `DON-248`/`DON-252`/`DON-253` archive-lifecycle successor is also not
implemented. The canonical programme policy names that successor programme
PR-5; the WAR-01 task packet called it “PR6.” Neither shorthand is an authority
for scope, and “PR6” must not be confused with GitHub PR #6, which is this
docs-only assurance PR. Archive security, streaming, archive-backed review,
and restore-and-replay remain `rewrite-pending` under those issue owners.

## Assurance objective

SAR Tracker must remain honest, responsive, recoverable, and inspectable under
operational pressure. A safety claim is valid only when all four parts agree:

1. the team or repository authority defines the meaning;
2. the production boundary enforces that meaning;
3. an inspected test exercises the named invariant; and
4. evidence exists at the tier needed for the artifact, platform, scale, and
   failure mode being claimed.

Missing one part is a gap, not permission to infer the others.

## Requirements authority

Use sources in this order when maintaining the register:

1. The verbatim team record in
   `team-feedback/breadcrumb-question-answers-20260822.md`, indexed by stable
   `SAR-QA-*` IDs in `docs/breadcrumb-team-question-and-answer-ledger.md`.
2. The locked decisions in
   `docs/breadcrumb-mission-history-architecture-decision.md` and explicit
   safety rules in `CLAUDE.md`.
3. Current Linear issue descriptions and comments, including regression
   provenance and unresolved acceptance gates.
4. Current production call paths and tests opened during the pinned-base
   inspection.
5. Release notes, handoff entries, and prior evidence reports, which support a
   claim only for their exact artifact and workload.

An old summary, filename, test count, or plausible architecture does not prove
an invariant. A team answer is not replaced by a model-generated question or
an implementation convenience.

## Absolute release blockers

The following conditions are blockers, not accepted degradation:

| Blocker | Required behavior |
| --- | --- |
| Delayed or hidden current position | A valid current fix is visible within one normal polling cycle. Before the operational renderer exists, current availability cannot wait without a visible bounded failure state for Electron-main diagnostics/crash I/O, synchronous store open/migration, an unclean-session evidence-loss fence, active-mission/restart bookkeeping, or renderer loading. Renderer startup then cannot wait for history, archive, reconciliation, coverage, replay, evidence bookkeeping, unbounded cache I/O, slow roster transport, service-worker registration, non-tracking core initialization or mission/governance/participant hydration, settings/credential/cache filesystem reads, or deferred-evidence module initialization. Starting or replacing tracking cannot leave the application without an active current-position request path: settings may load while the old service remains live, but once its current/evidence/history drain starts, the operator must not be left with an apparently current snapshot and no request path while replacement initialization waits. A prompt roster response may join only inside the explicit 50 ms metadata grace; after that, publication uses last-known metadata and a visible warning. The ADR requires a separate explicit operator action before live position is hidden; DON-193 and the operator manual deliberately suspend refresh while paused and warn critically, while the manual also names the separate Current Location control as the live-hide action. That pause authority conflict is unresolved and cannot be treated as a settled exception. Automatic recovery is not an operator live-hide action. The exact base does not fully meet this requirement: pre-window main-process work, serial renderer cold-start gates, participant-scope loading/error, awaited snapshot settlement, the settings-reload drain/replacement gap, paused polling, and automatic-recovery clearing can each delay or suppress current position; see `TRK-001`. |
| Silent evidence loss | Failed or uncertain accepted-evidence persistence creates a durable, mission-scoped critical state before the observation settles. `Complete`/`100%` stays blocked; a policy-authorized acknowledgement may permit an audited lifecycle close but never repairs, clears, or erases the permanent evidence gap. The exact base provides configured-roster attribution rather than authenticated actor authority and is accepted only inside the trusted-team-machine boundary; see `EVD-004` and `SEC-004`. |
| False `Complete` or `100%` | A claim requires the exact selected revision set, renderer attachment, delivery ledger, and fresh database claim, with no omission, evidence-health, transition, or worker blocker. Equal counts alone are insufficient. |
| Corrupted evidence | Invalid coordinates, timestamps, schemas, archives, and worker envelopes fail closed. Corruption must not be silently normalized into authoritative mission evidence. |
| Unbounded mission-size work on Electron main | Operational main-process work must have a fixed bound or execute in a cancellable worker/process boundary. Archive creation, integrity checks, review, replay, and coverage may not block current tracking or operator input as mission size grows. |

## Control and gap vocabulary

Each row separates the following concepts:

- **Confirmed control:** an exact production call path was opened and enforces
  the stated rule.
- **Tested control:** an opened test drives that rule at its named boundary.
- **Evidence-tier gap:** the control may be tested locally but the required
  package, platform, scale, fault, or field claim is not proved.
- **Hypothesis:** a plausible concern without a confirmed failing call path or
  reproduction. Hypotheses must not be reported as defects.
- **Rewrite-pending:** the controlling boundary is explicitly owned by an
  unmerged or unimplemented programme slice and must be re-inspected after it
  lands.

Every register row uses exactly one primary gap classification:

| Classification | Meaning |
| --- | --- |
| `untested-invariant` | Production appears to enforce the invariant, but no inspected test directly exercises the complete named rule. |
| `unenforced-invariant` | Authority requires the invariant, but the inspected production path does not yet enforce or surface it. |
| `evidence-tier-gap` | Code and tests control the invariant at a lower tier; the required artifact/platform/scale/fault/field proof is absent or incomplete. |
| `accepted-residual` | A current, explicit policy retains a bounded limitation or degraded mode with detection and fallback. This is not blanket field acceptance. |
| `rewrite-pending` | The relevant programme rewrite is unmerged or unimplemented, so the current-base control must be reconciled rather than frozen. |

## Evidence tiers

Evidence is monotonic only within the exact claim it proves. Higher-tier proof
does not make a different artifact, platform, profile, provider, or workload
equivalent.

| Tier | Evidence | Proof limit |
| --- | --- | --- |
| `T0` | Authority and source inspection | Establishes intent or a call path; proves no execution. |
| `T1` | Deterministic unit/static contract | Proves the named function/module inputs and outputs, usually with mocked adjacent boundaries. |
| `T2` | Integration or rendered browser workflow | Proves connected modules or operator-visible browser behavior; browser harness storage is not Electron persistence. |
| `T3` | Local Electron/package or independently inspected visual evidence | Proves the named local artifact and platform flow; it is not CI-artifact, scale, or field proof unless explicitly measured. |
| `T4` | Exact CI-built artifact with declared platform, scale, restart, and fault matrix | Proves only that artifact and matrix; it does not establish long-duration field behavior or every host profile. |
| `T5` | Controlled field/live-provider/long-duration evidence | Proves the observed machines, provider, duration, and workload; it does not erase contradictory field evidence. |

The register names the highest relevant existing tier and its proof limit. Test
files listed there were opened and inspected during WAR-01; their presence is
not inferred from a filename or suite count. A test run in this documentation
slice is recorded separately from that source inspection.

## Register ownership and maintenance

- Hazard IDs are stable. Never renumber or reuse a retired ID; append a status
  note if a hazard is superseded.
- The listed Linear issue is the closest existing owner, not a newly invented
  remediation issue and not proof that every detail already appears in its
  description.
- Any change to authority, invariant, production path, test, evidence tier,
  gap class, or residual risk requires an update to the same row.
- A concern becomes a confirmed defect only after tracing the exact call path
  and reproducing the violation. Until then, retain it as a bounded residual or
  evidence gap.
- The coordinator centrally retraces future confirmed findings before deciding
  remediation. WAR-01 creates no speculative Linear work.

## Reconciliation status and next mandatory boundary

The post-PR5 reconciliation is complete on the merge SHA above. `RPL-001`,
`RPL-002`, `RPL-003`, `RPL-005`, `EVD-005`, `TRK-002`, and the affected
`MIS-*`, `IPC-*`, archive, evidence, and map-surface rows were retraced against
the landed code and opened tests. Reclassification records a control only where
the merged path and inspected test justify it; it does not inherit an assurance
claim merely because PR5 merged.

The next mandatory reconciliation remains the unimplemented
`DON-248`/`DON-252`/`DON-253` archive-lifecycle successor. Keep `RPL-004`
`rewrite-pending` until its streamed encrypted/locked archive, key custody,
restore-and-replay, large-file, and recovery matrices land and are inspected.
After any such merge, retrace every changed archive/replay/finalization row and
obtain fresh exact-head broad life-safety and focused traceability reviews.
