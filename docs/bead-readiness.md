# Bead Readiness Rubric

Use this document before implementation to decide how much parallel research, planning, or product clarification a bead still needs.

The goal is to make implementation handoff-friendly: Donal and the planning/research team can work ahead on ambiguous areas while Codex or Claude Code finishes the current bead.

## Readiness Scale

### Research Required Rating
- `Low` — Ready to implement. Only minor product or UX choices remain.
- `Medium` — Implementable, but targeted research or a short design note would materially reduce risk.
- `High` — Not ready. Core behaviour, data flow, or architecture is still too ambiguous.

### Implementation Readiness Score
- `5/5` — Ready now. No meaningful blockers.
- `4/5` — Ready with a few minor clarifications.
- `3/5` — Probably implementable, but should not start without targeted decisions.
- `2/5` — Needs structured research/spec work first.
- `1/5` — Not ready for implementation.

## Rubric Template

Copy this section for future beads.

```md
## <Bead ID>: <Bead Title>

- Research required: `Low | Medium | High`
- Implementation readiness: `X/5`
- Recommended action: `Implement now | Implement after short design pass | Research before implementation`

### Why
- ...

### Locked Decisions
- ...

### Open Questions
- ...

### Evidence / References
- ...

### Ready-To-Start Checklist
- [ ] Safety invariants written down
- [ ] Failure modes written down
- [ ] Data model / persistence impact clear
- [ ] Coordinate impact clear
- [ ] Test plan written before production code
- [ ] Open questions resolved or explicitly deferred
```

## Current Assessments

## M2: Map — MapLibre + basemaps + coordinate display

- Research required: `Low`
- Implementation readiness: `5/5`
- Recommended action: `Implement now`

### Why
- The main technical choices are already locked.
- Spike evidence exists for both map rendering and coordinate conversion.
- The remaining offline GeoPackage work is explicitly deferred and non-blocking for this bead.

### Locked Decisions
- Raw MapLibre integration via `useRef`
- `proj4js` with the validated TOWGS84 transform from Spike S2
- Service worker tile caching for v1 resilience
- `WGS84` for input/rendering, `ITM` as working CRS, `TM65` display-only

### Open Questions
- Which basemap URLs and attribution strings are the canonical v1 defaults?
- What precision/rounding should the coordinate bar use for operator display?
- What exactly does “offline resilience” promise for v1 when service-worker-cached tiles are unavailable?

### Evidence / References
- `spikes/S1-osi-maps/`
- `spikes/S2-irish-grid/`

### Ready-To-Start Checklist
- [ ] Canonical basemap list confirmed
- [ ] Coordinate display format confirmed
- [ ] M2 test plan written

## M3: Persistence — SQLite mission store

- Research required: `Medium`
- Implementation readiness: `3/5`
- Recommended action: `Implement after short design pass`

### Why
- The architecture direction is strong and the spike evidence is good.
- Persistence is safety-critical, so schema and write semantics must be explicit before coding.
- The bead is close, but not yet precise enough for low-risk implementation.

### Locked Decisions
- SQLite in `WAL` mode
- Frontend never talks to the database directly
- Mission persistence sits behind a backend `MissionStore` boundary
- Tauri SQL plugin is the chosen integration path
- Default autosave interval is 60s

### Open Questions
- What is the exact initial schema for `missions`, `devices`, `positions`, `markers`, `drawings`, and `mission_events`?
- What gets written immediately vs on autosave?
- What backup location and file naming scheme should v1 use?
- Is v1 single-active-mission only?
- What is the archive/export shape for completed missions?
- What recovery behaviour should the operator see after crash/restart?

### Evidence / References
- `spikes/S5-persistence/`
- `src-tauri/` scaffold and SQL plugin wiring

### Ready-To-Start Checklist
- [ ] Initial schema written down
- [ ] MissionStore interface written down
- [ ] Crash recovery semantics written down
- [ ] Backup strategy written down
- [ ] M3 test plan written

## M4: Tracking — Traccar HTTP polling + map rendering

- Research required: `Medium`
- Implementation readiness: `3/5`
- Recommended action: `Implement after targeted operational clarifications`

### Why
- The transport decision is already made, which removes a major source of risk.
- The remaining ambiguity is operational and behavioural: how tracking should look, recover, degrade, and persist.
- Those choices affect trust and operator interpretation, so they should be explicit before implementation.

### Locked Decisions
- HTTP polling for v1, not WebSocket
- Polling interval defaults to 30s and should be configurable
- Mock auth/test payloads are acceptable before live credentials arrive
- Positions persist via `MissionStore`

### Open Questions
- How should device colours be assigned and persisted?
- Should breadcrumb trails render as lines, points, or both?
- Exactly when is a device considered stale, and how is that shown?
- What is stored in the last-good cache: full snapshot, per-device snapshot, or just positions?
- How should the UI behave when Traccar is unreachable during an active mission?
- What sample/sanitized real payloads should be used as canonical fixtures?

### Evidence / References
- `spikes/S7-traccar-integration/`
- Existing plugin provider logic in `~/Documents/Qgis/sartracker/providers/traccar_http.py`

### Ready-To-Start Checklist
- [ ] Canonical mock payloads collected
- [ ] Staleness semantics defined
- [ ] Last-good cache semantics defined
- [ ] Breadcrumb/device styling rules defined
- [ ] M4 test plan written

## M5: Mission UI — start/pause/resume/finish + timers

- Research required: `Medium-High`
- Implementation readiness: `2/5`
- Recommended action: `Research before implementation`

### Why
- The UI controls themselves are simple.
- The mission lifecycle semantics are not simple, and mistakes here ripple into tracking, persistence, and recovery.
- This bead needs a short written behaviour spec before implementation.

### Locked Decisions
- Mission lifecycle is independent of tracking availability
- Mission state persists via `MissionStore`
- The UI includes elapsed and active-search timers

### Open Questions
- What exactly does `pause` mean operationally?
- What exactly does `finish` do to incoming tracking, autosave, editing, and mission mutability?
- On restart, when should the app auto-resume vs prompt vs start fresh?
- What are the rules for back-dated mission start times?
- Is mission naming mandatory and must names be unique?
- Does a finished mission become read-only immediately?
- Can v1 have only one active mission, or one mission total in local working state?

### Evidence / References
- `~/Documents/Qgis/sartracker/controllers/mission_lifecycle_controller.py`
- `~/Documents/Qgis/sartracker/controllers/mission_controller.py`

### Ready-To-Start Checklist
- [ ] Mission lifecycle state machine written down
- [ ] Pause/resume/finish semantics agreed
- [ ] Restart/resume behaviour agreed
- [ ] Timer rules agreed
- [ ] M5 test plan written

## Working Order For Background Research

If the planning/research team wants to work ahead efficiently, prioritize:

1. `M5` — highest ambiguity, highest behavioural impact
2. `M3` — safety-critical persistence semantics
3. `M4` — operational clarity and fixture quality
4. `M2` — mostly ready, only minor clarifications needed
