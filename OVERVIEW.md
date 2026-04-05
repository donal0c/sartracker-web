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

### Proposed Stack
| Component | Technology | Replaces |
|-----------|-----------|----------|
| Desktop wrapper | Tauri 2 | QGIS application |
| Map rendering | MapLibre GL JS | QgsMapCanvas |
| Drawing tools | Terra Draw | QgsMapTool / QgsRubberBand |
| Geospatial maths | Turf.js | Custom Python drawing_math.py |
| Coordinates | proj4js | QgsCoordinateTransform |
| UI | TypeScript + React | PyQt5/6 widgets |
| Offline tiles | PMTiles | QGIS raster layers |
| Auto-update | Tauri updater plugin | Manual QGIS plugin updates |

### Key Advantages
- **One installer** (~10MB), no QGIS dependency
- **Auto-updates** pushed silently — team always on latest version
- **Full control** over update cycle — no more QGIS version breakage
- **Offline-first** maps bundled with the app
- **Cross-platform** Mac/Windows/Linux from one codebase

## Identified Risks

Reviewed by a 3-model Agent Council (Claude Opus 4.6, Gemini 3.1 Pro, GPT 5.4). Full council verdict in research docs.

| # | Risk | Severity | Status |
|---|------|----------|--------|
| R1 | OSI maps offline-first | CRITICAL | ⏳ Waiting on Eamonn for MapGenie access |
| R2 | Irish Grid coordinate accuracy (TM65/NTv2) | CRITICAL | 🔬 Needs research |
| R3 | Traccar WebSocket reconnect/reconciliation | HIGH | 🔬 Needs research |
| R4 | Auto-update security & rollback | HIGH | 🔬 Needs research |
| R5 | Mission state crash-safe persistence | MEDIUM | 🔬 Needs research |
| R6 | Magnetic declination (dynamic vs hardcoded) | MEDIUM | 🔬 Needs research |
| R7 | Tauri Windows/macOS distribution (signing) | MEDIUM | 🔬 Needs research |
| R8 | Terra Draw feature parity (range rings) | LOW | 🔬 Needs research |

## Spike Plan

Each critical risk gets a focused prototype before full build begins:

1. **Map Spike** — MapLibre + OSI MapGenie WMTS + offline tiles
2. **Coordinate Spike** — proj4js TM65 validation against QGIS golden dataset
3. **Persistence Spike** — atomic JSON save/load with crash recovery
4. **Traccar Spike** — WebSocket + HTTP fallback with gap healing

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

- **Now:** Planning, risk research, spike preparation
- **Next:** Validate spikes (maps, coordinates, persistence, Traccar)
- **Then:** Full build (estimated 25-30 days AI-assisted)
- **Before production:** Field testing with team
