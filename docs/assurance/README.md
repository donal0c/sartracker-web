# SAR Tracker Whole-Application Assurance Charter

## Status and scope

This charter is the WAR-01 assurance baseline for the complete existing SAR
Tracker application at `80309c995a18eeb190cce4310c9a46b0f46d5263`. It covers
production code outside the Breadcrumb and Mission-History Programme as well
as the programme boundaries already present on that exact base.

The companion [hazard register](hazard-register.md) records what the repository
actually controls, what the inspected tests prove, where the proof stops, and
which existing Linear issue owns the nearest follow-up. It is an assurance map,
not a claim that every listed risk is a defect or that the application is
qualified for live incidents.

This slice changes documentation only. It does not alter production code,
tests, workflows, dependencies, release configuration, product semantics, or
Linear ownership. It also does not manufacture new package, live-provider,
long-soak, or field evidence.

### In-flight boundary

The unmerged target is the `DON-274`/`DON-277`/`DON-278`/`DON-279` issue set on
GitHub PR #5. The canonical execution policy calls that scope programme PR-4,
while current issue/PR metadata calls it PR-5 of six. This charter therefore
targets the issue set and eventual merge SHA, not a bare programme number.
Every boundary it owns is marked `rewrite-pending`; this charter neither audits
nor freezes its unmerged implementation.

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
| Delayed or hidden current position | A valid current fix is visible within one normal polling cycle. Current request/publication cadence never waits for history, archive, reconciliation, coverage, replay, evidence bookkeeping, or completion of a slow roster transport. A prompt roster response may join only inside the explicit 50 ms metadata grace; after that, publication uses last-known metadata and a visible warning. The exact base does not fully meet this requirement; see `TRK-001`. |
| Silent evidence loss | Failed or uncertain accepted-evidence persistence creates a durable, mission-scoped critical state before the observation settles. `Complete`/`100%` stays blocked; an authorized acknowledgement may permit an audited lifecycle close but never repairs, clears, or erases the permanent evidence gap. |
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

## Required post-issue-set reconciliation

After the `DON-274`/`DON-277`/`DON-278`/`DON-279` issue set on GitHub PR #5
merges, perform one short, docs-only reconciliation before treating this
baseline as current:

1. record GitHub PR #5's merge SHA and diff it against the base used by this
   charter;
2. re-open every changed production and test boundary owned by `DON-274`,
   `DON-277`, `DON-278`, and `DON-279`, including GPX, versioned/source-exact
   evidence, replay, revision, search-area/pass, marker-attachment custody,
   archive inclusion, and coverage-presentation seams;
3. retrace `RPL-001` through `RPL-005`, `EVD-005`, and any other changed
   `EVD-*`, `MIS-*`, `TRK-*`, or `IPC-*` call path; do not carry current-base
   conclusions across a changed boundary by ancestry alone;
4. replace or reaffirm each `rewrite-pending` classification, cite only tests
   actually re-opened, and state the new evidence tier and proof limit;
5. keep the `DON-248`/`DON-252`/`DON-253` streamed archive/restore boundary
   `rewrite-pending` until its own implementation and qualification land; and
6. obtain a fresh exact-head broad life-safety review and a focused
   traceability review of the reconciled rows.

The reconciliation is not a retrospective audit of an unmerged branch. It is
the point at which the merged issue-set code becomes repository authority.
