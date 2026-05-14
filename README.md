# SAR Tracker Web

**Standalone Search & Rescue Tracking Console for Mountain Rescue**

A bespoke desktop application for real-time GPS tracking, mission management, and search area planning during mountain rescue operations.

![Tauri 2](https://img.shields.io/badge/Tauri-2.0-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![License](https://img.shields.io/badge/License-GPL--2.0-green)

---

## ⚠️ Life-Safety Critical

This application is used during real search and rescue operations. Accuracy, reliability, and crash safety are non-negotiable.

---

## What It Does

- **Map operations shell** with mountain-region MapLibre rendering and 4 selectable basemaps
- **Mission management** — start, pause, resume, finish, recover on restart, dual timers
- **Real-time GPS tracking runtime** via Traccar HTTP polling with breadcrumb/history persistence
- **Map markers** — IPP/LKP, clues, hazards, casualties with metadata and map-edit flows
- **Layer workspace** for people, helicopters, markers, drawings, measurements, and GPX overlays
- **Drawing and measurement tools** — lines, search areas, range rings, bearings, sectors, text labels, and quick distance/bearing checks
- **GPX and helicopter operations** — GPX import/watch surfaces and four aviation slot records in the desktop app
- **Irish Grid coordinates** — WGS84, ITM, and TM65 display in the operator UI
- **Tile caching after view** via service worker for limited offline resilience
- **Operator manual** — bundled at `public/manual/index.html` and linked from the app Help button

## Current Build Status

The current implementation line has moved past the original M1-M10 scaffold. The app now has a real map shell, mission lifecycle, tracking runtime, marker CRUD, drawing tools, measurement tools, GPX surfaces, helicopter slots, diagnostics, mission review, persistence, and a richer layer workspace.

Known remaining parity gaps include full packaged offline map bundles, replay/training mode parity, richer mission metadata capture, hosted browser hardening, and final QGIS replacement acceptance.

## Hosted Browser Testing

The Vercel-hosted app is a testing and possible future deployment path, but it is not automatically equivalent to the installed Tauri app.

Current plan: [`docs/hosted-browser-testing-plan.md`](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/hosted-browser-testing-plan.md)

Phase 0 intentionally uses browser session storage so teams can test the current operator surface quickly. The installed Tauri app remains the durable runtime with SQLite, WAL mode, backup mirror, and desktop filesystem adapters.

Execution guides:

- [`docs/two-track-execution-workplan.md`](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/two-track-execution-workplan.md) — current two-track work queue
- [`docs/team-testing-feedback-loop.md`](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/team-testing-feedback-loop.md) — hosted testing instructions and bug triage
- [`docs/tauri-beta-release-plan.md`](/Users/donalocallaghan/workspace/vibes/sartracker-web/docs/tauri-beta-release-plan.md) — Phase 1 desktop beta plan

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

# Run verification
npm run lint         # static analysis
npm run build        # TypeScript, Vite, and bundle budgets
npm run test         # JS unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright projects)
npm run test:backend # Tauri/Rust backend tests (Cargo)
npm run test:all     # JS unit + Playwright + backend tests
```

### Browser Validation Harness

For fast manual testing of mission and marker flows without the Tauri backend:

1. Run `npm run dev`
2. Open `http://127.0.0.1:1420/?missionHarness=1`
3. Start a mission, click the map to create/edit markers, and test recovery by reloading

The harness uses the real runtime/controller flow in browser mode and stores state in `sessionStorage`.

Hosted browser testing follows the same temporary persistence model and must be opened with `?missionHarness=1` until the browser runtime is hardened.

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- Platform dependencies for [Tauri](https://v2.tauri.app/start/prerequisites/)

## Background

This project replaces the [SAR Tracker QGIS Plugin](https://github.com/donal0c/sartracker), which was built as a QGIS plugin (~70K lines of Python). The standalone app removes the QGIS dependency, giving the team a simpler install, automatic updates, and no more version compatibility issues.

## Built For

Mountain Rescue teams operating in demanding field conditions.

---

**Status:** Active Development — Phase 2 parity program largely complete; M13 (replay), M25 (offline map bundles), and M26 (acceptance sweep) remain as the main open beads.
