# HANDOFF.md — Current Project State

> **Read this before doing ANY work. Update this after EVERY chunk of work.**

## Last Updated
2026-04-06 12:30 by Forge (OpenClaw)

## Current State
**Phase: Pre-Build — All spikes complete, ready for Phase 1 build**

## What's Been Done

### Spikes (all passed ✅)
| Spike | Tests | Key Files |
|-------|-------|-----------|
| S1: OSI Maps | 29 (23 vitest + 6 Playwright) | spikes/S1-osi-maps/ |
| S2: Irish Grid | 201 vitest | spikes/S2-irish-grid/src/coordinates.ts, geodesic.ts |
| S3: Drawing Tools | 53 (31 vitest + 22 Playwright) | spikes/S3-drawing-tools/src/lib/ |
| S4: Tauri Distribution | Research only | spikes/S4-tauri-distribution/RESULTS.md |
| S5: Persistence | 35 vitest | spikes/S5-persistence/src/mission-store.ts |
| S6: Layer Architecture | 3 HTML prototypes | spikes/S6-layer-architecture/ |
| S7: Traccar Integration | 23 vitest | spikes/S7-traccar-integration/src/traccar-client.ts |

### Architecture Decisions Made
- Hybrid layer approach (3 sources, ~15 layers, filter-based toggling)
- SQLite WAL for persistence (not JSON)
- HTTP polling for Traccar v1 (not WebSocket)
- No code signing for v1 (team is Windows + Linux)
- proj4js with TOWGS84 for coordinates (NTv2 not needed)
- Strict TDD for all production code

### Waiting On
- **Eamonn:** KMRT_package.gpkg file (1.25GB GeoPackage with OSI Discovery maps)
- **Eamonn:** Traccar admin credentials for API testing (kmrtsar.ddns.net:8082)

## What's Next
1. **Initialise the main Vite + React + TypeScript project** in src/
2. **Set up test infrastructure** — vitest config, Playwright config, CI scripts
3. **Start Phase 1: Operational Core** — begin with mission lifecycle (TDD)
4. **When GeoPackage arrives:** run the conversion pipeline, test in MapLibre

## Active Beads
```
bd list
```

## Blockers
- None for Phase 1 start
- GeoPackage file needed for offline map validation (non-blocking for initial dev)
- Traccar credentials needed for live API testing (can mock for now)

## Notes
- Spike code is REFERENCE ONLY — do not import directly
- All production code must be written TDD from scratch
- Spike golden datasets and test fixtures CAN be copied to tests/fixtures/
