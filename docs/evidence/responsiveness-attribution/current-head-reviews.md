# PR21 exact-head review receipt

> **SUPERSEDED — NOT ACCEPTED APPROVAL (2026-09-12).** The user rejected
> the GPT-5.5 review below. It is invalid and must not be counted. Neither
> historical review below satisfies the current Astra-only requirement.
> A fresh GPT-6 Astra low-reasoning exact-head review and current CI are
> required before merge. No current approval is claimed by this receipt.

## Fresh Astra source review

GPT-6 Astra, low reasoning, independent read-only reviewer `astra_review`,
reviewed `872593179b88c3cbaf71ba04d1326945bd087f7f` against
`e989e8922ea105657a18a03ca442ae88e6c9d548` on 2026-09-12. No actionable
P1/P2 source findings. Reviewed collector bounds/cleanup, inspector deadlines,
pointer/frame diagnostics, pressure retention, soak integration, tests, CI
routing and evidence boundaries. The independent main-loop gate is unchanged.
No prior model review conclusions were used. This is source review, not a
GitHub-account approval, CI proof or release acceptance.

The fresh local three-control run at that head failed the realm control with
`Target page, context or browser has been closed`; pointer and disconnect
controls passed. A process-logged targeted repeat passed. Five forced main
garbage collections retained the window, so fixture lifetime causation is not
established. The first failure remains unresolved evidence, not erased by a
passing repeat. Logs are retained in `tmp/pr21-astra-electron*.log` and
`tmp/pr21-fixture-gc.log` in the specified worktree.
The complete process-logged follow-up passed all three controls (4.1 seconds).
This confirms current execution but is not a causal repair of the first failure.

## Superseded historical receipt

Candidate: `cc620d82c01bc15573f3ba6040852a132098be76`
Base: `e989e8922ea105657a18a03ca442ae88e6c9d548`
Review date: 2026-09-12

These are independent read-only reviews of the accumulated exact-base diff.
Neither reviewer edited, staged, committed, pushed, or posted externally.

## Claude Code review

Reviewer: Claude Code non-interactive read-only fallback. The normal `herdr`
transport was unavailable because its local server was not running, so the same
bounded review prompt was run directly with `claude -p --permission-mode plan`
and captured at `/tmp/claude-pr21-exact-head-review.txt`.

Verdict: no P1 findings; code-level isolation and fail-safe collection claims
confirmed. The review identified the expected pre-merge evidence gap: exact-head
Linux CI had not yet run. It also recorded as P3 that the five-second inspector
request timeout applies to the shared transport used by the original heartbeat
as well as diagnostic calls.

## Codex bug-hunter review

Reviewer session: `01a094b2-7161-7740-bc39-1faa8c4f935e`, model `gpt-5.5`,
read-only CLI, captured at `/tmp/codex-pr21-exact-head-review.txt`.

Orchestration: two-pass single-reviewer inspection: source-of-truth/boundary
pass followed by adversarial diff/evidence pass.

Verdict: no P1/P2 findings. The strict main-event-loop predicate remains
independent; Electron controls are isolated and wired to Xvfb; diagnostic stop
is bounded, idempotent, and fail-visible; and the docs retain the release HOLD
and historical failures. Recommendation was conditional on exact-head CI.

The pre-rebase CI receipt remains historical and failed on its unchanged 205 ms
archive continuity gate. It is not evidence for this candidate's exact-head CI.
