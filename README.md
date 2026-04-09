# SAR Tracker Web

**Standalone Search & Rescue Tracking Console for Kerry Mountain Rescue**

A bespoke desktop application for real-time GPS tracking, mission management, and search area planning during mountain rescue operations.

![Tauri 2](https://img.shields.io/badge/Tauri-2.0-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![License](https://img.shields.io/badge/License-GPL--2.0-green)

---

## ⚠️ Life-Safety Critical

This application is used during real search and rescue operations. Accuracy, reliability, and crash safety are non-negotiable.

---

## What It Does

- **Map operations shell** with Kerry-centred MapLibre rendering and 4 selectable basemaps
- **Mission management** — start, pause, resume, finish, recover on restart, dual timers
- **Real-time GPS tracking runtime** via Traccar HTTP polling with breadcrumb/history persistence
- **Map markers** — IPP/LKP, clues, hazards, casualties with metadata and map-edit flows
- **Layer filtering** for people, markers, and persisted drawing records
- **Irish Grid coordinates** — WGS84, ITM, and TM65 display in the operator UI
- **Tile caching after view** via service worker for limited offline resilience

## Current Build Status

The current implementation line is:

- `M1-M7` complete
- `M8` drawing tools: not implemented yet
- `M9` measurement tool: not implemented yet
- `M10` full mission-flow E2E: not implemented yet

That means the app already has a real map shell, mission lifecycle, tracking runtime, marker CRUD, persistence, and the right-sidebar layer panel. It does not yet have operator drawing tools, measurement tools, or bundled offline topo maps.

## Stack

| Component | Technology |
|-----------|-----------|
| Desktop | Tauri 2 |
| UI | React + TypeScript + Vite |
| Maps | MapLibre GL JS |
| Drawing | Terra Draw + Turf.js |
| Coordinates | proj4js |
| Persistence | SQLite (WAL mode) |
| State | Zustand |

## Development

```bash
# Install dependencies
npm install

# Run browser development shell
npm run dev

# Run Tauri desktop development shell
npm run tauri dev

# Run tests
npm run test        # unit tests (vitest)
npm run test:e2e    # browser tests (Playwright)
npm run test:all    # everything
```

### Browser Validation Harness

For fast manual testing of mission and marker flows without the Tauri backend:

1. Run `npm run dev`
2. Open `http://127.0.0.1:1420/?missionHarness=1`
3. Start a mission, click the map to create/edit markers, and test recovery by reloading

The harness uses the real runtime/controller flow in browser mode and stores state in `sessionStorage`.

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- Platform dependencies for [Tauri](https://v2.tauri.app/start/prerequisites/)

## Background

This project replaces the [SAR Tracker QGIS Plugin](https://github.com/donal0c/sartracker), which was built as a QGIS plugin (~70K lines of Python). The standalone app removes the QGIS dependency, giving the team a simpler install, automatic updates, and no more version compatibility issues.

## Built For

[Kerry Mountain Rescue Team](https://www.kerrymountainrescue.ie/), Ireland 🏔️

---

**Status:** Active Development, with Phase 1 implemented through M7
