# WAR-06 Tracking Lifecycle Investigation

Date: 2026-09-11
Repository: `donal0c/sartracker-web`
Evidence base/current master: `3db57a7942b32beef0d13cc4e8484a5bb492dfa4` (`origin/master`, including merged PR #22)
Evidence implementation commit: `d96e51c85b6ba98642036ab31ed08e1976256bec`
(corrected reachable-route
characterization tests, production bridge and falsifiable negative controls)
Prior executable predecessor: `dc3ea82262a18cd70409ee1d2b547de4fd81a2594`
Prior documentation candidate: `10781e2d74e9a8034591e47a513f0957ccd6e3f7`
Exact executable-head CI: [run 34650688441](https://github.com/donal0c/sartracker-web/actions/runs/34650688441)
passed against `d96e51c85b6ba98642036ab31ed08e1976256bec`; the [PR #20 checks](https://github.com/donal0c/sartracker-web/pull/20/checks)
remain the live cross-check. PR-mode strict timing, 960k replay, packaged
tracking and archive lifecycle steps remain explicit skips and are not release
proof.
Original reviewed PR head: `839737e82a8736be8dea3e7104fdada16398ea31` (review `5175815340`; pre-rebase)
Merged Repair Train A application head: `713461bfa4018f8009e51660618515f78b8e23c0`
Scope: investigation and durable reproduction evidence only

## Outcome

The reviewed PR findings are now covered by three durable, passing
characterizations plus a six-run negative-control proof. `AUD-01` holds a
second real poll on a pending Traccar current-position response while Mission
B finish → idle → start wakes return through the poller's `pollInFlight` path,
then lets the real 100 ms history timer publish. `AUD-02` uses the real
polling manager while its current-fix callback is executing and participant
hydration defers publication; the genuine finish → idle → start wakes are
attempted during that in-flight window. The sibling cache characterization
models a cold start with Mission B already active and reads the single global
cache file. The production mission-status bridge and mission-selected
device boundaries are present in the harness. These tests confirm unsafe
renderer publication behaviour, not a production repair.

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
  -> characterization applySnapshot reads current mission-b
```

Reachable interleaving exercised by the test:

1. Mission A completes an initial poll and leaves the real 100 ms history
   publication timer pending.
2. The harness invokes the poller's wake wrapper to start a second poll; its
   Traccar current-position response remains pending.
3. Mission B becomes active. The production mission-wake subscriber calls
   `requestPollNow`, which reaches the real `pollInFlight` early return and
   defers the replacement poll without resetting the active history key.
4. The real timer fires before the pending poll reaches its stale-key discard,
   and the visible publisher receives Mission A history while Mission B is
   active.

Observed result: the real manager's delayed flush causes Mission A history and
the last-good Mission A current position to appear in the visible snapshot
while `useMissionStore.currentMission.id` is `mission-b`; the same publication
feeds the Mission B stationary-attention projection. This is a reachable
slow-response/operator-transition characterization; it does not claim that
every provider response reaches this ordering in the field.

The downstream persistence path is safer than the visible path: when evidence
is admitted, `persistTrackingSnapshot` checks the expected mission before
writing. That check prevents this reproduction from being silently promoted to
Mission B durable evidence, but it does not prevent wrong current coordinates
or derived stationary attention from being shown to the operator.

Required repair shape (future production work): guard the delayed timer
publication path with the current history-reconciliation identity before
calling `flushHistorySnapshot`; do not add a broad guard that breaks the
legitimate idle-path flush at `polling-manager.ts:977`. The same identity check
must govern retention and stationary projection inputs. A stale callback should
be dropped or replaced by an explicit current-mission state; it must not be
rendered under the new mission. No production repair is included in this PR.

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

The characterization starts a real polling manager and invokes the captured
production `onCurrentSnapshot` callback while the poll is still executing and
scope is loading. The real mission-wake subscriber drives `requestPollNow`,
which returns through the poller's `pollInFlight` branch during finish → idle →
start. The callback is held by the runtime hydration buffer until the
replacement Mission B scope is ready. Observed result:
`mission-a-deferred-fix` and its stationary projection are applied once after
Mission B is active and its participant scope is ready.

This route bypasses the normal poller's stale-response suppression because the
snapshot is held by the runtime-level hydration buffer. The dynamic scope
filter can make the old device look valid for Mission B, while the retained
position context is still explicitly keyed to Mission A. The result
contaminates the visible current marker and the stationary-attention
projection for Mission B in this characterization.

Required repair shape (future production work): the hydration subscriber must
compare the deferred snapshot's mission key with the current mission before
filtering, retention, or publication. A mismatch must discard the deferred
operational snapshot and request a fresh current poll for the active mission.
The fix must preserve the existing behavior that waits for trustworthy
participant scope before exposing or persisting a snapshot. No production
repair is included in this PR.

### WAR-06-CACHE-SIBLING — unkeyed cached snapshot crosses the same boundary

Severity: P1 candidate / confirmed renderer-boundary hazard
Repair owner: same tracking lifecycle/mission-scope repair as
`WAR-06-AUD-01` and `WAR-06-AUD-02`.
Reproduction: `tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts`

The runtime's cold-start cache path reads one global `tracking-cache.json` file
with no mission identity. The test serializes a real cache payload for Mission
A, relaunches the runtime with Mission B already active, and observes the
cached `mission-a-cached-fix` in the visible store. No participant-scope delay
or lifecycle choreography is required.

This characterizes the sibling hazard identified in review `5175815340`: the
cache payload has no mission identity and the runtime reads a single global
file. The scope filter can therefore authorize the old device under the new
mission. This is local runtime evidence only; it does not claim a packaged or
field cache migration result, and no production repair is included in this PR.

Required repair shape (future production work): bind cache data to an explicit
mission context or discard it when the runtime starts with a different active
mission. Preserve the existing fail-visible offline status and participant-
scope gate; do not make the cache silently authoritative for exact mission
evidence.

## Current-head characterization evidence

The evidence tests are intentionally passing characterizations: they assert
unsafe current behaviour so the reproductions are durable without committing a
failing test or a speculative production fix. The corrected executable test
commit is `d96e51c85b6ba98642036ab31ed08e1976256bec`, based on current master
`3db57a7942b32beef0d13cc4e8484a5bb492dfa4`.

| Evidence | Result | Claim boundary |
| --- | --- | --- |
| WAR-06 isolated characterization | 3 tests passed | Real `startTrackingRuntime` plus `startMissionTrackingStatusBridge`; production-derived active-device and breadcrumb-device selection; write-enabled cache configuration; real polling-manager delayed flush after a pending current poll for AUD-01; real polling manager with `pollInFlight` mission wakes plus current-fix callback for AUD-02; cold-start global-cache read for cache sibling; controlled local source evidence |
| WAR-06 negative-control proof | 3 GREEN / 3 RED at named safety oracles | `scripts/assurance/war-06-prove-red.mjs` runs each characterization once normally and once after a test-only visible-publication erase; collection, cleanup and unrelated failures are rejected |
| Existing tracking/reload/runtime/poller suite | 185 tests passed | Rechecked merged Repair Train A and PR22 tracking seams; unit/integration source evidence only |
| Ordinary correctness suite on rebased tree | 435 files / 4,462 tests passed / 6 skipped | `test:correctness` explicitly excludes strict wall-clock qualification; no timing pass is claimed |
| `AUD-13` false-Live reconnect | Not reproduced in focused current-head suite | Does not erase the historical/native limitation or prove packaged/field recovery |
| `AUD-02` stationary route | Existing policy tests pass | Does not prove every clock, device, or field profile |
| `AUD-03` stationary projection | Existing source/performance controls pass in the focused suite | Does not prove the strict `<200 ms` gate at release scale |
| Full source cycle, serial files | 427/428 files and 4,378/4,379 tests passed; the unchanged legacy event-writer hard-gate test observed 240.89 ms under the full suite | Strict `<200 ms` remains binding; the same test passed in isolation and was not changed here |
| Full source cycle, default parallelism | 426/428 files and 4,377/4,379 tests passed; two unchanged archive/event timing assertions observed 264.88 ms and 272.54 ms | Confirms load sensitivity; no timing gate was relaxed or changed here |

Commands run:

```bash
npm test -- tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts --no-file-parallelism
npm test -- tests/unit/assurance/war-06/negative-controls.test.ts --no-file-parallelism
npm test -- tests/unit/tracking-reload-custody.test.ts tests/unit/start-tracking-runtime.test.ts tests/unit/polling-manager.test.ts --no-file-parallelism
npm run test:correctness -- --no-file-parallelism
npm test -- --no-file-parallelism
npm test
npm test -- tests/unit/electron-mission-evidence-versioning.test.ts -t 'keeps current fixes below the hard gate while byte-bounding legacy event writer turns' --no-file-parallelism
npm run lint
npm run build
```

The characterization command passed 3/3 tests. The negative-control command
passed 1/1 test and recorded 3 GREEN current controls plus 3 RED named safety
oracles. The lifecycle command passed 3/3 files and 185/185
tests. The ordinary correctness cycle passed 435 files / 4,462 tests with 6
explicit qualification-only cases skipped; its banner states that strict
wall-clock responsiveness qualification was not run. Lint and production build
passed, including TypeScript/Vite and bundle-size budgets. The historical serial
full source cycle passed 427/428 files and 4,378/4,379
tests; its single failure was the unchanged strict `<200 ms` assertion at
`tests/unit/electron-mission-evidence-versioning.test.ts:1084`, which observed
240.89 ms under full-suite load. The default-parallel full source cycle passed
426/428 files and 4,377/4,379 tests; it failed unchanged timing assertions in
`tests/unit/electron-archive-registry.test.ts:502` (264.88 ms) and
`tests/unit/electron-mission-evidence-versioning.test.ts:1005` (272.54 ms).
The named WAR-06-adjacent timing test passed in isolation (1/1 selected test;
72 tests skipped).

## Escape analysis

Existing gates missed these defects for distinct reasons:

- The polling-manager tests exercised stale history completion guards and the
  idle flush, but did not hold a second current poll in flight while the real
  delayed history timer fired. They therefore did not cover the reachable
  timer-before-reset window.
- Runtime hydration tests covered participant-scope deferral, but the original
  WAR-06 characterization replaced `requestPollNow` with a no-op. That removed
  the production mission-wake path and hid the residual case where a poll is
  already in flight.
- Cache tests covered payload parsing, age and offline status, but not a cold
  relaunch with a different active mission reading the single global cache
  file.
- The first evidence helper omitted the production mission-tracking status
  bridge, hardcoded `['device-1']` instead of reading the active mission's
  selected devices, disabled cache writes while still reading cache, and
  omitted `getBreadcrumbDeviceIds`. All four deltas were conservative in the
  same direction: they made the harness weaker than production. The corrected
  helper now starts/stops the bridge, uses the active-device store for current
  and breadcrumb selection, and runs the cache path with writes enabled.
- Ordinary correctness intentionally excludes the strict wall-clock and
  packaged qualification lanes; neither lane was silently treated as passed.

The corrected characterization preserves the unsafe assertions as evidence. A
future repair must invert them into non-regression guards, retain the reachable
route, and add red/green proof for visible publication, retention, stationary
projection and persistence boundaries.

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
- The four reviewed fidelity deltas were all weaker-than-production and are
  now closed in the helper: `startMissionTrackingStatusBridge` runs alongside
  the tracking runtime; `applyTrackingSnapshot` and breadcrumb selection read
  `getActiveDeviceIds(missionId)`; cache writes are enabled when the cache is
  readable; and `getBreadcrumbDeviceIds` is wired to the same production
  selection store. The bridge's empty non-active snapshot is therefore part of
  every finish → idle edge in all three routes.
- `AUD-01` uses `createPollingManager`, its real 100 ms delayed flush, a
  harness-triggered slow poll, genuine finish → idle → start mission wakes,
  and a controlled pending current response. `AUD-02` uses the real
  poller-to-runtime callback while the poll is still executing, the genuine
  finish → idle → start mission wakes, and the real participant-hydration
  route; it does not claim a second provider call when `pollInFlight` correctly
  coalesces those wakes. The cache sibling starts the runtime with Mission B
  already active and reads the global cache.
- Remaining deltas are explicit and conservative: the provider is synthetic
  and deterministically controlled rather than Traccar over a network; the
  mission controller is a local real-runtime store rather than SQLite/IPC; the
  publication callback calls `applyTrackingSnapshot` directly rather than
  executing the full `startAppRuntime.applySnapshot` wrapper; and cache reads
  are an in-memory adapter rather than an Electron relaunch against the actual
  user-data file. These limits make the harness weaker than production for
  frequency, packaging and integration coverage; they do not add a stronger
  route than production or justify a release claim.
- The negative-control runner deliberately erases the visible publication just
  before each characterization oracle. Each route is GREEN normally and RED at
  its named safety assertion under that control; this proves falsifiability,
  not a production repair.
- The runtime cleanup is fail-safe: every started runtime is registered before
  assertions, `afterEach` resolves retained provider/persistence promises,
  clears fake timers before switching to real timers, stops every active
  runtime while collecting failures, and throws an aggregate cleanup error. A
  failed assertion cannot leave a polling runtime or timer lane running into
  the next test; `describe.sequential` makes the module-level cleanup sets
  explicit and prevents concurrent cross-cancellation.
- No strict `<200 ms` gate was changed or relaxed. The historical unexplained
  224 ms archive run and the remaining DON-254 qualification evidence remain
  outside this investigation.

## Review and provenance reconciliation

The prior independent review `5175815340` examined exact pre-rebase PR head
`839737e82a8736be8dea3e7104fdada16398ea31` with parent/base
`302bdd040976bd370271cf5866549fa2a7e05ff5`. The branch was then rebased onto
current `origin/master` `3db57a7942b32beef0d13cc4e8484a5bb492dfa4`, which includes
merged PR #22. The initial repaired characterization evidence was executable at
`2390b57bb2e2cc549c0069b80013d968d0fb36d3`; the prior cleanup-hardened tree
`dc3ea82262a18cd70409ee1d2b547de4fd81a259` is the executable predecessor.
The corrected executable characterization is `d96e51c8`. Exact executable-head
CI run `34650688441` passed the corrected tree; later documentation-only
commits do not alter the executable evidence.

The stable review IDs are dispositioned as follows: `WAR-06-AUD-01-REACHABILITY`
is addressed by the real manager delayed-flush interleaving;
`WAR-06-AUD-02-LIFECYCLE` by the real finish/idle/start and current-fix callback
route; `WAR-06-CACHE-SIBLING` by the unkeyed cache characterization;
`WAR-06-CLEANUP` by fail-safe runtime teardown; and
`WAR-06-PROVENANCE` by the exact base, executable commit, negative-control
receipt and pushed-head CI record in [review-receipts.md](review-receipts.md).
`WAR-06-COORDINATION` is reconciled in the current handoff, workplan, and
coordinated ledger without changing PR #18's merged truth.

The full-suite timing failures remain unresolved and are retained as a strict
gate. They are not reclassified by these additive tests, and this PR makes no
performance or threshold claim. Earlier reviewer UUIDs are historical
provenance only; the re-derivable local negative-control artifact and exact
head CI record are the current evidence.

Independent final review `5176300059` examined the pre-PR22 executable head
`c4cda818`; that review and CI `34575023706` are historical evidence only.
The current executable candidate is `d96e51c8`. The receipt file records the
bounded, re-derivable negative-control artifact and CI run `34650688441` on
that exact executable head; the live [PR checks](https://github.com/donal0c/sartracker-web/pull/20/checks)
remain the external cross-check. The PR-mode skipped timing, replay, packaged
tracking and archive steps remain explicit evidence gaps, not release
qualification.

## Next action

Treat `WAR-06-AUD-01`, `WAR-06-AUD-02`, and `WAR-06-CACHE-SIBLING` as one
lifecycle repair boundary. The rebased PR remains investigation-only and is
not a production repair, release qualification, or operational-use
recommendation: the P1 candidate hazards remain unrepaired and the strict
`<200 ms` failures remain unresolved. Exact executable-head ordinary CI is
recorded in the in-repo receipt; the remaining documentation-only delta does
not change executable evidence. It is merge-ready only as additive
investigation evidence for Donal's review; it is not a production repair or
release qualification. Do not close the findings or claim release/field safety
from this investigation PR.
