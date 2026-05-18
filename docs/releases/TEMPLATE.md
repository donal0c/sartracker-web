# SAR Tracker Desktop Beta &lt;version&gt; (&lt;build tag&gt;)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** &lt;e.g. 0.1.0-beta.1&gt;
- **Build tag:** &lt;e.g. sha.f352391035a1 or run.42.sha.abc123def456&gt;
- **Cut date (UTC):** &lt;YYYY-MM-DD&gt;
- **Cut by:** &lt;name or agent ID&gt;
- **Bead reference:** &lt;sartracker-web-XXXX&gt;
- **Verification report:** &lt;relative path under tmp/beta-artifacts/, or "CI run #&lt;n&gt;" for tag-driven CI builds&gt;
- **CI run:** &lt;link to the GitHub Actions run that produced these artifacts, when applicable&gt;

## Artifacts

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-web_<version>_linux_amd64.AppImage` | Single-file portable run; no install required. Most testers. |
| Linux x86_64 | `sartracker-web_<version>_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| Windows x86_64 | `sartracker-web_<version>_windows_amd64.exe` | NSIS installer, current-user install (no admin required). |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

macOS is not produced by CI in this beta lane (see `sartracker-web-590` for the
deferred CI re-add). When a macOS artifact is needed, it is produced locally
via `npm run beta:verify` (Path B in `docs/releases/README.md`) and uploaded
separately. If this beta drop includes a macOS artifact, list it here.

## Install — Linux (primary target)

### AppImage (zero-install, recommended for first-time testers)

1. Download `sartracker-web_<version>_linux_amd64.AppImage` and the `SHA256SUMS` file.
2. Verify the checksum:
   ```bash
   sha256sum -c SHA256SUMS --ignore-missing
   ```
   The line for the AppImage must say **OK**. If it does not, stop and report.
3. Mark executable and run:
   ```bash
   chmod +x sartracker-web_<version>_linux_amd64.AppImage
   ./sartracker-web_<version>_linux_amd64.AppImage
   ```
4. If you see `dlopen(): error loading libfuse.so.2`, install libfuse2:
   - Ubuntu 24.04 / Debian 13: `sudo apt install libfuse2t64`
   - Ubuntu 22.04 / Debian 12: `sudo apt install libfuse2`
5. The AppImage does not auto-register a desktop menu entry. If you want one,
   install `appimaged` or use the `.deb` instead.

### .deb (system install on Debian-derivatives)

1. Download `sartracker-web_<version>_linux_amd64.deb` and the `SHA256SUMS` file.
2. Verify the checksum (as above).
3. Install:
   ```bash
   sudo apt install ./sartracker-web_<version>_linux_amd64.deb
   ```
   `apt` will pull in the runtime dependencies (`libwebkit2gtk-4.1-0`, `libgtk-3-0`,
   `libayatana-appindicator3-1`, ...) automatically.
4. Launch from your application menu (look for *SAR Tracker Web*).

### Distribution floor

- Built on Ubuntu 22.04 (glibc 2.35). Compatible with Ubuntu 22.04+, Debian 12+,
  Fedora 38+, Mint 21+, Pop_OS 22.04+, recent Arch.
- Ubuntu 20.04 LTS is below the supported floor (no WebKitGTK 4.1). Operators on
  20.04 must upgrade.

### Linux warnings to expect

- WebKitGTK / Mesa stderr noise on first launch (compositing warnings, GPU driver
  fallbacks). Cosmetic — does not indicate a problem.
- If the system has no Secret Service (gnome-keyring-daemon / KDE Wallet not
  running, e.g. minimal i3/sway setup), saving Traccar credentials may fail. Run
  `gnome-keyring-daemon --start` or install `gnome-keyring`/`kwalletmanager` and
  log out/in.

## Install — Windows (secondary target)

### NSIS installer (recommended; no admin required)

This beta is **not yet code-signed.** Windows will warn that the publisher is
unknown. The warnings are expected for an unsigned app and the install does
**not** require admin rights or any change to your security settings.

1. Download `sartracker-web_<version>_windows_amd64.exe` and the `SHA256SUMS` file.
2. Verify the checksum from PowerShell:
   ```powershell
   Get-FileHash sartracker-web_<version>_windows_amd64.exe -Algorithm SHA256
   ```
   Compare the output against the matching line in `SHA256SUMS`. If they do not
   match, stop and report.
3. Right-click the downloaded `.exe` → **Properties** → tick **Unblock** → **OK**.
   This removes the Mark-of-the-Web flag.
4. Double-click to run. Windows SmartScreen will say
   *"Windows protected your PC — Unknown publisher."* Click **More info**, then
   **Run anyway**.
5. The installer runs without prompting for admin. The app installs to
   `%LOCALAPPDATA%\Programs\sartracker-web`.
6. On first launch, the app may briefly install Microsoft WebView2 if it is not
   already on your machine. This requires internet for that one step.

### MSI installer (deferred)

Tauri's MSI bundler does not currently support our pre-release version
suffix (`-beta.N`). Beta releases ship NSIS only. MSI will return when the
version scheme allows it. See `sartracker-web-g1u`.

### Windows blockers we cannot work around in the unsigned beta

If your laptop is managed by your team or workplace and Windows blocks the
install entirely with no **Run anyway** option, you are on a locked-down policy
(WDAC / AppLocker / SmartScreen for Business). There is no workaround for an
unsigned binary. Use a personal machine, or wait for the signed build.

## Install — macOS

macOS is not produced by CI in this beta lane (see `sartracker-web-590`). If a
macOS artifact is supplied separately for this drop (built locally via
`npm run beta:verify`), it will appear in the release as a zipped `.app`.

1. Download the macOS artifact and verify its checksum if one is provided.
2. Unzip and copy `sartracker-web.app` to `/Applications`.
3. The app is ad-hoc signed only. macOS Gatekeeper may refuse to open it.
   Try **Control-click / right-click → Open** first. If quarantine blocks
   launch, run the project-supplied quarantine-removal command:
   ```bash
   xattr -dr com.apple.quarantine /Applications/sartracker-web.app
   ```
   Run this command only for an artifact supplied through the agreed internal
   channel. If a managed Mac blocks unsigned apps by policy, stop and report
   the blocker — do not bypass managed security settings.

## What Changed

- &lt;short, operator-readable bullet list of changes since the previous beta&gt;
- &lt;include Linear issue IDs in square brackets&gt;

## What To Test

- &lt;short list of operator workflows the tester should exercise&gt;
- &lt;mark any items as critical so testers know which signal to prioritise&gt;

## Known Limitations

- &lt;explicit limitations the tester must understand before running the beta&gt;
- For the current internal beta lane this normally includes:
  - Linux x86_64 + Windows x86_64 only from CI. macOS is supplied separately
    (built locally) when needed. No Linux ARM, no Windows ARM, no macOS Intel.
  - All artifacts are unsigned. Expect SmartScreen / Gatekeeper warnings.
  - Tauri auto-updater is not enabled. Each beta is a fresh download.
  - High-definition mountain map packages are not bundled with this build.
  - Browser hosted-mode persistence is testing-only and not part of this
    desktop beta.

## Verification (CI-driven)

This release was produced by `.github/workflows/release.yml` on tag push.
The workflow runs:

- Version trio assertion (tag, package.json, src-tauri/tauri.conf.json all match)
- Release-notes existence check (this file)
- Lint (`npm run lint`)
- Unit tests (`npm run test`)
- Backend tests (`npm run test:backend`)
- Web build (`npm run build`)
- Per-OS Tauri bundle on `ubuntu-22.04` and `windows-2022` (macOS deferred,
  see `sartracker-web-590`)
- SHA256SUMS sidecar generation
- Draft release upload

The workflow does **not** run the manual smoke checklist. That step happens
locally before the release is promoted from draft to published. See
`docs/tauri-beta-release-plan.md` for the manual smoke gate.

## Rollback / Reinstall

- **To roll back to a previous beta:**
  1. Quit the running app.
  2. Linux AppImage: delete the AppImage file. `.deb`:
     `sudo apt remove sartracker-web`. Windows NSIS: uninstall via
     *Settings → Apps → sartracker-web → Uninstall*. macOS: drag
     `sartracker-web.app` to the bin.
  3. Reinstall the older beta from its release note.
- **Mission data:** Mission databases live under the app's per-user data
  directory and are not deleted by uninstalling the bundle. If mission data
  is suspected of corruption, capture diagnostics first and do not delete
  anything until the issue is recorded.

## Pre-Share Checklist

Before promoting this draft to a published release:

- [ ] CI workflow run `OVERALL: PASS` (linked above)
- [ ] All CI release assets present on the draft release: Linux `.AppImage`,
      Linux `.deb`, Windows `.exe` (NSIS). macOS and MSI deferred (see
      `sartracker-web-590` and `sartracker-web-g1u`).
- [ ] `SHA256SUMS` present and matches local computation against downloaded assets
- [ ] Local smoke pass on the primary platform (Linux): packaged app launches,
      mission can be started, mission persists after restart, tracking settings
      can be saved, diagnostics export works
- [ ] Release body matches this checked-in note (with CI Provenance footer
      appended)
- [ ] Release marked **prerelease** and **draft** in GitHub UI
- [ ] Release title contains "internal beta"
- [ ] Maintainer has signed off in `handoff/HANDOFF.md`
