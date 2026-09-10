# WAR-06 Tracking Lifecycle Investigation

Date: 2026-09-10
Repository: `donal0c/sartracker-web`
Investigation head: `302bdd040976bd370271cf5866549fa2a7e05ff5` (`origin/master`)
Merged Repair Train A application head: `713461bfa4018f8009e51660618515f78b8e23c0`
Scope: investigation and durable reproduction evidence only

## Outcome

The current head has two deterministic P1 lifecycle defects at the renderer
publication boundary. A tracking snapshot carrying an older mission identity
can reach the visible current-position snapshot after the active mission has
changed. One route is a direct stale history publication; the other is a
snapshot deferred while participant scope hydrates and replayed after the
mission changes.

Both defects are reproduced by the isolated WAR-06 characterization test. No
production, schema, workflow, release, deployment, or shared coordination
record was changed by this investigation.

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
  new mission.
- A stale operational snapshot must not mutate operational-position retention
  or the stationary-attention projection for the new mission.
- Canonical Traccar `fixTime` remains the only exact evidence clock. A valid
  `fixTime` does not authorize a snapshot to cross a mission boundary.
- Persistence must remain fail-closed: stale callbacks must not write into the
  new mission, and the existing expected-mission persistence check must remain.
- Outing and replay state are mission data state, not a permission to reuse a
  stale live snapshot. Finalized evidence remains immutable/read-only.

## Confirmed findings

### WAR-06-AUD-01 — stale history callback crosses the active mission boundary

Severity: P1
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

Deterministic interleaving:

1. Mission B is the active renderer mission.
2. A delayed history callback for Mission A resumes with a canonical live fix
   and `historyResetKey: mission-a`.
3. The runtime filters the snapshot against the currently-ready participant
   scope, but does not require the callback key to equal the active mission.
4. The visible publisher receives the Mission A fix while Mission B is active.

Observed result: `mission-a-fix` is applied once to the visible snapshot while
`useMissionStore.currentMission.id` is `mission-b`.

The downstream persistence path is safer than the visible path: when evidence
is admitted, `persistTrackingSnapshot` checks the expected mission before
writing. That check prevents this reproduction from being silently promoted to
Mission B durable evidence, but it does not prevent wrong current coordinates
or derived stationary attention from being shown to the operator.

Required repair shape: revalidate the operational mission identity immediately
before the final visible publication, and make the same identity check govern
retention and stationary projection inputs. A stale callback should be dropped
or replaced by an explicit current-mission state; it must not be rendered under
the new mission.

### WAR-06-AUD-02 — deferred participant-hydration snapshot crosses the mission boundary

Severity: P1
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

Observed result: the deferred `mission-a-deferred-fix` is applied once after
Mission B is active and its participant scope is ready.

This route bypasses the normal poller's stale-response suppression because the
snapshot is held by the runtime-level hydration buffer. The dynamic scope
filter can make the old device look valid for Mission B, while the retained
position context is still explicitly keyed to Mission A. The result can
contaminate the visible current marker and the stationary-attention projection
for Mission B.

Required repair shape: the hydration subscriber must compare the deferred
snapshot's mission key with the current mission before filtering, retention, or
publication. A mismatch must discard the deferred operational snapshot and
request a fresh current poll for the active mission. The fix must preserve the
existing behavior that waits for trustworthy participant scope before exposing
or persisting a snapshot.

## Current-head characterization evidence

The evidence test is intentionally a passing characterization: it asserts the
unsafe current behavior so the reproduction is durable without committing a
failing test or a speculative production fix.

| Evidence | Result | Claim boundary |
| --- | --- | --- |
| WAR-06 isolated characterization | 2 tests passed | Real `startTrackingRuntime`; controlled poller, mission store and participant scope; deterministic local source evidence |
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

The first command passed 2/2 tests. The second passed 3/3 files and 179/179
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
- The test uses controlled callback delivery to exercise an otherwise
  asynchronous interleaving; it proves the missing guard and its consequence,
  not the frequency of the race in field conditions.
- No strict `<200 ms` gate was changed or relaxed. The historical unexplained
  224 ms archive run and the remaining DON-254 qualification evidence remain
  outside this investigation.
- No shared `handoff/HANDOFF.md`, `docs/two-track-execution-workplan.md`, or
  `docs/assurance/coordinated-work-ledger.md` update is made in the initial
  investigation. Those records should be reconciled only in the post-Repair
  Train B closeout after rebasing this evidence against the then-current head.

## Next action

Treat `WAR-06-AUD-01` and `WAR-06-AUD-02` as one lifecycle repair boundary.
Before implementation, obtain the requested independent Luna audit and an
Astra retrace because the consequence is P1 and the repair will touch shared
tracking publication architecture. Implement the smallest final-boundary
mission identity guard, add red/green regressions, then rerun current-position,
stationary, persistence, browser, packaged and exact-head review gates. Do not
close the findings or claim release/field safety from this investigation PR.
