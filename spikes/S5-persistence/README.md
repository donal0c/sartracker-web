# S5: Crash-Safe Mission Persistence

## Goal
Validate a durable, crash-safe storage model for mission state that matches or exceeds the current plugin's persistence guarantees.

## Current Plugin Approach
The plugin uses SQLite/GeoPackage with snapshot semantics.
See: `~/Documents/Qgis/sartracker/utils/mission_storage.py`

## Approach to validate: SQLite via Tauri SQL plugin
- Mission state in SQLite (features, markers, drawings, device history)
- Autosave writes to SQLite transactionally
- On crash/restart: open existing DB, detect paused mission, offer resume
- Schema versioning with migration functions

## Pass Criteria
- [ ] Kill app mid-save — no data loss on reopen
- [ ] Force quit during active mission — resume correctly on reopen
- [ ] Schema migration works from v1 → v2 without data loss
- [ ] Autosave every 60s without blocking the UI thread
- [ ] Mission archive: export to a portable file format
