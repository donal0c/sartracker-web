# Train A external-review remediation

Donal supplied the [unaltered review](repair-train-a-external-review-20260910.txt)
against PR #17 head `2da06afa124c9041375b7b6ebb12feb8e7adf5f0` and explicitly
authorized repair and revalidation. The PR returned to draft. The earlier
readiness conclusion is withdrawn: passing tests and four review lanes missed
real failure-path and elapsed-duration defects. DON-267/DON-269 remain the
existing owners; DON-254 retains qualification. No merge/release is authorized.

## Decisions and failure boundaries

Cleanup attempts independent resources even after a failure, but failed producer
shutdown is **not** evidence that no more observations can arrive. Accepted
queue/cache work drains while admission, the mission settler, rejection delivery
and persistence generation remain available for the producer's retry. Only
successful producer cessation and durable drain permit those boundaries to close.
Successful cleanup steps do not repeat; concurrent callers share one attempt,
and failed steps can retry. Original startup errors remain attached to any
additional cleanup error.

Stationary corroboration remains derived presentation, never an edit to source
fixes. One outside fix becomes pending; elapsed time remains at the last
confirmed stationary fix. A return inside the old accuracy-aware bounds retains
the original episode and acknowledgement. A second outside fix confirms departure
and starts a new episode, still considering both anchor and successive movement.
SAR-QA-016's approximately twenty-minute rule and all configured thresholds stay
unchanged. Prepared and full evaluation share the same fold and pending state.

No persistence schema, coordinate transform, WAR-02A harness or timing threshold
changed. Retained current positions reset when the Traccar base URL changes;
provider-local device IDs cannot carry current positions into another server.

## Complete review disposition

| Report item | Disposition and regression |
| --- | --- |
| Blocker 1: retirement failure skips accepted fixes/cache at stop | **A-R10 accepted.** Cache-held red showed stop rejected before the write settled. Cleanup now drains accepted work despite a stop failure, retries failed retirement, and preserves admission if a producer still owns work. Actual polling-manager stop rejections also become retryable. |
| Blocker 2: failed tracking disposal skips remaining app cleanup; startup error replaced | **A-R11 accepted.** Red showed core cleanup was never called. Ordered cleanup attempts independent resources, retains the original startup error as cause/first aggregate member, and retries only unsettled steps. Held-reconfigure disposal and additional startup-cleanup failure tests cover the missing paths. |
| Blocker 3: pause abort becomes offline/backoff | **A-R12 accepted.** Real capacity reservation red emitted offline/failure diagnostics on pause. An aborted admission now exits as lifecycle cancellation and schedules the new mode without recording a provider failure. |
| Blocker 4: production rejection implementation missing; all stop-time rejections vanish | **Production premise disproved.** `electron/mission-store.cjs` implements `recordIngestRejections`; main/preload expose the IPC method and the Electron adapter returns that bridge. Retired responses use evidence-only recording without changing selected warnings. Existing real packaged warning/SQLite proof is repeated on the new application. Optional legacy adapters without recording are not claimed to provide the Electron durable-evidence contract. |
| Blocker 5: ordinary noise resets elapsed/acknowledgement | **A-R15 accepted for isolated unconfirmed deviation/return.** Exact 180-minute elapsed truth, pending-fix 80-minute duration and retained acknowledgement are covered in policy/store/browser tests. The UI keeps its acknowledged label alongside the uncorroborated-fix qualifier. |
| Blocker 5 table: arbitrary ±25 m scatter at accuracy 10 m; indefinite 12 m/20 min creep | **Not accepted as ground-truth oracles.** The first exceeds the configured 20 m envelope; the second accumulates meaningful movement. Master duration alone is not authority. Corroboration is repaired, but no wider statistical-noise policy or claim of indefinite stationarity was invented. Out-and-back and cumulative slow-walk regressions remain required. |
| Reservations do not protect against enqueues | **A-R14 accepted.** Red proved an unreserved payload could steal the slot. Enqueue counts remaining reservations; a producer converts its reservation immediately before synchronous admission with no await in between. Existing real queue/poller saturation controls retain every reserved source fix. Unreserved overflow remains explicitly loss-marked. |
| Server replacement retains old current positions under colliding IDs | **A-R16 accepted.** Red reproduced an old server fix after an empty successful replacement response. Provider URL replacement resets the operational retention map; same-provider retained-current behavior still passes. |
| Retirement error banner never clears | **Covered by A-R10.** Failed transports remain owned; a later Reconnect or shutdown retries them. The banner clears only when the failed transport actually settles, not merely when a new connection succeeds. |
| Throwing reconfigure silently stops autosave | **A-R13 accepted.** Red proved the previous autosave stopped. With a retained tracking session, old auxiliary services remain available until replacement succeeds; failed partial replacement stops only its new autosave. Explicit sync still reaches the old controller. |
| Last known precedes Stale | **Intentional dimensions, documented.** Last known describes connection freshness; stale age flags and filtering remain intact. No cosmetic priority change was needed. |
| Missing Unknown / EVIDENCE UNSETTLED manual text | **Fixed.** Manual now explains both visible states, retry semantics, preserved autosave and corroboration/acknowledgement behavior. |
| PR proof-input wording too broad | **Clarified.** Normal CI inputs and the separately changed standalone probe are named separately. The current application change requires new source/package/CI evidence; old green receipts are historical only. |

## Additional findings caught during this repair

- **A-R17:** attempting every cleanup step could prematurely seal custody after
  a failed producer stop. A held-response test now proves the first stop rejects
  without unregistering the settler; the later source is accepted and persisted,
  then a successful retry seals ownership. App rejection delivery follows the
  same dependency rule. Independent UI cleanup can still run.
- **A-R18:** deferring retirement stop by one microtask reopened the old-warning
  race. An independent real-runtime/real-poller probe found the race at one
  controlled response offset. Immediate stop invocation is restored with
  synchronous-throw capture; a durable sixteen-offset regression covers it.
  The real poller marks stopping before any potentially throwing history flush.
- **A-R19:** rejection delivery's own memoized failed disposal prevented retry
  after storage recovered. Its existing failed-loss-marker test now requires
  successful retry after the durable store becomes available; red/green retained.

## Escape analysis

The earlier policy tests checked attention presence and prepared/full equivalence,
but not elapsed time against an independently specified noisy stationary episode.
An optimized implementation can match the full implementation while both are wrong.
Shutdown tests covered healthy drains, not failed producer cessation, cleanup
failure, failed reconfiguration or retry after a durable-marker failure. Review
also failed to distinguish independent resource cleanup from dependent custody
closure. The new tests assert those boundaries, exact duration and acknowledgement.

## Verification status

Focused runtime/queue/rejection/policy tests pass; three browser flows pass,
including acknowledged 180-minute noise-return. The updated real Chromium
100×5,000 incremental probe passes all five samples with maximum **78.5 ms**,
both clocks and post-operation callbacks checked; fixture creation and initial
projection remain excluded. This is synthetic incremental renderer proof.

Full stable source passes **417 files / 4,299 tests**; lint and the production
build/bundle budgets pass. The rebuilt unsigned macOS arm64 package passes real
Settings Save Connect / Devices Reconnect with overlapping held responses:
replacement renders in **39 ms before old release**, Last known/Unknown is
visible while reconnecting, the old fix reaches SQLite, selected rejection
warning remains visible, six rejection records are retained, and two subsequent
polls resume automatically. Evidence health is healthy with zero pending,
corrupt or conflicting observations. Screenshots were inspected. The synthetic
provider's unavailable map tiles are outside this tracking proof.

[Curated receipts](../../evidence/repair-train-a/remediation/) include source,
browser, renderer, native and red regressions. The local source binding records
26 source/test/probe blobs and the ASAR hash; the precommit package displays its
parent SHA, so that label alone is not claimed as final-source identity.

Final exact-head reviews and Linux CI are still pending at this checkpoint.
The old soak's 466.7 ms renderer / 204.68 ms
external-action observations remain under DON-254, with no causal-fix claim.
