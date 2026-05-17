# SAR Tracker Desktop Beta 0.1.0-beta.2 (first CI-driven cut)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.2
- **Build tag:** v0.1.0-beta.2 (CI-driven, supersedes failed v0.1.0-beta.1; commit SHA + run URL appended by the workflow)
- **Cut date (UTC):** 2026-05-17
- **Cut by:** Claude Opus 4.7 (B4 first end-to-end CI run)
- **Bead reference:** sartracker-web-y6a (B4); sartracker-web-590 (deferred macOS CI re-add)
- **Verification report:** GitHub Actions run linked from the workflow summary
- **CI run:** see "CI Provenance" footer appended by the workflow

## Artifacts

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-web_0.1.0-beta.2_linux_amd64.AppImage` | Single-file portable run; no install required. Most testers. |
| Linux x86_64 | `sartracker-web_0.1.0-beta.2_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| Windows x86_64 | `sartracker-web_0.1.0-beta.2_windows_amd64.exe` | NSIS installer, current-user install (no admin required). Most testers. |
| Windows x86_64 | `sartracker-web_0.1.0-beta.2_windows_amd64.msi` | MSI installer, machine-wide (admin required). For IT-managed deployment. |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

macOS is not produced by CI in this beta lane (deferred per `sartracker-web-590`
to keep GitHub Actions billed minutes inside the free tier — macOS bills at 10x
the rate of Linux). When a macOS artifact is needed it is built locally via
`npm run beta:verify` and uploaded to the release manually.

## Install — Linux (primary target)

### AppImage (zero-install, recommended for first-time testers)

1. Download `sartracker-web_0.1.0-beta.2_linux_amd64.AppImage` and the
   `SHA256SUMS` file.
2. Verify the checksum:
   ```bash
   sha256sum -c SHA256SUMS --ignore-missing
   ```
   The line for the AppImage must say **OK**. If it does not, stop and report.
3. Mark executable and run:
   ```bash
   chmod +x sartracker-web_0.1.0-beta.2_linux_amd64.AppImage
   ./sartracker-web_0.1.0-beta.2_linux_amd64.AppImage
   ```
4. If you see `dlopen(): error loading libfuse.so.2`, install libfuse2:
   - Ubuntu 24.04 / Debian 13: `sudo apt install libfuse2t64`
   - Ubuntu 22.04 / Debian 12: `sudo apt install libfuse2`
5. The AppImage does not auto-register a desktop menu entry. If you want one,
   install `appimaged` or use the `.deb` instead.

### .deb (system install on Debian-derivatives)

1. Download `sartracker-web_0.1.0-beta.2_linux_amd64.deb` and the `SHA256SUMS`
   file.
2. Verify the checksum (as above).
3. Install:
   ```bash
   sudo apt install ./sartracker-web_0.1.0-beta.2_linux_amd64.deb
   ```
4. Launch from your application menu (look for *SAR Tracker Web*).

### Distribution floor

- Built on Ubuntu 22.04 (glibc 2.35). Compatible with Ubuntu 22.04+, Debian 12+,
  Fedora 38+, Mint 21+, Pop_OS 22.04+, recent Arch.
- Ubuntu 20.04 LTS is below the supported floor (no WebKitGTK 4.1).

### Linux warnings to expect

- WebKitGTK / Mesa stderr noise on first launch (compositing warnings, GPU driver
  fallbacks). Cosmetic — does not indicate a problem.
- If the system has no Secret Service (gnome-keyring-daemon / KDE Wallet not
  running), saving Traccar credentials may fail. Install `gnome-keyring`
  or `kwalletmanager` and log out/in.

## Install — Windows (secondary target)

This beta is **not yet code-signed.** Windows will warn that the publisher is
unknown. The warnings are expected for an unsigned app and the install does
**not** require admin rights or any change to your security settings.

### NSIS installer (recommended; no admin required)

1. Download `sartracker-web_0.1.0-beta.2_windows_amd64.exe` and the
   `SHA256SUMS` file.
2. Verify the checksum from PowerShell:
   ```powershell
   Get-FileHash sartracker-web_0.1.0-beta.2_windows_amd64.exe -Algorithm SHA256
   ```
   Compare the output against the matching line in `SHA256SUMS`.
3. Right-click the downloaded `.exe` → **Properties** → tick **Unblock** → **OK**.
4. Double-click to run. SmartScreen will say *"Windows protected your PC —
   Unknown publisher."* Click **More info**, then **Run anyway**.
5. The installer runs without prompting for admin. The app installs to
   `%LOCALAPPDATA%\Programs\sartracker-web`.
6. On first launch, the app may briefly install Microsoft WebView2 if it is not
   already on your machine. This requires internet for that one step.

### MSI installer (admin required; for IT-managed deployment)

Same SmartScreen flow as the NSIS path. UAC prompts for elevation. Use this
only if you need machine-wide install.

### Windows blockers we cannot work around in the unsigned beta

If your laptop is managed by your team or workplace and Windows blocks the
install entirely with no **Run anyway** option, you are on a locked-down policy
(WDAC / AppLocker / SmartScreen for Business). There is no workaround. Use a
personal machine or wait for the signed build.

## What Changed

### Since the failed v0.1.0-beta.1 cut (2026-05-17)

`v0.1.0-beta.1` was the first CI-driven cut and failed during the gates job:
the backend tests step (`npm run test:backend` → `cargo test`) could not link
`gdk-sys` because the Linux GTK/WebKit system libraries were not installed in
the gates job — only the bundle job had the apt step. No artifacts were
produced and no draft release was created. Per project policy
(`docs/releases/README.md`: tags are immutable), the failed tag was retained
on the remote and this release is cut as `v0.1.0-beta.2`.

Fix: the gates job now installs `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`,
`librsvg2-dev`, and `patchelf` before running cargo test. The bundle job's
identical apt step is unchanged.

### Project changes since the start of the project

This is the first CI-driven cross-platform desktop beta cut. Everything that
has landed on `master` since the start of the project is included. Notable
recent items:

- **B4: Cross-platform Tauri beta distribution** [sartracker-web-y6a]. Builds
  Linux AppImage + .deb and Windows NSIS + MSI on `v*` tag push via
  `.github/workflows/release.yml`. macOS deferred from CI per
  [sartracker-web-590].
- **B6: GPX and drawing hit-test hardening** [sartracker-web-fy5]. Marker /
  drawing / GPX click priority is now explicit (`marker > drawing > empty`).
  The headline marker-stacked-under-polygon swallow bug is fixed.
- **Visual review automation V2** [sartracker-web-n9i]. `npm run visual:review`
  runs the second-layer Opus review automatically with caching and severity
  gating.
- **Mast tracking ratio cleanup** [sartracker-web-zq9]. The ambiguous
  `ONLINE 14/13` ratio is replaced with separate `FIX` / `STALE` rows.
- **OpenTopoMap badge over-eagerness fix** [sartracker-web-2xp]. Tile-only
  filter and widened defaults (5-in-30s) so non-tile errors no longer count
  against the trust budget.
- **Visual review prompt drift fixes** [sartracker-web-wn6, sartracker-web-b3c].
- **R-series shared/runtime hardening** (R1–R11). Visible autosave failure
  reporting, observed-tick stale detection, honest hosted browser system
  status, persistent lifecycle backup failure alert, exception-safe runtime
  controller swap, runtime fault reload hardening, regression E2E coverage,
  browser harness storage non-goals note.
- **A3 batch (A3.1–A3.14)**: map placement guardrails, drawing rendering /
  visibility, compact Maps and Map Tools chrome, mission mast cleanup,
  contrast / theme pass, static notes relocation, Marker At Grid Reference,
  drawing labels / styles / delete, configurable Weather links (external links
  only), Irish Grid conversion accuracy, marker placement stability from
  coordinate entry, roster spacing, coordinate converter formats, drawing
  tools renamed to Map Tools with Measure
  [sartracker-web-6y3 and children].
- **Tauri renderer Traccar fetch via Rust reqwest** [sartracker-web-qmr].
  macOS App Transport Security blanket exception removed; renderer Traccar
  polling now goes through a Tauri command backed by Rust reqwest.

## What To Test

Critical operator paths the tester should exercise on Linux first, Windows
second:

- [ ] Packaged app launches without errors. Build/version chip in the mast
      reads `0.1.0-BETA.1+SHA.<commit>`.
- [ ] Start a new mission. Mission phase changes to **active**. Timer ticks.
- [ ] Pause / resume / finish the mission.
- [ ] Restart the app and confirm the mission persists across the restart.
- [ ] Configure a Traccar provider in Settings (use the test credentials in
      `handoff/HANDOFF.md` § Traccar Test Details). Confirm tracking devices
      appear and the FIX count increments. Mast `STALE` count should remain
      sane (zero on a healthy server).
- [ ] Place a marker by clicking the map and another via Marker At Grid
      Reference. Both must persist after restart.
- [ ] Draw a search-area polygon and a range ring. Both must render cleanly,
      hide via the Layers panel, and persist after restart.
- [ ] Open Diagnostics and run an export. The exported file must contain the
      version line matching the mast.
- [ ] Confirm the OpenTopoMap basemap loads and the tile-health badge does not
      flag a degraded state on a healthy network.

## Known Limitations

- Linux x86_64 + Windows x86_64 only from CI. macOS is supplied separately
  (built locally) when needed. No Linux ARM, no Windows ARM, no macOS Intel.
- All artifacts are unsigned. Expect SmartScreen / Gatekeeper warnings.
- Tauri auto-updater is not enabled. Each beta is a fresh download.
- High-definition mountain map packages are not bundled with this build.
- Browser hosted-mode persistence is testing-only and not part of this
  desktop beta.
- This is the first CI-driven beta cut. The release pipeline itself is being
  validated end-to-end by this run.

## Verification (CI-driven)

This release was produced by `.github/workflows/release.yml` on tag push.
The workflow runs:

- Version trio assertion (tag, package.json, src-tauri/tauri.conf.json all match)
- Release-notes existence check (this file)
- Lint (`npm run lint`)
- Unit tests (`npm run test`)
- Backend tests (`npm run test:backend`)
- Web build (`npm run build`)
- Per-OS Tauri bundle on `ubuntu-22.04` and `windows-2022`
- SHA256SUMS sidecar generation
- Draft release upload

The workflow does **not** run the manual smoke checklist. That step happens
locally before the release is promoted from draft to published.

## Rollback / Reinstall

- **To roll back:** quit the running app, uninstall the current beta
  (Linux AppImage: delete the file; `.deb`: `sudo apt remove sartracker-web`;
  Windows NSIS: *Settings → Apps → sartracker-web → Uninstall*), and reinstall
  the older beta from its release note.
- **Mission data:** Mission databases live under the app's per-user data
  directory and are not deleted by uninstalling the bundle.

## Pre-Share Checklist

Before promoting this draft to a published release:

- [ ] CI workflow run `OVERALL: PASS` (linked above)
- [ ] All CI release assets present on the draft release: Linux `.AppImage`,
      Linux `.deb`, Windows `.exe` (NSIS), Windows `.msi`. macOS, if needed,
      uploaded separately from a local build.
- [ ] `SHA256SUMS` present and matches local computation against downloaded
      assets
- [ ] Local smoke pass on the primary platform (Linux): packaged app launches,
      mission can be started, mission persists after restart, tracking
      settings can be saved, diagnostics export works
- [ ] Release body matches this checked-in note (with CI Provenance footer
      appended)
- [ ] Release marked **prerelease** and **draft** in GitHub UI
- [ ] Release title contains "internal beta"
- [ ] Maintainer has signed off in `handoff/HANDOFF.md`
