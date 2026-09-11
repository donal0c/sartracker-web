# WAR-06 Tracking Lifecycle Investigation

Date: 2026-09-11
Repository: `donal0c/sartracker-web`
Evidence base/current master: `49b2e1d416ca2fa4ff98cfae31c4d947bc4b0a6e` (`origin/master`, including merged PR #18)
Evidence implementation commit: `5ddeb6fd81761b0eea67e24403c7ded1c6aa012f` (rebased WAR-06 test evidence)
Original reviewed PR head: `839737e82a8736be8dea3e7104fdada16398ea31` (review `5175815340`; pre-rebase)
Merged Repair Train A application head: `713461bfa4018f8009e51660618515f78b8e23c0`
Scope: investigation and durable reproduction evidence only

## Outcome

The reviewed PR findings are now covered by three durable, passing
characterizations. `AUD-01` drives the real polling manager through its
100 ms delayed history flush while the mission changes; `AUD-02` drives the
real mission controller through finish → idle → start and then resumes the
runtime's current-fix callback after participant hydration; and the sibling
cache characterization proves that the unkeyed cached snapshot can cross the
same lifecycle boundary. These tests confirm unsafe renderer publication
behaviour, not a production repair.

The branch remains investigation-only. No production, schema, workflow,
release, deployment, or operator-manual behaviour was changed. The report and
shared coordination records were updated only to bind the evidence, current
base, ownership, and remaining gates.

The existing Repair Train A controls remain green. This audit did not reproduce
AUD-13's stopped-polling/false-Live behavior, AUD-02's out-and-back stationary
false positive, or AUD-03's broad stationary-history rescan in the current
focused source suite.

## Safety invariants used

- A current position is mission-scoped before it is applied to the visible
  tracking store. A callback's captured mission key is not sufficient if the
  active mission may have changed.
- Current positions remain the highest-priority operational surface, but an
  older mission's current position must never satisfy that priority for the
  new mission (`SAR-QA-002`, `SAR-QA-008`, `SAR-FIELD-002`).
- A stale operational snapshot must not mutate operational-position retention
  or the stationary-attention projection for the new mission.
- Canonical Traccar `fixTime` remains the only exact evidence clock. A valid
  `fixTime` does not authorize a snapshot to cross a mission boundary.
- Persistence must remain fail-closed: stale callbacks must not write into the
  new mission, and the existing expected-mission persistence check must remain.
- Outing and replay state are mission data state, not a permission to reuse a
  stale live snapshot. Finalized evidence remains immutable/read-only.

## Confirmed findings

### WAR-06-AUD-01 — real delayed history flush crosses the active mission boundary

Severity: P1 candidate / confirmed renderer-boundary hazard
Repair owner: tracking lifecycle/mission-scope repair, coordinated with
`DON-267`; candidate for the next tracking repair train.
Reproduction: `tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts`

Call path on the current head:

```text
stale onSnapshot(snapshot, { historyResetKey: mission-a })
  -> filterOperationalSnapshot(..., contextKey = mission-a)
  -> publishOperationalSnapshot(snapshot)
  -> dependencies.applySnapshot(snapshot)
  -> startAppRuntime.applySnapshot reads current mission-b
```

Deterministic interleaving exercised by the test:

1. Mission A starts and the real `createPollingManager` begins its initial
   history reconciliation. A controlled second persistence promise keeps the
   manager in the same initial poll while its real 100 ms delayed flush is
   pending.
2. The injected timer wrapper changes the active mission to Mission B
   immediately after the manager's delayed flush callback schedules its
   publication microtask, before that microtask is delivered.
3. The runtime filters the callback against the currently-ready participant
   scope, but does not require `historyResetKey: mission-a` to equal the active
   mission.
4. The visible publisher receives the Mission A breadcrumb while Mission B is
   active.

Observed result: the real manager's delayed flush causes `mission-a-history`
to appear in the visible snapshot while `useMissionStore.currentMission.id`
is `mission-b`. This is a valid event-loop interleaving characterization; it
does not claim that every provider response reaches this ordering in the field.

The downstream persistence path is safer than the visible path: when evidence
is admitted, `persistTrackingSnapshot` checks the expected mission before
writing. That check prevents this reproduction from being silently promoted to
Mission B durable evidence, but it does not prevent wrong current coordinates
or derived stationary attention from being shown to the operator.

Required repair shape (future production work): revalidate the operational
mission identity immediately before the final visible publication, and make the
same identity check govern retention and stationary projection inputs. A stale
callback should be dropped or replaced by an explicit current-mission state; it
must not be rendered under the new mission. No production repair is included in
this PR.

### WAR-06-AUD-02 — deferred participant-hydration snapshot crosses the mission boundary

Severity: P1 candidate / confirmed renderer-boundary hazard
Repair owner: same tracking lifecycle/mission-scope repair as
`WAR-06-AUD-01`.
Reproduction: `tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts`

Call path on the current head:

```text
onSnapshot(snapshot-A, context mission-a)
  -> participant scope is loading
  -> deferredOperationalSnapshot = { snapshot-A, historyResetKey: mission-a }
  -> active mission changes to mission-b
  -> participant scope becomes ready
  -> subscribeParticipationScope callback
  -> filterOperationalSnapshot(snapshot-A, contextKey = mission-a)
  -> dependencies.applySnapshot(snapshot-A)
```

The characterization drives `startMissionRuntime` through a real
finish → idle → start transition, then invokes the captured runtime
`onCurrentSnapshot` callback while scope is loading. The callback is held by the
runtime hydration buffer until the replacement Mission B scope is ready.
Observed result: `mission-a-deferred-fix` is applied once after Mission B is
active and its participant scope is ready.

This route bypasses the normal poller's stale-response suppression because the
snapshot is held by the runtime-level hydration buffer. The dynamic scope
filter can make the old device look valid for Mission B, while the retained
position context is still explicitly keyed to Mission A. The result can
contaminate the visible current marker and the stationary-attention projection
for Mission B.

Required repair shape (future production work): the hydration subscriber must
compare the deferred
snapshot's mission key with the current mission before filtering, retention, or
publication. A mismatch must discard the deferred operational snapshot and
request a fresh current poll for the active mission. The fix must preserve the
existing behavior that waits for trustworthy participant scope before exposing
or persisting a snapshot. No production repair is included in this PR.

### WAR-06-CACHE-SIBLING — unkeyed cached snapshot crosses the same boundary

Severity: P1 candidate / confirmed renderer-boundary hazard
Repair owner: same tracking lifecycle/mission-scope repair as
`WAR-06-AUD-01` and `WAR-06-AUD-02`.
Reproduction: `tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts`

The runtime's cold-start cache path stores a deferred snapshot with
`historyResetKey: null` when participant scope is loading. The test serializes a
real cache payload for Mission A, starts with scope unresolved, drives the real
mission controller through finish → idle → start, then marks Mission B's scope
ready. Hydration applies the cached `mission-a-cached-fix` to the visible store
while Mission B is current.

This characterizes the sibling hazard identified in review `5175815340`: the
cache payload has no mission identity and the deferred runtime record is
unkeyed. The scope filter can therefore authorize the old device under the new
mission. This is local runtime evidence only; it does not claim a packaged or
field cache migration result, and no production repair is included in this PR.

Required repair shape (future production work): bind cache data to an explicit
mission context or discard it at a mission transition before hydration. Preserve
the existing fail-visible offline status and participant-scope gate; do not make
the cache silently authoritative for exact mission evidence.

## Current-head characterization evidence

The evidence tests are intentionally passing characterizations: they assert
unsafe current behaviour so the reproductions are durable without committing a
failing test or a speculative production fix. The exact executable test commit
is `5ddeb6fd81761b0eea67e24403c7ded1c6aa012f`, rebased onto current master
`49b2e1d416ca2fa4ff98cfae31c4d947bc4b0a6e`.

| Evidence | Result | Claim boundary |
| --- | --- | --- |
| WAR-06 isolated characterization | 3 tests passed | Real `startTrackingRuntime`; real polling-manager delayed flush for AUD-01; real mission-controller finish/idle/start plus current-fix callback for AUD-02 and cache sibling; controlled local source evidence |
| Existing tracking/reload custody suite | 179 tests passed | Rechecked merged Repair Train A seams; unit/integration source evidence only |
| `AUD-13` false-Live reconnect | Not reproduced in focused current-head suite | Does not erase the historical/native limitation or prove packaged/field recovery |
| `AUD-02` stationary route | Existing policy tests pass | Does not prove every clock, device, or field profile |
| `AUD-03` stationary projection | Existing source/performance controls pass in the focused suite | Does not prove the strict `<200 ms` gate at release scale |
| Full source cycle, serial files | 427/428 files and 4,378/4,379 tests passed; the unchanged legacy event-writer hard-gate test observed 240.89 ms under the full suite | Strict `<200 ms` remains binding; the same test passed in isolation and was not changed here |
| Full source cycle, default parallelism | 426/428 files and 4,377/4,379 tests passed; two unchanged archive/event timing assertions observed 264.88 ms and 272.54 ms | Confirms load sensitivity; no timing gate was relaxed or changed here |

Commands run:

```bash
npm test -- tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts --no-file-parallelism
npm test -- tests/unit/tracking-reload-custody.test.ts tests/unit/start-tracking-runtime.test.ts tests/unit/polling-manager.test.ts --no-file-parallelism
npm test -- --no-file-parallelism
npm test
npm test -- tests/unit/electron-mission-evidence-versioning.test.ts -t 'keeps current fixes below the hard gate while byte-bounding legacy event writer turns' --no-file-parallelism
```

The first command passed 3/3 tests. The second passed 3/3 files and 179/179
tests. The serial full source cycle passed 427/428 files and 4,378/4,379
tests; its single failure was the unchanged strict `<200 ms` assertion at
`tests/unit/electron-mission-evidence-versioning.test.ts:1082`, which observed
240.89 ms under full-suite load. The default-parallel full source cycle passed
426/428 files and 4,377/4,379 tests; it failed unchanged timing assertions in
`tests/unit/electron-archive-registry.test.ts:500` (264.88 ms) and
`tests/unit/electron-mission-evidence-versioning.test.ts:1003` (272.54 ms).
The named WAR-06-adjacent timing test passed in isolation (1/1 selected test;
72 tests skipped).

## Adjacent lifecycle audit

### Current positions and transport replacement

Repair Train A's selected-transport generation and retiring-transport custody
controls were rechecked by the focused suite. Old transport callbacks are
suppressed for operational publication, accepted evidence retains settlement
rights, and failed stop cleanup is retryable. No new AUD-13 reappearance was
observed. The new WAR-06 findings are a different seam: runtime-level mission
identity is not revalidated at the final visible publication boundary.

### Stationary attention

The repaired policy keeps a continuous episode through an isolated noise return,
requires a second outside fix to confirm movement, accounts for reported
accuracy, and preserves acknowledgement across noise. The current projector
and store tests pass. However, because a stale current snapshot can reach
`applyTrackingSnapshot` with the new mission id, the WAR-06 lifecycle defect can
feed an old fix into the new mission's derived stationary projection. This is a
consequence of the confirmed lifecycle findings, not a new stationary-policy
finding.

One unresolved hypothesis remains: `stationary-attention.ts` accepts any
finite `timestamp`, including a live device/server-time fallback marked
`fix_time_unverified`. The team answer explicitly permits such a current
location to remain visible while excluding it from exact evidence, but does not
explicitly decide whether it may drive stationary attention. Treat this as an
open product/safety decision, not as confirmed evidence for this PR.

### `fixTime`, persistence, and source immutability

The current normalization and evidence filter retain the source timestamp
provenance, keep unverified current locations visible only on the operational
path, and exclude non-`fixTime` rows from exact mission evidence. The Electron
store conflict controls preserve the first accepted source fix and record a
same-identity content conflict rather than overwriting it. These controls were
not changed and are not weakened by the WAR-06 test.

The remaining risk is scope, not source identity: a canonical fix from the
wrong mission can be shown before persistence rejects its mission mismatch.

### Outings and replay

Outing refresh uses mission generations and cancels stale fix-summary requests;
the schedule classifies half-open, non-overlapping outing windows. Mission
Review replay uses replay tokens, request identities, cancellable reads and
replay generations for paged continuation. The focused audit found no new
deterministic outing/replay overwrite in these paths. The WAR-06 defect is in
live current-position publication and must be repaired before relying on a
later replay/archive qualification as evidence of live safety.

### Evidence immutability and finalization

The investigation did not mutate stored evidence, finalize or unlock a mission,
create an archive, or run cleanup. Existing source tests cover immutable source
identity conflicts, replay generation invalidation and finalized read-only
boundaries. Those are separate proof tiers from the live mission-scope defect.

## Harness and proof limits

- The new reproductions are deterministic real-runtime unit evidence, not a
  packaged Electron, CI, multi-machine, soak, field, or release qualification.
- `AUD-01` uses `createPollingManager` and its real 100 ms delayed flush, with a
  controlled persistence promise and timer interleaving. `AUD-02` and the cache
  sibling use the real mission controller and runtime callback/hydration route.
  Controlled delivery proves the missing guard and its consequence, not the
  frequency of the race in field conditions.
- The runtime cleanup is fail-safe: every started runtime is registered before
  assertions, `afterEach` resolves retained provider/persistence promises,
  stops every active runtime while collecting failures, restores fake timers,
  and throws an aggregate cleanup error. A failed assertion cannot leave a
  polling runtime or timer lane running into the next test.
- No strict `<200 ms` gate was changed or relaxed. The historical unexplained
  224 ms archive run and the remaining DON-254 qualification evidence remain
  outside this investigation.

## Review and provenance reconciliation

Independent review `5175815340` examined exact pre-rebase PR head
`839737e82a8736be8dea3e7104fdada16398ea31` with parent/base
`302bdd040976bd370271cf5866549fa2a7e05ff5`. The branch was then rebased onto
current `origin/master` `49b2e1d416ca2fa4ff98cfae31c4d947bc4b0a6e`, which includes
merged PR #18. The repaired characterization evidence is executable at
`5ddeb6fd81761b0eea67e24403c7ded1c6aa012f`; any later documentation commit is a
different final PR head and must be checked by exact SHA before approval.

The stable review IDs are dispositioned as follows: `WAR-06-AUD-01-REACHABILITY`
is addressed by the real manager delayed-flush interleaving;
`WAR-06-AUD-02-LIFECYCLE` by the real finish/idle/start and current-fix callback
route; `WAR-06-CACHE-SIBLING` by the unkeyed cache characterization;
`WAR-06-CLEANUP` by fail-safe runtime teardown; and
`WAR-06-PROVENANCE` by the exact base, reviewed head, and rebased evidence
commit above. `WAR-06-COORDINATION` is reconciled in the current handoff,
workplan, and coordinated ledger without changing PR #18's merged truth.

The full-suite timing failures remain unresolved and are retained as a strict
gate. They are not reclassified by these additive tests, and this PR makes no
performance or threshold claim.

Independent final review `5176300059` examined executable head `c4cda818` and
returned clean after identifying one coordination-only contradiction: live
Linear `DON-254` had drifted to Done while its latest qualification comment,
PRs #19/#21, and the handoff retained open qualification work. The issue is now
back to **In Progress**, with a dated explanatory comment. Exact-head Linux CI
`34575023706` also passed the executable tree. These are engineering/evidence
checks only and do not close the qualification issue.

## Next action

Treat `WAR-06-AUD-01`, `WAR-06-AUD-02`, and `WAR-06-CACHE-SIBLING` as one
lifecycle repair boundary. Following the status correction, PR #20 is
**merge-ready as additive investigation evidence for Donal's review**, but it
is not a production repair, release qualification, or operational-use
recommendation: the P1 candidate hazards remain unrepaired and the strict
`<200 ms` failures remain unresolved. The independent Luna review is clean;
obtain the required Astra retrace before any production identity guard is
implemented, then run current-position, stationary, persistence, browser,
packaged, and exact-head review gates. Do not close the findings or claim
release/field safety from this investigation PR.
