# S4: Tauri Desktop Distribution — Spike Results

**Date:** 2026-04-06
**Status:** RESEARCH COMPLETE (no build — Rust not installed)
**Verdict:** Tauri 2 is viable. macOS signing is non-negotiable ($99/yr). Windows signing strongly recommended (~$120/yr). Total: ~$220/yr.

---

## Table of Contents

1. [Tauri 2 Architecture](#1-tauri-2-architecture)
2. [Auto-Updater](#2-auto-updater)
3. [Code Signing — Full Cost/Effort Analysis](#3-code-signing--full-costeffort-analysis)
4. [Installation UX Assessment](#4-installation-ux-assessment)
5. [Tauri Capabilities & Permissions](#5-tauri-capabilities--permissions)
6. [Recommendation](#6-recommendation)

---

## 1. Tauri 2 Architecture

### How Tauri Works

Tauri uses the operating system's native webview instead of bundling a browser engine (like Electron does with Chromium). The architecture is:

```
Frontend (React/TS) → System WebView → Tauri Core (Rust) → OS APIs
```

| Platform | WebView Engine        | Update Mechanism       |
|----------|-----------------------|------------------------|
| Windows  | **WebView2** (Chromium/Edge) | Windows Update / auto-update |
| macOS    | **WKWebView** (WebKit/Safari) | macOS system updates   |
| Linux    | **WebKitGTK** (webkit2gtk)    | Distro package manager |

**Key implication:** Security patches come via OS updates automatically. The tradeoff is minor rendering inconsistency across platforms (WebKit vs Chromium), though for a map-centric app this is unlikely to matter.

### Expected Binary Size (React + MapLibre)

| Component | Size |
|-----------|------|
| Frontend bundle (React + MapLibre GL JS + app code) | ~3–5 MB |
| Tauri core (Rust binary) | ~5–10 MB |
| **Expected installer total** | **10–20 MB** (unoptimised) |
| **Optimised** | **8–15 MB** |
| **Electron equivalent** | **150–200 MB** |

MapLibre GL JS is ~1.5–2 MB minified+gzipped. Real-world Tauri apps consistently report 5–15 MB installers.

**Note:** There is a known Tauri v2 size regression vs v1 (~2x, tracked in tauri-apps/tauri#12820). Mitigation PR #12890 addressed ~80% of the bloat. Current v2 sizes are 9–15 MB unoptimised, 3–8 MB with aggressive optimisation (`opt-level = "z"`, LTO, symbol stripping, `panic = "abort"`).

### Platform Support

| Platform | Minimum Version | Distribution Formats |
|----------|----------------|---------------------|
| macOS | 10.15 Catalina | `.dmg`, `.app` bundle |
| Windows | Windows 10 (recommended) | `.msi` (WiX), `-setup.exe` (NSIS) |
| Linux | Varies by distro | `.deb`, `.rpm`, `AppImage` |

### System Requirements Per Platform

**Windows — WebView2 Availability:**

| Windows Version | WebView2 Pre-installed? |
|----------------|------------------------|
| Windows 11 (all) | ✅ Yes — built-in |
| Windows 10 + Microsoft 365 Apps v2101+ | ✅ Yes — auto-installed |
| Windows 10 without M365 | ❌ No — must be installed |
| Windows 7/8 | ❌ No — limited support |

Tauri provides 5 strategies for handling missing WebView2:

| Strategy | Added Size | Internet Required | Recommendation |
|----------|-----------|-------------------|----------------|
| `downloadBootstrapper` (default) | 0 MB | Yes | Not for SAR |
| `embedBootstrapper` | ~1.8 MB | Yes | Not for SAR |
| **`offlineInstaller`** | **~127 MB** | **No** | **✅ Use this** |
| `fixedVersion` | ~180 MB | No | Overkill |
| `skip` | 0 | N/A | Dangerous |

**Recommendation for SAR Tracker:** Use `offlineInstaller`. Mountain rescue teams deploy on laptops that may lack reliable internet. The +127 MB size penalty is acceptable for guaranteed offline installation. This brings the Windows installer to ~140–150 MB total.

**macOS:** WKWebView is a core OS component on all supported macOS versions (10.15+). Nothing additional needed.

**Linux:** WebKitGTK must be installed via package manager for `.deb`/`.rpm` builds. AppImage bundles all dependencies (~+50–100 MB) and is distro-agnostic — recommended for SAR Tracker.

---

## 2. Auto-Updater

### How tauri-plugin-updater Works

The updater is fully app-controlled — **nothing happens automatically**:

```
App calls check() → HTTP GET to endpoint → Returns update metadata or 204
   ↓ (if update available)
App calls download() → Streams installer with progress events
   ↓
App calls install() → Applies update
   ↓
App calls relaunch() → Restarts with new version
```

Each step is a separate API call. The app has full control over timing.

### GitHub Releases Integration

Point the updater at:
```
https://github.com/YOUR_ORG/sartracker/releases/latest/download/latest.json
```

The `tauri-apps/tauri-action` GitHub Action generates and uploads `latest.json` automatically when configured with `includeUpdaterJson: true`.

**Known issue (Feb 2026):** Parallel matrix builds race on `latest.json` upload. Workaround: set `retryAttempts: 3`.

### Can Updates Be Deferred/Skipped? — YES ✅

**This is the most important finding for SAR Tracker.** The updater has no forced-update mechanism. The app fully controls when to check, download, and install.

Implementing "skip if mission active":

```typescript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

async function checkForUpdates(isMissionActive: boolean) {
  // Don't even check during an active mission
  if (isMissionActive) {
    console.log('Mission active — update check skipped');
    return;
  }

  const update = await check();
  if (!update) return;

  // Prompt the user — never auto-install without consent
  const userConsents = await promptUser(update.version, update.body);
  if (!userConsents) return;

  await update.downloadAndInstall();
  await relaunch();
}
```

**Recommended SAR Tracker update strategy:**
1. Never check at app startup if `missionActive === true`
2. Check when mission transitions to `false` or user opens Settings
3. Show a dismissible banner: "Update available (v1.2.3) — install when ready"
4. Install + relaunch only on explicit user confirmation
5. Cache the "update available" state after `check()` so the UI shows a badge without re-checking

### Rollback Mechanism

**There is no built-in rollback.** This is a notable gap. Practical approach:

1. **Keep all GitHub Release assets** — never delete older releases
2. **Emergency rollback:** Update `latest.json` to point at previous release assets
3. **Allow downgrades** with a custom `version_comparator` in Rust:

```rust
.version_comparator(|current, update| {
  update.version != current  // allows downgrade
})
```

4. **Maintain a rollback runbook** documenting how to swap `latest.json` for field emergencies

### Update Signing

**Signing is mandatory and cannot be disabled.** Uses Ed25519 via minisign.

```bash
# Generate key pair (one-time)
npm run tauri signer generate -- -w ~/.tauri/sartracker.key
# Produces: sartracker.key (PRIVATE — never share) + sartracker.key.pub (goes in config)
```

**⚠️ CRITICAL:** If the private key is lost, users with the app installed CANNOT receive future updates. They must reinstall manually. Store the key in a secure vault (1Password, GitHub Secrets).

### Example `tauri.conf.json` — Updater Config

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk...",
      "endpoints": [
        "https://github.com/YOUR_ORG/sartracker/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

### Example `latest.json` (GitHub Release)

```json
{
  "version": "1.2.3",
  "notes": "Bug fix: GPS track rendering on older devices",
  "pub_date": "2026-04-06T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<content of .sig file>",
      "url": "https://github.com/YOUR_ORG/sartracker/releases/download/v1.2.3/sartracker_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<content of .sig file>",
      "url": "https://github.com/YOUR_ORG/sartracker/releases/download/v1.2.3/sartracker_x64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "<content of .sig file>",
      "url": "https://github.com/YOUR_ORG/sartracker/releases/download/v1.2.3/sartracker_amd64.AppImage"
    },
    "windows-x86_64": {
      "signature": "<content of .sig file>",
      "url": "https://github.com/YOUR_ORG/sartracker/releases/download/v1.2.3/sartracker_x64_en-US.msi.zip"
    }
  }
}
```

**Required fields per platform:** `url` and `signature`. Required top-level: `version`. Optional: `notes`, `pub_date`.

---

## 3. Code Signing — Full Cost/Effort Analysis

### macOS

#### Apple Developer Program — $99/year

| Item | Detail |
|------|--------|
| Cost | $99 USD/year (~€95) |
| Enrollment options | Individual or Organization (both $99/yr) |
| Individual approval | 1–2 business days |
| Organization | Requires D-U-N-S number (free, but 2 weeks to obtain) |
| Fee waiver | Available for nonprofits — KMRT may qualify if registered charity |
| What you get | Developer ID certificates, notarization access, Xcode Cloud |

#### Notarization Process

Notarization is Apple's automated malware scan — **not human review**:

1. `tauri build` produces `.app` bundle and `.dmg`
2. Submit to Apple's notary service via `notarytool`
3. Apple scans (typically **under 5 minutes**)
4. If approved, "staple" the ticket to the `.dmg` for offline verification
5. Distribute the stapled `.dmg`

**Tauri 2 automates this entire flow** via CI/CD environment variables (Apple ID + app-specific password or API key).

#### Hardened Runtime

Mandatory for notarization. Required entitlements for Tauri:
- `com.apple.security.cs.allow-jit` (WebKit JS engine)
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.network.client`

Tauri 2 generates these automatically — no manual config needed.

#### Without Signing — What Users See

**macOS Sequoia (15.x) — BREAKING CHANGE (Sep 2024):**

Apple removed the right-click → Open bypass. The new flow:

1. User double-clicks app → error: *"[App] cannot be opened because it is from an unidentified developer"*
2. **No bypass option visible in the dialog**
3. User must open **System Settings → Privacy & Security**
4. Scroll to find: *"[App] was blocked from use because it is not from an identified developer"*
5. Click **"Open Anyway"**
6. Enter admin password (or Touch ID)
7. Final confirmation dialog — click **"Open"** again

**This is a 7-step process requiring admin privileges and knowledge of System Settings.** It was deliberately designed to be difficult.

**Verdict: Non-technical mountain rescue volunteers CANNOT install an unsigned macOS app without direct IT support.** For a life-safety application, this is unacceptable. **macOS signing is non-negotiable.**

### Windows

#### Certificate Options

| Type | Cost/year | SmartScreen Bypass? | Hardware Token? | Notes |
|------|-----------|--------------------|--------------------|-------|
| **Azure Trusted Signing** | **$120/yr** ($9.99/mo) | Builds faster | No (cloud) | **✅ Recommended** |
| OV (SSL.com) | $65–$300 | Must build reputation | Yes (mandatory) | Budget option |
| EV | $249–$500 | ~~Yes~~ **No (since Mar 2024)** | Yes | No longer worth the premium |
| Unsigned | $0 | Never | N/A | Severe warnings |

**Critical change (March 2024):** Microsoft removed the automatic SmartScreen bypass for EV certificates. All certificate types now build reputation organically. EV certificates no longer justify their premium price for SmartScreen purposes.

#### Azure Trusted Signing — Recommended for SAR Tracker

- $9.99/month (Basic tier, 5,000 signatures/month)
- **EU organizations qualify** — Ireland is in scope
- Requires organization with 3+ years verifiable tax history
- No hardware token — fully cloud-based
- Clean GitHub Actions integration
- Identity validation: 1–7 business days
- Some reports suggest faster SmartScreen reputation build vs traditional certs

#### SmartScreen Reputation — The Uncomfortable Truth

SmartScreen reputation is per-file-hash. Each new release starts from zero. Microsoft says "weeks to months" to build trust. For ~30 users, **reputation may never build enough to suppress warnings entirely**. Every new release will likely trigger warnings for early installers.

**Practical mitigation:** Include a brief installation guide with screenshots showing "click More info → Run anyway."

#### Unsigned Windows App — What Users See

1. Edge/Chrome may warn during download: *"not commonly downloaded"* — many users click "Discard" here
2. Running the installer shows **"Windows protected your PC"** dialog
3. Only visible button: **"Don't run"**
4. Small "More info" text link (not a button) — easy to miss
5. Clicking "More info" reveals the **"Run anyway"** button
6. Publisher shows "Unknown Publisher"

**With a signed cert:** Same warning dialog initially, but publisher name is shown (adds legitimacy). Warnings clear faster.

#### WebView2 on Windows

Modern Windows 10/11 (post-late 2020) include WebView2. For older machines:

**Use `offlineInstaller` mode for SAR Tracker** (+~127 MB). Mountain rescue laptops may lack internet at install time. This guarantees WebView2 is available regardless of connectivity.

### Linux

**No signing required.** Linux has no Gatekeeper or SmartScreen equivalent.

- AppImage: Download → `chmod +x` → run. No warnings, no blocks.
- Optional GPG signing available for integrity verification but imposes no install friction.
- `.deb`/`.rpm`: Unsigned packages install without blocking via `dpkg -i` / `rpm -i`.

### Cost Summary

| Platform | Required? | Annual Cost | Setup Effort |
|----------|-----------|------------|--------------|
| macOS (Apple Developer Program) | **YES** | $99/yr (~€95) | 1–2 days approval |
| Windows (Azure Trusted Signing) | Strongly recommended | $120/yr (~€110) | 1–7 days validation |
| Linux | No | $0 | None |
| **Total** | | **~$220/yr (~€205)** | |

---

## 4. Installation UX Assessment

### macOS — Signed & Notarized

| Step | User Action |
|------|-------------|
| 1 | Download `SARTracker-1.0.0.dmg` from GitHub Releases |
| 2 | Double-click `.dmg` — disk image mounts |
| 3 | Drag `SAR Tracker.app` to Applications folder |
| 4 | Double-click to launch |
| 5 | First launch: "Are you sure you want to open this?" → click Open |

**Warnings:** Single first-launch confirmation (standard for all notarized apps). No Gatekeeper block.

**Friction rating: 🟢 LOW**

### macOS — Unsigned

| Step | User Action |
|------|-------------|
| 1 | Download `.dmg`, open, drag to Applications |
| 2 | Double-click → blocked: *"cannot be opened because it is from an unidentified developer"* |
| 3 | Open System Settings → Privacy & Security |
| 4 | Find the blocked app entry, click "Open Anyway" |
| 5 | Enter admin password |
| 6 | Click "Open" in final confirmation |

**Warnings:** Multi-step process through System Settings requiring admin password.

**Friction rating: 🔴 HIGH — Unacceptable for non-technical volunteers**

### Windows — Signed (Azure Trusted Signing)

| Step | User Action |
|------|-------------|
| 1 | Download `SARTracker-1.0.0-setup.exe` from GitHub Releases |
| 2 | Run installer |
| 3 | SmartScreen may warn (until reputation builds): click "More info" → "Run anyway" |
| 4 | Installer runs (WebView2 installs silently if missing with `offlineInstaller` mode) |
| 5 | App installed, desktop shortcut created |

**Warnings:** SmartScreen warning on first installs of new releases until reputation builds. Publisher name shown (adds legitimacy).

**Friction rating: 🟡 MEDIUM** (with installation guide: LOW-MEDIUM)

### Windows — Unsigned

| Step | User Action |
|------|-------------|
| 1 | Download installer — browser may warn "not commonly downloaded" |
| 2 | Run installer → **"Windows protected your PC"** — only "Don't run" button visible |
| 3 | Must find hidden "More info" link, then click "Run anyway" |
| 4 | Publisher shows "Unknown Publisher" |

**Friction rating: 🔴 HIGH — Most non-technical users will abandon at step 2**

### Linux — AppImage

| Step | User Action |
|------|-------------|
| 1 | Download `SARTracker-1.0.0.AppImage` |
| 2 | Right-click → Properties → Allow executing as program (or `chmod +x`) |
| 3 | Double-click to run |

**Warnings:** Some desktop environments show "Do you want to run this file?" — informational only.

**Friction rating: 🟢 LOW** (for Linux users; Linux users are inherently more technical)

### Summary Table

| Platform | Signed | Unsigned |
|----------|--------|----------|
| macOS | 🟢 LOW | 🔴 HIGH (blocked) |
| Windows | 🟡 MEDIUM | 🔴 HIGH |
| Linux | 🟢 LOW | 🟢 LOW |

---

## 5. Tauri Capabilities & Permissions

### How the System Works

Tauri 2 replaced Tauri 1's flat `allowlist` with a three-tier model:

1. **Permissions** — granular per-command access controls with path/URL scopes
2. **Capabilities** — bundles of permissions assigned to specific windows
3. **Scopes** — fine-grained path/URL constraints within permissions

**Everything is blocked by default.** You opt in explicitly per window, per command, per path/URL.

### SAR Tracker Required Permissions

| Plugin | Permissions | Purpose |
|--------|-------------|---------|
| `tauri-plugin-sql` | `sql:default` + `sql:allow-execute` | SQLite DB for missions, devices, markers |
| `tauri-plugin-fs` | `fs:default` + recursive app read/write | Offline tiles (PMTiles), mission export files |
| `tauri-plugin-http` | `http:default` + URL allowlist | Traccar API, map tile fetching |
| `tauri-plugin-websocket` | `websocket:default` | Traccar real-time GPS |
| `tauri-plugin-updater` | `updater:default` | Auto-update |
| `tauri-plugin-dialog` | `dialog:default` | File save/open for mission exports |
| `tauri-plugin-process` | (for `relaunch()`) | Restart after update |
| Core | `core:window:default`, `core:tray:default` | Window management, system tray |

**⚠️ Gotcha:** `sql:default` does NOT include write operations. You MUST add `sql:allow-execute` separately for INSERT/UPDATE/DELETE.

**⚠️ Gotcha:** `http:default` allows the fetch commands but allows NO URLs. You MUST add explicit URL patterns in the scope.

**⚠️ Note:** `websocket:default` has no URL scoping — any WS URL can be connected to. Acceptable for a trusted desktop app.

### Example Capabilities Config

`src-tauri/capabilities/main-capability.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main window capability for SAR Tracker desktop app",
  "windows": ["main"],
  "platforms": ["linux", "macOS", "windows"],
  "permissions": [
    "core:path:default",
    "core:event:default",
    "core:window:default",
    "core:app:default",
    "core:resources:default",
    "core:menu:default",
    "core:tray:default",

    "sql:default",
    "sql:allow-execute",

    "fs:default",
    "fs:allow-app-read-recursive",
    "fs:allow-app-write-recursive",
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$APPDATA/**/*" },
        { "path": "$APPLOCALDATA/**/*" }
      ]
    },

    {
      "identifier": "http:default",
      "allow": [
        { "url": "http://kmrtsar.ddns.net:5055/**" },
        { "url": "https://*.tile.openstreetmap.org/**" },
        { "url": "https://*.tile.opentopomap.org/**" },
        { "url": "https://api.maptiler.com/**" },
        { "url": "https://*.basemaps.cartocdn.com/**" }
      ]
    },

    "websocket:default",
    "dialog:default",
    "updater:default"
  ]
}
```

### Additional Plugins Worth Considering

| Plugin | Purpose | Priority |
|--------|---------|----------|
| `tauri-plugin-single-instance` | Prevent multiple app instances (operators double-clicking) | HIGH |
| `tauri-plugin-store` | Key-value store for app settings/preferences | MEDIUM |
| `tauri-plugin-notification` | Desktop notifications for GPS alerts | MEDIUM |
| `tauri-plugin-autostart` | Start on login for persistent ops | LOW |
| `tauri-plugin-global-shortcut` | Keyboard shortcuts when minimized | LOW |

### Rust Dependencies (`src-tauri/Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-fs = { version = "2" }
tauri-plugin-http = { version = "2" }
tauri-plugin-websocket = { version = "2" }
tauri-plugin-updater = { version = "2" }
tauri-plugin-dialog = { version = "2" }
tauri-plugin-process = { version = "2" }
```

---

## 6. Recommendation

### Should We Sign for v1?

**macOS: YES — non-negotiable.** macOS Sequoia removed the right-click bypass. Unsigned apps require a 7-step process through System Settings with admin password. Non-technical mountain rescue volunteers will not be able to install an unsigned app without direct support. For a life-safety application, this is unacceptable.

**Windows: YES — strongly recommended.** While users *can* bypass SmartScreen (click "More info" → "Run anyway"), the warning is alarming and the bypass is hidden. For non-technical volunteers, signing with a brief installation guide is far better than relying on them to navigate security warnings.

**Linux: NO — not needed.** No install friction without signing.

**Cost:** ~$220/year ($99 Apple + $120 Azure Trusted Signing). For a life-safety application serving ~30 volunteers, this is a justified expense.

**Note on fee waiver:** Apple offers Developer Program fee waivers for nonprofits. If KMRT is registered as a charity/nonprofit in Ireland, this could reduce the macOS cost to $0/year. Worth investigating.

### Minimum Viable Distribution Strategy

For v1 with minimal investment:

1. **macOS:** Apple Developer Program ($99/yr), sign + notarize, distribute `.dmg` via GitHub Releases
2. **Windows:** Skip signing initially. Provide a **screenshot installation guide** showing "More info → Run anyway". Use `offlineInstaller` for WebView2. Accept the friction — it's a one-time event per user per version.
3. **Linux:** AppImage, no signing
4. **Auto-updater:** GitHub Releases + `tauri-plugin-updater` + mission-active guard
5. **Update signing:** Generate Ed25519 key pair, store private key in GitHub Secrets

**Estimated annual cost: $99/year** (macOS only)

### Ideal Distribution Strategy

For the smoothest possible experience:

1. **macOS:** Apple Developer Program + notarization (same as above)
2. **Windows:** Azure Trusted Signing ($9.99/mo) + `offlineInstaller` WebView2 mode + installation guide for SmartScreen (still needed for first installs of new releases)
3. **Linux:** AppImage + optional GPG signing
4. **Auto-updater:** Same as minimum viable + rollback runbook documenting how to swap `latest.json`
5. **CI/CD:** `tauri-apps/tauri-action` on GitHub Actions building for all 3 platforms + auto-upload to GitHub Releases
6. **Distribution guide:** One-page PDF/screenshot guide for each platform, distributed with the download

**Estimated annual cost: ~$220/year**

### Blockers

| Blocker | Severity | Resolution |
|---------|----------|------------|
| Apple Developer Program enrollment | **BLOCKING** | Enroll before first macOS build. 1–2 days for individual, up to 2 weeks if org needs D-U-N-S number. |
| Update signing key management | **BLOCKING** | Generate key pair before first build. Store in 1Password/GitHub Secrets. Losing this key = users can't receive updates. |
| Azure Trusted Signing eligibility | LOW | Requires org with 3+ years tax history. If KMRT doesn't qualify, fall back to SSL.com OV cert (~$65–$130/yr) or defer Windows signing. |
| WebView2 offline installer adds ~127 MB | LOW | Acceptable tradeoff for guaranteed offline installation. |
| SmartScreen warnings for small user base | LOW | Likely never fully suppressed for ~30 users. Mitigated with installation guide. |
| No built-in rollback in Tauri updater | LOW | Mitigated with rollback runbook + kept release assets + `version_comparator` override. |

### Key Takeaways

1. **Tauri 2 is an excellent fit** for SAR Tracker — ~15 MB installer vs ~200 MB Electron, full native OS integration, auto-updates with mission-active guard.

2. **The update system is safe by design** — no forced updates, full app control over check/download/install/relaunch lifecycle. The "skip during active rescue" requirement is trivially implementable.

3. **macOS signing ($99/yr) is the hard requirement.** Everything else can be deferred if budget is tight.

4. **Windows SmartScreen is an ongoing nuisance, not a blocker.** Even with signing, new releases will warn ~30 users initially. An installation guide bridges this gap.

5. **Total cost is modest** — ~$220/yr for full signing on both platforms. For a life-safety application used by volunteer mountain rescue, this is easily justified.

---

## Appendix A: GitHub Actions Workflow (Reference)

A typical `tauri-apps/tauri-action` CI workflow would build for all platforms, sign, and upload to GitHub Releases:

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: --target aarch64-apple-darwin
          - platform: macos-latest
            args: --target x86_64-apple-darwin
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          # macOS signing
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          tagName: v__VERSION__
          releaseName: 'SAR Tracker v__VERSION__'
          releaseBody: 'See the release notes for details.'
          releaseDraft: true
          prerelease: false
          includeUpdaterJson: true
          retryAttempts: 3
          args: ${{ matrix.args }}
```

## Appendix B: SAR Tracker Update Flow (Recommended)

```
App Launch
    │
    ├─ Is mission active? ──YES──→ Skip update check. Show nothing.
    │
    NO
    │
    ├─ check() → HTTP GET latest.json
    │
    ├─ Update available? ──NO──→ Done.
    │
    YES
    │
    ├─ Show dismissible banner: "v1.2.3 available — install when ready"
    │
    ├─ User clicks "Install" ──→ downloadAndInstall() ──→ relaunch()
    │
    └─ User dismisses ──→ Cache update state, show badge on Settings icon
```

If mission becomes active after update is cached but before install: **do not install**. Wait for mission to end.

## Update: Signing Decision (2026-04-06)

**Team uses Windows + Linux only. Donal (developer) is on Mac.**

**Decision: NO CODE SIGNING for v1.**
- Windows: SmartScreen "Run Anyway" with a simple install guide for the team
- Linux: AppImage, no signing needed
- macOS: Developer only, knows how to bypass Gatekeeper
- Saves $220/yr
- Auto-updater works fine unsigned
- Revisit if the app ever needs wider distribution beyond KMRT
