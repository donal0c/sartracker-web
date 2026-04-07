# Post-Spike Risk Notes

These notes are retained for implementation planning after the spike phase. They are not the authoritative source for current project state; use `handoff/HANDOFF.md`, `CODEX_START.md`, and `CLAUDE.md` for the active build direction.

# R4: Auto-Update Security & Rollback

## Risk Level: HIGH
## Status: Deferred to Phase 3 hardening

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
## Status: Resolved by Spike S5

## Outcome
This risk is closed for v1. The project direction is SQLite in WAL mode behind a backend mission store, not JSON-on-disk mission state.

## Confirmed Direction
- SQLite with WAL mode
- Transactional writes
- Sequential schema migrations
- Backup rotation
- Recovery on restart through SQLite semantics rather than ad hoc file repair

---

# R6: Magnetic Declination

## Risk Level: MEDIUM
## Status: Open product decision for v1

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
## Status: Largely resolved for v1

## The Problem
Non-technical users need seamless installation. macOS Gatekeeper blocks unsigned apps. Windows SmartScreen warns on unknown publishers. Tauri on Windows requires WebView2.

## Current Direction
- Tauri 2 remains the chosen desktop wrapper
- v1 is aimed at the team's Windows/Linux usage
- No code signing for v1
- Packaging hardening remains a later-phase concern, not a blocker for scaffold/core implementation

---

# R8: Terra Draw Feature Parity

## Risk Level: LOW
## Status: Resolved by Spike S3

## Outcome
This is no longer an open architecture risk. Terra Draw plus custom SAR geometry logic proved sufficient in the drawing tools spike.

## Implementation Reminder
- Rebuild the production drawing system from scratch with tests
- Use the spike as a reference implementation, not as an import source
