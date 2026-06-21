# Linear issue Readiness Rubric

Use this document before implementation to decide how much parallel research, planning, or product clarification a Linear issue still needs.

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

---

## Current Assessments

Last updated: 2026-05-14 by Codex (planning consolidated into the two-track workplan)

## Hosted Browser Runtime

Canonical plan: `docs/hosted-browser-testing-plan.md`

Strategic stance: hosted browser is the fast feedback/testing lane; Electron desktop is the operational lane. Do not try to make both fully equivalent before the team has completed surface-level testing and the high-definition mountain map requirements are known.

Execution docs:

- `docs/two-track-execution-workplan.md` — canonical active queue
- `docs/team-testing-feedback-loop.md` — supporting tester instructions
- `docs/electron-beta-handoff.md` — current Electron handoff and release detail

### Phase 0: Hosted browser testing unblock

- Research required: `Low`
- Implementation readiness: `5/5`
- Recommended action: **Implement now**
- Why: The team needs to test the current app from Vercel immediately. Session storage is acceptable for this test release as long as the app visibly labels the limitation.
- Locked decisions:
  - Hosted browser testing mode is opt-in via `?missionHarness=1`.
  - Phase 0 can use session storage.
  - Phase 0 must not be described as live-incident-grade persistence.
  - Traccar access uses the team-managed HTTPS server directly (`https://kmrtsar.eu`).
- Open questions:
  - Exact long-term browser persistence design: IndexedDB only, export/import, or server-backed shared missions.
  - Final browser secret-handling model.
  - Which desktop filesystem workflows must become browser-native before hosted browser can leave testing status.

### Browser runtime hardening — deferred

- Research required: `Medium`
- Implementation readiness: `3/5`
- Recommended action: **Defer until after Phase 0 team feedback and the desktop beta foundation**
- Why: Browser hardening may be valuable later, but the near-term operational path is Electron. IndexedDB/secrets/export work should not outrank the desktop release pipeline and offline map path.

### Phase 1: Electron beta release foundation

- Research required: `Medium`
- Implementation readiness: `4/5`
- Recommended action: **Start lightweight prep now while Phase 0 team testing runs**
- Why: The team needs fast Vercel iteration, but the operational release path needs repeatable packaged desktop builds, release notes, and install guidance.
- Locked decisions:
  - Vercel remains the rapid test channel.
  - Electron beta becomes the runtime for persistence, filesystem, map package, and recovery validation.
  - GitHub Releases or equivalent versioned artifacts are enough before auto-update/signing is tackled.
- Open questions:
  - Which OS/package formats the team needs first.
  - Whether unsigned beta builds are acceptable during testing.
  - How frequently the team can absorb desktop beta updates.

### Phase 2: Desktop operational core

- Research required: `Medium`
- Implementation readiness: `3/5`
- Recommended action: **Implement after beta release flow is repeatable**
- Why: Persistence, recovery, Traccar credentials, GPX, diagnostics, archive, and filesystem workflows need packaged-app validation rather than browser harness proof.

### Phase 3: High-definition mountain maps and offline readiness

- Research required: `High`
- Implementation readiness: `2/5`
- Recommended action: **Research before implementation**
- Why: Map format, size, CRS, tiling, packaging, licensing, and update cadence are unknown. This should be desktop-first unless evidence strongly supports browser delivery.

### Phase 4: Browser runtime hardening decision

- Research required: `Medium`
- Implementation readiness: `3/5`
- Recommended action: **Short design pass before implementation**
- Why: The direction is clear if browser becomes operational, but persistence, secrets, exports, and attachment/file workflows need explicit product decisions before implementation. This should follow team feedback and desktop beta learnings, not lead them.

## QGIS Replacement Program

Last updated: 2026-05-13 by Claude (T01 docs reconciliation)

### `sartracker-web-2jk` — M11: QGIS replacement parity program

- Research required: `Low`
- Implementation readiness: `5/5`
- Recommended action: **Phase 2 largely complete; remaining work is M13 replay, M25 offline bundles, and M26 acceptance sweep**

### New Linear issues Created From The Parity Audit

| Linear issue | Score | Recommended action | Why |
|------|-------|--------------------|-----|
| `sartracker-web-2jk.1` — M12 Settings workspace parity | Complete | Implemented; see HANDOFF | Settings workspace shipped |
| `sartracker-web-2jk.2` — M13 Replay / training mode parity | 4/5 | Open — route through the two-track workplan when prioritized | Clear plugin gap with strong guardrails already evidenced in plugin tests/docs |
| `sartracker-web-2jk.3` — M14 Mission finalization, archive, and admin unlock | Complete | Implemented; see HANDOFF | Finalize/archive/unlock workflows shipped with audit coverage |
| `sartracker-web-2jk.4` — M15 Mission logs and audit review workspace | Complete | Implemented; see HANDOFF | Mission review workspace shipped |
| `sartracker-web-2jk.5` — M16 Layer catalog domain and grouped layer model | Complete | Implemented; see HANDOFF | Grouped layer catalog is the authoritative source for the layer tree |
| `sartracker-web-2jk.6` — M17 Layer tree and feature inspection UI | Complete | Implemented; see HANDOFF | Feature inspection rows live in `src/features/layers/layer-panel-model.ts` |
| `sartracker-web-2jk.7` — M18 Text labels and coordinate tool parity | Complete | Implemented; see HANDOFF | Coordinate converter and text labels shipped |
| `sartracker-web-2jk.8` — M19 Devices workspace parity | Complete | Implemented; see HANDOFF | Devices workspace shipped |
| `sartracker-web-2jk.9` — M20 Marker evidence and audit metadata parity | Complete | Implemented; see HANDOFF | Marker metadata/audit parity shipped |
| `sartracker-web-2jk.10` — M21 Diagnostics workspace and repair tooling | Complete | Implemented; see HANDOFF | Diagnostics workspace shipped |
| `sartracker-web-2jk.11` — M22 GPX import and watch parity | Complete | Implemented; see HANDOFF | GPX import/watch surfaces shipped |
| `sartracker-web-2jk.12` — M23 Helicopter layer parity | Complete | Implemented 2026-04-11 | First-class helicopter slots persist, render, and validate end to end |
| `sartracker-web-2jk.13` — M24 Focus mode parity | Complete | Implemented; closed by T01 | Focus Mode Plus store, toggle, sidebar, coordinate mirror, E2E + visual coverage; see `src/features/focus-mode/` |
| `sartracker-web-2jk.14` — M25 Offline map resilience parity | 3/5 | Open — readiness + current-view preflight shipped; packaged offline bundles still outstanding | Capability gap partially closed by 2026-05 readiness work; full packaged bundles still need a design pass |
| `sartracker-web-2jk.15` — M26 QGIS replacement parity acceptance sweep | 5/5 | Open — run last, after M13 and M25 | Final retirement gate for the plugin |

## Completed Milestones

| Linear issue | Completed | Key Output |
|------|-----------|------------|
| M1: Scaffold | 2026-04-07 | Tauri + Vite + React + TS, all tests green |
| M2: Map | 2026-04-08 | MapLibre, basemaps, coordinate bar, health badge, SW caching |
| M3: Persistence | 2026-04-08 | 2,341 lines Rust, full schema, audit trail, autosave, archive |
| M4: Tracking (`sartracker-web-rbg`) | 2026 Phase 1 | Traccar HTTP polling runtime, per-device breadcrumbs, last-good cache, stale detection |
| M5: Mission UI (`sartracker-web-vxm`) | 2026 Phase 1 | Mission lifecycle, timers, recovery, back-dated start |
| M6: Markers (`sartracker-web-ahy`) | 2026 Phase 1 | IPP/LKP, clue, hazard, casualty marker CRUD with audit metadata |
| M7: Layer panel (`sartracker-web-o56`) | 2026 Phase 1 | Right-rail layer/filter panel with visibility store |
| M8: Drawing tools (`sartracker-web-a9l`) | 2026 Phase 1 | Lines, search areas, range rings (LPB), bearings, sectors |
| M9: Measurement (`sartracker-web-93p`) | 2026 Phase 1 | Quick distance/bearing measurement tool |
| M10: Integration E2E (`sartracker-web-2bz`) | 2026 Phase 1 | Playwright coverage across mission/marker/drawing flows |
| M12: Settings workspace (`sartracker-web-2jk.1`) | 2026 Phase 2 | Settings workspace parity, secret boundary |
| M14: Finalization/archive/unlock (`sartracker-web-2jk.3`) | 2026 Phase 2 | Finalize, archive, admin unlock with audit |
| M15: Mission logs/audit review (`sartracker-web-2jk.4`) | 2026 Phase 2 | Mission review workspace |
| M16: Layer catalog domain (`sartracker-web-2jk.5`) | 2026 Phase 2 | Canonical layer catalog store |
| M17: Layer tree / inspection (`sartracker-web-2jk.6`) | 2026 Phase 2 | Grouped layer tree + feature inspection rows |
| M18: Text labels + coordinate tool (`sartracker-web-2jk.7`) | 2026 Phase 2 | Text label schema/CRUD + coordinate converter |
| M19: Devices workspace (`sartracker-web-2jk.8`) | 2026 Phase 2 | Devices workspace parity |
| M20: Marker evidence/audit metadata (`sartracker-web-2jk.9`) | 2026 Phase 2 | Marker metadata + audit persistence |
| M21: Diagnostics + repair (`sartracker-web-2jk.10`) | 2026 Phase 2 | Diagnostics workspace and repair tooling |
| M22: GPX import/watch (`sartracker-web-2jk.11`) | 2026 Phase 2 | GPX import + watch surfaces integrated into layer catalog |
| M23: Helicopter layer (`sartracker-web-2jk.12`) | 2026-04-11 | First-class helicopter slots |
| M24: Focus mode (`sartracker-web-2jk.13`) | 2026 Phase 2 | Focus Mode Plus, persisted reload, tracking/mission awareness, coordinate mirror |

### Currently Open Parity Linear issues

- `sartracker-web-2jk.2` — M13 replay / training mode parity (route through the two-track workplan when prioritized)
- `sartracker-web-2jk.14` — M25 offline map resilience parity (readiness + current-view preflight shipped; full packaged offline bundles remain)
- `sartracker-web-2jk.15` — M26 QGIS replacement parity acceptance sweep (blocked — run last)
- `sartracker-web-bsl` — sections 13–16 not yet triple-verified in deep UI validation

---

## ✅ M2 — Map + basemaps + coordinate display — COMPLETE
Implemented 2026-04-08 by Codex. See HANDOFF.md for details.

---

## ✅ M3 — Persistence (SQLite mission store) — COMPLETE
Implemented 2026-04-08 by Codex. See HANDOFF.md for details.

### Cross-cutting questions resolved by implementation:
- **Archive boundary:** SQLite is the live store. Archive creates ZIP with manifest.json + mission.json + SQLite snapshot. GeoPackage is NOT used.
- **Recovery authority:** SQLite only. Archive does not participate in crash recovery.
- **Persisted lifecycle states:** IDLE, ACTIVE, PAUSED, FINISHED, FINALIZED all stored in missions table. FINALIZED is a status value (not a separate flag).

---

## sartracker-web-rbg: M4 — Tracking (Traccar HTTP polling + map rendering)

- Research required: `Low`
- Implementation readiness: `5/5`
- Recommended action: **Implement now** (after M2 + M3)

### Locked Decisions
- HTTP polling for v1 (30s default, configurable)
- Mock auth for tests; real credentials from Eamonn when available
- Device colours: MD5 hash of device_id, deterministic, 50-255 range, collision-resistant
- Breadcrumb trails: dotted lines (width 1.5), current positions: circle markers (size 5)
- Stale device: 1hr visibility threshold, 5min cache TTL, yellow indicator
- Last-good cache: full per-device snapshots + breadcrumbs, JSON on disk, 4hr max age, atomic writes
- Traccar unreachable: serve cached data, OFFLINE MODE warning, never clear map, CONNECTION RESTORED on recovery
- Incremental breadcrumbs: per-device timestamp tracking, dedup by (device_id, timestamp), 100K max, FIFO eviction

### Open Questions
None — all resolved.

### Resolved
- **Cache authority:** JSON last-good cache is transport-only. SQLite (via MissionStore) is always authoritative.
- **Canonical fixtures:** Traccar device/position/breadcrumb payloads extracted from plugin fixtures and tests. Ready for tests/fixtures/.

### Evidence
- Plugin investigation: `/tmp/m4-tracking.md`
- Spike: `spikes/S7-traccar-integration/`
- Plugin source: `~/Documents/Qgis/sartracker/providers/traccar_http.py`, `controllers/provider_controller.py`

### Ready-To-Start Checklist
- [x] Device colour strategy documented
- [x] Staleness semantics documented
- [x] Last-good cache semantics documented
- [x] Breadcrumb/device styling documented
- [x] Offline behaviour documented
- [x] Incremental fetch documented
- [ ] Test plan (Codex writes as part of TDD)

---

## sartracker-web-vxm: M5 — Mission UI (start/pause/resume/finish + timers)

- Research required: `Low`
- Implementation readiness: `5/5`
- Recommended action: **Implement now** (after M2 + M3)

### Locked Decisions
- State machine: IDLE → ACTIVE → PAUSED ↔ ACTIVE → FINISHED (no backwards)
- Persisted statuses: active, paused, finished, finalized. Idle is UI-only.
- Pause: timer stops, polling suppressed (not stopped), data editable
- Finish: persists as 'finished' in DB, UI resets, data editable
- Finalize: deferred to Phase 3 (not in M5 scope)
- Admin unlock: deferred to Phase 3
- Back-date: 0-48 hours
- Recovery: query DB for active/paused mission on startup, prompt Resume/Start Fresh
- Start Fresh: clears pause state, does NOT delete data
- Timer formulas: elapsed = now - start_ts, active = elapsed - total_paused
- All dialog copy locked (from plugin)

### Open Questions
None — all 9 questions from Codex resolved.

### Ready-To-Start Checklist
- [x] State machine documented
- [x] Persisted statuses resolved (idle is UI-only)
- [x] Pause/finish behaviour documented with exact semantics
- [x] Finalize scoped out of M5
- [x] Timer formulas documented with example
- [x] Recovery behaviour documented
- [x] Dialog copy locked
- [x] Architecture guidance (domain module, not UI)
- [ ] Test plan (Codex writes as part of TDD)

---

## sartracker-web-ahy: M6 — Markers

- Research required: `Low`
- Implementation readiness: `4/5`
- Recommended action: **Implement now** (after M2 + M3)

### Locked Decisions
- 4 marker types: IPP/LKP, Clue, Hazard, Casualty
- Per-type forms with type-specific fields (documented in M3 schema)
- Auto-populated Irish Grid reference from click coordinates
- Persisted to SQLite via MissionStore

### Open Questions
None — all resolved.

### Resolved (by plugin investigation 2026-04-08)
- **Icons:** Custom SVGs — star(blue) IPP, circle(white) clue, inverted-arrow(red) hazard, star(red+shadow) casualty
- **Form UI:** Modal dialog with dynamic type-specific fields
- **Labels:** Always visible, name field, type-coloured text with white halo
- **All dropdowns:** Subject categories, clue types, confidence, hazard types/severity, casualty conditions/evacuation — all fixed lists extracted from plugin

### Ready-To-Start Checklist
- [x] Data model documented
- [x] Coordinate conversion proven
- [x] Icon design decided
- [x] Form UI decided
- [x] All dropdown values locked
- [ ] Test plan (Codex writes as part of TDD)

---

## sartracker-web-o56: M7 — Layer/filter panel

- Research required: `Low`
- Implementation readiness: `4/5`
- Recommended action: **Implement after M4 + M6**

### Locked Decisions
- Hybrid approach: 3 sources, ~15 style layers, filter-based toggling (S6 spike)

### Open Questions
- Panel location (left sidebar? right sidebar?)
- Collapsed/expanded default state

---

## sartracker-web-a9l: M8 — Drawing tools

- Research required: `Low`
- Implementation readiness: `5/5`
- Recommended action: **Implement now** (after M2 + M3)

### Locked Decisions
- Terra Draw for polygons/lines, custom GeoJSON for range rings/bearing lines/sectors
- Geodesic math proven in S2/S3 spikes
- All drawing schemas documented in M3 Linear issue
- Magnetic declination: fixed -4.5° for v1 (true → magnetic: subtract 4.5°, magnetic → true: add 4.5°). Dynamic WMM deferred to Phase 3.
- LPB distances: Koester/NASAR data locked (9 categories, 4 percentiles each — see Linear issue comment)
- LPB ring colours: 25%=green, 50%=yellow, 75%=orange, 95%=red
- Tool activation: one-active-at-a-time, ESC cancels, auto-deactivate after feature creation, right-click finishes multi-point tools

### Open Questions
None — all resolved.

### Investigation Required Before Start
~~Lock the magnetic declination rule for v1 and document the rationale.~~ Done.
~~Lock the LPB subject categories and probability distance source data that will be used for range rings.~~ Done.

---

## sartracker-web-93p: M9 — Measurement tool

- Research required: `Low`
- Implementation readiness: `4/5`
- Recommended action: **Implement after M2**

### Open Questions
- Display format (popup? permanent label?)
- Keep measurements across sessions or clear on finish?

---

## sartracker-web-2bz: M10 — Integration test

- Research required: `Low`
- Implementation readiness: `4/5`
- Recommended action: **Implement after all M2-M9**

### Open Questions
- Mock Traccar or real server for CI?
- How to simulate app crash in Playwright?

---

## Summary

| Linear issue | Score | Status |
|------|-------|--------|
| M2: Map | 5/5 | ✅ Ready |
| M3: Persistence | 5/5 | ✅ Ready |
| M4: Tracking | 5/5 | ✅ Ready — fixtures resolved |
| M5: Mission UI | 5/5 | ✅ Ready — all 9 Codex questions resolved |
| M6: Markers | 5/5 | ✅ Ready — all UX decisions locked |
| M7: Layer Panel | 4/5 | ✅ Ready (after M4+M6) |
| M8: Drawing Tools | 5/5 | ✅ Ready — declination, LPB, UX all locked |
| M9: Measurement | 4/5 | ✅ Ready |
| M10: Integration | 4/5 | ✅ Ready (after all others) |

---

## Cross-Linear issue Investigation Checklist

| # | Question | Status |
|---|----------|--------|
| 1 | M3 archive boundary | ✅ Resolved — SQLite live, ZIP archive export-only |
| 2 | M4 cache authority | ✅ Resolved — JSON is transport-only, SQLite authoritative |
| 3 | M5 persisted lifecycle states | ✅ Resolved — all states in DB, FINALIZED is a status value |
| 4 | M8 magnetic declination | ⏳ Open — fixed -4.5° for v1 recommended, needs Donal's sign-off |
| 5 | M8 LPB distances | ⏳ Open — need SAR literature data |
| 6 | Investigation evidence | ⏳ Move /tmp/*.md into docs/investigations/ |
