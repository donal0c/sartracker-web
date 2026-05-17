# Tauri Beta Release Plan

> Supporting Phase 1 beta detail. The active queue and next-task order live in `docs/two-track-execution-workplan.md`; update that workplan before treating new beta work as planned.

## Purpose

The hosted browser build is the fast feedback lane. The Tauri beta lane is where we validate the operational runtime: durable mission records, filesystem-backed workflows, local map packages, recovery, diagnostics, and install/update friction.

The first beta does not need to be polished or auto-updating. It needs to be repeatable, identifiable, and honest about limitations.

## Phase 1 Goal

Produce a repeatable desktop beta process that lets the team test the installed app without bespoke developer intervention each time.

## Release Channel Stance

- Initial beta artifacts are distributed through GitHub Releases on
  `donal0c/sartracker-web` as draft prereleases with the title containing
  "internal beta".
- Cross-platform Linux + Windows + macOS arm64 artifacts are produced by the
  CI release workflow at `.github/workflows/release.yml`. See B4 below.
- Code signing, notarization, Windows SmartScreen reputation, and auto-update
  are important, but they do not need to block the internal beta lane unless
  the team machines reject unsigned builds.
- Every beta must include a visible build/version and a short release note in
  `docs/releases/`.
- Vercel remains the place for rapid UI iteration between beta packages.

## Work Chunks

### B1: Packaging Recon

Status: done 2026-05-16.

Questions to answer:

- What exact command builds the packaged app on this machine?
- Which package formats are produced?
- Where are artifacts written?
- Does the current build require signing credentials?
- What warnings appear on macOS/Windows?
- Which target OS does the team need first?

Expected commands to investigate:

```bash
npm run tauri build
npm run build
npm run test:backend
```

Do not assume these are sufficient until run and recorded.

Deliverable:

- Update this file with the actual command, artifact path, package format, warnings, and blockers.

Result from the current macOS development machine:

| Item | Result |
| --- | --- |
| Machine/runtime | macOS arm64 development machine; Node `v22.17.1`; npm `10.9.2`; Rust `1.94.1`; Cargo `1.94.1`; Tauri CLI `2.10.1` |
| Configured command | `npm run tauri build` |
| Reliable first-beta command on this machine | `npm run tauri build -- --bundles app` |
| App artifact | `src-tauri/target/release/bundle/macos/sartracker-web.app` |
| Release binary | `src-tauri/target/release/sartracker-web` |
| App size | about 25 MB |
| Zip command for sharing | `ditto -c -k --keepParent src-tauri/target/release/bundle/macos/sartracker-web.app tmp/beta-artifacts/sartracker-web_0.1.0_aarch64.app.zip` |
| Zip artifact from recon run | `tmp/beta-artifacts/sartracker-web_0.1.0_aarch64.app.zip` at about 15 MB |
| macOS install path | unzip, then drag/copy `sartracker-web.app` to `/Applications`; for local smoke testing it can also be opened from the extracted folder |
| Windows artifact | not produced from this macOS run; needs a Windows build host or explicit cross-build plan |
| Windows install path assumption | unknown until Windows packaging is run; expect installer-managed install location rather than promising one in beta notes |

Important findings:

- `npm run tauri build -- --bundles app` completed successfully and produced a macOS arm64 `.app` bundle.
- `npm run tauri build` compiled the release binary and produced the `.app`, but failed during DMG bundling at the generated `bundle_dmg.sh` step. Tauri reported:
  `failed to bundle project error running bundle_dmg.sh`.
- The failed DMG run left a temporary writable image at
  `src-tauri/target/release/bundle/macos/rw.64181.sartracker-web_0.1.0_aarch64.dmg`.
  Treat that file as a failed intermediate, not a shareable installer.
- Current signing is ad-hoc/linker-signed only. `spctl -a -vvv -t open src-tauri/target/release/bundle/macos/sartracker-web.app`
  rejected the app with `source=Insufficient Context`. This is expected for an unsigned internal beta and should be called out in any sharing instructions.
- `codesign -dv --verbose=4` reports `Signature=adhoc`, `TeamIdentifier=not set`,
  `Info.plist=not bound`, and `Sealed Resources=none`.
- No Developer ID signing, notarization, or stapling was configured or attempted.

Recommendation for the first internal beta:

- Use the macOS arm64 `.app` bundle zipped with the `ditto` command above if the first testers are on Apple Silicon Macs and can accept unsigned beta warnings.
- Do not treat DMG packaging as ready. Create a follow-up blocker if a DMG is required before the first internal beta.
- Do not promise Windows install behavior until B1-equivalent packaging has been run on a Windows machine or CI runner.

### Internal macOS Gatekeeper Guidance

Status: internal beta guidance only. This is not a substitute for Developer ID signing,
notarization, stapling, a polished installer, or a production release process.

The current macOS beta artifact is an ad-hoc signed Apple Silicon `.app` bundle. On the
current development machine, `spctl` rejects it with `source=Insufficient Context`, and
`codesign -dv --verbose=4` reports `Signature=adhoc`, `TeamIdentifier=not set`,
`Info.plist=not bound`, and `Sealed Resources=none`. Treat this as expected for the
first internal beta, not as an operator-ready distribution state.

Beta release notes must tell testers to expect one of these macOS outcomes:

- macOS may refuse to open the app and say Apple cannot verify it, the developer cannot
  be verified, or the app may be damaged or untrusted.
- A right-click / Control-click followed by **Open** may allow the app to launch, depending
  on local security policy.
- If the app was downloaded from a browser or shared drive, quarantine may need to be
  removed manually before launch.

Only share the quarantine-removal command with testers who understand that they are
opening a trusted internal beta artifact from this project:

```bash
xattr -dr com.apple.quarantine /Applications/sartracker-web.app
```

If the app is opened from the extracted folder rather than `/Applications`, replace the
path with the actual extracted `.app` path, for example:

```bash
xattr -dr com.apple.quarantine ~/Downloads/sartracker-web.app
```

The beta note must also include these cautions:

- Run this command only for a SAR Tracker beta artifact supplied through the agreed
  internal channel.
- Do not use the internal beta for live incidents until the specific beta has passed the
  desktop smoke checklist.
- If a team Mac blocks unsigned apps by policy, stop and record that as a beta blocker
  rather than asking non-technical volunteers to bypass managed security settings.

### B2: Release Note Template

Status: done 2026-05-17 (`sartracker-web-xhz`). The canonical release-note
template, repeatable verification gate, and release-channel decision are now
checked into the repo.

Where the deliverables live:

- `docs/releases/TEMPLATE.md` — canonical release-note template. Copy, do
  not edit in place.
- `docs/releases/README.md` — authoring workflow, distribution channel, and
  storage rules.
- `docs/releases/sartracker-web-0.1.0-beta-DRAFT.md` — first dry-run release
  note, kept in the repo as the worked example future agents copy from.
- `scripts/beta-verify.mjs` and `build/beta-verify-lib.js` — the
  `npm run beta:verify` gate that runs lint, build, test, test:backend,
  package (`npm run tauri build -- --bundles app`), and the manual smoke
  checklist, then writes a JSON evidence report to `tmp/beta-artifacts/`.
- `tests/unit/beta-verify-lib.test.ts` — unit coverage for the gate's pure
  helpers (step parsing, formatting, summary, report filename).

Distribution decision (locked by B2):

- Primary channel for the first internal betas: GitHub Releases on
  `donal0c/sartracker-web`, marked as **draft** and **prerelease**, with
  access limited to the team via the "internal beta" tag in the title.
- Release notes in `docs/releases/` are the single source of truth.
- macOS arm64 `.app` zips are the only currently proven artifact; do not
  upload other platforms until packaging is proven on a real build host.
- Build artifacts must not be committed. Local working copies stay under
  `tmp/beta-artifacts/` (gitignored). Verification JSON reports stay in the
  same folder and are referenced from the release note by relative path.

Verification gate contract:

- `npm run beta:verify` runs the full chain in canonical order. The first
  failing step short-circuits the rest, every step result is captured in
  the JSON report, and the script exits non-zero on any failure.
- A gate that ends with `OVERALL: PASS` but a `WARNING: ... skipped` line
  is not shareable. The release note checklist must mirror the JSON report.
- Subset runs are supported with `--steps` for iteration only; the real
  beta cut runs without `--steps` filters.

### B3: First Internal Smoke Build

Status: ready. B2 (`sartracker-web-xhz`) provides the release-note template
and the `npm run beta:verify` gate. The smoke pass should run that gate end
to end (no `--steps` filters), copy `docs/releases/TEMPLATE.md` to a new
`sartracker-web-<version>-beta-DRAFT.md`, and only drop the `-DRAFT` suffix
once the artifact is uploaded and the smoke checklist is signed off.

Smoke path:

1. Install/open the packaged app.
2. Confirm build/version is visible in the mast.
3. Start a mission.
4. Pause/resume/finish the mission.
5. Restart the app and confirm recovery/persistence behavior.
6. Configure Traccar if credentials are available and confirm connection.
7. Open Diagnostics and confirm export/open behavior.

Deliverable:

- Record result in `handoff/HANDOFF.md`.
- If smoke passes, create a shareable beta release note.
- If smoke fails, create a bead for the blocker.

## Beta Release Gate

Before sharing a desktop beta outside the dev machine:

- The app must build cleanly.
- The packaged app must open.
- Mission start must work.
- Persistence/restart behavior must be checked.
- Known limitations must be written down.
- The artifact must have a visible version/build ID.

## Not In Phase 1

- Auto-update.
- Polished installer UX.
- Full signing/notarization unless required to run.
- High-definition map integration.
- Browser IndexedDB hardening.
- Stable operational release.

## B4: Cross-Platform Beta Distribution

Status: implemented 2026-05-17 (`sartracker-web-y6a`).

Delivered:

- `.github/workflows/release.yml` — tag-driven release workflow (`v*` tags +
  `workflow_dispatch` escape hatch). Splits into a `gates` job (Linux,
  lint/test/build/version-trio assertion/release-notes existence check), a
  `bundle` matrix (`ubuntu-22.04` + `windows-2022`) using
  `tauri-apps/tauri-action@v0.6.2`, a `checksums` job that generates a
  `SHA256SUMS` sidecar from the uploaded assets, and a `summary` job.
- Linux artifacts: AppImage + `.deb`, x86_64.
- Windows artifacts: NSIS `.exe` (current-user, no admin) + MSI, x86_64.
- macOS arm64 was dropped from the CI matrix to keep GitHub Actions billed
  minutes inside the free tier (macOS bills at 10x the rate of Linux).
  Re-adding macOS to CI is tracked by `sartracker-web-590` and gated on a
  stable monthly-cadence release rhythm. Until then macOS is built locally
  via Path B (`npm run beta:verify`) and uploaded manually if needed.
- `tauri.conf.json` Windows section configured for unsigned-tester ergonomics:
  NSIS `installMode: currentUser`, WebView2 `downloadBootstrapper` with
  `silent: true`, LZMA compression.
- `docs/releases/TEMPLATE.md` rewritten with per-OS install sections covering
  AppImage, .deb, NSIS-with-SmartScreen, MSI, and macOS Gatekeeper paths.
- `docs/releases/README.md` documents Path A (CI-driven cross-platform) and
  Path B (local macOS-only smoke).
- Operator manual (`public/manual/index.html`) Desktop Beta Install Notes
  rewritten to cover Linux primary / Windows secondary / macOS parity.

Decisions locked:

- **Linux primary, Windows secondary.** Most operators are on Linux. macOS
  arm64 deferred from CI per `sartracker-web-590`.
- **Build Linux on `ubuntu-22.04`** (not `ubuntu-latest`, not `ubuntu-24.04`).
  glibc forward-compatibility means a 22.04 build runs on 22.04+, 24.04, Debian
  12+, Fedora 38+, Mint 21+, Pop_OS 22.04+. Building on 24.04 cuts off 22.04
  users with `GLIBC_2.39 not found`.
- **Build Windows on `windows-2022`** (not `windows-latest`, which has moved to
  `windows-2025`).
- **NSIS `currentUser` install mode** for Windows beta — no admin required, no
  UAC prompt. MSI is the secondary artifact for IT-managed deployments.
- **WebView2 `downloadBootstrapper`** — bundle stays at 0 MB overhead; the
  ~2 MB Microsoft-signed bootstrapper only fires on the small minority of
  Windows machines that lack WebView2.
- **x86_64 only for v1.** Linux ARM and Windows ARM are deliberately out of
  scope. Add only when an operator asks.
- **No code signing** in this beta lane. Release notes give testers the exact
  SmartScreen / Gatekeeper runbook.
- **Tag is the single source of truth** for version. CI asserts that the tag
  (without `v`), `package.json#version`, and `tauri.conf.json#version` all
  agree before any bundle runs.
- **Release notes sourced from `docs/releases/sartracker-web-<version>-beta.md`.**
  CI fails loudly if the file is missing. The release body is the file
  contents plus a CI Provenance footer (commit SHA + run URL).
- **Draft + prerelease.** No release is published automatically. Maintainer
  reviews and runs `gh release edit <tag> --draft=false` after smoke.
- **`fail-fast: false`** on the bundle matrix so Linux artifacts survive a
  Windows/macOS failure. Half-published is acceptable in DRAFT state because
  no end-user sees it.
- **`SHA256SUMS` sidecar** generated by a follow-up job after all bundle
  uploads settle. Testers verify with `sha256sum -c` (Linux) /
  `Get-FileHash` (Windows) / `shasum -a 256 -c` (macOS).

Cut a beta:

```bash
# Bump version in both places (must match exactly)
# - package.json#version
# - src-tauri/tauri.conf.json#version
# Copy docs/releases/TEMPLATE.md to docs/releases/sartracker-web-<version>-beta.md and fill it in.
git commit -am "chore(release): cut v0.1.0-beta.1"
git tag v0.1.0-beta.1
git push origin master
git push origin v0.1.0-beta.1
# Watch the workflow at https://github.com/donal0c/sartracker-web/actions
# When green, smoke-test the primary platform locally, then:
gh release edit v0.1.0-beta.1 --repo donal0c/sartracker-web --draft=false
```

## Preconditions for Wider / Signed Distribution

These must be cleared before promoting beyond the internal team or moving to a
signed distribution lane:

1. **Auto-updater work is gated on `sartracker-web-qmr` follow-up.** That bead
   removed the macOS ATS blanket exception by routing renderer Traccar fetch
   through Rust `reqwest`. The same posture applies to other plain-HTTP
   exceptions and signing-key handling — no auto-updater until those are
   tightened.
2. **macOS signing:** Apple Developer ID ($99/year) + notarization. Gated on
   maintainer time + budget decision, not technical readiness.
3. **Windows signing:** Azure Trusted Signing ($9.99/month, 2026 path,
   self-employed and small-org eligible since 2025). Gated on the legal entity
   verification process. EV/OV certs are the more expensive fallback. Filed as
   a separate decision-gated bead, not part of B4.
4. **`reqwest` CA root strategy:** current `Cargo.toml` uses `rustls-tls` with
   no native-roots feature. Self-hosted Traccar servers using internal CAs
   may fail with `UnknownIssuer` until we add `rustls-tls-native-roots` (or
   ship Mozilla's bundle via `webpki-roots`). This is fine for the current
   plain-HTTP test endpoint but must be resolved before any HTTPS Traccar
   deployment.
5. **Tauri updater signing keys:** `TAURI_SIGNING_PRIVATE_KEY` /
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` need to exist in CI secrets before the
   updater is wired up. Workflow currently sets `uploadUpdaterJson: false` so
   we do not publish a broken updater manifest.

## Open Questions

- How often can the team reasonably install beta updates? (Manual download
  cadence acceptable for now.)
- Who on the team will test desktop installation? (TBD via B5 feedback intake.)
