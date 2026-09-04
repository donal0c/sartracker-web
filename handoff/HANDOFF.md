# HANDOFF.md — Live Baton

> Read this after `CLAUDE.md`. Keep this file short and operational. Historical
> detail lives in `handoff/archive/`, the two-track workplan, Linear, and commits.

## Current State

- **PR #10 recovery is active on the existing
  `codex/breadcrumb-pr6-archive-lifecycle` branch for `DON-248`, `DON-252`, and
  `DON-253`.** Donal retains approval, merge, release, and team-contact authority.
  Final immutable head/tree, proof receipts, and reviewer verdicts belong in the
  PR/Linear ledger so recording them does not create a different source head.
- **Exact head `caf9e5e480fcd02cc44d68c8397efcd6ae78f2cd` is rejected.** Its Ubuntu
  qualifier created and verified a 5,243,848,931-byte archive, but the receipt
  ended `UNCLASSIFIED_INTERNAL_FAILURE` at `teardown:incomplete`. Profile cleanup
  did complete. An unbounded `Math.max(...samples)` diagnostics aggregation
  caused the misleading teardown classification; constant-space aggregation is
  the repair. Independent measurements also showed real multi-second create,
  restore, cleanup, and durable-write stalls.
- **The recovery cause is understood.** The field fixture retained roughly 9.7
  million high-volume telemetry `mission_events`, and archive paths repeatedly
  scanned mission history for finalization and acknowledgement state. The old
  sub-millisecond “current position” measurement was only an in-process map
  operation and did not prove the packaged renderer path.
- **The bounded recovery source work and pre-freeze local gates are complete.**
  It uses deterministic current-finalization lookups, lazy evidence-loss
  acknowledgement lookup with a durable
  projection, mission-scoped logical cleanup with a restart-safe rowid cursor
  and telemetry-only `mission_events` deletion, constant-space diagnostics, and
  a packaged Electron external watchdog that correlates exact synthetic Traccar
  fixes through main/preload, React, and the MapLibre source. Every liveness
  dimension is a strict `<200 ms` gate; ledger overflow and missing continuity
  fail closed.

## Locked Safety Boundaries

- Finalized missions remain read-only. Archive revisions and supplements remain
  immutable and indefinitely retained.
- Cleanup requires the existing verified encrypted archive and custody gates.
  It may remove archived mission rows other than the retained mission stub,
  rebuildable derived projections, four explicitly settled operational tables,
  and—within `mission_events` only—the `device_updated`, `position_recorded`,
  and `mission_backup_synced` telemetry event types. It retains the mission
  stub, archive and supplement records, and all non-telemetry mission audit
  records, including operational, finalization, custody, cleanup, supplement,
  and unknown future event types.
- Cleanup is logical SQLite deletion. Freed pages may be reused, but the file may
  not shrink. Physical compaction and oversized-store recovery remain with
  `DON-250` / `DON-251`; no in-process multi-GB `VACUUM` is authorized.
- The 50 ms packaged polling profile is time-compressed validation, not a
  production cadence. The separate greater-than-2-GiB qualifier measures
  Node/SQLite scale contention; it is not packaged-renderer proof. Both exact-
  head receipts are required and their evidence limits must stay explicit.

## Active Work

- Freeze and commit the reviewed strict-TDD recovery on the existing PR branch.
- Rerun full static, unit, browser, visual, package, packaged-lifecycle and
  physical SIGKILL gates on that exact clean head. The unsigned macOS package
  rehearsal built, but its lifecycle runner correctly refused the dirty
  pre-commit tree and supplies no packaged-liveness proof.
- Run four independent exact-head reviews: broad life-safety/end-to-end,
  persistence/completeness, concurrency/finalization/liveness, and renderer/
  input-containment/operator surface. Source-retrace every finding; any accepted
  P1/P2 requires red-first repair and affected re-review.
- After every cheap prerequisite is green, run exactly one fresh controlled
  Ubuntu greater-than-2-GiB qualification, bound to the exact Linux packaged
  liveness report and source head/tree.

## Open Issues That Matter Now

- `DON-248` — archive encryption, authenticity, custody, and emergency access.
- `DON-252` — streamed encrypted archive plus exhaustive restore/verification.
- `DON-253` — archive-backed read-only Review, revisions, and logical cleanup.
- `DON-250` / `DON-251` — deferred oversized-store recovery, physical
  compaction, retention, and measured indexing.
- `DON-254` / `DON-255` — programme-wide qualification and the later single
  team-facing release; neither is part of PR #10 recovery.
- `DON-247` — original field-machine beta.12 confirmation remains separate.
- `DON-264` — persistent overlay-sync diagnostics remains a non-blocking backlog
  item.

## Verification Snapshot

- Combined recovery unit/integration gate: `28` files / `680` tests green.
- Full deterministic serial unit gate: `375` files / `3,685` tests green.
  ESLint, TypeScript/production build, bundle budgets, Node syntax, and diff
  checks are green; backend is `58` passed / `1` platform-specific ignored.
- Full Chromium operator suite: `173/173` green. Full visual Playwright:
  `62/62` green. The refreshed 15-check cleanup frame passed an uncached
  independent critical visual review and now backs the operator-manual image.
- Unsigned macOS arm64 directory packaging passed. Exact-head packaged
  lifecycle/liveness, physical SIGKILL, Linux, four-review, and fresh field
  gates remain pending. Prior-head results are diagnostic only.

## Next Actions

1. Freeze, commit, and push the existing PR branch; run exact-head package,
   browser/visual, kill-matrix, Linux, and four-review gates.
2. If all remain clean, execute the single fresh Ubuntu field qualification and
   record the final ledger externally in PR #10 and the three Linear issues.

## Blockers

- None at present. The rejected caf9 receipt is diagnosis, not qualification.

Archived pre-recovery baton: `handoff/archive/HANDOFF-history-2026-09-04-pre-pr10-recovery.md`.
