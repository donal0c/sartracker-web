# Electron Beta Handoff And Discovery Map Loading

> Current desktop handoff runbook for SAR Tracker Electron. This supersedes the
> older Tauri beta release instructions for the operational desktop lane.
>
> **Linear:** `DON-142`
> **Current state:** GitHub prerelease internal validation drop, not a stable field release

## Current Answer

For the immediate team handoff, use the Electron prerelease uploaded to GitHub:

```text
https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.3
```

This prerelease uses Electron artifacts produced and smoked locally/through the
Ubuntu builder. It is not the final repeatable GitHub Actions release path
because the Electron release workflow is still tracked under `DON-143` and the
Windows official-map smoke remains open under `DON-141`.

Uploaded prerelease assets:

```text
sartracker-electron-validation_0.1.0-beta.3_linux_x86_64.AppImage
sartracker-electron-validation_0.1.0-beta.3_linux_amd64.deb
sartracker-electron-validation_0.1.0-beta.3_macos_arm64.zip
SHA256SUMS
```

Checksums:

```text
20f3660a7b8ccc67cfbdd7c4d239e111a21c5c94517f39fd8e89928f5697c8ae  sartracker-electron-validation_0.1.0-beta.3_linux_amd64.deb
1ae8667f7d74eba9204162b9b91ac46defd7bb07a6c19d2381d60da0b55a2d07  sartracker-electron-validation_0.1.0-beta.3_linux_x86_64.AppImage
f7b7b9ae193bb12e6621a5f606494c56ec46cfe4ba2324254e750278a8164463  sartracker-electron-validation_0.1.0-beta.3_macos_arm64.zip
```

Do not attach private Discovery map packages, MapGenie credentials, source USB
contents, raw diagnostics with local paths, or private map screenshots to a
public GitHub release.

## Immediate Handoff Channel

Until `DON-141` proves Windows, treat this as an internal validation drop:

- Linux testers: share the GitHub prerelease URL. Recommend the `.deb` for
  Ubuntu/Debian users who want a normal install; use AppImage for a portable
  no-install run.
- macOS testers: share the zipped `.app` only if they are comfortable with
  unsigned internal builds and Gatekeeper warnings.
- Windows testers: wait for `DON-141`.

The preferred long-term channel is still a GitHub Actions-produced
draft/prerelease containing app artifacts and checksums only. The current
prerelease was uploaded manually from validated local/Linux artifacts so the
team can start testing. The map package remains distributed through the team's
private channel, not GitHub. The Electron-specific GitHub Releases workflow is
tracked separately by `DON-143`.

## Build Commands

macOS arm64 package:

```bash
npm run electron:pack -- --mac --arm64
ditto -c -k --sequesterRsrc --keepParent \
  "tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app" \
  "tmp/don142-electron-handoff/sartracker-electron-validation_0.1.0-beta.3_macos_arm64.zip"
```

Linux AppImage and `.deb` must be built on Linux so `better-sqlite3` is native
Linux x64:

```bash
npm ci
npm run electron:dist:linux
```

Current Ubuntu builder used for the DON-115/DON-142 validation:

```text
donal@192.168.18.31:~/sartracker-don115-validation/repo
```

## Pre-Share Checks

Before any tester receives an Electron artifact:

1. Confirm the artifact came from current `master`.
2. Generate `SHA256SUMS`.
3. Run the relevant package launch smoke.
4. For official maps, run or manually perform the Discovery import/readiness
   smoke with the private MBTiles package outside the repo.
5. Confirm diagnostics and any shared evidence do not contain private map paths,
   credentials, source URLs, or licensed data.
6. Record whether Windows remains unverified.

## Current Ubuntu Release-Asset Smoke

`electron-v0.1.0-beta.3` has been checked on the Ubuntu machine via SSH:

1. Downloaded the GitHub prerelease `.deb` and `SHA256SUMS`.
2. Verified `sha256sum -c SHA256SUMS --ignore-missing` returned `OK`.
3. Inspected the `.deb`: package `sartracker-web`, version `0.1.0~beta.3`,
   architecture `amd64`, expected Electron runtime dependencies.
4. Installed the `.deb` with `sudo apt install`.
5. Confirmed `dpkg -s sartracker-web` reports `install ok installed`, version
   `0.1.0~beta.3`, architecture `amd64`.
6. Launched the installed app from
   `/opt/SAR Tracker Electron Validation/sartracker-web`.
7. Ran the official offline map smoke with the private Reeks Discovery package.

Result: packaged app launched, renderer HTTP/S was blocked, local Discovery
tile reads worked, readiness was **Field ready** inside the package area,
outside-area warning appeared, Settings showed the package ready, and
diagnostics contained safe package metadata only.

Evidence directory on Ubuntu:

```text
~/sartracker-release-smoke/electron-v0.1.0-beta.3/installed-smoke-evidence
```

## Discovery Map Loading Instructions

These are the operator-facing steps for the team.

1. Install or open the Electron app for your operating system.
2. Keep the private Discovery MBTiles package on a USB drive, external disk, or
   other private team storage. Do not email it publicly or upload it to GitHub.
3. Open **Settings**.
4. In **Official Maps**, choose **Add Discovery Package**.
5. Select the private Discovery `.mbtiles` file.
6. Save Settings. The app imports the package into app-owned storage.
7. Wait until the package card shows **READY**.
8. Open **Maps** and choose **Discovery Topo**.
9. Use **Check View Coverage** over the intended search area.
10. Confirm the field-readiness checklist says **Field ready** before relying on
    the official offline map.

After import, the original USB/source disk should not be needed for ordinary
map display because the app owns its imported package copy.

## Offline Confidence Check

For a field-style check, do this before a mission or training test:

1. Import the Discovery package and confirm it is ready.
2. Restart the app.
3. Turn off Wi-Fi / unplug network where practical.
4. Open **Maps** and choose **Discovery Topo**.
5. Confirm Discovery still renders over the operational area.
6. Run **Check View Coverage**.
7. Confirm the checklist says **Field ready** inside the package area.
8. Pan outside the package area and confirm the app warns outside coverage.

The automated DON-115 smoke blocks renderer HTTP/S requests and proves local
tile reads. A physical network-off smoke is still the clearest operator proof
when the machine is available locally.

## Diagnostics

If something fails:

1. Open **Diagnostics**.
2. Export the report.
3. Before sharing, check that the report does not include:
   - map package file paths,
   - credentials,
   - MapGenie source URLs,
   - private source USB paths,
   - mission-sensitive personal data.

Expected safe official-map diagnostics include map id, status, zoom range, tile
count, format, bounds, and ready/not-ready state.

## Going Forward

The target release flow is:

1. Electron Linux and Windows builds are produced by GitHub Actions.
2. macOS is either added to CI later or uploaded manually as a zipped `.app`.
3. GitHub Releases hold app artifacts and `SHA256SUMS`.
4. Private map packages remain outside GitHub.
5. Each release note states exactly which OS/map smokes passed.
6. `DON-115` closes only after Windows official-map smoke (`DON-141`) passes.

The current `.github/workflows/release.yml` is still Tauri-era. Do not use it
as the source of truth for Electron app handoff until it has been migrated or
replaced under `DON-143`.
