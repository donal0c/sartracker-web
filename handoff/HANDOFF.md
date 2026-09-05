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
- **Exact recovery head `49523dc8b460a2080c5fbbd3bc11c961296f481d` is
  rejected.** Linux run `33908771732` passed through packaged tracking soak,
  then the archive lifecycle failed `current_fix_continuity_gate_breached`.
  A faithful macOS package reproduced a second generic
  `current_fix_not_observed_before_gate` failure. The runner wrote no failure
  receipt, so those labels did not identify a phase or prove a product stall.
- **Exact local head `81e47973714ff5cbbd908329559009c281b352fe` is also
  rejected.** Its clean macOS package emitted the new 0600 failure receipt and
  stopped in `create` before any archive operation (`operationCount: 0`) on
  `renderer_frame_sample_invalid`. The first queued animation-frame timestamp
  predated the `performance.now()` phase arm. The narrow red-first repair uses
  one clock for both endpoints and distinguishes a repeated primary probe fault
  from a genuinely new stop failure. It also settles the external watchdog and
  releases launch ownership before propagating that fresh stop failure; the
  strict `<200 ms` gate is unchanged.
- **Exact local head `74bdd95ca3bbd09f775ba111d53f6313e76769d6` is
  rejected.** Its clean package produced one exact create sample with every gap
  below 34 ms, then failed `source_identity_left_pending_at_operation_start`
  before an archive operation began. Continuous polling emitted a source fix
  between the non-atomic renderer and source ledger cuts. That normal in-flight
  join state must remain under its original 200 ms expiry and must not count as
  operation-fresh. The receipt also counted a secondary teardown expiry without
  identifying it; bounded sanitized cleanup attribution is required.
- **Exact local head `6a72ae91720b0ce65a9274c2c462dcad484587f5` is
  rejected.** Its exact package passed, then its one lifecycle attempt wrote a
  complete 0600 failure receipt. One source emitted 45 ms before operation start
  expired at 213 ms even though 17 later operation-fresh/19 total exact create
  identities reached MapLibre; maxima were 54 ms continuity, 4 ms source/request
  latency, 50.366 ms main, and 10.7 ms renderer frame. This is a latest-state
  proof-model false negative, not product or host stall evidence: Zustand/React
  may legitimately supersede an intermediate HTTP snapshot before MapLibre.
  Exact successor acknowledgements now retire only older snapshots still below
  their original deadline; no acknowledgement, invalid/late acknowledgement,
  or sequence regression remains fail-closed at the unchanged `>=200 ms` gate.
- **Exact local head `2316130047fb1c69e966ac58956b1abc0b6a5792` is
  rejected.** Its exact package passed, then its one lifecycle attempt wrote the
  sole 0600 terminal artifact: a failure receipt with SHA-256
  `36795e1f7512b982015f90c9b292f1f7b3445d6069dfc1ba474854f4a5fc3c31`.
  Restore recorded 38 exact MapLibre samples and a 216 ms continuity trigger,
  with 13 ms source/request latency, 153.65 ms main, and 16.9 ms renderer-frame
  maxima; process/profile cleanup completed with no secondary failure. The
  receipt is harness-indeterminate, not admissible product-stall proof: the main
  watchdog could audit a stale externally drained renderer watermark while a
  timely fix was already stamped in the renderer. Separately, source retrace
  confirmed a real cadence risk: successful polling waited for durable snapshot
  settlement and then added the full 50 ms validation interval.
- **Exact pushed head `d91ec23252afa118cc6323ed840554bb109043b2` is
  rejected for final qualification.** Its exact macOS package and sole macOS
  packaged lifecycle attempt passed, bound to tree `560b3dc6…`, ASAR
  `cdd430e0…`, and a
  0600 report with SHA-256 `beefb7fb…`; all phase liveness maxima were strictly
  below 200 ms. Chromium `173/173`, visual Playwright `62/62`, and the fresh
  uncached visual review `74/74` also passed. The physical kill matrix then
  failed with no report. Diagnostic subsets isolated `create.seal`: ciphertext,
  registry digest/size/file identity, operation ID, and cleanup gate were intact,
  but the parent oracle searched the public archive projection for the private
  `creation_operation_id` field that projection deliberately omits. The resulting
  baseline-custody failure is a harness false negative, not archive loss. A real-
  process red regression now requires authoritative operation-bound rediscovery.
  Exact-head Linux run `33935825755` passed lint, units, build, artifact
  inspection, replay, llvmpipe, and packaged tracking soak, then wrote a
  cleanup-complete archive-lifecycle failure receipt before any archive
  operation. The readiness predicate had accepted the participant list's single
  empty-state paragraph as one hydrated participant. A mock fix was therefore
  attributed to `create` while the application correctly withheld it from
  MapLibre during participant-scope loading. The successor requires the exact
  active device in both the public participant store and a rendered
  `.sar-readout` before arming liveness, including after restart. Each readiness
  IPC read is bounded by the remaining monotonic readiness budget so a wedged
  renderer fails into terminal cleanup and receipt publication.
- **Exact pushed head `7e0d8ea3407aeecd298fd25cc16130c132ae9dc8` is
  rejected for final qualification.** Its exact macOS arm64 package and sole
  packaged lifecycle attempt passed: tree `a036132e…`, ASAR `76f311ef…`, 0600
  lifecycle report SHA-256 `23112d9d…`, two launches, 5,516 cleaned rows, zero
  secret/plaintext residue, and every phase maximum strictly below 200 ms.
  Chromium passed `173/173`, visual Playwright `62/62`, fresh uncached visual
  review `74/74`, and the exact physical SIGKILL matrix qualified `32/32` with
  report SHA-256 `fea482fc…`. Linux run `33938682590` was deliberately cancelled
  after final review found an accepted P2 and is not evidence. Broad and
  concurrency reviews were clean; persistence found same-name mission recovery
  was not bound to the original UUID, and renderer review found rendered
  participant readiness was not bound to device identity and sealed archive
  presence did not prove operator recovery readiness. Those three findings are
  repaired red-first in the current successor. The archive oracle now reuses
  the production IPC projector, requires exact v2 passphrase/recovery slots and
  sealed/verified recovery semantics, derives Review inputs from that projection,
  and includes the projector in its five-file evidence-identity manifest.
- **The recovery cause is understood.** The field fixture retained roughly 9.7
  million high-volume telemetry `mission_events`, and archive paths repeatedly
  scanned mission history for finalization and acknowledgement state. The old
  sub-millisecond “current position” measurement was only an in-process map
  operation and did not prove the packaged renderer path.
- **Successor source work is locally green but not frozen.**
  It uses deterministic current-finalization lookups, lazy evidence-loss
  acknowledgement lookup with a durable
  projection, mission-scoped logical cleanup with a restart-safe rowid cursor
  and telemetry-only `mission_events` deletion, constant-space diagnostics, and
  a packaged Electron external watchdog that correlates exact synthetic Traccar
  fixes through main/preload, React, and the MapLibre source. Every liveness
  dimension is a strict `<200 ms` gate; ledger overflow and missing continuity
  fail closed. The liveness repair now starts after instrumentation is armed,
  preserves exact-fix, main, and renderer continuity across phase handoffs,
  drains the final operation ledger, ends before unrelated terminal closeout,
  pauses renderer attribution before teardown, keeps profiles when an owned
  process may survive, and enforces one atomic sanitized terminal artifact. A
  valid repeated-correction lineage now remains live after re-finalization and
  ordinary Admin Unlock. Its deterministic archive-owned unlock IDs and linked
  rowid/time proofs require only existing unique-id and rowid point reads: no
  startup index, migration, history scan, or sort was added. Causal source-
  sequence fences now separate global continuous-poll evidence from finite
  operation-fresh evidence, and renderer drain/correlation is serialized across
  explicit and watchdog collection without extending the strict 200 ms duty.
  Exact renderer sequence acknowledgements model the latest-state UI boundary:
  they may supersede older pending snapshots only before the older original
  deadline, cannot refresh a deadline, cannot satisfy a different operation,
  and fail closed if they regress within or across drains.
  The current successor subtracts already-spent durable-settlement time from the
  next successful poll interval without overlapping polls or releasing mission
  evidence early. Current-fix absence is audited only through a serialized
  renderer collection's request-start watermark; independent main ticks still
  enforce the main gate but cannot overtake a renderer observation. The strict
  `>=200 ms` current-fix and source deadlines remain unchanged.
  Queue acquisition and CDP work each retain their own strict bound; late timed-
  out drains are poisoned and cannot commit stale evidence. Exact phase handoff
  partitions fixes at one renderer-owned watermark and operation segments carry
  immutable lower/upper bounds. Pause owns pre-mutation and post-mutation drains,
  freezes the original continuity bound, and resumes that partial state during
  cleanup retry without crediting a post-pause fix. Genuinely new renderer or
  cleanup failures carry bounded, sanitized attribution, while nullish/hostile
  failure shapes remain terminal and cannot suppress the receipt. The physical-
  kill oracle now uses private operation identity only to correlate the recovered
  archive ID, then requires that ID exactly once in a fresh public projection and
  revalidates UUID, mission, and creation-operation identity in the final post-
  close custody snapshot. Restart readiness also binds the original mission UUID
  and requires one exact device identity in both durable participant state and
  the rendered row. Public archive readiness is projected through the same pure
  CommonJS boundary as renderer IPC and fails closed unless the exact v2 archive
  is presently recoverable with unique passphrase and recovery slots.

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

- Freeze and commit the red-first liveness-accounting, failure-receipt,
  correction-lineage, and kill-oracle repair on the existing PR branch.
- Rerun package/lifecycle first on that exact clean head, then full static,
  browser, visual, physical SIGKILL, and Linux gates. Never rerun unchanged
  rejected heads `49523dc8`, `81e47973`, `74bdd95`, `6a72ae91`, `23161300`, or
  `d91ec232` or `7e0d8ea3`.
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

- Current successor-focused verification is green at `4` files / `97` tests,
  and the fresh full serial suite is green at `375` files / `3,770` tests. The
  accepted mission-ID, rendered-device, public archive recoverability, and
  harness-identity findings have red-to-green gates and clean bounded re-audits.
- Full ESLint, TypeScript/production build and bundle budgets, focused Node
  syntax, diff checks, and the backend (`58` passed / `1` platform-specific
  ignored) are green. These are pre-freeze dirty-tree checks, not exact-head
  package proof.
- The `create.seal`, public-projection, final-operation, and participant-
  readiness and wedged-readiness regressions are red-to-green on the dirty
  successor.
- Chromium `173/173`, visual Playwright `62/62`, uncached visual review `74/74`,
  and physical SIGKILL `32/32` are clean at rejected head `7e0d8ea3` and are now
  prior-head evidence. Exact-head package/lifecycle,
  physical SIGKILL, Linux, four-review, and fresh field gates remain pending.

## Next Actions

1. Finish the successor verification, freeze it locally, and run exact-head
   package/lifecycle.
   If it is green, push the existing PR branch and run browser/visual,
   kill-matrix, Linux, and exactly four final-head review charters.
2. If all remain clean, execute the single fresh Ubuntu field qualification and
   record the final ledger externally in PR #10 and the three Linear issues.

## Blockers

- PR #10 is not ready. `caf9e5e8`, `49523dc8`, `81e47973`, `74bdd95`,
  `6a72ae91`, `23161300`, `d91ec232`, and `7e0d8ea3` are rejected diagnostics;
  the replacement exact-head package/lifecycle gate must pass before Linux or
  field-scale qualification.

Archived pre-recovery baton: `handoff/archive/HANDOFF-history-2026-09-04-pre-pr10-recovery.md`.
