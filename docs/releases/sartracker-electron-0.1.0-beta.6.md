# SAR Tracker Electron Desktop Beta 0.1.0-beta.6 (Linux keyring startup hotfix)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.6
- **Build tag:** `electron-v0.1.0-beta.6`
- **Cut date (UTC):** 2026-06-16
- **Cut by:** Claude Code agent (Donal supervising)
- **Linear reference:** DON-175 (Linux keyring decrypt failure blocks Electron startup)
- **Verification report:** to be filled after the GitHub Actions release run + Ubuntu on-device smoke
- **CI run:** to be filled after `electron-release.yml` run completes
- **GitHub release:** draft prerelease at `electron-v0.1.0-beta.6` (Linux AppImage + `.deb` + `SHA256SUMS`) — held until the release-blocking bad-secret smoke passes on the CI-built artifact

## Artifacts

Expected after the GitHub Actions release run passes:

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.6_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.6_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
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
2. `sudo apt install ./sartracker-electron-validation_0.1.0-beta.6_linux_amd64.deb`.
3. Launch from the application menu.

## What Changed

Since `0.1.0-beta.5`:

- **A Linux login-keyring problem no longer blocks app startup.** [DON-175] A
  team field report on Linux showed the runtime startup fault shell with
  `Error while decrypting the ciphertext provided to safeStorage.decryptString`,
  caused by the login keyring not being unlocked. The Electron settings store
  now catches `safeStorage` decrypt failures and starts the app in a safe
  state: the mission runtime and autosave start normally, tracking stays idle
  and disabled, and the operator sees the warning **"Stored Traccar credentials
  could not be decrypted. Re-enter the password or token in Settings."** Settings
  can be opened to re-enter the Traccar password/token. Previously this stale or
  undecryptable stored secret could prevent the app from opening at all.
- **Runtime tracking config contract hardened.** [DON-175] An explicit
  `trackingConfig: null` from bootstrap is now treated as authoritative
  (tracking intentionally disabled) instead of falling back to environment
  tracking config. This keeps the disabled-tracking state deterministic.
- **New release-blocking bad-secret smoke.** [DON-175] `npm run
  electron:smoke:bad-secret` seeds a throwaway profile with an undecryptable
  Traccar secret and verifies the packaged app reaches the normal shell, shows
  the disabled-tracking warning, and lets Settings recover the secret. It is now
  part of `beta:verify`, the pre-share checklist, and the Ubuntu smoke runbook.
  Beta.5 only exercised the happy unlocked-keyring path; beta.6 adds the
  negative path that the field report exposed.

All beta.5 behavior (breadcrumb route coverage, breadcrumb accumulation
performance, mission persistence safety contract, standalone finalization
archive, coordinate/drawing safety guards) is carried forward unchanged.

## What To Test

- **Critical (release-blocking):** with a corrupt/undecryptable stored Traccar
  secret, the packaged app must start to the normal shell (no startup fault
  shell), show tracking disabled with the re-enter warning, and allow Settings
  to enter a replacement secret. Run `npm run electron:smoke:bad-secret` against
  the CI-built artifact.
- **Critical:** app launches and a mission can be started, then persists after a
  full restart.
- **Critical:** finalize a mission and confirm a standalone archive is created,
  diagnostics remain sanitized, and the finalized mission cannot be destructively
  edited.
- **Critical:** tracking connects to the team Traccar server with the operator's
  persisted (decryptable) provider config.
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
- **Known issue (DON-176):** opening Mission Review during an active mission can
  block map tools / Pause / Finish until Review is closed (full-screen workspace
  overlay intercepts clicks). Tracked separately; not addressed in this hotfix.

## Verification (CI-driven)

This beta is produced by `.github/workflows/electron-release.yml` on the
`electron-v0.1.0-beta.6` tag. Before sharing with testers, the release must
have:

- GitHub Actions gates green: lint, unit tests, web build, native Linux bundle,
  private-map-data guard, Xvfb launch smoke, and `SHA256SUMS`.
- Real Ubuntu smoke against the CI-built artifact: launch, mission persistence
  across restart, live Traccar connection, Discovery offline tile read if the
  private package is available, diagnostics sanitization, finalized-mission lock,
  standalone archive creation, and — release-blocking for this beta — the
  bad stored-secret startup recovery smoke.

## Rollback / Reinstall

- AppImage: delete the file. `.deb`: `sudo apt remove sartracker-electron-validation`.
- Mission data lives under the app's per-user data directory and is not removed
  by uninstalling the bundle. If corruption is suspected, capture diagnostics
  first and do not delete anything until recorded.

## Publication State

Draft prerelease, not yet published. Promotion to a shared team prerelease is
held until the release-blocking bad-secret smoke and the core lifecycle / live
tracking smokes pass on the CI-built artifact and Donal approves promotion.
