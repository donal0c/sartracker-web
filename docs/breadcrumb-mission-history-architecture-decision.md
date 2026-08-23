# DON-248 Breadcrumb And Mission-History Architecture Decision

Date: 2026-08-22

Status: **Locked for programme planning.** The operator/domain decisions are confirmed. The renderer implementation and archive key-management mechanism remain measured/design choices inside bounded implementation chunks; they do not reopen the domain model.

## Purpose

Replace the current bounded breadcrumb display with a mission-history system that remains operationally useful, exact, resilient, and reviewable across long-running life-safety missions.

This decision extends the existing SQLite mission-store architecture. It does not authorize a storage rewrite or a big-bang replacement.

## Sources

- The canonical raw team transcript in
  `team-feedback/breadcrumb-question-answers-20260822.md` and its indexed,
  cross-referenced ledger in
  `docs/breadcrumb-team-question-and-answer-ledger.md`. The raw answer and its
  ledger ID outrank summaries when wording is ambiguous.
- Team answers `SAR-QA-001` through `SAR-QA-013` covering complete breadcrumb
  visibility, current-position priority, outings, external teams, field scale,
  source-fix immutability, replay, and repeated search areas.
- Follow-up team answers `SAR-QA-014` through `SAR-QA-020`, received
  2026-08-22, covering outing ownership, participant selection, stationary
  alert timing, timeline semantics, search-pass authority, undated GPX,
  finalization, retention, and archive protection.
- `tmp/oxalpha-slices/01-current-fix-critical-path.report.md` through `07-architecture-synthesis.report.md`.
- `tmp/agent-mail/fable-breadcrumb-rearchitecture-plan-20260821.md`.
- `tmp/traccar-live-architecture-evidence-20260821.md`.
- Existing `DON-241` mission-store reliability programme and `DON-248` through `DON-255` bounded-storage lane.

## Locked Operator Model

### Mission outings (`SAR-QA-003`, `SAR-QA-010`, `SAR-QA-014`)

- An outing is a mission-wide operational period started and ended by the coordinator.
- An outing may cross midnight.
- Outings never overlap.
- Individual people, devices, groups, or external resources may join or leave during an outing. Their participation windows do not create separate outings.
- Calendar dates may be offered as a display convenience only. They are not the canonical persistence or coverage partition.

### Mission participants (`SAR-QA-004`, `SAR-QA-011`, `SAR-QA-015`)

- SAR Tracker never records every Traccar device automatically merely because it is registered on the server.
- The coordinator explicitly selects participating Traccar groups and/or devices at mission start.
- The coordinator may add participants later.
- Participant additions, removals, and group-membership changes are retained as mission history; they do not rewrite earlier participation.
- The supported envelope is 100 active Traccar devices in total, divided into groups/teams. External teams may also contribute imported GPX evidence.

### Current positions and stationary attention (`SAR-QA-002`, `SAR-QA-012`, `SAR-QA-016`)

- Current positions are the highest-priority operational path and must never wait for history, archive, reconciliation, or coverage rendering.
- Historical selection or omission never hides a participant's current position. Hiding live position requires a separate explicit operator action.
- Tracker distance reporting is configurable; approximately 25 metres is the current normal rule.
- When distance-driven reporting does not occur, the current safety heartbeat is approximately 20 minutes.
- Two accepted positions approximately 20 minutes apart showing no meaningful movement are sufficient to highlight the searcher to the operator.
- Stationary evaluation must account for reported GPS accuracy and must describe an attention condition, not automatically declare an emergency.
- Meaningful movement clears the attention state. Acknowledgement/presentation details are a usability decision inside the stationary-attention chunk and must not erase the underlying state.

### Complete breadcrumb coverage (`SAR-FIELD-001`, `SAR-QA-001`, `SAR-QA-003`, `SAR-QA-008`)

- Default history view shows all accepted breadcrumbs for all selected participants across the complete mission to date.
- The coordinator may omit historical data selectively by device and outing without deleting or changing evidence.
- Older coverage may load progressively, with newest/current operational information first.
- Progress must be derived from a real database completeness watermark. It must never be an estimated animation.
- Existing paged exact Breadcrumb Dots remain an inspection/export mechanism, not the complete operational coverage view.

### Source-fix immutability (`SAR-QA-006`, `SAR-QA-013`)

- Operators have no ability to edit or delete Traccar fixes.
- Identical source fixes are idempotent duplicates.
- Repeated SAR Tracker retrieval of the same immutable Traccar database row is
  not a new source observation or breadcrumb. Per-poll delivery accounting is
  transport diagnostics, not separate mission evidence (`SAR-DUP-001`).
- If the same source identity ever arrives with different content, SAR Tracker preserves the first accepted fix as displayed truth, records the conflicting observation as an anomaly, and warns the operator. It never silently overwrites either observation.
- Late or out-of-order fixes remain accepted when valid and are ordered by fix time while retaining receipt time.
- Invalid/rejected fixes never become position truth, but their rejection and reason remain durable and operator-visible.
- The absence of conflicts in a bounded live-server sample is not proof that conflicts are impossible.

### Timeline replay (`SAR-QA-007`, `SAR-QA-017`)

- Timeline replay reconstructs the mission data known at the selected time: tracks, positions, clues, markers, drawings, search areas, assignments, passes, and lifecycle state as applicable.
- Replay does not reproduce the exact map zoom, pan, open panels, or transient screen layout used by the coordinator.
- Fix time, receipt time, creation time, edit time, and effective/discovery time remain distinct where relevant.
- Mutable operational objects use explicit versions so later edits never destroy prior mission state.

### Search areas and repeated passes (`SAR-QA-009`, `SAR-QA-018`)

- A search area's geographic identity is separate from assignments and actual search passes.
- The same area may be assigned or searched multiple times, including partially and by different teams.
- The coordinator declares every completed pass as fully searched, partially searched, or aborted.
- Breadcrumb-derived geometric coverage is advisory. It may highlight discrepancies but never declares completion.
- Completed historical areas and passes are retired or revised, never silently hard-deleted.

### External teams and GPX evidence (`SAR-QA-004`, `SAR-QA-019`)

- Live Traccar groups and imported GPX are both supported.
- They share a provenance-carrying track query contract but retain source-specific storage and semantics.
- GPX evidence never presents live-position freshness.
- GPX source bytes receive a content hash; changed content creates a new immutable revision.
- Point timestamps and elevation are retained when present; rejected points/segments are recorded.
- SAR Tracker never invents GPX timestamps.
- An undated GPX track may be assigned to an outing and displayed as static evidence, but is excluded from precise timeline replay.

### Finalization, retention, and archive evidence (`SAR-QA-007`, `SAR-QA-020`)

- A finalized mission is read-only.
- Any supported post-finalization correction is a visible revision with authority, reason, before/after state, and audit history; it never erases the earlier record.
- Finalized mission evidence is retained indefinitely. There is no automatic or operator-facing permanent deletion path for operational evidence.
- Indefinite retention does not require every finalized mission to remain in the hot live database. After a complete, verified archive exists, data may move to archive-backed review while remaining recoverable and reviewable without loss.
- The finalized archive is encrypted and locked for confidentiality.
- The archive also carries a cryptographic hash manifest for integrity verification; encryption alone is not integrity provenance.
- Archive creation must be streamed and mission-scoped, contain every table/artifact needed for deterministic review and replay, and pass restore-and-replay verification before live-store cleanup is eligible.
- Encryption key custody, authorized unlock, loss recovery, and emergency access must be decided and tested before the archive implementation chunk can complete.

## Target Architecture

### Evidence spine

- Keep SQLite in WAL mode behind Electron main-process/worker adapters.
- Preserve append-oriented position truth and existing revision support.
- Add receipt-time/content provenance and a durable ingest anomaly ledger.
- Add canonical outings, mission participants, teams/resources, and historical membership/participation records.
- Preserve source-specific live Traccar and GPX stores behind one track query port.
- Add same-transaction marker and drawing versions for replay.
- Add stable search areas, assignments, append-oriented search passes, clue links, and track-evidence references.

### Read models

Maintain explicit, independently testable read models for:

1. current safety positions;
2. stationary-searcher attention;
3. complete operational coverage by mission/device/outing;
4. exact fix inspection and export;
5. mission timeline replay;
6. diagnostics, anomalies, and completeness.

SQLite and its workers own truth, identity, completeness, and read-model construction. The renderer consumes published read models and never decides evidence completeness.

### Coverage renderer

The final rendering mechanism is not guessed in this decision. A bounded spike must compare:

- device/outing GeoJSON chunks;
- SQLite-backed local vector tiles;
- a monolithic GeoJSON control expected to expose the failure boundary.

The spike uses deterministic 960,000-fix and 2,000,000-fix fixtures, including 100 devices, 12 outings, stationary clusters, overlaps, revisits, and external GPX. It must measure first useful coverage, complete coverage, append latency, filters, pan/zoom responsiveness, memory, main-process stalls, and interruption recovery.

Generalized rendering is never evidentiary truth. Exact inspection/export always resolves to SQLite evidence.

## Engineering Acceptance Budgets

These are programme gates, subject to measured revision only through an explicit decision update:

- A new current fix is visible within one normal polling cycle and is never delayed by history work.
- First useful historical coverage appears within 5 seconds on reference field hardware.
- Selected complete 960,000-fix coverage appears within 30 seconds on reference field hardware.
- Device/outing filter changes respond within 500 milliseconds.
- Once replay indexes/read models are ready, ordinary timeline seeks respond within 1 second.
- No history/renderer operation causes an Electron main-process stall above the programme's ratified safety budget.
- At failure or cancellation, already loaded consistent coverage stays visible with an explicit incomplete state.
- The 2,000,000-fix fixture is deliberate headroom and a renderer rejection gate, not a claim about the normal mission size.

## Non-Negotiable Invariants

1. Current positions never wait for history.
2. Operational evidence is never silently omitted, overwritten, corrected, or deleted.
3. Selection and display simplification never mutate evidence.
4. Progress and 100% completeness are database-backed claims.
5. Outing, not calendar date, is the canonical operational partition.
6. Operator declarations, not geometry, decide search-pass outcome.
7. GPX and Traccar share queryability, not evidentiary equivalence.
8. No synchronous operation proportional to mission/database size runs on Electron's main isolate.
9. Every table has an explicit live retention, archive, and recovery story.
10. Tests, CI, synthetic fixtures, packaged verification, and field evidence remain separately labelled.

## Explicit Non-Goals

- Replacing SQLite or introducing full event sourcing.
- Recording every pan, zoom, panel, or transient UI state for replay.
- Automatically ingesting every Traccar device into every mission.
- Inventing timestamps for imported evidence.
- Allowing computed geometry to declare a search complete.
- Treating encrypted archives as tamper evidence without a hash manifest.
- Shipping a big-bang rewrite without reversible, independently verified chunks.

## Programme Planning Rule

The programme is delivered through the five ordered PRs in
`docs/breadcrumb-programme-execution-policy.md`, followed by one final
team-facing release. BCP work units remain the just-in-time design and TDD
boundaries inside those PRs. Each work unit receives a Fable design subsection
covering safety invariants, failure modes, persistence/coordinate impact,
strict red-green-refactor tests, evidence tier, rollback, documentation,
Linear mapping, and completion gate before its production implementation.

Coverage and replay remain architecturally decoupled even though they ship in
the same final release. One bounded unpublished packaged checkpoint follows
the complete-coverage PR; broad qualification is end-weighted to BCP-17.
