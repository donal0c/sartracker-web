# S4: Tauri Desktop Distribution

## Goal
Validate that a Tauri 2 app can be built, signed, and installed on Mac and Windows without friction for non-technical users.

## Questions to answer
- [ ] What OS do KMRT team members actually use? (ask Eamonn)
- [ ] macOS: code signing + notarization — Apple Developer Program ($99/yr)?
- [ ] Windows: SmartScreen friction on unsigned binary — how bad?
- [ ] Windows: WebView2 pre-installed on Win10/11?
- [ ] Installer size with MapLibre + React bundled
- [ ] Tauri updater setup with GitHub Releases
- [ ] "Skip update if mission active" logic

## Pass Criteria
- [ ] .dmg installs on macOS without Gatekeeper warning (signed + notarized)
- [ ] .exe/.msi installs on Windows without SmartScreen block
- [ ] Auto-update downloads and applies without user action
- [ ] Update skipped if mission is in progress
- [ ] Rollback to previous version works
