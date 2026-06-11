# SAR Tracker Electron Desktop Beta 0.1.0-beta.4 (first electron-release.yml cut)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.4
- **Build tag:** run.<n>.sha.<commit> (filled by CI)
- **Cut date (UTC):** 2026-06-11
- **Cut by:** Claude Code agent (Donal supervising)
- **Linear reference:** DON-143 (release workflow); carries DON-147, DON-148, DON-151
- **Verification report:** CI run (linked below) + Ubuntu real-machine smoke
- **CI run:** <link to the GitHub Actions run that produced these artifacts>

## Artifacts

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.4_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.4_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

macOS arm64 is not part of this cut (built locally and attached only when
needed). Windows is not produced: the NSIS job is gated off pending the Windows
official-map smoke (`DON-141`).

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
2. `sudo apt install ./sartracker-electron-validation_0.1.0-beta.4_linux_amd64.deb`.
3. Launch from the application menu.

## What Changed

Since `0.1.0-beta.3`:

- **Release pipeline migrated to Electron.** This is the first beta produced by
  the new `.github/workflows/electron-release.yml`. The old Tauri release
  workflow has been retired. [DON-143]
- **Diagnostics: crash capture, runtime log, and support-bundle export.** Native
  crash minidump capture, a bounded sanitized runtime log, an unclean-shutdown
  banner, and an "Export Support Bundle" action. Renderer-fault logging now only
  records genuine faults, not clean exits. [DON-147]
- **Mission Review no longer freezes on large missions.** Audit log is bounded
  and tracking telemetry is excluded by default, with a toggle and truncation
  notice. [DON-148]
- **Faster launch after long tracking history.** The poller resumes per-device
  history from persisted timestamps instead of rebuilding the full breadcrumb
  trail on every launch/poll. [DON-151]

## What To Test

- **Critical:** app launches and a mission can be started, then **persists after
  a full restart** (SQLite durability).
- **Critical:** tracking connects to the team Traccar server and devices appear.
- Basemap tiles render; Discovery offline map loads and reads (if you have the
  private package).
- Diagnostics export works and contains no private paths or credentials.

## Known Limitations

- Linux x86_64 only from CI for this cut. No Windows, no macOS, no ARM.
- Artifacts are unsigned. Expect Gatekeeper/SmartScreen-style warnings on other
  platforms (n/a for this Linux-only cut).
- Auto-updater is not enabled. Each beta is a fresh download.
- High-definition mountain map packages are not bundled.
- Browser hosted-mode persistence is testing-only and not part of this desktop beta.

## Verification (CI-driven)

Produced by `.github/workflows/electron-release.yml` on the `electron-v0.1.0-beta.4`
tag. CI proves: lint, 847 unit tests, web build, native Linux AppImage + `.deb`
build, the packaged `better_sqlite3.node` is real Linux x86-64, an Xvfb launch
smoke (real window, non-black content, no fault shell), and `SHA256SUMS`
generation. A real-machine Ubuntu smoke (below) covers what CI cannot.

## Rollback / Reinstall

- AppImage: delete the file. `.deb`: `sudo apt remove sartracker-electron-validation`.
- Mission data lives under the app's per-user data directory and is not removed
  by uninstalling the bundle. If corruption is suspected, capture diagnostics
  first and do not delete anything until recorded.

## Pre-Share Checklist

Before promoting this draft to a published release:

- [ ] CI run green (linked above)
- [ ] Linux `.AppImage`, Linux `.deb`, and `SHA256SUMS` present on the draft release
- [ ] `SHA256SUMS` matches local computation against downloaded assets
- [ ] CI launch-smoke evidence reviewed
- [ ] Real-machine Ubuntu smoke pass: launch, mission persists after restart,
      Traccar connects, basemap renders, diagnostics export safe
- [ ] Release body matches this note (with CI Provenance footer appended)
- [ ] Release marked **draft** + **prerelease**
- [ ] Maintainer signed off in `handoff/HANDOFF.md`
