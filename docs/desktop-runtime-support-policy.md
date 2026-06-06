# Desktop Runtime Support Policy

> Canonical runtime support policy for SAR Tracker desktop. This document
> defines what we support, how we keep it current, how we validate releases,
> how we detect host-specific breakage, and how operators/admins handle
> updates.
>
> **Linear issue:** DON-30 (S8e)
> **Decision basis:** DON-29 closed 2026-06-06 — Electron is the production
> desktop shell.

---

## 1. Runtime Decision Summary

Electron is the production desktop shell. Tauri code remains in the repo as
historical reference but is not the release path.

**Why Electron:**
- Bundles Chromium rather than relying on host WebKitGTK (the root cause of
  the Linux black-map field failure).
- Proven on all team machine classes: Dell Ubuntu 24.04, old Ubuntu 18.04
  Lenovo Z580, PCLinuxOS/NVIDIA Quadro P620, PCLinuxOS/AMD Ryzen 7.
- All of the above black-screened under Tauri/WebKitGTK.
- Bridge parity (settings, secrets, SQLite, tracking, GPX, attachments,
  diagnostics, offline maps) validated on installed Linux `.deb`.

**What Electron bundles:**
- Chromium rendering engine (WebGL, V8 JavaScript, network stack)
- Node.js runtime for main process
- `better-sqlite3` native module for mission persistence
- Application code (React, MapLibre GL JS, Terra Draw, proj4js, Turf.js)
- All npm dependencies at locked versions

**What still depends on the host OS:**
- Linux kernel and glibc baseline (minimum glibc 2.35 / Ubuntu 22.04)
- GPU driver and Mesa/NVIDIA stack (WebGL rendering)
- Display server (X11 or Wayland via XWayland)
- Secret store backend (GNOME Keyring, KDE Wallet, or compatible Secret
  Service implementation)
- FUSE support for AppImage (libfuse2)
- Filesystem permissions and sandboxing (AppArmor on Ubuntu 24.04+)
- Network connectivity to Traccar and map tile providers

**WebGL failure resilience:** If the host GPU/driver breaks WebGL even inside
Electron's bundled Chromium, the app has two defenses:
1. **Visible failure with diagnostics:** The diagnostics export reports WebGL
   renderer, GPU feature status, and map status. A black map is detectable
   and actionable.
2. **Leaflet raster fallback (DON-27):** A read-only non-WebGL fallback
   renderer is available behind `?mapRenderer=leaflet`. It renders raster
   basemap tiles, tracking points/breadcrumbs, markers, and drawing GeoJSON
   without WebGL. This is a degraded-mode safety net, not the primary
   renderer. MapLibre (WebGL) remains the default.

---

## 2. Supported Operating System Matrix

### Linux (primary field target)

| Tier | Distro / Version | Packaging | Evidence |
| --- | --- | --- | --- |
| Tier 1 (tested, supported) | Ubuntu 22.04+ | `.deb`, AppImage | Dell Ubuntu 24.04, CI ubuntu-22.04 |
| Tier 1 (tested, supported) | Debian 12+ | `.deb`, AppImage | glibc compat from ubuntu-22.04 build |
| Tier 1 (tested, supported) | PCLinuxOS (RPM-family) | AppImage | Two team machines: NVIDIA + AMD |
| Tier 2 (expected compatible) | Fedora 38+, Mint 21+, Pop_OS 22.04+ | AppImage, `.deb` where supported | glibc 2.35+ satisfied |
| Unsupported | Ubuntu 20.04 and older | — | glibc 2.31 is below floor; old Ubuntu 18.04 worked for S8a probe only |
| Not tested | Arch, openSUSE, other RPM distros | AppImage likely works | No team machines for validation |

### macOS

| Tier | Version | Packaging | Evidence |
| --- | --- | --- | --- |
| Tier 1 (tested, supported) | macOS arm64 (Apple Silicon) | `.app` zip | Development machine, DON-107 offline maps |
| Tier 2 (expected compatible) | macOS Intel | `.app` zip (separate build) | Not yet validated |
| Not CI-built | — | — | Deferred from CI per billing (10x cost); built locally via Path B |

### Windows

| Tier | Version | Packaging | Evidence |
| --- | --- | --- | --- |
| Tier 2 (CI-built, not field-validated) | Windows 10+ x86_64 | NSIS `.exe` (current-user) | CI launch smoke on windows-2022; no real machine available |
| Deferred | Windows MSI | — | Tauri MSI bundler rejects `-beta.N` suffix |
| Gap | Real-machine operator validation | — | Blocked until a Windows machine is available |

---

## 3. Packaging Formats

| Format | Target | First-class? | Notes |
| --- | --- | --- | --- |
| AppImage | All Linux, especially RPM-family (PCLinuxOS) | Yes | Zero-install; requires libfuse2 on Ubuntu 24.04+. Configured in `electron-builder.json`. |
| `.deb` | Ubuntu, Debian, Mint, Pop_OS | Yes | System install with desktop integration. Configured in `electron-builder.json`. |
| `.rpm` | Fedora, openSUSE, PCLinuxOS native | No (deferred) | Only if AppImage proves insufficient; team uses AppImage successfully |
| NSIS `.exe` | Windows | Gap | Not yet configured in `electron-builder.json`. The existing CI Windows build uses Tauri/WebView2. Electron Windows packaging must be added before the Tauri release path is retired. |
| MSI | Windows enterprise/managed | Deferred | Depends on Electron Windows packaging being implemented first |
| `.app` zip | macOS | Yes (manual build) | Built locally via `npm run electron:pack -- --mac`. Ad-hoc signed; not CI-built until billing decision resolves. Not configured in `electron-builder.json` (uses CLI flags). |

**Build host pinning:**
- Linux artifacts: built on `ubuntu-22.04` via `electron-linux-validation.yml`
  (glibc 2.35 floor for forward-compatibility).
- Windows artifacts: gap — Electron Windows build not yet configured. Current
  CI Windows lane uses the Tauri bundler (to be retired).
- macOS artifacts: built locally on the development machine (arm64) using
  `npm run electron:pack -- --mac`.

**Packaging migration note:** The move from Tauri to Electron as the
production shell means the Windows packaging lane needs migration from
Tauri's NSIS bundler to electron-builder's NSIS target. Until that work is
complete, the existing Tauri Windows CI build remains the interim Windows
artifact path. This is tracked as future work (Section 14).

---

## 4. Electron and Chromium Update Policy

### Pinned versions (current)

| Component | Version | Pinned in |
| --- | --- | --- |
| Electron | ^40.10.0 (resolved: 40.10.0) | `package.json` (caret range; `package-lock.json` is the true pin) |
| Chromium (bundled) | 144.0.7559.236 | Determined by Electron version |
| Node.js (bundled) | 24.15.0 | Determined by Electron version |
| electron-builder | ^26.0.12 (resolved: 26.0.12) | `package.json` (caret range; lockfile is the true pin) |

**Note:** The caret ranges in `package.json` allow minor/patch updates, but
`package-lock.json` is committed and authoritative. `npm ci` in CI ensures
reproducible builds. Version drift only happens via explicit `npm update`.

### Review cadence

| Trigger | Action | Timeframe |
| --- | --- | --- |
| Electron stable release | Evaluate changelog for security fixes, breaking changes, and Chromium CVEs | Within 2 weeks of release |
| Critical Chromium security CVE (actively exploited) | Emergency bump evaluation | Within 72 hours |
| High-severity Chromium CVE | Scheduled bump evaluation | Within 2 weeks |
| Quarterly review | Check Electron EOL timeline, upcoming breaking changes, and dependency freshness | Every 3 months |

### Upgrade decision process

1. **Evaluate:** Read Electron release notes and linked Chromium CVEs. Does
   the CVE affect our attack surface? (SAR Tracker loads controlled local
   content and known remote tile/API URLs, not arbitrary web pages.)
2. **Test locally:** Bump version in a branch. Run full unit + E2E + backend
   test suites. Run `electron:pack` and verify local launch.
3. **CI validation:** Push to trigger `electron-linux-validation.yml`. Verify
   native module rebuild, map rendering, and screenshot content mean.
4. **Team machine validation:** For major Electron version bumps (e.g. 40→41),
   produce a validation AppImage and test on at least one representative
   Linux machine before merging.
5. **Hold policy:** If a bump introduces a regression (map rendering, native
   module, packaging) that cannot be resolved within the review window,
   hold at the current version and document the hold reason in this file.

### When to hold

- A Chromium renderer change breaks MapLibre GL JS on a tested GPU class.
- A Node.js major bump breaks `better-sqlite3` native module builds.
- electron-builder compatibility lags behind the Electron version.
- A packaging change breaks AppImage FUSE behavior or `.deb` dependency
  resolution on the supported floor.

---

## 5. Application Dependency Update Policy

### npm dependencies

| Category | Cadence | Process |
| --- | --- | --- |
| Security vulnerabilities (`npm audit`) | Immediate evaluation | Patch if exploitable in our context; otherwise note and schedule |
| `better-sqlite3` | Pin exact major; minor/patch on review | Native module — requires rebuild validation on Linux |
| MapLibre GL JS | Pin major; minor/patch after local map render check | Core rendering dependency |
| Other production deps | Monthly `npm audit` + quarterly manual review | Standard npm update flow |
| Dev dependencies | Low priority | Update when convenient; do not block releases |

### Lockfile rules

- `package-lock.json` is committed and authoritative.
- No `npm install` without reviewing the lockfile diff.
- CI uses `npm ci` (not `npm install`) to ensure reproducible builds.
- After any dependency change, verify: `npm run test`, `npm run build`,
  `npm run electron:pack`.

### Native module expectations

- `better-sqlite3` is the only production native module.
- It must be rebuilt on the target platform (no macOS→Linux cross-build;
  DON-28 proved this produces invalid ELF headers).
- CI builds on `ubuntu-22.04` using Node 22 and produces a verified
  ELF x86-64 `.node` binary.
- After any Node.js or Electron major bump, the native module must be
  rebuilt and inspected: `file node_modules/better-sqlite3/build/Release/better_sqlite3.node`
  must report `ELF 64-bit LSB shared object, x86-64`.

### Rollback plan

- If a dependency update causes a regression detected post-merge:
  1. Revert the lockfile change.
  2. Rebuild and verify.
  3. Cut a new beta if the broken version was already distributed.
- Mission data is never affected by dependency changes (SQLite schema is
  versioned independently).

---

## 6. Release Channels and Auto-Update Policy

### Channels

| Channel | Audience | Artifact source | Promotion gate |
| --- | --- | --- | --- |
| Validation probe | Developer only | Local build or CI draft | No external distribution |
| Pre-release (internal beta) | Team testers | GitHub Releases (draft + prerelease) | CI green + manual smoke |
| Stable field release | All operators | GitHub Releases (published) | Pre-release soak + full smoke checklist + mission-readiness gates |

### Auto-update decision

**Auto-update is DISABLED.** Silent auto-update will not be enabled until:

1. A tested rollback mechanism exists (not just "reinstall the old version").
2. Release channel separation prevents validation/pre-release builds from
   reaching stable-channel machines.
3. The Tauri/Electron updater signing key infrastructure is in place.
4. At least one full release cycle has been completed with manual updates
   to prove the release process is reliable.

**Rationale:** A field machine must not silently move onto an untested
runtime immediately before or during a mission. Manual download is
acceptable for the current team size and update cadence.

### Operator/admin update workflow

1. Admin receives notification of a new stable release (GitHub notification,
   team message, or manual check).
2. Admin downloads the artifact and verifies the SHA256 checksum.
3. Admin installs on a non-mission machine first.
4. Admin runs the mission-readiness smoke (Section 7) on the non-mission
   machine.
5. Only after smoke passes does the admin update mission machines.
6. **Never update a mission machine immediately before or during a scheduled
   mission.** Updates should happen during quiet periods with time to
   validate and roll back if needed.

---

## 7. Mission-Readiness Release Gates

Before any build is promoted from pre-release to stable field release, it
must pass all of the following on a representative machine:

### Automated gates (CI)

- [ ] Version trio assertion (tag, package.json, electron-builder config)
- [ ] Lint clean
- [ ] Unit tests pass (all files)
- [ ] Backend/Tauri tests pass
- [ ] Web build succeeds
- [ ] Live dependency preflight (Traccar API reachable, tile URLs respond)
- [ ] Native Linux AppImage launch smoke (window appears, map renders)
- [ ] Native Windows NSIS launch smoke (installer completes, app starts)
- [ ] SHA256SUMS generated

### Manual gates (real machine)

- [ ] Packaged app launches without errors on a representative Linux machine
- [ ] Map renders at least one raster basemap (OpenTopoMap or official)
- [ ] Black-canvas detection: no visible black map after 10 seconds with
      network available
- [ ] Tracking connection test: connects to configured Traccar, shows devices
- [ ] Mission create/save/restart persistence: SQLite survives app restart
- [ ] Official offline maps: registered package renders tiles with network
      disabled (when applicable)
- [ ] GPX import: file and folder import produce visible tracks
- [ ] Diagnostics export: produces a sanitized JSON report
- [ ] Rollback evidence: previous beta can be reinstalled and launches
      correctly after uninstalling the new version

### Visual evidence

- [ ] Screenshot of map rendering with tiles visible
- [ ] Screenshot of tracking panel with devices listed
- [ ] Screenshot of diagnostics showing correct runtime label

---

## 8. Team Machine Inventory

### Purpose

Maintain a one-time inventory of team machines so that support triage does
not require ad-hoc "what distro are you running?" exchanges during a crisis.

### Inventory template

Capture once per machine. Update only when the machine OS is upgraded or
hardware changes.

```yaml
machine_id: <short friendly name, e.g. "Ned-Dell-Ubuntu">
owner: <team member name>
role: <mission-primary | training | development>
os: <e.g. Ubuntu 24.04 LTS>
kernel: <e.g. 6.8.0-45-generic>
arch: x86_64
display_server: <X11 | Wayland | XWayland>
gpu: <e.g. Intel HD Graphics 4000 / NVIDIA Quadro P620 / AMD integrated>
gpu_driver: <e.g. Mesa 24.0.1 / nvidia-driver-580.159.03>
desktop_environment: <e.g. GNOME 46 / KDE Plasma 5.27 / XFCE>
secret_store: <e.g. gnome-keyring / kwallet / none>
package_format_used: <AppImage | .deb | both>
fuse_version: <libfuse2 | libfuse3 | not installed>
network: <normal broadband | mobile hotspot | restricted corporate>
last_updated: <YYYY-MM-DD>
notes: <any machine-specific caveats>
```

### Known team machines (from S8a/S8c evidence)

| Machine | OS | GPU | Driver | Package | Map result |
| --- | --- | --- | --- | --- | --- |
| Dell Ubuntu 24.04 | Ubuntu 24.04 | Intel (integrated) | Mesa | `.deb` + AppImage | Renders (Electron) |
| Old Lenovo Z580 | Ubuntu 18.04 | Intel HD 4000 | Mesa/i915 | AppImage | Renders (Electron) |
| PCLinuxOS NVIDIA | PCLinuxOS x64 | NVIDIA Quadro P620 | 580.159.03 | AppImage | Renders (Electron) |
| PCLinuxOS AMD | PCLinuxOS x64 | AMD Ryzen 7 (Radeon) | Mesa/amdgpu | AppImage | Renders (Electron) |

---

## 9. Diagnostics and Support Workflow

### Diagnostics export design

The app includes a one-click diagnostics export that produces a sanitized
JSON report. The report is allow-listed: only explicitly chosen fields are
included.

**Included in diagnostics:**
- App version, build tag, commit SHA
- Runtime type (`electron desktop` / `browser validation` / `tauri desktop`)
- Electron version, Chromium version, Node version
- OS platform, arch, kernel version
- GPU feature status (from Electron `app.getGPUFeatureStatus()`)
- WebGL renderer/vendor strings
- MapLibre status (ready/error/context-lost)
- safeStorage backend (gnome_libsecret / kwallet / basic_text / unavailable)
- Configured provider base URL and auth mode (no credentials)
- Secret-present indicator (boolean, not the secret itself)
- Tracking status and cache summary (device count, last poll time)
- Mission store path, schema version, SQLite status, native module load
- Database and backup paths
- Recent app-owned fault/error messages
- Official map package metadata (map type, zoom range, tile count, bounds,
  status — no file paths, no credentials, no source URLs)

**Excluded from diagnostics (never sent):**
- Traccar credentials or API keys
- Full Electron/Chromium profile directories
- Cookies, session storage, trust tokens, network state databases
- GPU cache files (DawnGraphiteCache, DawnWebGPUCache, GPUCache)
- File system paths to user data (shown locally, excluded from export)
- Licensed map source file paths or access credentials
- Mission content or personal data

### Issue intake workflow

```
1. INTAKE
   - Operator reports issue via agreed channel (team chat, email, or in-person)
   - Operator attaches: diagnostics export + screenshot + description of
     what they were doing
   - If the issue happened during a mission: note the mission name and
     approximate time

2. EVIDENCE
   - Cross-reference diagnostics against the machine inventory
   - Check if the issue is known (existing Linear issue)
   - Check if the runtime/GPU/driver matches a known failure class

3. TRIAGE
   - Classify: packaging | runtime | map/WebGL | network/tracking |
     application bug | operator confusion | host environment
   - Assign priority based on mission impact:
     - Critical: blocks mission start, loses mission data, or breaks tracking
     - High: degrades map visibility or operator confidence
     - Medium: cosmetic, workaround available
     - Low: minor UI preference

4. REPRODUCTION
   - Attempt to reproduce on the matching platform tier
   - If not reproducible: request additional evidence or schedule a
     screen-share

5. FIX
   - Implement fix with tests
   - Validate on the affected platform tier

6. VALIDATION
   - Produce a pre-release build containing the fix
   - Have the reporter (or same machine class) confirm the fix

7. RELEASE
   - Include the fix in the next scheduled pre-release or stable build
   - Critical fixes may warrant an out-of-band release

8. COMMUNICATION
   - Update the reporter
   - If the issue affected multiple machines, notify all potentially
     affected operators
   - Update the known-issues list if relevant
```

### Known failure classes

| Class | Symptom | Likely cause | First response |
| --- | --- | --- | --- |
| Black map | Map canvas renders black, tracking overlay visible | Host GPU/WebGL/driver issue even inside Electron (rare) | Check diagnostics WebGL renderer; try `--disable-gpu` flag; escalate |
| Secret store failure | "Cannot store credentials" on Linux | No Secret Service running | Install gnome-keyring; the app adds `--password-store=gnome-libsecret` automatically |
| FUSE missing | AppImage fails to launch with libfuse error | Ubuntu 24.04 dropped libfuse2 from default install | `sudo apt install libfuse2t64` |
| Tracking connection failure | "Connection failed" in settings | Wrong URL (port 5055 instead of 8082), or network issue | Verify URL is the web/API port, not device listener |
| SQLite native module crash | App crashes on mission operations | Wrong-architecture native module in package | Rebuild from correct platform; verify ELF header |

---

## 10. Rollback Policy

### Operator rollback path

Operators must always have a known-good version they can return to.

1. **Keep the previous stable release artifact.** Do not delete old releases
   from GitHub.
2. **Rollback procedure:**
   - Quit the current app.
   - Uninstall: AppImage (delete file), `.deb` (`sudo apt remove`), Windows
     (Settings → Apps → Uninstall), macOS (drag to bin).
   - Download and install the previous known-good release from GitHub.
   - Launch and verify map/tracking/mission.
3. **Mission data is preserved across versions.** SQLite databases live in
   the app's per-user data directory and are not removed by uninstalling.
   Schema migrations are forward-only; if a rollback crosses a schema
   boundary, note this explicitly in the release notes.

### Known-good release list

Maintain a list of releases confirmed stable for field use:

| Version | Date | Status | Notes |
| --- | --- | --- | --- |
| (none yet) | — | — | First stable release pending |

Pre-release/beta builds are never "known-good" for live missions unless
explicitly promoted after full smoke.

---

## 11. Stable vs Pre-Release Channel Separation

### Labels

- **Pre-release:** GitHub Release marked `prerelease: true`. Title contains
  "internal beta" or "validation". Version contains `-beta.N` or `-rc.N`.
- **Stable:** GitHub Release marked `prerelease: false`, `draft: false`.
  Version is a clean semver (e.g. `1.0.0`).

### Operator guidance

- **Mission machines** should only run stable releases that have passed the
  full mission-readiness gate (Section 7).
- **Training/testing machines** may run pre-releases for feedback purposes.
- **Never install a pre-release on a mission machine without explicit team
  lead approval and a completed smoke.**
- Release notes clearly distinguish stable field builds from validation
  probes by title, version suffix, and the GitHub prerelease flag.

---

## 12. Operator Pre-Mission Update Guidance

### What should NOT be updated immediately before a mission

- The SAR Tracker application itself
- The operating system (kernel, system packages, display drivers)
- GPU drivers (Mesa, NVIDIA, AMD)
- Desktop environment or display server
- Secret store / keyring software
- Any system package that could affect display, network, or sandboxing

### What is safe to update before a mission

- Map tile cache (the app manages this internally)
- Official map packages (offline packages are additive, not destructive)
- Traccar server credentials (if the server moved)
- Weather links and other non-critical settings

### Recommended update cadence

- **Application updates:** During quiet periods (e.g. weekly training night,
  post-mission debrief day). Never during the 24 hours before a scheduled
  exercise or callout readiness window.
- **OS updates:** Monthly, with a 48-hour soak period before mission
  readiness.
- **GPU driver updates:** Only when a known rendering issue requires it.
  Always validate map rendering after a driver change.

---

## 13. Recurring Review Schedule

| Review | Cadence | Owner | Output |
| --- | --- | --- | --- |
| Electron security CVEs | Every 2 weeks (check release notes) | Maintainer | Bump decision or documented hold |
| npm audit | Monthly | Maintainer | Patch or document accepted risk |
| Full dependency freshness | Quarterly | Maintainer | Update plan or explicit holds |
| Machine inventory refresh | Annually or on OS upgrade | Each operator | Updated inventory entry |
| Policy review | Every 6 months | Maintainer + team lead | Policy amendments if needed |
| Known-good release list | Every stable release | Maintainer | Updated table in Section 10 |

---

## 14. Future Work (Not In v1 Policy)

These items are acknowledged but intentionally deferred:

- **Electron Windows packaging:** Migrate the Windows build from Tauri NSIS
  to electron-builder NSIS. Until complete, the existing Tauri CI Windows
  lane remains the interim Windows artifact path. Must be resolved before
  Tauri code is removed from the repo.
- **Auto-update mechanism:** Requires updater signing keys, channel
  separation, and tested rollback. Tracked separately.
- **Code signing:** macOS Developer ID + notarization, Windows Azure Trusted
  Signing. Gated on legal entity and budget decisions.
- **`.rpm` packaging:** Only if AppImage proves insufficient for RPM-family
  distros.
- **Linux ARM / Windows ARM:** Only when an operator requests it.
- **Offline/air-gapped update delivery:** USB-based update path for machines
  without reliable internet. Consider when field deployment patterns clarify.
- **Automated fleet telemetry:** Opt-in crash/diagnostic reporting from
  mission machines. Privacy and consent review required first.
- **Real Windows machine validation:** CI builds and launches Windows NSIS
  but no operator workflow has been validated on a real Windows machine.
  Blocked until hardware is available.

---

## Document History

| Date | Change | Reference |
| --- | --- | --- |
| 2026-06-06 | Initial policy created | DON-30, DON-29 decision |
