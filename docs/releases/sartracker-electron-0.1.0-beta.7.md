# SAR Tracker Electron Desktop Beta 0.1.0-beta.7 (local credential storage + docked Review)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.7
- **Build tag:** `electron-v0.1.0-beta.7`
- **Cut date (UTC):** 2026-06-16
- **Cut by:** Claude Code agent (Donal supervising)
- **Linear reference:** DON-177 (app-owned local credential storage), DON-176 (docked Review), DON-175 (keyring startup guard — first shipped to the team in this beta)
- **Verification report:** to be filled after the GitHub Actions release run + Ubuntu on-device smoke
- **CI run:** to be filled after `electron-release.yml` run completes
- **GitHub release:** draft prerelease at `electron-v0.1.0-beta.7` (Linux AppImage + `.deb` + `SHA256SUMS`) — held until the deep Ubuntu packaged smoke passes on the CI-built artifact and Donal approves promotion

## Supersedes beta.6

`electron-v0.1.0-beta.6` was built and smoked as a keyring startup hotfix but
was **never published to the team**. Its DON-175 fix (an undecryptable stored
secret no longer blocks startup) is carried forward here, so beta.7 is the first
build that delivers the keyring fix to testers. There is no need to install
beta.6.

## Artifacts

Expected after the GitHub Actions release run passes:

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.7_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.7_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

macOS arm64 is not part of the CI cut. Windows remains gated off pending the
Windows official-map smoke (`DON-141`).

Private Discovery map packages are never release artifacts. Distribute those
through the agreed private team channel and load them through Settings after
installing the app.

## Install — Linux (primary target)

### AppImage (zero-install)

1. Download the `.AppImage` and `SHA256SUMS`.
2. Verify: `sha256sum -c SHA256SUMS --ignore-missing` — the AppImage line must say **OK**.
3. `chmod +x` the AppImage and run it.
4. If you see `dlopen(): error loading libfuse.so.2`: Ubuntu 24.04 `sudo apt install libfuse2t64`; Ubuntu 22.04 `sudo apt install libfuse2`.

### .deb (system install)

1. Download the `.deb` and `SHA256SUMS`, verify the checksum.
2. `sudo apt install ./sartracker-electron-validation_0.1.0-beta.7_linux_amd64.deb`.
3. Launch from the application menu.

## What Changed

Since `0.1.0-beta.5` (the last published team build):

- **Traccar credentials are stored in an app-owned local file, not the OS keyring.** [DON-177]
  The password or token now lives in an app-owned `credentials.json` in the app
  data folder. Tracking startup no longer depends on the Linux login keyring
  being unlocked, which removes the class of field failures where tracking would
  not connect (or the app would not start) because the keyring was locked,
  changed, or copied from another profile. A successful Settings connection test
  now uses the same credential the runtime will use. On first launch after
  upgrading, an existing keyring-encrypted credential is migrated automatically
  when it can still be read; if it cannot be read, the app still opens with
  tracking disabled and a clear warning to re-enter the password or token. The
  credential value is never written to settings, diagnostics, or support
  bundles.
- **An undecryptable stored credential no longer blocks startup.** [DON-175]
  Carried forward from the unpublished beta.6. The app reaches the normal shell
  with tracking disabled and a re-enter warning instead of showing the runtime
  startup fault shell.
- **Mission Review no longer blocks mission controls during an active mission.** [DON-176]
  While a mission is active or paused, Review opens as a docked, read-only panel
  on the left of the map. The mission-control rail (Pause, Finish) and the map
  stay live and usable beside it, so reviewing audit history never freezes the
  incident controls. A note marks the panel read-only; close Review or press Esc
  to return the map to full width. With no active mission, Review still opens
  full-screen with the mission selector for cross-mission audit.

All beta.5 behavior (breadcrumb route coverage, breadcrumb accumulation
performance, mission persistence safety contract, standalone finalization
archive, coordinate/drawing safety guards) is carried forward unchanged.

## What To Test

- **Critical (DON-177):** save a Traccar password in Settings, fully restart the
  app, and confirm tracking reconnects without re-entering the secret and
  without depending on the login keyring.
- **Critical (DON-177 migration):** upgrading from an older beta with a working
  stored credential should keep tracking working after the first launch.
- **Critical (DON-177 recovery):** if a stored credential cannot be read, the app
  must still open with tracking disabled and let you re-enter the secret in
  Settings; the runtime startup fault shell must not appear.
- **Critical (DON-176):** with a mission active, open Review and confirm Pause,
  Finish, and the map still work without closing Review.
- **Critical:** app launches, a mission can be started, persists after a full
  restart, finalizes with a standalone archive, and the finalized mission cannot
  be destructively edited.
- **Critical:** tracking connects to the team Traccar server.
- Basemap tiles render; Discovery offline map loads if the private package is
  available.
- Coordinate entry rejects obviously outside-Ireland or ambiguous
  signed-direction inputs with clear messages.

## Loading Discovery Maps

1. Install/open the Electron app.
2. Keep the private Discovery MBTiles package on USB, external disk, or agreed
   private team storage.
3. Open **Settings**.
4. In **Official Maps**, choose **Add Discovery Package**.
5. Select the private `.mbtiles` package.
6. Save Settings and wait for the package card to show **READY**.
7. Open **Maps**, choose **Discovery Topo**, and run **Check View Coverage**.
8. Confirm the field-readiness checklist says **Field ready** over the intended
   search area.

Do not upload the map package, credentials, raw diagnostics with private paths,
or screenshots showing private paths to GitHub.

## Known Limitations

- Linux x86_64 only from CI for this cut. No Windows, no macOS, no ARM.
- Artifacts are unsigned. Expect platform security warnings outside Linux.
- Auto-updater is not enabled. Each beta is a fresh download.
- High-definition mountain map packages are not bundled.
- Browser hosted-mode persistence is testing-only and not part of this desktop beta.
- Windows official-map import remains blocked on `DON-141`.
- Traccar credentials are stored as local app-owned plaintext (best-effort
  `0600` file permissions). This is an intentional trade for operational
  reliability on trusted team machines (`DON-177`); it is not OS-keyring
  encryption.

## Verification (CI-driven)

This beta is produced by `.github/workflows/electron-release.yml` on the
`electron-v0.1.0-beta.7` tag. Before sharing with testers, the release must
have:

- GitHub Actions gates green: lint, unit tests, web build, native Linux bundle,
  private-map-data guard, Xvfb launch smoke, and `SHA256SUMS`.
- Real Ubuntu smoke against the CI-built artifact: launch, mission persistence
  across restart, finalized-mission lock, standalone archive, live Traccar
  connection, diagnostics sanitization, the docked-Review behavior (DON-176),
  and the local-credential matrix (DON-177): fresh install starts with tracking
  disabled; a saved local credential survives restart; a decryptable legacy
  `secrets.json` migrates; an undecryptable legacy `secrets.json` starts cleanly
  with tracking disabled and Settings recovery.

## Rollback / Reinstall

- AppImage: delete the file. `.deb`: `sudo apt remove sartracker-electron-validation`.
- Mission data lives under the app's per-user data directory and is not removed
  by uninstalling the bundle. If corruption is suspected, capture diagnostics
  first and do not delete anything until recorded.

## Publication State

Draft prerelease, not yet published. Promotion to a shared team prerelease is
held until the deep Ubuntu packaged smoke passes on the CI-built artifact and
Donal approves promotion.
