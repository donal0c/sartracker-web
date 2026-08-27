# Breadcrumb And Mission-History Programme Execution Policy

Date: 2026-08-22

Status: **Locked for execution.** This document records the BCP-00 delivery,
complexity, review, branch, qualification, and first-PR decisions. Domain
semantics remain governed by
`docs/breadcrumb-mission-history-architecture-decision.md`, with the team's
exact words and question history governed by
`docs/breadcrumb-team-question-and-answer-ledger.md`.

## Delivery Decision

- Deliver the programme through six substantial, coherent PRs. The fourth is
  the bounded field-feedback bridge inserted after the original allocation.
- Use feature branches for every programme PR. No programme implementation is
  committed directly to `master`.
- Keep `master` green and internally coherent after every merge, without
  treating that as field qualification.
- Publish one team-facing release only after the complete final qualification.
- Run one unpublished internal packaged checkpoint after PR-3 to isolate
  coverage faults before replay and archive work build on it.
- Keep coverage and replay architecturally separate even though they ship in
  the same final release.
- Preserve paged exact Breadcrumb Dots as the source-exact inspection and
  export contract throughout the programme.

## Reference Hardware And Stall Budget

- Coverage decision evidence and the PR-3 checkpoint use the existing Ubuntu
  X11 qualification host identified in `handoff/HANDOFF.md` as the reference
  machine.
- The original field machine remains final-candidate evidence and is not part
  of routine PR qualification.
- Electron main-process response has a target ceiling of **150 ms** and a hard
  release/decision gate of **200 ms** during history, coverage, replay, archive,
  and reconciliation work. Any measured breach requires a fix or an explicit
  architecture-decision amendment; it is never silently accepted.
- A new current fix must remain visible within one normal successful polling
  cycle regardless of concurrent history work.

## Complexity And Review Routing

Complexity combines implementation breadth, safety impact, persistence risk,
failure-mode difficulty, and the difficulty of proving the result.

Donal's coordination workflow now fixes the implementation executor for every
approved slice at **GPT-5.6 Sol with high reasoning** in a fresh Codex task.
Complexity continues to determine planning depth and independent exact-head PR
review allocation; it no longer automatically changes the implementation
model. See `docs/breadcrumb-programme-coordination-workflow.md`.

| Score | Independent PR reviews |
| --- | ---: |
| 1-4 | 1 |
| 5-6 | 2 |
| 7-8 | 3 |
| 9 | 4 |
| 10 | 5 |

Scores are reassessed in the just-in-time design pass if the actual current
code or accepted scope is materially different. A lower score may not be used
merely to reduce review cost after implementation has started.

## Coordination And Approval

The binding operating loop is
`docs/breadcrumb-programme-coordination-workflow.md`. Codex coordinates and
guards requirements; fresh bounded Fable planning is the default when a new
plan is genuinely needed; Donal explicitly authorizes every implementation
task; and each approved complete PR is delegated to one fresh GPT-5.6 Sol high
task. BCP units remain internal planning and TDD checkpoints inside that task.
No team question is sent until it passes the ledger's duplicate-question gate.

## PR And Slice Scores

| Stage | Slice | Complexity |
| --- | --- | ---: |
| Mobilization | BCP-00 programme setup | 4/10 |
| PR-1: trustworthy ingest and live safety | Overall | **9/10** |
|  | BCP-10 exact-dots preservation contract | 6/10 |
|  | BCP-01 current-position hardening | 7/10 |
|  | BCP-02 provenance and anomaly ledger | 9/10 |
|  | BCP-05 stationary attention | 8/10 |
| PR-2: mission model | Overall | **9/10** |
|  | BCP-03 outings | 7/10 |
|  | BCP-04 participants and Traccar groups | 9/10 |
|  | BCP-06 mission-scale fixtures | 8/10 |
| PR-3: complete coverage | Overall | **10/10** |
|  | BCP-07 renderer decision | 8/10 |
|  | BCP-08 coverage read model and watermark | 10/10 |
|  | BCP-09 coverage UI and filters | 9/10 |
| PR-4: field-feedback bridge | Overall | **7/10** |
|  | `fixTime` authority and history-independent current polling | 7/10 |
| PR-5: mission evidence and replay | Overall | **10/10** |
|  | BCP-11 GPX evidence | 8/10 |
|  | BCP-12a versioned mission data | 9/10 |
|  | BCP-12b timeline replay | 10/10 |
|  | BCP-13 search areas and repeated passes | 9/10 |
| PR-6: archive lifecycle | Overall | **10/10** |
|  | BCP-14 archive security decision | 9/10 |
|  | BCP-15 encrypted streamed archives | 10/10 |
|  | BCP-16 archive review and retention | 10/10 |
| Qualification | BCP-17 final qualification and release | **10/10** |

## PR Grouping And Merge Order

1. **PR-1 — Trustworthy ingest and live safety:** BCP-10, BCP-01, BCP-02,
   BCP-05. Branch: `codex/breadcrumb-pr1-ingest-safety`.
2. **PR-2 — Mission model:** BCP-03, BCP-04, BCP-06.
3. **PR-3 — Complete coverage:** BCP-07, BCP-08, BCP-09.
4. **PR-4 — Field-feedback bridge:** canonical Traccar `fixTime`, explicit
   local-time display and history-independent current polling.
5. **PR-5 — Mission evidence and replay:** BCP-11, BCP-12a, BCP-12b,
   BCP-13.
6. **PR-6 — Archive lifecycle:** BCP-14, BCP-15, BCP-16.
7. **BCP-17 — Qualification:** final-candidate evidence and the one
   team-facing release after PR-1 through PR-6 merge.

Merges serialize in this order. A later branch may be prepared from the prior
PR head, but it cannot merge ahead of its prerequisite.

## Review Allocation

Reviews operate on the exact PR head and use independent contexts. They are
evidence-backed reviews, not votes. For PR-4 onward, the accepted allocation is
four complementary reviews on one final code-and-documentation head:

- broad life-safety and end-to-end;
- persistence and completeness;
- concurrency and finalization; and
- renderer and input containment.

The former five-independent-review allocation is superseded for these PRs.
P1 and P2 findings block merge. Any new commit invalidates the affected
review. Remediation receives one fresh broad exact-head review plus each
affected focused recheck; all four restart only when a shared state machine,
cross-boundary contract, or unbounded impact invalidates the original charters.

### PR-3 Remediation And PR-4-Onward Review Topology

Donal approved the following prospective amendment on 2026-08-26. It applies
to PR-4 and later programme PRs. On the same date, after repeated confirmed
PR-3 findings at the mission-evidence lifecycle seam, Donal explicitly applied
the bounded remediation topology to PR-3 as well:

- pause the PR-3 review loop and perform one deliberate end-to-end architecture
  and attack-test pass over the complete evidence-lifecycle seam;
- land the resulting seam correction as one coherent, red-first change;
- complete deterministic, browser/visual, macOS package, and Linux package/soak
  proof before re-review; and
- run one fresh broad exact-head review plus targeted exact-head
  persistence/completeness, concurrency/finalization, and renderer/input-
  containment rechecks. Do not restart five full reviews after each fix.

For PR-4 onward:

- retain four independent reviewers for a 10/10 PR, run in parallel on one
  final code-and-documentation head;
- use one broad life-safety/end-to-end charter plus three complementary focused
  charters: persistence/completeness, concurrency/finalization, and
  renderer/input containment;
- complete strict TDD, deterministic gates, required packaged/Linux evidence,
  browser and visual verification, evidence documents, manual, and handoff
  before that wave wherever practical;
- centrally source-retrace every finding before changing code;
- treat PR opened/review-ready as an intermediate state; the implementation
  task owns this baseline review wave and its accepted-finding remediation,
  while Donal retains final approval and merge authority and may request
  additional review;
- after a confirmed fix, run one fresh broad exact-head review plus targeted
  exact-head rechecks only from focused reviewers whose risk areas changed;
- retain unaffected focused reviews when their reviewed executable-code and
  test trees are unchanged; and
- require exact-tree and exact-diff attestation for a documentation-only
  evidence-binding commit without automatically invalidating completed code
  reviews when executable-code and test trees are byte-identical.

Recheck scope is contract-based. A narrow persistence fix receives the fresh
broad review plus persistence/completeness; a renderer input-containment fix
receives the fresh broad review plus renderer/input containment; a Finish
evidence fix normally receives the fresh broad review plus both
persistence/completeness and concurrency/finalization. Restart all four only
when a remediation changes a shared state machine or cross-boundary contract,
touches enough critical areas that its impact cannot be confidently bounded,
or invalidates the original charters' assumptions. Schema-plus-renderer,
IPC-plus-worker ownership, finalization-plus-persistence, and Complete/100%
logic are explicit escalation examples.

Repeated confirmed P1/P2 findings at the same seam after remediation trigger an
architecture pause, not another automatic local patch. Re-trace the shared
cause, strengthen the attack-test model, and revise the accepted plan before
continuing. Any resulting change to approved architecture, scope, proof budget,
or domain behaviour returns to Donal for approval.

The stop conditions do not change: false Complete or false 100%, lost mission
evidence, unbounded Electron-main-isolate work, any P1/P2, or any unresolved
safety failure blocks merge. Green CI and a majority of clean reviewers cannot
override a reproduced safety failure.

Before PR-5 implementation begins, record a short PR-4 process retrospective
covering defect yield, centrally rejected false/duplicate findings, avoided
re-review work, escalations, and missed risks. Continue or amend this topology
from that evidence rather than reverting or weakening it by default.

## Cost-Aware Qualification

- Development uses strict red-green-refactor with focused unit, integration,
  and narrow operator-flow tests.
- A review-ready large PR receives the deterministic software gate and only
  the packaged or scale proof required to localize that PR's risks.
- Heavy results are bound to code SHA, fixture hash, harness version, machine,
  and flags. They remain valid until a later change touches the exercised
  surface.
- The PR-3 checkpoint is one bounded Ubuntu packaged run at 960,000 fixes. It
  is not published and excludes the live server, field machine, archive drill,
  installed-package matrix, and full visual sweep.
- The broad packaged, live, multi-machine, archive/custody, long-soak, visual,
  checksum, and fresh-download matrix runs on the final candidate.

## PR-1 Internal Order

1. BCP-10: freeze the existing source-exact Dots behaviour as a contract.
2. BCP-01: harden the current-position path and rejected-row visibility.
3. BCP-02: add receipt/content provenance and the durable anomaly ledger.
4. BCP-05: derive and present stationary attention from the trusted stream.

Each work unit receives a just-in-time Fable design subsection before its
production implementation. PR-1 receives one integration design covering the
boundaries between all four work units.

The accepted PR-1 design is
`tmp/agent-mail/fable-breadcrumb-pr1-design-20260822.md`. It confirms BCP-10
requires no production-code change and defines the BCP-01, BCP-02, and BCP-05
module boundaries, red-first tests, migration proof, operator evidence, and
four reviewer charters.

## Evidence Limit

This policy records programme decisions. It does not itself prove runtime,
packaged, benchmark, live-server, or field behaviour. Those proof tiers remain
separate and must be executed at the gates above.
