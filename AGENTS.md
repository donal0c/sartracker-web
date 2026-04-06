# AGENTS.md — SAR Tracker Web

## ⚠️ LIFE-SAFETY CRITICAL

This is a search and rescue tracking application for Kerry Mountain Rescue Team (KMRT), Ireland. It replaces a QGIS plugin with a standalone desktop app. Wrong coordinates, broken tracking, or data loss can endanger lives. Act accordingly.

## Project Context

### What
Bespoke desktop SAR tracking and mission management application. Tracks rescue team members via GPS, displays positions and breadcrumb trails on topographic maps, provides drawing tools for search area planning, and manages mission lifecycle.

### Who
- **Developer:** Donal O'Callaghan
- **Team lead (KMRT):** Eamonn O'Connor
- **Users:** ~30 volunteer mountain rescue members (Kerry, Ireland)
- **Platforms:** Windows + Linux (team), macOS (developer)

### Why
The existing QGIS plugin (~70K lines Python) breaks on every QGIS version update. The team is non-technical and can't troubleshoot QGIS issues. A standalone app gives full control over updates and removes the QGIS dependency.

## Architecture Decisions (validated by spikes)

All architecture decisions were validated through 7 technical spikes AND reviewed by a 3-model Agent Council (Claude Opus, Gemini 3.1 Pro, GPT 5.4). See spikes/ for evidence.

| Decision | Evidence | Spike |
|----------|----------|-------|
| proj4js for Irish Grid (TM65/ITM) | Sub-mm accuracy, matches QGIS | S2 |
| MapLibre GL JS for map rendering | Renders topo tiles, handles 30K features | S1, S6 |
| Hybrid layer architecture (3 sources, ~15 layers) | Best performance + granularity | S6 |
| Terra Draw + custom for drawing tools | All 8 tools working | S3 |
| SQLite WAL for persistence | Crash-safe, 420K pos/sec | S5 |
| HTTP polling for Traccar v1 | Proven, matches plugin approach | S7 |
| Tauri 2 for desktop wrapper | ~15MB binary, auto-update | S4 |
| No code signing for v1 | Team is Windows+Linux, saves $220/yr | S4 |

## Build Phases

### Phase 1: Operational Core
- [ ] Mission lifecycle (start/pause/resume/finish)
- [ ] Traccar HTTP polling → device positions + breadcrumbs
- [ ] MapLibre map with basemap switcher
- [ ] Coordinate display (WGS84 + Irish Grid)
- [ ] Simple markers (IPP/LKP, clues, hazards, casualties)
- [ ] Layer/filter panel
- [ ] SQLite persistence + autosave

### Phase 2: Tactical Drawing
- [ ] Lines with distance
- [ ] Search area polygons with metadata
- [ ] Range rings (manual + LPB)
- [ ] Bearing lines (true/magnetic)
- [ ] Search sectors
- [ ] Measurement tool
- [ ] Select/edit/delete

### Phase 3: Hardening
- [ ] Tauri build + packaging
- [ ] Auto-updater
- [ ] Replay/training mode
- [ ] Offline GeoPackage tile loading
- [ ] Field testing with KMRT

## Development Process

### Strict TDD
Every feature starts with a failing test. No exceptions. This is a life-safety system.

### Handoff Protocol
After every chunk of work:
1. Update `handoff/HANDOFF.md` with what was done and what's next
2. Update the relevant bead (`bd comment <id> "..."`)
3. Commit with bead reference
4. Run full test suite

Before starting work:
1. Read `CLAUDE.md`
2. Read this file
3. Read `handoff/HANDOFF.md`
4. Check beads: `bd list`

### Multi-Agent Coordination
- **Donal + Codex/Claude Code** — primary coding, in the repo
- **Forge (OpenClaw)** — planning, research, spike coordination, reviews
- **Handoff file** is the bridge — always current, always read before work

### Beads
Issue tracking lives in beads. Every piece of work has a bead.
```bash
bd list          # see all open issues
bd show <id>     # see details
bd create --title "..." --body "..."  # create new
bd close <id>    # mark done
```

## Key Coordinates (for testing)

| Location | Lat | Lon | ITM E | ITM N | TM65 Grid Ref |
|----------|-----|-----|-------|-------|----------------|
| Carrauntoohil summit | 51.9990 | -9.7440 | 480245 | 584452 | V 80245 84452 |
| Killarney | 52.0599 | -9.5045 | 496584 | 591256 | V 96584 91256 |
| Tralee | 52.2709 | -9.7022 | 483517 | 614796 | Q 83517 14796 |

## Source Plugin Reference
`~/Documents/Qgis/sartracker/` — the original QGIS plugin (read-only reference)
