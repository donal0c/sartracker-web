# SAR Tracker Electron Desktop Beta &lt;version&gt; (&lt;build tag&gt;)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** &lt;e.g. 0.1.0-beta.1&gt;
- **Build tag:** &lt;e.g. sha.f352391035a1 or run.42.sha.abc123def456&gt;
- **Cut date (UTC):** &lt;YYYY-MM-DD&gt;
- **Cut by:** &lt;name or agent ID&gt;
- **Linear reference:** &lt;DON-XXX&gt;
- **Verification report:** &lt;relative path under tmp/beta-artifacts/, or "CI run #&lt;n&gt;" for tag-driven CI builds&gt;
- **CI run:** &lt;link to the GitHub Actions run that produced these artifacts, when applicable&gt;

## Artifacts

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_<version>_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_<version>_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| macOS arm64 | `sartracker-electron-validation_<version>_macos_arm64.zip` | Local/manual zipped `.app` while macOS CI is deferred. |
| Windows x86_64 | `sartracker-electron-validation_<version>_windows_x64.exe` | Electron NSIS installer once `DON-141`/Windows packaging passes. |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

Private Discovery map packages are never release artifacts. Distribute those
through the agreed private team channel and load them through Settings after
installing the app.

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
   sudo apt install ./sartracker-electron-validation_<version>_linux_amd64.deb
   ```
   `apt` will pull in runtime dependencies automatically.
4. Launch from your application menu.

### Distribution floor

- Built on Ubuntu 22.04 (glibc 2.35). Compatible with Ubuntu 22.04+, Debian 12+,
  Fedora 38+, Mint 21+, Pop_OS 22.04+, recent Arch.
- Ubuntu 20.04 LTS is below the supported floor. Operators on 20.04 should
  upgrade before using the Electron beta.

### Linux warnings to expect

- Mesa/GPU stderr noise on first launch can be cosmetic. A black or blank map is
  not cosmetic and should be reported with diagnostics.
- If the system has no Secret Service (gnome-keyring-daemon / KDE Wallet not
  running, e.g. minimal i3/sway setup), saving Traccar credentials may fail. Run
  `gnome-keyring-daemon --start` or install `gnome-keyring`/`kwalletmanager` and
  log out/in.

## Install — Windows (secondary target)

### NSIS installer (recommended; no admin required)

This beta is **not yet code-signed.** Windows will warn that the publisher is
unknown. The warnings are expected for an unsigned app and the install does
**not** require admin rights or any change to your security settings.

1. Download `sartracker-web_<version>_windows_x64.exe` and the `SHA256SUMS` file.
2. Verify the checksum from PowerShell:
   ```powershell
   Get-FileHash sartracker-web_<version>_windows_x64.exe -Algorithm SHA256
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

Electron MSI is deferred. Use NSIS once Windows Electron packaging has passed.

### Windows blockers we cannot work around in the unsigned beta

If your laptop is managed by your team or workplace and Windows blocks the
install entirely with no **Run anyway** option, you are on a locked-down policy
(WDAC / AppLocker / SmartScreen for Business). There is no workaround for an
unsigned binary. Use a personal machine, or wait for the signed build.

## Install — macOS

macOS is currently produced locally as a zipped `.app`.

1. Download the macOS artifact and verify its checksum if one is provided.
2. Unzip and copy `SAR Tracker Electron Validation.app` to `/Applications`.
3. The app is ad-hoc signed only. macOS Gatekeeper may refuse to open it.
   Try **Control-click / right-click → Open** first. If quarantine blocks
   launch, run the project-supplied quarantine-removal command:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/SAR Tracker Electron Validation.app"
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

- &lt;explicit limitations the tester must understand before running the beta&gt;
- For the current internal beta lane this normally includes:
  - Linux x86_64 + Windows x86_64 only from CI. macOS is supplied separately
    (built locally) when needed. No Linux ARM, no Windows ARM, no macOS Intel.
  - All artifacts are unsigned. Expect SmartScreen / Gatekeeper warnings.
  - Auto-updater is not enabled. Each beta is a fresh download.
  - High-definition mountain map packages are not bundled with this build.
  - Browser hosted-mode persistence is testing-only and not part of this
    desktop beta.

## Verification (CI-driven)

This section must name the workflow or local build process that produced the
Electron artifacts. The old `.github/workflows/release.yml` is Tauri-era and
must not be cited for Electron artifacts unless it has been migrated.

Minimum verification for an Electron official-map handoff:

- `npm run build`
- focused or full unit tests relevant to the slice
- Electron package build on the target OS
- official Discovery package import/readiness smoke where applicable
- diagnostics export checked for private-data leakage
- `SHA256SUMS` generated for shared artifacts

## Rollback / Reinstall

- **To roll back to a previous beta:**
  1. Quit the running app.
  2. Linux AppImage: delete the AppImage file. `.deb`:
     `sudo apt remove sartracker-electron-validation`. Windows NSIS: uninstall
     via *Settings → Apps*. macOS: drag the `.app` to the bin.
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
- [ ] CI launch-smoke artifacts reviewed: Linux AppImage screenshot/log and
      Windows NSIS screenshot/log.
- [ ] Real-machine smoke pass on the primary platform (Linux): packaged app
      launches, OpenTopoMap tiles load on a normal network, mission can be
      started, mission persists after restart, tracking settings connect to the
      Traccar web/API base URL, diagnostics export works.
- [ ] Release body matches this checked-in note (with CI Provenance footer
      appended)
- [ ] Release marked **prerelease** and **draft** in GitHub UI
- [ ] Release title contains "internal beta"
- [ ] Maintainer has signed off in `handoff/HANDOFF.md`
