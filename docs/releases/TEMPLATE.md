# SAR Tracker Electron Desktop Beta &lt;version&gt; (&lt;build tag&gt;)

> **Internal controlled/shadow-use beta only.** Not a production or sole-source
> operational release. Passing this note's checks does not make the application
> operationally safe. The independent primary operational process remains
> authoritative under `docs/assurance/shadow-use-protocol.md`.

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
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

Private Discovery map packages are never release artifacts. Distribute those
through the agreed private team channel and load them through Settings after
installing the app.

## Shadow-use declaration

Complete this section before sharing the beta. A missing field blocks shadow
use; it does not block the team's independent primary operation.

- **Protocol:** [`docs/assurance/shadow-use-protocol.md`](../assurance/shadow-use-protocol.md)
- **Primary operational source/process:** &lt;exact existing source/process; never "QGIS and/or Traccar"&gt;
- **Primary-system operator role:** &lt;name or agreed role&gt;
- **Primary-only fallback drill:** &lt;date, measured switch time, maximum 60 seconds&gt;
- **Candidate identity:** &lt;version, tag, exact Git SHA, artifact filename and full SHA-256&gt;
- **Qualified platform/profile:** &lt;platform, architecture, OS/distro/kernel/session, package type, profile class, runtime flags&gt;
- **Residual-risk register:** &lt;version/path; every entry uses the protocol's exact eight-field format&gt;
- **WAR-13B scorecard declaration:** &lt;path or explicit not-started; no scorecard auto-promotes this release&gt;

SAR Tracker is advisory during shadow use. Stop triggers include unexplained
current-position uncertainty, evidence loss/corruption/mis-scoping, false
`Complete`/`100%`, non-interactivity, privacy concerns, and archive/restore
uncertainty. Ordinary UI/wording feedback needs only a short feedback record;
incident bundles and raw mission/profile evidence are not the default.

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
- Credentials use the app-owned local file under the Electron profile rather
  than a desktop keyring. Protect the operating-system account and never share
  profile files or raw credential evidence.

Windows and macOS artifacts are not produced or attached by this Linux release
lane. Each needs a separate CI build and complete packaged qualification before
it can appear in a future release.

## What Changed

- &lt;short, operator-readable bullet list of changes since the previous beta&gt;
- &lt;include Linear issue IDs in square brackets&gt;

## Regression provenance

Use exactly one classification. For a release that does not correct a known
regression, keep only the first two lines and write `Not applicable — no
regression correction in this release.` for the Linear issue.

- Classification: &lt;Regression correction | No known regression correction&gt;
- Linear issue: &lt;[DON-XXX](https://linear.app/.../issue/DON-XXX) | Not applicable — no regression correction in this release.&gt;
- Affected release(s): &lt;published/candidate versions and exact artifacts&gt;
- Last known good: &lt;version/artifact, or explicit unknown with reason&gt;
- First known bad: &lt;version/artifact&gt;
- Root cause: &lt;confirmed causal mechanism&gt;
- Escape analysis: &lt;why existing tests, CI, packaged smoke, or qualification missed it&gt;
- Before/after evidence: &lt;same-workload correctness and performance comparison&gt;
- Regression gate: &lt;new automated and packaged proof that fails on recurrence&gt;
- Remaining uncertainty: &lt;residual risk or field confirmation still required; use “None known after qualification” only when justified&gt;

## What To Test

- &lt;short list of operator workflows the tester should exercise&gt;
- &lt;mark any items as critical so testers know which signal to prioritise&gt;
- &lt;record successful comparisons as well as failures, bound to the exact
  candidate/session identity&gt;

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
  - Linux x86_64 only. Windows and macOS are not release assets in this lane.
  - Linux artifacts are unsigned.
  - Auto-updater is not enabled. Each beta is a fresh download.
  - High-definition mountain map packages are not bundled with this build.
  - Browser hosted-mode persistence is testing-only and not part of this
    desktop beta.
  - Shadow-use protocol controls testing but does not qualify the application
    for sole-source or unrestricted operational use.
  - Archive/restore/custody remains prohibited as a relied-on workflow unless
    this exact candidate has explicit breadcrumb programme PR-6 archive/restore
    qualification evidence.

## Verification (CI-driven)

This section must name the workflow or local build process that produced the
Electron artifacts. The current pipeline is
`.github/workflows/electron-release.yml`, triggered by an `electron-v*` tag.
(The old Tauri `release.yml` has been removed and must never be cited for
Electron artifacts.)

Minimum verification for an Electron official-map handoff:

- tag-driven `.github/workflows/electron-release.yml` run green
- local no-skip `npm run beta:verify`, including the legacy backend
  compatibility suite
- tag workflow gates: `npm run lint`, `npm run test`, `npm run build`,
  `npm run test:e2e:chromium`, Linux bundle/soak, and AppImage launch
- focused or full unit tests relevant to the slice
- Electron package build on the target OS
- official Discovery package import/readiness smoke where applicable
- diagnostics export checked for private-data leakage
- `SHA256SUMS` generated for shared artifacts

## Packaged Smoke Matrix

The draft release must not be published until the CI-built artifact has passed
every packaged smoke gate below. Only the unchanged private-map-package gate may
be marked `NOT APPLICABLE`, with a concrete reason; every other row must be
`PASS`. Gate names are an executable contract with the guarded publisher and
must not be renamed.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | TODO | exact filename, full digest, and evidence path |
| .deb SHA-256 | TODO | exact filename, full digest, and evidence path |
| AppImage launch | TODO | TODO |
| .deb install and launch | TODO | TODO |
| Core lifecycle, restart/recovery, finish/finalize/archive | TODO | TODO |
| Coordinate rejection | TODO | TODO |
| Diagnostics/support/incident exports sanitized | TODO | TODO |
| Bad/corrupt stored credential reaches shell | TODO | TODO |
| Live Traccar connection and breadcrumb reconciliation | TODO | TODO |
| Official offline Discovery package | TODO | PASS evidence or NOT APPLICABLE with reason |
| Duplicate launch | TODO | TODO |
| Five-day and fourteen-day packaged soak | TODO | TODO |
| Cross-profile exact breadcrumb identity comparison | TODO | TODO |

## Rollback / Reinstall

- **To roll back to a previous beta:**
  1. Quit the running app.
  2. Linux AppImage: delete the AppImage file. `.deb`:
     `sudo apt remove sartracker-electron-validation`.
  3. Reinstall the older beta from its release note.
- **Mission data:** Mission databases live under the app's per-user data
  directory and are not deleted by uninstalling the bundle. If mission data
  is suspected of corruption, capture diagnostics first and do not delete
  anything until the issue is recorded.

## Pre-Share Checklist

Before promoting this draft to a published release:

- [ ] Tag-driven CI workflow run is green and linked above
- [ ] Clean no-skip local `npm run beta:verify` passed, including backend
- [ ] CI release gates passed: lint, unit tests, web build, standard Chromium
      E2E, Linux bundle/soak, Linux launch smoke
- [ ] All expected CI release assets present on the draft release: Linux
      `.AppImage`, Linux `.deb`, and `SHA256SUMS` only.
- [ ] `SHA256SUMS` present and matches local computation against downloaded assets
- [ ] CI launch-smoke artifacts reviewed: Linux AppImage screenshot/log.
- [ ] Real-machine smoke pass on the primary platform (Linux): packaged app
      launches, OpenTopoMap tiles load on a normal network, mission can be
      started, mission persists after restart, tracking settings connect to the
      Traccar web/API base URL, diagnostics export works.
- [ ] Packaged smoke matrix above is complete, with evidence paths or run links
- [ ] Release body retains this note's content, has the exact CI Provenance
      footer, and replaces every matrix placeholder with exact-artifact evidence
- [ ] Regression provenance is explicit and complete; every regression release
      links the canonical Linear issue with root cause, escape analysis,
      before/after evidence, durable gate, and remaining uncertainty
- [ ] Release marked **prerelease** and **draft** in GitHub UI
- [ ] Release title contains "internal beta"
- [ ] Shadow-use declaration is complete; the independent primary process and
      named operator remain authoritative
- [ ] Primary-only fallback drill passed in no more than 60 seconds
- [ ] Residual-risk register and predeclared WAR-13B scorecard are linked, and
      neither is represented as automatic release promotion
- [ ] Maintainer has signed off in `handoff/HANDOFF.md`
