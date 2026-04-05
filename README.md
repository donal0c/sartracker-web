# SAR Tracker Web — Bespoke Replacement for QGIS Plugin

## What
Replace the QGIS-based SAR Tracker plugin with a standalone desktop application for Kerry Mountain Rescue Team.

## Why
- QGIS version updates keep breaking the plugin (Qt5→Qt6, QGIS 4 incompatibility)
- The team uses 5% of QGIS — everything else is custom plugin code
- Non-technical volunteers can't troubleshoot QGIS issues
- Every QGIS update = Donal on the phone firefighting

## Proposed Stack
- **Tauri 2** — desktop wrapper, auto-update, ~10MB binary
- **MapLibre GL JS** — WebGL map rendering
- **Terra Draw** — drawing tools (polygon, circle, sector, line, select)
- **Turf.js** — geospatial maths (range rings, bearings, distance)
- **proj4js** — coordinate conversion (TM65/ITM/WGS84)
- **TypeScript + React** — UI
- **PMTiles** — offline map tiles

## Status
- **Phase: Planning & Risk Research**
- Decision: BUILD BESPOKE (confirmed by 3-model Agent Council review)
- Waiting on: Eamonn re MapGenie/OSI tile access details

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

## Risks (from Agent Council review — each needs deep investigation)
See research/ for detailed investigation of each.

| # | Risk | Severity | Status |
|---|------|----------|--------|
| R1 | OSI maps offline-first | CRITICAL | ⏳ Waiting on Eamonn for MapGenie access |
| R2 | Irish Grid coordinate accuracy (TM65/NTv2) | CRITICAL | 🔬 Needs research |
| R3 | Traccar WebSocket reconnect/reconciliation | HIGH | 🔬 Needs research |
| R4 | Auto-update security & rollback | HIGH | 🔬 Needs research |
| R5 | Mission state crash-safe persistence | MEDIUM | 🔬 Needs research |
| R6 | Magnetic declination (dynamic vs hardcoded) | MEDIUM | 🔬 Needs research |
| R7 | Tauri Windows/macOS distribution (signing, WebView2) | MEDIUM | 🔬 Needs research |
| R8 | Terra Draw feature parity (range rings, bearings, sectors) | MEDIUM | 🔬 Needs research |

## Spike Plan (after risks researched)
1. **Map Spike** — MapLibre + OSI MapGenie WMTS + offline tiles (R1)
2. **Coordinate Spike** — proj4js TM65 validation against QGIS golden dataset (R2)
3. **Persistence Spike** — SQLite-first mission store with crash recovery (R5)
4. **Traccar Spike** — HTTP polling baseline (port existing logic), WebSocket as optional v2 (R3)
5. **Drawing Spike** — bearing lines, range rings, sectors via Terra Draw + Turf.js (R8)

## Build Phases (after spikes pass)
- **Phase 1: Operational Core** — mission lifecycle, live tracking, breadcrumbs, coordinates, simple markers, offline maps
- **Phase 2: Tactical Drawing** — lines, polygons, range rings, bearing lines, sectors
- **Phase 3: Hardening** — updater/signing, replay mode, archive/export, field test feedback

## Timeline
- Planning & risk research: this week
- Spikes: once risks are understood
- Phase 1 build: after spikes validated
- Phase 2-3: incremental
- Field testing: before any production use
- Current QGIS plugin remains operational fallback until standalone passes field validation

## Notes
- QGIS 4 is confirmed broken for SAR Tracker (Seán tested — layers all over the place, despite metadata declaring compat)
- Traccar v1 should use HTTP polling (proven in current plugin), WebSocket is a v2 enhancement
- Persistence should be SQLite-first, not JSON (current plugin already uses structured mission storage)
- Codex reviewed MIGRATION.md on 2026-04-06 — see ~/Documents/Qgis/sartracker/MIGRATION_REVIEW.md
