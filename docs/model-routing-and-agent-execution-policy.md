# Model Routing And Agent Execution Policy

Date: 2026-09-14

Status: **Current operating policy.** This policy applies to new SAR Tracker
planning, implementation, investigation, repair, and review tasks. It
supersedes older instructions that prescribe Fable or GPT-5.6 Sol for every
slice. Historical model use remains evidence, not current routing authority.

## Purpose

Choose models by the uncertainty, consequence, and proof burden of the work,
while spending most usage on the lowest-cost model that can reliably produce
an accepted, verified result. Complexity scores inform routing; they do not
replace judgement about blast radius or ambiguity.

## Required Task Contract

Every delegated task must state:

```text
Goal:
Context and authoritative sources:
Important constraints and non-goals:
Done means:
Verification:
Stop and ask only if:
```

Give the task the exact branch/base SHA, relevant Linear issues and repository
documents, safety invariants, file boundaries, proof requirements, and
explicit exclusions. Do not paste broad project history that the agent can
retrieve from current repository sources.

Implementation tasks own the complete agreed outcome: reproduce or define the
behaviour, implement it, run proportionate verification, update required
records, open the PR, complete the current independent review process, resolve
valid findings, and continue until genuinely merge-ready. A plausible first
implementation, a plan, or a list of findings is not completion.

## Model Routing

### GPT-5.6 Luna X-High — default worker

Use Luna for bounded, reversible work with clear behaviour and verification:

- routine implementation, documentation, and source extraction;
- focused tests, test repair, and mechanical changes;
- isolated, low-blast-radius fixes;
- bounded subagent work with explicit file ownership.

Escalate when discovery reveals cross-layer dependencies, unresolved product
meaning, repeated failed attempts, or high blast radius. Repeated cheap retries
are not a substitute for correct routing.

### GPT-5.6 Sol — ambiguity and cross-layer tier

Use Sol, normally High and only X-High when justified, for architecture,
cross-layer changes, difficult root-cause analysis, persistence or shared
contracts, and consequential final review. Sol is the normal escalation from
Luna when the difficulty is technical rather than exceptional.

### GPT-6 Astra Low — precision tier

Use Astra only for a bounded, recorded trigger:

- rare life-safety or high-consequence work where failure costs materially
  more than the model usage;
- difficult coding where avoiding repeated failed iterations is high leverage;
- unusually long-context or cross-repository reasoning;
- recovery after two failed or rejected Sol attempts on the same problem;
- browser/computer-use work that genuinely needs its stronger capability;
- orchestration of more than three independent agents.

Astra is a coding model, not only a planner. Keep it at Low unless Donal
explicitly authorizes a higher effort. Its prompt must be narrow and include
instruction precedence, authority boundaries, delegation boundaries,
ambiguity handling, and explicit completion evidence.

### Complexity guide

| Complexity | Starting route |
| --- | --- |
| 1-4 | Luna X-High unless a safety trigger overrides it |
| 5-7 | Luna X-High when bounded; Sol High when ambiguous or cross-layer |
| 8-9 | Sol High/X-High normally; Astra Low for a recorded high-consequence, recovery, or unusually difficult trigger |
| 10 | Deliberate choice between Sol X-High and Astra Low; complexity alone does not decide |

Record the chosen model, effort, routing trigger, affected scope, and any
escalation in the relevant Linear issue, PR, or assurance record. Complexity
continues to determine review depth under the applicable review policy; model
choice and review count are separate decisions.

## Cost-Conscious Delegation

- Astra or Sol may delegate independent grunt work to Luna X-High when this
  reduces accepted-outcome cost.
- Each delegated question must be bounded and have explicit file ownership or
  be read-only. Require an evidence-backed result.
- Never run concurrent edits against the same files or state. Do not give every
  subagent the entire parent context.
- The owning model must inspect, integrate, verify, and stand over delegated
  work. Two cheap parallel agents are not independent verification when they
  share the same assumptions or edit surface.
- Prefer one fresh task with a concise source packet. Reuse an old task only
  when unresolved context is genuinely necessary and cheaper than clean
  re-entry.
- Measure value by accepted verified outcomes, retries, wall-clock time, scope
  drift, and regressions—not calls made or tokens spent in isolation.

## Planning, Parallelism, And Escalation

Do not force a separate planning task for clear, bounded work. Use a short
inspection-first plan for unfamiliar or cross-layer changes, and a living
contract for multi-hour, interruptible, migration, or release-defining work.
Fable is not a default part of the workflow; use an external planning model
only when Donal explicitly requests it.

Parallel tasks require genuinely disjoint source/state ownership and explicit
merge order. Shared handoff, workplan, ledger, manual, and CI files must have a
named integration owner or be reconciled after the first merge.

Escalate one tier after two failed or rejected attempts on the same bounded
subtask. Stop for Donal only when authority is required, a repository-backed
team/domain answer is genuinely missing, or the work cannot proceed without
weakening a safety invariant. Test failures, review findings, rebases, and
transient tools are ordinary work, not stopping conditions.

## Evidence Boundary

Every completion report must state changed behaviour, exact files and head,
checks passed, checks failed, checks skipped, review dispositions, and
remaining uncertainty. Local, browser, packaged, CI, merge, release, and field
acceptance are separate claims. Model strength never substitutes for evidence,
and no implementation task may merge or release without Donal's authority.
