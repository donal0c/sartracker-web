# PR21 exact-head review receipt

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
