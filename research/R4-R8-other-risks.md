# R4: Auto-Update Security & Rollback

## Risk Level: HIGH
## Status: 🔬 Needs research

## The Problem
Auto-update in a life-safety desktop app is a supply-chain boundary. A broken update during an active rescue could be catastrophic. The update mechanism needs to be hardened.

## Research Needed
- [ ] Tauri 2 updater plugin capabilities (signing, rollback, staged rollout)
- [ ] GitHub Releases as update server — how does Tauri consume it?
- [ ] Code signing: Apple Developer cert for macOS, what for Windows?
- [ ] Cost of Apple Developer Program ($99/yr) — justified?
- [ ] Can updates be deferred/skipped if app is mid-mission?
- [ ] Rollback mechanism if an update breaks something
- [ ] What happens if update is interrupted mid-download?

## Design Requirements
- Signed update artifacts
- "Update available" notification — not forced during active mission
- One-click rollback to previous version
- Update only on app startup, never during a mission
- "Skip this version" option
- Controlled release feed (GitHub Releases)

---

# R5: Mission State Crash-Safe Persistence

## Risk Level: MEDIUM
## Status: 🔬 Needs research

## The Problem
Replacing QgsProject with "JSON on disk" without crash safety = potential mission data loss. A crash during autosave could leave a 0-byte file.

## Research Needed
- [ ] Tauri filesystem API capabilities (atomic rename, temp files)
- [ ] Best practices for crash-safe JSON persistence in Electron/Tauri apps
- [ ] What does the current plugin store in mission state? (audit mission_storage.py)
- [ ] SQLite via Tauri SQL plugin — overkill or appropriate?
- [ ] Write-ahead-log patterns for JSON state

## Design Requirements
- Atomic writes (write to .tmp, rename on success)
- Schema versioning with migration functions
- Automatic backup before each save (keep last 3)
- Corruption detection (checksum or JSON parse validation)
- Recovery UI: "Mission file appears corrupted. Restore from backup?"

---

# R6: Magnetic Declination

## Risk Level: MEDIUM
## Status: 🔬 Needs research

## The Problem
Current plugin hardcodes Ireland's magnetic declination at -4.5°. This drifts annually and varies by location.

## Research Needed
- [ ] Current actual declination for Kerry (2026)
- [ ] JavaScript WMM (World Magnetic Model) libraries
- [ ] npm package: geomagnetism or wmm-js
- [ ] How critical is bearing accuracy for SAR operations? (ask Eamonn)
- [ ] Does the team actually use magnetic bearings in the field?

---

# R7: Tauri Distribution (Windows/macOS)

## Risk Level: MEDIUM
## Status: 🔬 Needs research

## The Problem
Non-technical users need seamless installation. macOS Gatekeeper blocks unsigned apps. Windows SmartScreen warns on unknown publishers. Tauri on Windows requires WebView2.

## Research Needed
- [ ] What OS do team members actually use? (ask Eamonn)
- [ ] WebView2 availability on Windows 10/11 (pre-installed on Win 11)
- [ ] Tauri Windows installer options (.msi, .exe, NSIS)
- [ ] macOS notarization process and cost
- [ ] Linux distribution (AppImage? .deb?)
- [ ] Tauri binary size for a MapLibre + React app

---

# R8: Terra Draw Feature Parity

## Risk Level: LOW
## Status: 🔬 Needs research

## The Problem
Terra Draw has most SAR drawing modes built in, but range rings (concentric circles at LPB probability distances) are not native. Need custom implementation.

## Research Needed
- [ ] Terra Draw API for custom geometry generation
- [ ] Turf.js circle() at multiple radii → GeoJSON → MapLibre layers
- [ ] Can Terra Draw features have custom metadata (POA, team, status)?
- [ ] Select/edit workflow for search areas
- [ ] Measurement display (distance/area labels on drawn features)
