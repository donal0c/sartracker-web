# SAR Tracker Electron Desktop Beta 0.1.0-beta.10 (DON-240 replacement hotfix)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.10
- **Build tag:** `electron-v0.1.0-beta.10`
- **Cut date (UTC):** 2026-07-08
- **Cut by:** Codex agent (Donal supervising)
- **Supersedes:** `electron-v0.1.0-beta.9` (**HOLD**)
- **Linear reference:** `DON-240`
- **Verification report:** local gates, GitHub Actions release run, and Ubuntu packaged smoke complete; team freeze retest pending.
- **CI run:** `electron-release.yml` run `28965175933` succeeded for commit `3e9ce22dff518d4718851296f6c9881559485dd2`.
- **GitHub release:** internal prerelease after packaged smoke; beta.9 HOLD is not lifted until team freeze-machine retest is recorded.

## Why beta.10 exists

Beta.9 reached testers but was put on **HOLD** after Linux AppImage feedback
reported long UI hangs while panning the official Discovery map, opening
Devices, and exporting diagnostics.

Beta.10 is the replacement hotfix build. It keeps the beta.9 Fable safety
hardening and adds targeted DON-240 runtime fixes for the reported freeze
profile.

## DON-240 Fix Summary

- Official-map tile serving no longer reloads and normalizes Settings on every
  tile IPC request.
- Offline package coverage misses now return an operator-visible hatched
  "no offline coverage" tile instead of throwing one Electron IPC exception per
  missing tile.
- Settings/package metadata is cached and invalidated on Settings save/import
  changes.
- Current Traccar fixes publish before slower breadcrumb-history fan-out, so
  Devices/map status is not held behind breadcrumb work.
- Duplicate-only breadcrumb overlap windows no longer invalidate retained
  snapshots.
- Diagnostics recent-log reads are bounded to the requested tail instead of
  parsing the whole rotated runtime log.
- Tracking position dedup has an exhaustiveness guard so future position fields
  cannot be silently ignored.

## Validation To Date

Before cutting beta.10 and after the beta.10 tag retry:

- `npm run lint` passed locally.
- `npm run build` passed locally.
- `npm run test` passed locally: 153 files / 1080 tests.
- `npm run test:backend` passed locally: 47 passed / 1 ignored.
- `npm run test:e2e:chromium` passed locally: 129 / 129 tests.
- Tag-driven GitHub Actions run `28965175933` passed release gates, Linux
  artifact inspection/private-map guard, Linux AppImage Xvfb launch smoke, and
  draft prerelease/SHA256SUMS upload.
- GitHub Linux validation build `28959613296` passed for the hotfix artifact,
  including Linux artifact inspection and AppImage launch smoke.
- Ubuntu packaged full-profile probe ran with the 31,729-tile private Discovery
  package and live Traccar load (33 devices / 8 fixes).
- Ubuntu packaged smoke passed on the CI-built beta.10 AppImage on
  `donal-Precision-5570` (`6.17.0-35-generic`, X11 display `:0`). Evidence is
  mirrored under `output/beta10-ubuntu-smoke/`.

Important qualification: the Ubuntu smoke machine did **not** reproduce the
field freeze numerically on original beta.9, even under full-profile load. It
did reproduce the beta.9 tile-miss exception storm. The hotfix removed that
measured failure signature:

| Build | Profile | Result |
| --- | --- | --- |
| beta.9 original AppImage | heavy pan + live tracking | `frozen=false`, worst stall 66.7 ms, tile-miss IPC exceptions 2,542 |
| hotfix CI AppImage | heavy pan + live tracking | `frozen=false`, worst stall 62.5 ms, tile-miss IPC exceptions 0 |

Because beta.9 did not freeze first on the Ubuntu box, beta.10 still needs a
targeted retest on the actual team machine/profile that froze before the hold
can be lifted.

## Artifacts

Created by GitHub Actions after the `electron-v0.1.0-beta.10` tag:

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.10_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.10_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

macOS arm64 is not part of the CI cut. Windows remains gated off pending the
Windows official-map smoke (`DON-141`).

Private Discovery map packages are never release artifacts. Distribute those
through the agreed private team channel and load them through Settings after
installing the app.

## Install - Linux

### AppImage

1. Download the `.AppImage` and `SHA256SUMS`.
2. Verify: `sha256sum -c SHA256SUMS --ignore-missing` - the AppImage line must say **OK**.
3. `chmod +x` the AppImage and run it.
4. If you see `dlopen(): error loading libfuse.so.2`: Ubuntu 24.04 `sudo apt install libfuse2t64`; Ubuntu 22.04 `sudo apt install libfuse2`.

### .deb

1. Download the `.deb` and `SHA256SUMS`, verify the checksum.
2. `sudo apt install ./sartracker-electron-validation_0.1.0-beta.10_linux_amd64.deb`.
3. Launch from the application menu.

## What To Test First

This beta should go first to the tester/team machine that froze on beta.9.

Critical retest:

- Install/run the beta.10 AppImage or `.deb`.
- Load the same private Discovery package used during the beta.9 freeze.
- Connect live Traccar tracking.
- Pan the map aggressively across and beyond the package boundary.
- Open Devices repeatedly during/after panning.
- Export Diagnostics and, if relevant, an incident/support bundle.
- Report whether the window manager shows "Not Responding" or whether the UI
  hangs for multi-second periods.

Capture for any failure:

- approximate time of failure,
- screenshot/photo of the window manager prompt if present,
- exported diagnostics/support bundle if export succeeds,
- whether this was AppImage or `.deb`,
- whether the same machine had beta.9 installed previously.

## Packaged Smoke Matrix

The GitHub release must remain a draft until this matrix is complete.

| Gate | Result | Evidence |
| --- | --- | --- |
| Tag-driven `electron-release.yml` run green | PASS | Run `28965175933`, commit `3e9ce22dff518d4718851296f6c9881559485dd2`. |
| Checksum verified against `SHA256SUMS` | PASS | Local and Ubuntu verification of downloaded draft assets: AppImage `84467e7aaac9d5d0bd90512f769c005f8a05ba0dd69c1631f52a74b9ad0473f5`, `.deb` `44f57f53bfc20720f87a938798f1ef451f564e703a22d7bd6ff7f51d80b7730c`. |
| Packaged AppImage launches to normal shell | PASS | CI Xvfb launch smoke in run `28965175933`; Ubuntu packaged smoke launch in `output/beta10-ubuntu-smoke/core-lifecycle/`. |
| Full-profile freeze probe / team retest | PASS / TEAM RETEST PENDING | Ubuntu full-profile probe with live tracking and Reeks package: `frozen=false`, worst stall 50 ms, main p99 21 ms, renderer p99 17 ms, live tracking online 33 devices / 8 fixes. The original team freeze machine/profile still needs to retest before beta.9 HOLD is lifted. |
| Official offline map package smoke | PASS | Reeks package, network blocked, local tile bytes returned, inside/outside coverage and Settings package status passed. Evidence: `output/beta10-ubuntu-smoke/official-offline/`. |
| Diagnostics export succeeds and is sanitized | PASS | Diagnostics report, support bundle, and incident support bundle exported and scanned without credential/private-path leakage. Evidence: `output/beta10-ubuntu-smoke/diagnostics-bundles/`. |
| Mission lifecycle / restart / recovery / finalize / archive | PASS | Real SQLite packaged smoke: mission start, marker save, reload recovery, finish, finalize, archive `5015` bytes. Evidence: `output/beta10-ubuntu-smoke/core-lifecycle/`. |
| Coordinate rejection and Irish Grid coarse-ref behavior | PASS | Out-of-Ireland DD flagged; `V 80 84` resolved to `V 80500 84500`. Evidence: `output/beta10-ubuntu-smoke/coord-diag/` and `single-instance-coordinates/`. |
| Bad/corrupt stored credential reaches shell, not runtime fault | PASS | Packaged app reached normal shell, showed stored-credential warning, and Settings allowed replacement secret entry. Evidence: `output/beta10-ubuntu-smoke/bad-secret/`. |
| Live Traccar connection | PASS | Full-profile freeze probe seeded app-owned Ubuntu credentials; tracking went online with 33 devices / 8 fixes. Evidence: `output/beta10-ubuntu-smoke/full-profile-freeze/`. |
| Duplicate launch / single-instance smoke | PASS | Second AppImage launch exited code `0`; primary app remained usable. Evidence: `output/beta10-ubuntu-smoke/single-instance-coordinates/`. |

## Known Limitations

- Linux x86_64 only from CI for this cut. No Windows, no macOS, no ARM.
- Artifacts are unsigned. Expect normal internal-beta OS warnings.
- Auto-updater is not enabled. Each beta is a fresh download.
- High-definition mountain map packages are not bundled with this build.
- Browser hosted mode is testing/training only and is not part of this desktop beta.

## Rollback

To roll back, quit the app and reinstall beta.8 from
`electron-v0.1.0-beta.8`. Mission data lives under the per-user app data
directory and is not deleted by uninstalling the bundle. Capture diagnostics
before deleting any user data.
