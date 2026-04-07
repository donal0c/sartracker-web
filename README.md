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

- **Real-time GPS tracking** of rescue team members via Traccar
- **Breadcrumb trails** showing where each team member has been
- **Mission management** — start, pause, resume, finish with dual timers
- **Map markers** — IPP/LKP, clues, hazards, casualties with metadata
- **Drawing tools** — search areas, range rings, bearing lines, search sectors
- **Irish Grid coordinates** — TM65 grid references and ITM, the formats rescue teams use
- **Offline maps** — works without internet on the mountain

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

# Run in development
npm run tauri dev

# Run tests
npm run test        # unit tests (vitest)
npm run test:e2e    # browser tests (Playwright)
npm run test:all    # everything
```

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- Platform dependencies for [Tauri](https://v2.tauri.app/start/prerequisites/)

## Background

This project replaces the [SAR Tracker QGIS Plugin](https://github.com/donal0c/sartracker), which was built as a QGIS plugin (~70K lines of Python). The standalone app removes the QGIS dependency, giving the team a simpler install, automatic updates, and no more version compatibility issues.

## Built For

[Kerry Mountain Rescue Team](https://www.kerrymountainrescue.ie/), Ireland 🏔️

---

**Status:** Active Development
