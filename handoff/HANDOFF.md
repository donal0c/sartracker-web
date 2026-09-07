# HANDOFF.md — Live Baton

> Read this after `CLAUDE.md`. Historical detail and exact prior receipts live
> in `docs/breadcrumb-pr6-evidence.md` and the archived baton.

## Current State

- PR #10 recovery remains active on the existing
  `codex/breadcrumb-pr6-archive-lifecycle` branch for `DON-248`, `DON-252`, and
  `DON-253`. Donal retains approval, merge, release, and team-contact authority.
- Pushed head `20486b6c` / tree `131da068` is rejected. Its package, browser,
  visual, and kill evidence is prior-head only; later review found correction-
  custody races and Linux run `33954733857` was cancelled.
- The next source tree `840947d5fcacb66c64597f85f6a434753de621a9`
  was rejected pre-package for a correction pathname-rebind race and a lifecycle
  terminal-consumption race.
- Reviewed tree `91f8f3ed` was rejected pre-commit by two fixed 50 ms test waits
  across lazy dialogs (`3,958/3,960` passed); product behavior was not implicated.
- Its reviewed descendant `969bf644` was rejected pre-commit when the unchanged
  25,000-row acknowledgement test exceeded Vitest's generic 5-second ceiling
  under suite contention (`3,959/3,960` passed). At each freeze, no package or
  deferred platform gate had run.
- Behavioral tree `d5727b82` passed two clean bounded delta reviews and its one
  full non-browser source cycle. Production sources and strict liveness gates
  remain unchanged; any final status-only descendant must preserve every non-doc
  blob from that reviewed and tested tree.

## Active Work

- Correction attachment mutation runs only in a cwd-bound Electron
  `utilityProcess` authenticated by exact database-directory identity. One
  SQLite custody plan precedes bytes; each restored attachment is an exact
  operation-owned mode-0600 two-link pair revalidated around archive reads.
- Correction unlock and plan removal commit atomically. Cancellation, crash,
  failed correction, and startup recovery do not delete or rename attachment
  residue. Reconciliation computes full byte proofs outside SQLite's writer
  transaction, then revalidates the exact plan, mission/unlock state, directory
  identity, and unchanged pair topology before clearing custody.
- UtilityProcess messages are V8-cloneable and cancellation uses message plus
  bounded termination. Completion and fallback require the same exact correction
  operation in the terminal and durable unlock event. Any ambiguous commit or
  residual custody is durably fenced across restart, and physical helper exit is
  joined before correction ownership is released.
- Lifecycle supervision now separates a short preparation gate, durable active
  lease, parent-prepared child staging, canonical terminal inode, and durable
  consumed record. Only the exact active lease owner may touch a terminal
  boundary. Success is exposed only after settled child cleanup, then read back
  and consumed before return.
- Same-head lifecycle reuse remains forbidden. A dead consumed lease is
  reclaimable only for a different head after its prior terminal is proved.
  Emitted and already-observed POSIX wrapper exits must prove the complete
  process group empty; residual groups are boundedly terminated/reaped, while
  unproved settlement fails closed and retains child staging.
- The Saved Mission Archives workspace tests now wait for the exact cleanup and
  verification split modules inside React `act`; the focused file passes `14/14`
  without arbitrary sleeps or React warnings.
- The 25,000-row acknowledgement test retains its full semantic workload and
  assertions with a test-local 15-second ceiling; focused green is `1/1` in
  `1,643 ms`. Packaged liveness remains a separate strict `<200 ms` gate.

## Locked Safety Boundaries

- Finalized missions remain read-only. Archive revisions and supplements remain
  immutable and indefinitely retained.
- Cleanup is logical SQLite deletion only. It retains the mission stub, archive
  and supplement records, non-telemetry audit events, and unknown future event
  types. Physical compaction remains `DON-250` / `DON-251`; no operational
  `VACUUM` is authorized.
- Every liveness dimension remains strictly `<200 ms`; `200 ms` fails.
- The 50 ms packaged polling profile is time-compressed validation, not a
  production cadence. The Ubuntu greater-than-2-GiB qualifier is a separate
  Node/SQLite scale gate, not packaged-renderer proof.
- One packaged lifecycle attempt is permitted per frozen exact head. Rejected
  candidates are never rerun unchanged.

## Relevant Linear Issues

- `DON-248` — archive encryption, authenticity, custody, and emergency access.
- `DON-252` — streamed encrypted archive plus exhaustive restore/verification.
- `DON-253` — archive-backed read-only Review, revisions, and logical cleanup.
- `DON-250` / `DON-251` — deferred oversized-store recovery and compaction.
- `DON-254` / `DON-255` — later programme qualification/release; not this cycle.
- `DON-247` and `DON-264` remain separate reliability work.

## Verification Snapshot

- Correction passes `8/102`; independent integration and custody/protocol audits
  are clean at `8/137` and `7/99`, including real utility children, exact-
  operation attribution, restart fences, exit joins, plan drift, and ABA swaps.
- Maximum 4,096-entry committed and near-4-MiB uncommitted reconciliation held
  the SQLite writer for `59.9-94.7 ms` across measured variants; every concurrent
  WAL writer succeeded. Full hashing occurred outside the writer transaction.
- The expanded matrix passes `20/628`; it caught and closed one test-only
  UtilityProcess injection gap without a production fallback or orphan helper.
- Lifecycle supervision passes `3/259`; its independent exact-owner/process-group
  re-audit is clean. Earlier repair evidence is in `docs/breadcrumb-pr6-evidence.md`.
- Tree `91f8f3ed` passed the three-model council, renderer/operator review, and
  an independent persistence review from a separate Git archive, all with no
  deterministic P1/P2. Its full source cycle then rejected it on the two
  load-sensitive test waits above. The repaired focused file passes `14/14`.
- Reviewed descendant `969bf644` then exposed only the unrelated generic timeout
  above; its product code and tracking persistence path were unchanged.
- Behavioral tree `d5727b82` then passed `380/380` unit files and `3,960/3,960`
  tests in `84.33 s`, full ESLint, production build and bundle budgets, changed-
  script Node syntax, `git diff --check`, and backend `58` passed / `1` ignored.
  Two independent exact-tree delta reviews are clean. This is local source
  evidence, not package, lifecycle, platform, or field proof.

## Next Actions

1. Commit and explicitly fast-forward only a final docs-only closure whose
   non-doc blobs exactly match reviewed and tested tree `d5727b82` and whose
   status delta has passed bounded independent review.
2. Package once with `EXPECTED_SOURCE_SHA` set to the new commit, restore the
   generated-version source blob without rebuilding, verify a clean checkout,
   run the sole packaged lifecycle once, and validate exactly one terminal
   success or failure artifact.
3. Stop and report. Browser/visual, physical-kill, Linux CI, and the fresh Ubuntu
   greater-than-2-GiB qualifier remain pending. A lifecycle pass is not merge,
   release, field, or production qualification.

## Blockers

- PR #10 is not ready to merge or release. The replacement exact-head package
  and lifecycle terminal have not yet been produced, and all deferred gates
  remain outstanding.
- The Ubuntu host was previously reachable as `Linux 7.0.0-28-generic x86_64`,
  but no current qualifier has started.

Archived pre-recovery baton:
`handoff/archive/HANDOFF-history-2026-09-04-pre-pr10-recovery.md`.
