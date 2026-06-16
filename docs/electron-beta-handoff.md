# Electron Beta Handoff And Discovery Map Loading

> Current desktop handoff runbook for SAR Tracker Electron. This supersedes the
> older Tauri beta release instructions for the operational desktop lane.
>
> **Linear:** `DON-142`
> **Current state:** GitHub prerelease internal validation drop, not a stable field release

## Current Answer

For the immediate team handoff, the last published Electron prerelease is:

```text
https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.4
```

The next candidate is `electron-v0.1.0-beta.5`. It must be built by GitHub
Actions, smoke-tested on the Ubuntu machine, and only then shared with the
team.

The published beta.4 prerelease was the first release produced by the Electron-specific GitHub
Actions path from `DON-143`. The workflow builds Linux artifacts, checks that
the packaged native SQLite module is Linux x86-64, guards against licensed map
data, runs a launch smoke, creates `SHA256SUMS`, and publishes app artifacts
only. Windows official-map smoke remains open under `DON-141`.

Uploaded prerelease assets:

```text
sartracker-electron-validation_0.1.0-beta.4_linux_x86_64.AppImage
sartracker-electron-validation_0.1.0-beta.4_linux_amd64.deb
SHA256SUMS
```

Checksums:

```text
2c321e6a292797102fc69fa87b51c0ecb463a521a4a19e42a58b20cfa4bf65d4  sartracker-electron-validation_0.1.0-beta.4_linux_amd64.deb
92a7bd68f8c9965e1d53ea17e6a6d1646aff6fbbc936d6465f73f6e16f93ed09  sartracker-electron-validation_0.1.0-beta.4_linux_x86_64.AppImage
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

The preferred long-term channel is now in place: GitHub Actions produces an
Electron prerelease containing app artifacts and checksums only. The map package
remains distributed through the team's private channel, not GitHub. `DON-143`
tracks the completed release workflow; `DON-141` tracks the remaining Windows
smoke gate.

## Build Commands

macOS arm64 package:

```bash
npm run electron:pack -- --mac --arm64
ditto -c -k --sequesterRsrc --keepParent \
  "tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app" \
  "tmp/sartracker-electron-validation_<version>_macos_arm64.zip"
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
5. Run the bad stored-secret smoke:
   `npm run electron:smoke:bad-secret -- --app <AppImage-or-binary>`. This
   seeds a throwaway profile with an undecryptable Traccar secret and must prove
   the app starts with tracking disabled rather than showing the startup fault
   shell.
6. Confirm diagnostics and any shared evidence do not contain private map paths,
   credentials, source URLs, or licensed data.
7. Record whether Windows remains unverified.

## Next Candidate Smoke Focus

For `electron-v0.1.0-beta.5`, the Ubuntu smoke should prove the new release
artifact, not only local source:

1. Verify the downloaded AppImage or `.deb` against `SHA256SUMS`.
2. Launch the packaged app on the Ubuntu machine with a real display.
3. Confirm a mission can start, survive full app restart, and recover cleanly.
4. Confirm a finalized mission refuses destructive edits/deletes.
5. Confirm finalizing a mission creates a standalone archive under app-owned
   user data and that a later mission finalize does not overwrite it.
6. Confirm live Traccar connects over the supported team API URL.
7. Confirm Discovery offline tiles read from the private MBTiles package if it
   is available on the Ubuntu machine.
8. Confirm an undecryptable stored Traccar secret does not block startup:
   normal shell appears, tracking is disabled with a clear warning, and Settings
   can be opened to re-enter the password/token.
9. Confirm diagnostics export is sanitized.
10. Retest the Saturday breadcrumb scenario and the separate DON-151 launch /
   panning slowdown if the needed tracking history/test data is available.

## Current Ubuntu Release-Asset Smoke

`electron-v0.1.0-beta.4` has been checked on the Ubuntu machine with the
CI-built AppImage:

1. Verified the release checksum against the downloaded artifact.
2. Launched the AppImage on Ubuntu 24.04.2 / kernel 6.14 with a real Wayland
   display.
3. Confirmed a real window opened with no SIGTRAP/crash.
4. Confirmed mission persistence across full restart: the recovery prompt showed
   the created mission name and start time.
5. Confirmed live Traccar **"Connection successful."** over `https://kmrtsar.eu`.
6. Confirmed Discovery offline tiles read from SQLite with renderer network
   blocked; inside package area reports **Field ready**, outside warns.
7. Confirmed DD / Irish Grid / DMS coordinate readout renders correctly.
8. Confirmed diagnostics export is sanitized (`secret present: no`).

Evidence directory on Ubuntu:

```text
~/sartracker-don143-smoke/{offline-evidence,persist-evidence}
```

## Previous Ubuntu Release-Asset Smoke

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

The current beta does **not** import raw Discovery raster/source files as map
packages. The team must receive the prepared MBTiles package separately through
a private channel.

Do not tell testers to select these files with **Add Discovery Package**:

- `Discovery_National.zip`
- `Discovery_RGB_95pct_C70_high30.1953.tif`
- `relief_byte.tif`
- `Slope_30plus.tif`

If a tester selects a raw `.zip` or `.tif` there, beta.4 now explains that raw
Discovery source files need an admin-prepared `.mbtiles` package instead.
`mountainrescue_org.txt` is different: select it only with **Choose MapGenie
File** when configuring the optional online/source metadata path.

For this beta, give testers the prepared package:

```text
reeks-standard-60km-z16.mbtiles
SHA256: e317fd016b02d88f0fdc0e4f97653a2c4758acc46779bad7ffb55ac2807b6589
Coverage: Reeks / west Kerry standard operating area
```

1. Install or open the Electron app for your operating system.
2. Keep `reeks-standard-60km-z16.mbtiles` on a USB drive, local disk, or other
   private team storage. Do not email it publicly or upload it to GitHub.
3. Open **Settings**.
4. Optional: choose **Choose MapGenie File** only if you are configuring the
   provider/source metadata file, such as `mountainrescue_org.txt`.
5. In **Official Maps**, choose **Add Discovery Package**.
6. Select `reeks-standard-60km-z16.mbtiles`.
7. Save Settings. The app imports the package into app-owned storage.
8. Wait until the package card shows **READY**.
9. Open **Maps** and choose **Discovery Topo**.
10. Use **Check View Coverage** over the intended search area.
11. Confirm the field-readiness checklist says **Field ready** before relying on
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

The release flow (now implemented under `DON-143`) is:

1. Electron Linux builds are produced by GitHub Actions
   (`.github/workflows/electron-release.yml`, triggered by an `electron-v*`
   tag). The job verifies the packaged `better-sqlite3` is native Linux x86-64
   and runs an Xvfb launch smoke on the built AppImage.
2. macOS arm64 is built locally and uploaded manually as a zipped `.app`
   (GitHub macOS runners bill at 10x).
3. Windows NSIS is scaffolded but **disabled by default**; it only builds when
   the workflow is dispatched with `enable_windows=true`, which waits on the
   Windows official-map smoke (`DON-141`).
4. GitHub Releases hold app artifacts and `SHA256SUMS` only. The build output is
   guarded against `.mbtiles` / licensed map data.
5. Private map packages remain outside GitHub.
6. Each release note states exactly which OS/map smokes passed.
7. `DON-115` closes only after Windows official-map smoke (`DON-141`) passes.

The old Tauri `.github/workflows/release.yml` has been **removed** so it cannot
be mistaken for the Electron path. See `docs/releases/README.md` for the full
authoring workflow.

## Open Workflow Gap

`DON-144` owns the map-package distribution and raw-source packaging workflow.
Operators should not be expected to convert raw USB files. Until that workflow
is implemented, Donal/admin must prepare and privately distribute `.mbtiles`
packages for testers.
