# SAR Tracker — Project Overview

## What Is This?

SAR Tracker is a GPS tracking and mission management tool built for **Kerry Mountain Rescue Team (KMRT)**, Ireland. It's used during real search and rescue operations to track team members in the mountains, manage missions, place markers, draw search areas, and coordinate rescue efforts.

## Current State

SAR Tracker currently exists as a **QGIS plugin** (~70,000 lines of Python, 276 commits). It's production-ready and in pre-launch testing with the team.

**Plugin location:** `~/Documents/Qgis/sartracker/`

### Features (all working in the plugin)
- Real-time GPS tracking via Traccar HTTP server (OsmAnd protocol)
- Breadcrumb trails per device with coloured tracks
- Mission lifecycle: start → pause → resume → finish (with dual timers)
- Markers: IPP/LKP (blue), Clues (orange), Hazards (red), Casualties (red star)
- Drawing tools: Lines, Search Area polygons, Range Rings (manual + Lost Person Behaviour probability), Bearing Lines (true/magnetic), Search Sectors
- Irish Grid coordinate conversion (TM65, ITM, WGS84)
- Coordinate converter dialog
- Auto-save and auto-refresh (configurable intervals)
- Device list panel with filtering
- Focus mode (distraction-free ops)
- Mission resume on QGIS restart
- Replay/testing mode for training exercises
- OSI Discovery Series 1:50,000 topographic maps

## The Problem

QGIS version updates keep breaking the plugin. The team is non-technical and can't troubleshoot QGIS issues. Key pain points:

1. **Qt5 → Qt6 migration** required a 1,000-line compatibility shim file
2. **QGIS 4** — team member upgraded, "nothing works, layers all over the place"
3. **Every QGIS update** = Donal gets phone calls to fix compatibility issues
4. **QGIS is massive overkill** — the team uses only the map canvas and layers. Everything else is plugin code.
5. **Schema migrations** between QGIS versions cause data inconsistencies
6. **Installation friction** — two-step process (install QGIS, then install plugin)

## The Plan

**Build a bespoke standalone desktop application** that replaces the QGIS plugin entirely. Port all domain logic from Python to TypeScript.

### Confirmed Stack
| Component | Technology | Replaces |
|-----------|-----------|----------|
| Desktop wrapper | Tauri 2 | QGIS application |
| Map rendering | MapLibre GL JS | QgsMapCanvas |
| Drawing tools | Terra Draw | QgsMapTool / QgsRubberBand |
| Geospatial maths | Turf.js | Custom Python drawing_math.py |
| Coordinates | proj4js | QgsCoordinateTransform |
| UI | TypeScript + React | PyQt5/6 widgets |
| Offline tiles | PMTiles / GeoPackage-derived tiles | QGIS raster layers |
| Auto-update | Tauri updater plugin | Manual QGIS plugin updates |

### Key Advantages
- **One installer** (~10MB), no QGIS dependency
- **Auto-updates** pushed silently — team always on latest version
- **Full control** over update cycle — no more QGIS version breakage
- **Offline-first** maps bundled with the app
- **Cross-platform** Mac/Windows/Linux from one codebase

## Architecture Status

The initial risks were reviewed by a 3-model Agent Council and then validated through 7 technical spikes. At this point, the repo is no longer in open-ended research mode; it is in pre-build with a defined architecture.

| # | Risk | Severity | Status |
|---|------|----------|--------|
| R1 | OSI maps offline-first | CRITICAL | Spike passed; production GeoPackage still awaited for final validation |
| R2 | Irish Grid coordinate accuracy | CRITICAL | Resolved via S2 using validated proj4js transform |
| R3 | Traccar live updates | HIGH | Resolved for v1 with HTTP polling; WebSocket deferred |
| R4 | Auto-update security & rollback | HIGH | Deferred to hardening policy work after core build |
| R5 | Mission state crash-safe persistence | MEDIUM | Resolved via S5 with SQLite WAL |
| R6 | Magnetic declination policy | MEDIUM | Still open for explicit v1 product decision |
| R7 | Desktop distribution | MEDIUM | Resolved for v1 with Tauri 2 and no code signing |
| R8 | Terra Draw feature parity | LOW | Resolved via S3 |

## What The Spikes Established

1. **Coordinates:** `ITM` is the internal working CRS, `TM65` is display-only, and the chosen transform matches QGIS accuracy.
2. **Persistence:** SQLite in `WAL` mode is the production direction, not JSON files.
3. **Tracking:** HTTP polling is the correct v1 transport because it matches the proven plugin model and avoids WebSocket reconnection complexity.
4. **Layers:** A hybrid `3-source / ~15-layer` MapLibre architecture performs well enough for large breadcrumb datasets.
5. **Drawing:** Terra Draw plus custom geometry logic covers the SAR-specific toolset.

## Current Execution State

- **Phase:** Pre-build, ready for scaffold and Phase 1 implementation
- **Immediate next steps:** scaffold the app, set up test infrastructure, then build mission lifecycle first with TDD
- **Operational continuity:** `handoff/HANDOFF.md` is the authoritative in-repo log for whichever coding agent works next

## Project Structure

```
sartracker-web/
├── README.md              ← Master plan and risk table
├── OVERVIEW.md            ← This file
├── research/              ← Deep research on each risk
│   ├── R1-osi-maps-offline.md
│   ├── R2-irish-grid-accuracy.md
│   ├── R3-traccar-websocket.md
│   └── R4-R8-other-risks.md
├── spikes/                ← Prototype code for risk validation
└── specs/                 ← Architecture specs and build plans
```

## Documentation & References

- **Planning docs:** `~/workspace/vibes/sartracker-web/research/`
- **Current QGIS plugin:** `~/Documents/Qgis/sartracker/`
- **Plugin README:** `~/Documents/Qgis/sartracker/README.md`
- **Pre-launch issues:** `~/Documents/Qgis/sartracker/PRE_LAUNCH/`
- **KMRT Tracker PWA** (companion mobile tracker): `~/workspace/vibes/kmrt-tracker/` — deployed at https://kmrt-tracker.netlify.app
- **Traccar server:** `kmrtsar.ddns.net:5055` (OsmAnd protocol)

## Team

- **Developer:** Donal O'Callaghan
- **Team lead (KMRT):** Eamonn O'Connor
- **Users:** ~30 volunteer mountain rescue members (Kerry, Ireland)
- **AI assistants:** Claude Code, Codex, Gemini (for research and development)

## Timeline

- **Now:** Scaffold and Phase 1 build
- **Next:** Operational core features with tests-first workflow
- **Then:** Hardening, field validation, and deployment preparation
- **Before production:** Field testing with team
