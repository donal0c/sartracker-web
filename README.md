# SAR Tracker Web — Bespoke Replacement for QGIS Plugin

## What
Replace the QGIS-based SAR Tracker plugin with a standalone desktop application for Kerry Mountain Rescue Team.

## Why
- QGIS version updates keep breaking the plugin (Qt5→Qt6, QGIS 4 incompatibility)
- The team uses 5% of QGIS — everything else is custom plugin code
- Non-technical volunteers can't troubleshoot QGIS issues
- Every QGIS update = Donal on the phone firefighting

## Stack
- **Tauri 2** — desktop wrapper, auto-update, ~10MB binary
- **MapLibre GL JS** — WebGL map rendering
- **Terra Draw** — drawing tools (polygon, circle, sector, line, select)
- **Turf.js** — geospatial maths (range rings, bearings, distance)
- **proj4js** — coordinate conversion (TM65/ITM/WGS84)
- **TypeScript + React** — UI
- **PMTiles / GeoPackage-derived offline tiles** — offline map delivery path

## Status
- **Phase: Pre-build / scaffold start**
- Decision: BUILD BESPOKE (confirmed by spike work and council review)
- All 7 technical spikes are complete
- Waiting on: Eamonn for the `KMRT_package.gpkg` offline map file and Traccar admin credentials for live API validation

## Key Directories
```
sartracker-web/
├── README.md          ← this file
├── research/          ← deep research on risks and unknowns
├── spikes/            ← prototype code for validating risks
├── specs/             ← architecture specs and build plans
```

## Source Plugin
- Location: ~/Documents/Qgis/sartracker/
- 116 Python files, ~70K lines, 276 commits
- All domain logic to be ported from here

## Spike Outcomes
The major architecture risks have now been investigated through spikes. Older planning notes remain in the repo for traceability, but the spike results and handoff file are the current source of truth.

| # | Risk | Severity | Status |
|---|------|----------|--------|
| R1 | OSI maps offline-first | CRITICAL | Spike passed; waiting on production GeoPackage for final offline validation |
| R2 | Irish Grid coordinate accuracy (TM65/ITM/WGS84) | CRITICAL | Resolved in S2 with proj4js + validated TOWGS84 transform |
| R3 | Traccar transport strategy | HIGH | Resolved for v1: HTTP polling. WebSocket deferred to v2 |
| R4 | Auto-update security & rollback | HIGH | Tauri 2 validated; operational update policy still to be finalised in hardening phase |
| R5 | Mission state crash-safe persistence | MEDIUM | Resolved in S5 with SQLite WAL mission store |
| R6 | Magnetic declination policy | MEDIUM | Still open; current working assumption is fixed Ireland declination for v1 |
| R7 | Desktop distribution constraints | MEDIUM | Resolved for v1: Tauri 2, no code signing, target Windows/Linux team use |
| R8 | Terra Draw feature parity | MEDIUM | Resolved in S3 with custom SAR drawing support |

## Confirmed Architecture
- **Map rendering:** MapLibre GL JS
- **Coordinates:** `WGS84` for GPS/rendering, `ITM` as the internal working CRS, `TM65` for display only
- **Persistence:** SQLite in `WAL` mode behind a backend mission store exposed through Tauri commands
- **Tracking:** HTTP polling for Traccar v1 with retry, backoff, and stale-data handling
- **Layers:** Hybrid source/layer architecture from S6
- **Drawing:** Terra Draw + Turf.js + custom SAR geometry logic from S3

## Build Phases
- **Phase 1: Operational Core** — mission lifecycle, live tracking, breadcrumbs, coordinates, simple markers, offline maps
- **Phase 2: Tactical Drawing** — lines, polygons, range rings, bearing lines, sectors
- **Phase 3: Hardening** — updater/signing, replay mode, archive/export, field test feedback

## Timeline
- Spikes: complete
- Phase 1 build: current focus
- Phase 2-3: incremental
- Field testing: before any production use
- Current QGIS plugin remains operational fallback until standalone passes field validation

## Notes
- QGIS 4 is confirmed broken for SAR Tracker (Seán tested — layers all over the place, despite metadata declaring compat)
- Traccar v1 should use HTTP polling (proven in current plugin), WebSocket is a v2 enhancement
- Persistence should be SQLite-first, not JSON (current plugin already uses structured mission storage)
- `handoff/HANDOFF.md` is the authoritative continuity log for the next coding agent entering the repo
- Codex reviewed MIGRATION.md on 2026-04-06 — see ~/Documents/Qgis/sartracker/MIGRATION_REVIEW.md
