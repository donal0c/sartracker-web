# CODEX_START.md

**Welcome to SAR Tracker Web.**

If you are an AI coding assistant (Codex, Claude Code, etc.) reading this file, this is your starting point. It contains everything you need to understand the project, our architectural decisions, the research we've already done, and the rules of engagement.

## 1. The Mission

We are rebuilding "SAR Tracker" — a life-safety search and rescue application used by Kerry Mountain Rescue Team (KMRT) in Ireland.

Currently, SAR Tracker is a QGIS plugin (~70,000 lines of Python). It works, but QGIS is a massive dependency that breaks on every version update (e.g., Qt5→Qt6 migration, QGIS 4 breakages). The team is non-technical; they cannot troubleshoot GIS software.

**Our goal:** Replace the QGIS plugin with a bespoke, standalone desktop application that is stable, auto-updating, and tailored entirely to their operational needs.

**This is a LIFE-SAFETY CRITICAL system.** Wrong coordinates or dropped tracking data can endanger lives on the mountain. Rigour, exactness, and testing are non-negotiable.

## 2. The Stack

We have chosen this stack based on deep research and 7 technical spikes (detailed below):

*   **Desktop Shell:** Tauri 2 (Rust-based, small binary, cross-platform)
*   **UI Framework:** React + TypeScript + Vite
*   **Map Rendering:** MapLibre GL JS (WebGL)
*   **Drawing Interactions:** Terra Draw
*   **Geospatial Math:** Turf.js
*   **Coordinate Conversion:** proj4js
*   **Local Persistence:** SQLite in WAL mode, exposed to the frontend through Tauri commands
*   **Testing:** Vitest (unit) + Playwright (E2E UI)

## 3. What We Have Proven (The 7 Spikes)

Before writing production code, we ran 7 isolated spikes to validate our riskiest assumptions. **These are stored in the `spikes/` directory and serve as your golden reference implementations.**

1.  **S1 OSI Maps (`spikes/S1-osi-maps/`)**: MapLibre can render the required maps. *Note: We are waiting on a 1.25GB GeoPackage file from the team containing their offline OSI Discovery Series maps. For now, use OpenTopoMap or OSM as fallbacks.*
2.  **S2 Irish Grid (`spikes/S2-irish-grid/`)**: We proved that `proj4js` using a specific TOWGS84 7-parameter transform achieves sub-millimeter accuracy matching QGIS for converting between WGS84 and ITM (EPSG:2157) / TM65 (EPSG:29902). **Use the math and tests here.**
3.  **S3 Drawing Tools (`spikes/S3-drawing-tools/`)**: Terra Draw + Turf.js + our ported geodesic math can successfully replicate all 8 SAR drawing tools (markers, lines, polygons, range rings, bearing lines, sectors, measurement).
4.  **S4 Tauri Distribution (`spikes/S4-tauri-distribution/`)**: Research confirmed Tauri 2 is viable. *Decision: No code signing for v1, as the team uses Windows/Linux.*
5.  **S5 Persistence (`spikes/S5-persistence/`)**: Proved that SQLite in WAL mode provides crash-safe, atomic persistence for mission state. Far superior to raw JSON files.
6.  **S6 Layer Architecture (`spikes/S6-layer-architecture/`)**: Proved that a "Hybrid" approach (3 GeoJSON sources for tracking/markers/drawings, filtered into ~15 style layers) performs vastly better (30K points @ 60FPS) than the QGIS "100+ separate layers" approach.
7.  **S7 Traccar Integration (`spikes/S7-traccar-integration/`)**: Built a robust HTTP polling client for the Traccar GPS server, handling auth, retries, exponential backoff, and stale-data detection.

## 4. Architectural Rules & Decisions

*   **TDD is Mandatory:** Write tests first. Every module needs unit tests. Every user flow needs Playwright E2E tests.
*   **Coordinate Safety:**
    *   **WGS84 (EPSG:4326)** is for GPS input and MapLibre rendering.
    *   **ITM (EPSG:2157)** is the internal working coordinate system for persistence.
    *   **TM65** is for DISPLAY ONLY (Irish Grid References like "V 80245 84452").
    *   *Always* validate inputs (no NaN/Infinity) before converting.
*   **State Management:** Do not let React component state become the source of truth for mission data. Mission state must be serializable and crash-recoverable (SQLite).
*   **Persistence Boundary:** The renderer must not talk to SQLite directly. Mission persistence lives behind a backend store exposed through Tauri commands so writes remain controlled, testable, and crash-safe.
*   **Layer Architecture:** Use the Hybrid approach from Spike S6. Use MapLibre filter expressions for visibility toggling.
*   **Traccar Strategy:** Use HTTP polling for v1 (already proven in S7). WebSocket push is a v2 enhancement.

## 5. Development Workflow & Handoff

You are part of a multi-agent team:
*   **Donal + You (Codex/Claude Code):** You live in the repo, write the code, run the tests, and make commits.
*   **Forge (OpenClaw):** Lives outside the repo. Handles planning, research, architectural reviews, and coordinating spikes.

**The Loop:**
1.  Check the active task via the `bd` (beads) CLI tool: `bd list` -> `bd show <id>`
2.  Read `handoff/HANDOFF.md` to see the exact current state. Treat it as the authoritative log for in-flight work, decisions made during implementation, and what the next agent should do.
3.  Do the work (TDD).
4.  Run tests: `npm run test:all`
5.  Commit with the bead ID in the message: `feat: add coordinate bar [sartracker-web-abc]`
6.  Update the bead: `bd comment <id> "..."` and `bd close <id>` if done.
7.  **Crucially: Update `handoff/HANDOFF.md`** so Forge knows what you did and what's next.

## 6. What To Do Next

1. Read `CLAUDE.md` and `AGENTS.md` for condensed rules and context.
2. Read `handoff/HANDOFF.md` for your immediate starting instructions.
3. Check `bd list` for your first assigned task (likely setting up the Vite/React/Tauri scaffold).

Good luck.
