# HANDOFF.md — Current Project State

> **Read this before doing ANY work. Update this after EVERY chunk of work.**

## Last Updated
2026-04-07 20:50 by Codex

## Current State
**Phase: Pre-Build — All spikes complete, ready for Phase 1 build**

`HANDOFF.md` is the authoritative continuity log for active repo work across Donal, Codex, and Claude Code. Update it after every meaningful chunk so the next agent can resume without re-discovery.

## What's Been Done

### 2026-04-07 M1 scaffold implementation
- Scaffolded the app with Vite + React + TypeScript in the repo root and initialized `src-tauri/`
- Installed locked core dependencies: MapLibre, Turf, proj4, Terra Draw, Zustand, Tauri SQL plugin, Tailwind, Vitest, Playwright
- Configured Tailwind, Vite fixed dev port (`1420`), TypeScript strict mode, ESLint, Vitest, and Playwright
- Replaced the stock Vite demo with a minimal SAR Tracker shell using Zustand-backed scaffold state
- Added smoke coverage:
  - `tests/unit/scaffold-smoke.test.ts` for dependency resolution
  - `tests/e2e/scaffold.spec.ts` for app shell render
- Verification completed:
  - `npm run test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `npm run test:all` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
- `npm run tauri dev` starts correctly, launches Vite, and begins native Rust compilation; I stopped it after confirming startup path to avoid leaving long-running watchers in the workspace
- Cleaned up generated metadata defaults:
  - Rust crate renamed from generic `app` to `sartracker-web`
  - Tauri bundle identifier set to `ie.kmrt.sartrackerweb`

### 2026-04-06 Doc cleanup
- Aligned `README.md`, `OVERVIEW.md`, and supporting docs with the post-spike reality
- Marked older WebSocket/planning notes as deferred or historical where they no longer describe the active v1 plan
- Clarified that mission persistence is SQLite in WAL mode behind a backend store exposed through Tauri commands
- Clarified that this handoff file is the shared continuity document between coding agents

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
1. **Start M2: Map — MapLibre + basemaps + coordinate display**
2. **Begin M2 with tests/design first where practical** — keep the renderer thin and move coordinate logic into testable modules
3. **Copy only the required golden datasets/fixtures from the spikes** into `tests/fixtures/` when M2 needs them
4. **Make an explicit v1 magnetic declination decision** before implementing magnetic-bearing behaviour in later drawing work
5. **When GeoPackage arrives:** run the conversion pipeline, test in MapLibre

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
- If an older planning doc disagrees with the current implementation state, update the doc or defer to this handoff file plus `CODEX_START.md`
- `src-tauri/` is now initialized and the Tauri SQL plugin is wired in; persistence work should continue behind the MissionStore boundary only
