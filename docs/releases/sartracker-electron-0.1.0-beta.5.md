# SAR Tracker Electron Desktop Beta 0.1.0-beta.5 (persistence and coordinate safety retest)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.5
- **Build tag:** `electron-v0.1.0-beta.5`
- **Cut date (UTC):** 2026-06-15
- **Cut by:** Codex agent (Donal supervising)
- **Linear reference:** DON-159, DON-160, DON-165, DON-167
- **Verification report:** GitHub Actions run #4 green (gates, native Linux bundle, private-map guard, Xvfb launch smoke, SHA256SUMS) + Ubuntu 24.04.2 on-device smoke passed
- **CI run:** `electron-release.yml` run `27570596320` — success
- **GitHub release:** Published prerelease at `electron-v0.1.0-beta.5` (Linux AppImage + `.deb` + `SHA256SUMS`)

## Artifacts

Expected after the GitHub Actions release run passes:

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.5_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.5_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
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
2. `sudo apt install ./sartracker-electron-validation_0.1.0-beta.5_linux_amd64.deb`.
3. Launch from the application menu.

## What Changed

Since `0.1.0-beta.4`:

- **Breadcrumb trails preserve route coverage across long multi-device missions.** Rendering now budgets retained breadcrumbs per device instead of applying one global 20k cap, so one noisy tracker cannot evict another rescuer's trail. Diagnostics include per-device observed/retained/truncated counts. [DON-159]
- **Breadcrumb accumulation no longer re-sorts with repeated timestamp parsing every poll.** Timestamp parsing is cached during sorting so retained-history growth does not add avoidable main-thread work. [DON-165]
- **Electron mission persistence now matches the safety contract.** Locked finished/finalized missions reject destructive deletes, marker/drawing/helicopter/GPX writes emit audit events atomically, and first device contact records `device_created`. [DON-161, DON-163, DON-164]
- **Mission finalization writes a real standalone archive.** Finalize now creates a per-mission archive in the app data directory and records the full requested/succeeded/finalized audit sequence. [DON-162]
- **Coordinate and drawing safety guards are stricter.** Out-of-Ireland committed coordinates are rejected, live coordinate display warns instead of crashing, ambiguous signed direction input is rejected, and search-sector/geodesic helpers reject invalid radius/distance cases. [DON-167, DON-168, DON-169, DON-170, DON-171, DON-172, DON-173, DON-174]
- **Operator manual updates describe the new archive, finalized-mission lock, and Irish-bounds behavior.** [DON-160, DON-167]

## What To Test

- **Critical:** app launches and a mission can be started, then persists after a full restart.
- **Critical:** finalize a mission and confirm a standalone archive is created, diagnostics remain sanitized, and the finalized mission cannot be destructively edited.
- **Critical:** tracking connects to the team Traccar server and device trails remain complete enough for the Saturday multi-device breadcrumb scenario.
- **Critical:** retest the original `DON-151` launch/panning slowdown after tracking history has accumulated.
- Basemap tiles render; Discovery offline map loads and reads if the private package is available.
- Coordinate entry rejects obviously outside-Ireland or ambiguous signed-direction inputs with clear messages.

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

## Verification (CI-driven)

This beta is intended to be produced by `.github/workflows/electron-release.yml`
on the `electron-v0.1.0-beta.5` tag. Before sharing with testers, the release
must have:

- GitHub Actions gates green: lint, unit tests, web build, native Linux bundle,
  private-map-data guard, Xvfb launch smoke, and `SHA256SUMS`.
- Real Ubuntu smoke against the CI-built artifact: launch, mission persistence
  across restart, live Traccar connection, Discovery offline tile read if the
  private package is available, diagnostics sanitization, finalized-mission lock,
  and standalone archive creation.

## Rollback / Reinstall

- AppImage: delete the file. `.deb`: `sudo apt remove sartracker-electron-validation`.
- Mission data lives under the app's per-user data directory and is not removed
  by uninstalling the bundle. If corruption is suspected, capture diagnostics
  first and do not delete anything until recorded.

## Publication State

Published prerelease `electron-v0.1.0-beta.5` on 2026-06-15 after CI run
`27570596320` and the Ubuntu 24.04.2 on-device smoke both passed.

### Ubuntu Release-Asset Smoke (2026-06-15)

CI-built AppImage downloaded to `192.168.18.31:~/sartracker-beta5-smoke`,
`sha256sum -c SHA256SUMS` returned **OK**, launched against the real SQLite
backend on a live Wayland display (`--ozone-platform=wayland`,
`SARTRACKER_ELECTRON_BLOCK_NETWORK=1`), driven via Playwright over CDP. Runtime:
Electron 40.10.0, app version `0.1.0-beta.5+run.4.sha.725a683`, schema v3.

All gates passed:

1. Launch: app-shell + map canvas rendered, no fault shell.
2. Mission start on the real backend.
3. Marker created and saved.
4. Persistence: mission recovered after a full app restart (recovery dialog → Resume).
5. Mission finished, then finalized (governance card shows `finalized`).
6. Standalone finalization archive written to `userData/archives` (4,984 bytes).
7. Coordinate safety: out-of-Ireland DD (Paris) flagged "Coordinate outside
   Ireland…" rather than emitting a false Irish grid reference.
8. Diagnostics export sanitized: `secret present: no`, provider URL not
   configured, no credential leakage.

Live tracking (separate run, using the operator's persisted provider config):

9. Provider config loads from local userData (`~/.config/sartracker-web/settings.json`
   → `https://kmrtsar.eu`, user `sean`, `autoConnect`). Password is an encrypted
   blob in `secrets.json` (gnome_libsecret), not stored in plaintext.
10. Live Traccar connection test: **"Connection successful."**
11. With an active mission, Save & Connect brings tracking **online with 33 real
    devices / 7 fixes** from the live server. Network was not blocked for this run.

The live-tracking run seeded a throwaway userData with copies of the operator's
`settings.json` + `secrets.json` (same machine → same keyring decrypts the
secret); the real mission database under `~/.config/sartracker-web/` was not
touched.

Evidence on the box: `~/sartracker-beta5-smoke/evidence{,2,-tracking}/`
(screenshots + `app.log` + exported diagnostics report).
