# Bead Readiness Rubric

Use this document before implementation to decide how much parallel research, planning, or product clarification a bead still needs.

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

Last updated: 2026-04-08 08:00 by Forge

## QGIS Replacement Program

Last updated: 2026-04-11 18:46 by Codex

### `sartracker-web-2jk` — M11: QGIS replacement parity program

- Research required: `Low`
- Implementation readiness: `5/5`
- Recommended action: **Execute as the Phase 2/3 parity program**

### New Beads Created From The Parity Audit

| Bead | Score | Recommended action | Why |
|------|-------|--------------------|-----|
| `sartracker-web-2jk.1` — M12 Settings workspace parity | 5/5 | Implement first | Mini-spec now locks section structure, settings scope split, and secure secret boundary |
| `sartracker-web-2jk.2` — M13 Replay / training mode parity | 4/5 | Implement after M12 | Clear plugin gap with strong guardrails already evidenced in plugin tests/docs |
| `sartracker-web-2jk.3` — M14 Mission finalization, archive, and admin unlock | 5/5 | Implement after M12 | Mini-spec now locks lifecycle semantics, read-only enforcement, and unlock audit model |
| `sartracker-web-2jk.4` — M15 Mission logs and audit review workspace | 4/5 | Implement after M14 | Depends on lifecycle governance and uses richer review/audit surface |
| `sartracker-web-2jk.5` — M16 Layer catalog domain and grouped layer model | 5/5 | Implement first wave | Mini-spec now locks canonical tree, node taxonomy, and mission-vs-local persistence split |
| `sartracker-web-2jk.6` — M17 Layer tree and feature inspection UI | 4/5 | Implement after M16 | UI layer on top of the catalog foundation |
| `sartracker-web-2jk.7` — M18 Text labels and coordinate tool parity | 5/5 | Implement in parallel once bandwidth exists | Coordinate converter behavior is explicit, and text-label schema/CRUD are plugin-backed even though the old SAR-panel button was still disabled |
| `sartracker-web-2jk.8` — M19 Devices workspace parity | 5/5 | Implement in parallel | Clear plugin analogue and bounded scope |
| `sartracker-web-2jk.9` — M20 Marker evidence and audit metadata parity | 4/5 | Implement after M15 | Touches review/audit and persistence shape |
| `sartracker-web-2jk.10` — M21 Diagnostics workspace and repair tooling | 4/5 | Implement after M12 | Mostly bounded, but repair semantics need careful standalone interpretation |
| `sartracker-web-2jk.11` — M22 GPX import and watch parity | 4/5 | Implement after M16 | Needs integration into grouped layer/catalog model |
| `sartracker-web-2jk.12` — M23 Helicopter layer parity | Complete | Implemented 2026-04-11 | First-class helicopter slots now persist, render, and validate end to end |
| `sartracker-web-2jk.13` — M24 Focus mode parity | 5/5 | Implement later | Bounded UI/interaction feature once the rest is stable |
| `sartracker-web-2jk.14` — M25 Offline map resilience parity | 3/5 | Short design pass, then implement | Capability gap is clear, but final offline packaging strategy needs a small design decision |
| `sartracker-web-2jk.15` — M26 QGIS replacement parity acceptance sweep | 5/5 | Run last | Final retirement gate for the plugin |

## Completed Milestones

| Bead | Completed | Key Output |
|------|-----------|------------|
| M1: Scaffold | 2026-04-07 | Tauri + Vite + React + TS, all tests green |
| M2: Map | 2026-04-08 | MapLibre, basemaps, coordinate bar, health badge, SW caching |
| M3: Persistence | 2026-04-08 | 2,341 lines Rust, full schema, audit trail, autosave, archive |

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
- All drawing schemas documented in M3 bead
- Magnetic declination: fixed -4.5° for v1 (true → magnetic: subtract 4.5°, magnetic → true: add 4.5°). Dynamic WMM deferred to Phase 3.
- LPB distances: Koester/NASAR data locked (9 categories, 4 percentiles each — see bead comment)
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

| Bead | Score | Status |
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

## Cross-Bead Investigation Checklist

| # | Question | Status |
|---|----------|--------|
| 1 | M3 archive boundary | ✅ Resolved — SQLite live, ZIP archive export-only |
| 2 | M4 cache authority | ✅ Resolved — JSON is transport-only, SQLite authoritative |
| 3 | M5 persisted lifecycle states | ✅ Resolved — all states in DB, FINALIZED is a status value |
| 4 | M8 magnetic declination | ⏳ Open — fixed -4.5° for v1 recommended, needs Donal's sign-off |
| 5 | M8 LPB distances | ⏳ Open — need SAR literature data |
| 6 | Investigation evidence | ⏳ Move /tmp/*.md into docs/investigations/ |
