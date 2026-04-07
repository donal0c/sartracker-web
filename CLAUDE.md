# CLAUDE.md — SAR Tracker Web

## ⚠️ LIFE-SAFETY CRITICAL APPLICATION

This application is used by Kerry Mountain Rescue Team during real search and rescue operations. Incorrect coordinates, broken tracking, or data loss could endanger lives. Treat every change with the seriousness that demands.

## Before You Start

1. **Read this file completely**
2. **Read AGENTS.md** for project context and architecture
3. **Read handoff/HANDOFF.md** for the current state and what was last done
4. **Read the relevant bead** for whatever you're working on (`bd list`, `bd show <id>`)

`handoff/HANDOFF.md` is the shared continuity document between Donal, Codex, and Claude Code. If there is any mismatch between older planning docs and the current implementation state, follow the handoff file and update stale docs as part of the work.

## After Every Chunk of Work

1. **Update handoff/HANDOFF.md** — what you did, what's next, any blockers
2. **Update the bead** — close it, add comments, update status
3. **Commit with a descriptive message** referencing the bead ID
4. **Run the full test suite** — nothing ships without green tests

## Development Rules

### Strict TDD — No Exceptions
1. Write the test FIRST
2. Run it — it must FAIL (red)
3. Write the minimum code to pass
4. Run it — it must PASS (green)
5. Refactor if needed
6. Every module gets unit tests + integration tests
7. Every user-facing flow gets Playwright E2E tests

### Feature Delivery Workflow
For every feature bead after scaffolding:
1. Do a short design pass before implementation
2. Write down the safety invariants and failure modes
3. Define the test plan before writing production code
4. Start with failing tests for the core behaviour
5. Only then implement the feature

For scaffold and tooling beads, be pragmatic. For behaviour-bearing features, tests-first is the default and should only be skipped with an explicit reason recorded in `handoff/HANDOFF.md`.

### Code Quality
- TypeScript strict mode — no `any` types
- All functions must have JSDoc comments
- All coordinate functions must validate inputs (NaN, Infinity, out-of-range)
- Error messages must be clear and actionable — volunteers will see them
- No silent failures — log and surface errors
- Prefer deterministic tests over brittle snapshots
- Prefer simple, boring infrastructure choices over clever abstractions
- If a safety-critical path fails, fail loudly and visibly rather than silently falling back

### Coordinate Safety
- ITM (EPSG:2157) is the working CRS
- TM65 is display-only (Irish Grid references)
- WGS84 (EPSG:4326) for GPS input and map display
- All coordinate transforms must be validated against the golden dataset in spikes/S2-irish-grid/
- Magnetic declination for Ireland: -4.5° (true → magnetic: subtract, magnetic → true: add)

### Commits
- Reference bead IDs in commit messages: `feat(tracking): add device polling [sartracker-web-xyz]`
- Atomic commits — one logical change per commit
- Never commit failing tests

### Bead Planning Checklist
Before implementing a feature bead, capture these explicitly in the bead notes, handoff, or working notes:
- Goal and non-goals
- Safety invariants
- Failure modes
- Persistence impact
- Coordinate impact
- What must never regress
- Test plan

If an architectural decision is made during execution, record it in `handoff/HANDOFF.md` so the next coding agent inherits the same assumptions.

## Architecture

### Stack
- **Tauri 2** — desktop wrapper
- **Vite + React + TypeScript** — UI
- **MapLibre GL JS** — map rendering
- **Terra Draw** — drawing interactions (polygons, lines)
- **Turf.js** — geospatial calculations
- **proj4js** — coordinate conversion
- **SQLite mission store behind Tauri commands** — mission persistence (WAL mode)

### Layer Architecture (from S6 spike)
- **Hybrid approach**: 3 sources (tracking, markers, drawings) + ~15 style layers
- Filter-based visibility toggling per item
- NOT one-layer-per-feature like QGIS

### Persistence (from S5 spike)
- SQLite with WAL mode — crash-safe by default
- Atomic operations — no partial writes
- Schema versioned with migrations
- Backup rotation — keep last 3
- Renderer does not access the database directly; persistence is mediated by a backend mission store

### Domain Boundaries
- The renderer stays thin
- Safety-critical logic lives in testable modules behind clear interfaces
- Domain logic, persistence, and coordinate transformation code must not be buried inside React components
- Spike code is evidence and reference material, not production code to import directly

### Testing Strategy
- Unit tests for pure logic, transforms, validators, and domain rules
- Integration tests for module boundaries such as MissionStore, Traccar polling, and layer-state shaping
- Playwright E2E tests only for genuine operator workflows
- New features should normally add or update tests at the lowest meaningful level first, then add higher-level coverage where warranted

### Traccar Integration (from S7 spike)
- HTTP polling for v1 (proven, reliable)
- WebSocket enhancement for v2
- Retry with exponential backoff
- Last-good cache when server unreachable
- Stale device detection (>5 min no update)

## Project Structure
```
sartracker-web/
├── CLAUDE.md              ← you are here
├── AGENTS.md              ← project context and architecture
├── README.md              ← project overview and risk table
├── OVERVIEW.md            ← detailed project description
├── handoff/
│   └── HANDOFF.md         ← current state, last work done, next steps
├── src/
│   ├── lib/               ← core libraries (coordinates, geodesic, traccar, store)
│   ├── components/        ← React components
│   ├── hooks/             ← React hooks
│   ├── utils/             ← utility functions
│   └── types/             ← TypeScript type definitions
├── tests/
│   ├── unit/              ← vitest unit tests
│   ├── e2e/               ← Playwright E2E tests
│   └── fixtures/          ← test data (golden datasets, mock responses)
├── spikes/                ← ARCHIVED spike code (reference only, do not modify)
├── specs/                 ← architecture specs
└── docs/                  ← reference documentation
```

## Spike Reference (read-only)
All spikes passed. Use them as reference implementations and test fixtures:
- `spikes/S1-osi-maps/` — MapLibre basemap switcher, offline caching, coordinate display
- `spikes/S2-irish-grid/` — proj4js coordinate conversion, golden dataset, grid reference formatting
- `spikes/S3-drawing-tools/` — all 8 drawing tools with UI, geodesic math, LPB data
- `spikes/S4-tauri-distribution/` — distribution research, updater config, signing analysis
- `spikes/S5-persistence/` — SQLite mission store, schema, migrations, crash recovery
- `spikes/S6-layer-architecture/` — hybrid layer approach, synthetic data, filter panel
- `spikes/S7-traccar-integration/` — Traccar HTTP client, polling manager, connection test

## Testing
```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# All tests
npm run test:all
```

## Key Files in the QGIS Plugin (reference)
The original Python plugin is at ~/Documents/Qgis/sartracker/
- `utils/coordinates.py` — coordinate conversion (port reference)
- `utils/drawing_math.py` — geodesic math (port reference)
- `utils/mission_storage.py` — persistence approach (port reference)
- `providers/traccar_http.py` — Traccar integration (port reference)
- `controllers/layer_managers/drawing_manager.py` — drawing tools (port reference)
- `layers/schema.py` — layer structure (port reference)
