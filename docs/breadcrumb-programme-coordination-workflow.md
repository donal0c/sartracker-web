# Breadcrumb Programme Coordination Workflow

Date: 2026-08-22

Status: **Locked by Donal for the Breadcrumb and Mission-History Programme.**

This is the operating workflow for planning, implementation delegation, review
iteration, and requirements control. It supplements
`docs/breadcrumb-programme-execution-policy.md`; it does not replace the domain
decisions in `docs/breadcrumb-mission-history-architecture-decision.md`.

The raw question-and-answer authority is
`team-feedback/breadcrumb-question-answers-20260822.md`, indexed by
`docs/breadcrumb-team-question-and-answer-ledger.md`. Summaries in plans,
Linear, ADRs, or model output never outrank the team's recorded words there.

## Roles And Authority

- **Donal** owns the approval gates. No implementation task starts until Donal
  explicitly says to proceed with that planned slice.
- **Codex in this task** is the programme coordinator and chief of staff. It
  maintains continuity, prepares bounded Fable planning work, checks every plan
  and implementation against team requirements, creates implementation tasks
  only after approval, follows their progress, and keeps the repository and
  Linear state coherent.
- **Fable** is the bounded architecture and implementation-planning adviser. It
  does not implement, mutate Linear/GitHub, or run expensive qualification
  unless Donal explicitly changes that scope.
- **One fresh Codex task using GPT-5.6 Sol with high reasoning** implements each
  approved complete PR through review-ready proof. BCP units are internal
  planning and strict-TDD checkpoints inside that task, not separate
  implementation tasks.
- **Donal controls PR review.** The coordinator reconciles review findings and
  routes remediation back to the implementation task until the exact head is
  acceptable.

## Requirements Authority

Every plan and implementation brief must be checked against, in order:

1. the exact confirmed team answers and field examples in
   `docs/breadcrumb-team-question-and-answer-ledger.md`;
2. `docs/breadcrumb-mission-history-architecture-decision.md`;
3. the relevant Linear BCP issue and its dependencies;
4. `docs/breadcrumb-programme-execution-policy.md`;
5. current code and verified evidence.

The coordinator must preserve a short requirement-to-test trace for each slice.
It must identify the operator need, safety invariant, intended visible result,
failure behaviour, persistence effect, and proving test. A code-level proposal
that conflicts with a confirmed team need is rejected or taken back to Donal
and the team; it is never allowed to become the de facto requirement.

Core ambiguity in life-safety behaviour blocks implementation. Minor UI polish
may proceed only with an explicit recorded assumption.

### Mandatory Duplicate-Question Gate

Before proposing any question for the SAR team, the coordinator must:

1. search the canonical Q&A ledger using the operational nouns in the proposed
   question, not only its technical wording;
2. list every related `SAR-QA-*` ID;
3. state in ordinary operational language why those answers do not resolve the
   proposed question;
4. distinguish an operator/domain decision from an engineering mechanism;
5. add the proposed question to the ledger before it is sent.

If the gap cannot be stated, the question is not sent. Fable, OxAlpha, and an
implementation agent may identify a possible ambiguity, but they cannot turn
an already-answered domain point into a new team question. The coordinator
must perform this gate personally.

## Cost-Conscious Fable Policy

- Default to **one fresh, bounded Fable instance per planning slice**. This
  avoids repeatedly paying for a large accumulated conversation context.
- Reuse an existing Fable session only when the new task materially depends on
  its unresolved reasoning and that continuity is cheaper and safer than a
  concise fresh source packet.
- Use the normal `fable5` medium-effort launcher unless Donal explicitly asks
  for high effort. Run the required AWS launcher preflight before a fresh job.
- Give Fable only the exact branch/SHA, relevant requirements, governing docs,
  current code seams, known evidence, and one bounded deliverable.
- One initial planning pass and, only if genuinely required, one focused
  correction pass is the normal maximum. Do not run open-ended planning loops.
- Store the completed artifact under `tmp/agent-mail/` with a completion
  sentinel. Codex reads it fully, checks it against requirements and current
  code, and owns the final synthesis.
- Do not call Fable merely to repeat an already accepted plan. BCP-01 is already
  sufficiently planned in
  `tmp/agent-mail/fable-breadcrumb-pr1-design-20260822.md`; no additional Fable
  run is required before Donal's BCP-01 implementation approval. BCP-02 and
  BCP-05 receive fresh current-code planning passes after their predecessors
  change the checkout.

## PR Implementation Cycle

### 1. Prepare

Codex confirms the current branch and exact HEAD, reads the governing material,
inspects the relevant current seams, and decides whether the accepted plan is
still current. It updates the plan only when code, evidence, or team decisions
have changed.

### 2. Plan With Fable

When a fresh plan is needed, Codex sends one bounded task containing:

- goal and non-goals;
- exact requirement trace using canonical `SAR-QA-*` IDs;
- safety invariants and failure modes;
- source-of-truth repository, branch, SHA, and dirty-worktree caveat;
- required module boundaries and anti-sprawl constraints;
- red-first tests, focused verification, and completion gate;
- explicit prohibition on source edits and external mutations.

Codex then challenges the result against the raw team answers and current
code. A model-labelled "product decision" is not forwarded automatically; it
must pass the mandatory duplicate-question gate first. Only genuinely
unresolved product decisions go to Donal or the team before implementation.

### 3. Approval Gate

Codex gives Donal a concise readiness summary: planned behaviour, important
trade-offs, genuine open questions, complexity, and proof scope. It waits for
an explicit go-ahead. Preparing a plan is not implementation authority.

### 4. Create The Implementation Task

After approval, Codex creates one new Codex task using **GPT-5.6 Sol, high
reasoning** for the complete PR. The task receives a self-contained execution
packet containing:

- exact branch and starting SHA;
- relevant requirements and accepted Fable artifact;
- goal, non-goals, invariants, and file boundaries;
- strict TDD sequence and focused commands;
- documentation, manual, Linear, commit, and push obligations;
- proof limits and explicit exclusions;
- instruction to stop on a core domain contradiction.

The implementation task owns every BCP checkpoint in that PR through final
integration, review-ready proof, verified commits, push, and the single PR.
The coordinator monitors it and provides only requirements clarification,
scope control, or blocker resolution. A BCP boundary does not create a new
implementation task.

### 5. Candidate And Review

The implementation task returns the exact head SHA, commits, changed files,
test evidence, remaining uncertainty, and PR-readiness status. Codex verifies
that handoff against the accepted plan and requirements.

Donal then initiates the allocated PR reviews. P1/P2 findings block progress.
Remediation normally returns to the same implementation task to retain useful
code context; a fresh task is used only when Donal requests it or the original
task is genuinely unsuitable. Fable is not recalled unless review exposes an
architecture or requirements problem rather than an ordinary implementation
defect.

### 6. Close And Advance

Once the exact head is accepted and merged, Codex synchronizes Linear, the
workplan, handoff, and any operator documentation. It then prepares the next
slice but again waits at Donal's implementation approval gate.

## Evidence And Release Discipline

- Focused deterministic verification runs during implementation.
- Each large PR receives its planned review-ready gates.
- Expensive multi-machine, live-server, extended-soak, full visual, archive,
  checksum, and field smoke remains end-weighted as already locked.
- PR-3 receives the single unpublished packaged checkpoint.
- No programme PR produces a team release. BCP-17 qualifies one final release.

## Current Baton

PR-1 is owned by one authorized Sol-high implementation task. Its BCP-10,
BCP-01, BCP-02, and BCP-05 checkpoints remain open in Linear until the complete
PR merges. Donal coordinates review after the task returns the single PR at an
exact review-ready head; no separate BCP implementation task is created.
