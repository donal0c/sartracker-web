# HOLD - SAR Tracker Electron Desktop Beta 0.1.0-beta.9 (Fable safety hardening)

> **Release hold, 2026-07-08:** beta.9 reached testers, but team feedback
> reported long Linux UI hangs while panning the official map, opening Devices,
> and exporting diagnostics. Treat this release as **not suitable for further
> rollout**. The blocking follow-up is `DON-240`; testers should wait for the
> replacement hotfix build.

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.9
- **Build tag:** `electron-v0.1.0-beta.9`
- **Cut date (UTC):** 2026-07-07
- **Cut by:** Codex agent (Donal supervising)
- **Supersedes:** `electron-v0.1.0-beta.8`
- **Linear reference:** Fable deep-analysis parent `DON-230`; shipped fixes `DON-228`, `DON-231`-`DON-238`. `DON-239` is intentionally parked for a later low-priority tracking-staleness pass.
- **Verification report:** local gates, local browser/packaged smoke, GitHub Actions, Linux bundle, CI AppImage launch smoke, and deep Ubuntu CI-artifact smoke complete.
- **CI run:** `electron-release.yml` run `28875685324` - success (gates, Linux bundle, Xvfb AppImage launch smoke, draft prerelease + SHA256SUMS).
- **GitHub release:** published prerelease, now marked HOLD on GitHub pending
  `DON-240` replacement artifacts.

## What this beta is

Beta.9 is a **safety and durability hardening release** driven by the Fable
deep-analysis review. It does not add a new operator workflow. It fixes mission
record integrity, SQLite backup/archive durability, Traccar cursor/session
correctness, tracking overlay churn, Electron trust-boundary gaps, diagnostic
redaction, and Irish Grid coordinate semantics.

## Release Hold Finding

`DON-240` was opened after beta.9 tester feedback showed a release-blocking
freeze on Linux AppImage. Root cause investigation found a main-process
saturation pattern when a real official Discovery MBTiles package, live
tracking, and diagnostics export were combined:

- the Electron official-map tile proxy loaded and normalized Settings on every
  tile IPC request, including first-pan bursts;
- ordinary offline package coverage misses threw one Electron IPC exception per
  missing tile, producing stack-log storms while panning outside coverage;
- beta.9 tracking waited behind slow breadcrumb fan-out before publishing
  current fixes, and duplicate overlap windows could still invalidate retained
  breadcrumb snapshots;
- diagnostics export parsed the whole rotated runtime log to return a bounded
  recent slice.

The hotfix branch for `DON-240` addresses those paths and must produce a new
replacement beta. Do not treat the original beta.9 artifact as release-ready.

## Artifacts

Created by GitHub Actions run `28875685324`:

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.9_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.9_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

macOS arm64 is not part of the CI cut. Windows remains gated off pending the
Windows official-map smoke (`DON-141`).

Private Discovery map packages are never release artifacts. Distribute those
through the agreed private team channel and load them through Settings after
installing the app.

## Install - Linux (primary target)

### AppImage (zero-install)

1. Download the `.AppImage` and `SHA256SUMS`.
2. Verify: `sha256sum -c SHA256SUMS --ignore-missing` - the AppImage line must say **OK**.
3. `chmod +x` the AppImage and run it.
4. If you see `dlopen(): error loading libfuse.so.2`: Ubuntu 24.04 `sudo apt install libfuse2t64`; Ubuntu 22.04 `sudo apt install libfuse2`.

### .deb (system install)

1. Download the `.deb` and `SHA256SUMS`, verify the checksum.
2. `sudo apt install ./sartracker-electron-validation_0.1.0-beta.9_linux_amd64.deb`.
3. Launch from the application menu.

## What Changed

Since `0.1.0-beta.8`. Grouped so you can test by risk area.

### Mission record integrity

- **Paused mission time is accumulated from pause intervals.** [DON-231]
  Pausing and resuming no longer risks corrupting elapsed mission accounting.
- **Created/imported timestamps are preserved on edit.** [DON-231]
  Marker, drawing, and GPX edits keep their original created/imported time
  instead of rewriting history during normal edits.

### SQLite durability, backup, and archive safety

- **Mission writes now use stronger SQLite durability.** [DON-232]
  The desktop mission store uses `synchronous=FULL` for stronger crash-safety on
  committed mission data.
- **Backup mirrors are atomic and serialized.** [DON-232]
  Backup writes go through a temp file plus rename, backup/archive work is
  serialized, and archive validation avoids marking a mission finalized when the
  archive is missing or incomplete.
- **Opening a newer schema fails explicitly.** [DON-232]
  A beta.9 app will not silently open a database created by a future app version.
- **Finalize/archive retries are safer.** [DON-232]
  Retry behavior is idempotent around stale archive state and no longer leaves
  ambiguous finalized-vs-archived mission records.

### Traccar cursor, session, and speed correctness

- **Breadcrumb cursors no longer create blind spots or runaway old windows.** [DON-228, DON-233]
  Incremental fetches overlap safely, clamp future timestamps to the completed
  fetch window, and advance from the maximum timestamp in an unsorted response.
- **Seed failures no longer truncate retained history.** [DON-233]
  If resume seeding fails, the runtime avoids replacing the mission's history
  with a short fallback.
- **Same-second fixes are preserved when they are genuinely distinct.** [DON-233]
  Timestamp canonicalization prevents duplicates from string-format drift while
  still keeping distinct fixes that share the same second.
- **Expired Traccar sessions recover cleanly.** [DON-234]
  A `401` or `403` clears stale cookies and reauthenticates.
- **Failed request timeouts are cleaned up.** [DON-234]
  Timed-out requests no longer leave stale timeout handles behind.
- **Traccar speed is displayed/stored in km/h.** [DON-234]
  API speeds are normalized from Traccar's knot-based values before reaching the
  operator UI or mission persistence.

### Tracking map performance and visual stability

- **Hidden Tracking work is quiet.** [DON-235]
  Hidden Tracking uses a stable empty snapshot, skips unchanged FeatureCollection
  construction, and avoids repeated `setData` calls during idle map frames.
- **Healthy polls publish one settled snapshot.** [DON-235]
  The runtime avoids extra intermediate overlay churn after successful polls.
- **Breadcrumb source memory is bounded.** [DON-235]
  Retained source arrays stay bounded while observed mission totals remain
  cumulative for diagnostics.
- **Hover coordinates are animation-frame throttled.** [DON-235]
  Map hover readouts are less likely to compete with render work during panning.
- **Tracking labels and small-display coordinate strip were tightened.** [DON-235]
  Visual validation caught and fixed a label halo/readability issue and a
  small-display coordinate-strip overlap.

### Electron runtime trust boundaries

- **Fatal main-process errors flush diagnostics before relaunch/exit.** [DON-236]
  Crash evidence is written before the app tries to recover or quit.
- **Packaged `file:` IPC senders are restricted to the built renderer entrypoint.** [DON-236]
  The preload/main boundary rejects unexpected packaged-file senders.
- **External navigation and popups are denied.** [DON-236]
  App windows cannot be redirected into untrusted pages.
- **The Traccar proxy is origin-constrained and size-bounded.** [DON-236]
  Proxy requests are limited to the configured provider origin and oversized
  responses are capped.
- **File/path IPC is limited to app-owned or operator-selected paths.** [DON-236]
  File-launch and related IPC surfaces no longer accept arbitrary local paths.

### Diagnostics and settings safety

- **Diagnostic metadata cannot be overridden by report payload fields.** [DON-237]
  App-owned metadata remains authoritative in exported reports.
- **Diagnostic redaction is recursive.** [DON-237]
  Authorization headers, tokens, URL credentials, and home paths are redacted
  through nested diagnostic payloads.
- **Clean-exit marking is awaited.** [DON-237]
  Clean shutdown state is less likely to race app exit.
- **Settings does not advertise Traccar auth when credential persistence fails.** [DON-237]
  Operators will not see a misleading "saved" state if the credential write did
  not actually succeed.

### Coordinate safety and Irish Grid semantics

- **Production TM65 uses the EPSG:1641 negative-Y transform.** [DON-238]
  Historical S2 spike data is no longer treated as the active coordinate oracle.
- **Displayed Irish Grid refs truncate to requested precision.** [DON-238]
  Formatting no longer rounds into a neighboring grid square.
- **Coarse Irish Grid refs resolve to the centre of the represented square.** [DON-238]
  Converter and Marker at Grid Reference now place refs such as `V 80 84` at the
  centre of that 1 km square (`V 80500 84500`), matching the locked product call.
- **Irish Grid converter results preserve parsed TM65 at 100 km edges.** [DON-238]
  Edge-square inputs no longer drift through a round-trip display artifact.
- **Decimal-comma DD input has a clear decimal-point error.** [DON-238]
  Ambiguous `52,123` style decimal-degree input tells the operator to use a
  decimal point.
- **Impossible live coordinate values render a placeholder.** [DON-238]
  Bad live coordinate values show `-` instead of throwing in the coordinate strip.

## Parked Fable Item

- **DON-239:** tracking stale-threshold policy and presentation improvement.
  This was assessed as low priority for this release. Beta.9 does not change the
  product call here.

## What To Test

Critical, packaged-build, on the Ubuntu machine after the CI artifacts exist.
This matrix passed on 2026-07-08 against the CI-built AppImage:

- Checksum verification for AppImage and `.deb` using `SHA256SUMS`.
- Packaged launch on the real Ubuntu smoke box.
- Mission lifecycle: start, persist after restart, recovery, finish, finalize,
  archive creation, and clean relaunch after finalization.
- Coordinate rejection and coarse Irish Grid behavior (`V 80 84` should resolve
  to `V 80500 84500`; out-of-Ireland DD should be rejected).
- Diagnostics export and incident/support bundle sanitization.
- Bad/corrupt credential startup safety.
- Settings credential-persistence failure behavior if it can be simulated.
- Live Traccar connection to `https://kmrtsar.eu`, including breadcrumb continuity
  and displayed speed units.
- Duplicate launch / single-instance smoke from beta.8 should be rechecked as a
  release-regression guard.
- Private Discovery offline map package smoke if the package is available on the
  Ubuntu box; otherwise record the package as unavailable and do not publish for
  map-testing purposes.

Local pre-Ubuntu smoke covered the same app surfaces where practical. The
release was published only after the Ubuntu packaged smoke passed on the
CI-built artifact.

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

- Linux x86_64 only from CI for this cut. No Windows, no macOS, no ARM.
- Artifacts are unsigned. Expect platform security warnings outside Linux.
- Auto-updater is not enabled. Each beta is a fresh download.
- High-definition mountain map packages are not bundled.
- Browser hosted-mode persistence is testing-only and not part of this desktop beta.
- Windows official-map import remains blocked on `DON-141`.
- Diagnostics support bundles are local file exports only; there is no in-app
  remote upload inbox yet (`DON-181` is not in this build).
- Traccar credentials are stored as local app-owned plaintext (best-effort
  `0600` file permissions), unchanged from beta.7 (`DON-177`). This is an
  intentional reliability trade for trusted team machines, not OS-keyring
  encryption.

## Verification

This beta is produced by `.github/workflows/electron-release.yml` on the
`electron-v0.1.0-beta.9` tag. Before sharing with testers, the release must have:

- GitHub Actions gates green: lint, unit tests, web build, native Linux bundle,
  private-map-data guard, Xvfb launch smoke, and `SHA256SUMS`.
- Real Ubuntu smoke against the **CI-built** artifact, not a local rebuild:
  checksum verification, packaged launch, mission lifecycle/restart/recovery/
  finalize/archive, coordinate rejection and coarse-grid handling, sanitized
  diagnostics/support bundle export, live Traccar connection, bad/corrupt
  credential startup safety, and duplicate-launch regression coverage.

### Local pre-Ubuntu verification

Completed on 2026-07-07 on Donal's local macOS arm64 machine before cutting the
tag:

- `npm run beta:verify` - PASS with no skipped steps; report
  `tmp/beta-artifacts/verify-0.1.0-beta.9-sha.581d43382545-2026-07-07T14-50-20Z.json`.
  Covered lint, build, unit tests, backend tests, Chromium E2E `129/129`,
  local unsigned Electron packaging, and the formal manual smoke checklist.
- `npx playwright test --project=visual` - PASS `34/34`.
- `npm run visual:review -- --fail-on critical` - PASS `39/39`; report
  `test-results/visual-verification/reports/visual-review-2026-07-07T14-39-54Z.json`.
- Browser smoke against `http://127.0.0.1:1420/?missionHarness=1` - PASS.
  Evidence under `output/playwright/beta8-local-smoke/` covers idle shell,
  active tracking warning, Devices at 1100x720, minimized Mission Control, Map
  Tools, Marker at Grid Reference, Settings credential-in-URL rejection, mocked
  online tracking, Diagnostics support bundle, and small-display map/scale
  layout. The script recorded expected reload/tile `ERR_ABORTED` noise while
  deliberately resetting browser state.
- Local packaged Electron core smoke against
  `tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app` - critical
  gates PASS: launch, real SQLite mission start, marker save, restart recovery,
  finish/finalize, and standalone archive creation (`5055` bytes). Evidence:
  `tmp/beta9-local-packaged-core-smoke/`.
- Local packaged coordinate/diagnostics smoke - coordinate rejection PASS.
  Diagnostics export was manually inspected after the legacy script flagged the
  safe label `secret present: no`; no password/token/Authorization value was
  present and home paths were redacted. Evidence:
  `tmp/beta9-local-packaged-coordinate-diagnostics-smoke/`.
- `npm run electron:smoke:bad-secret -- --app "tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app/Contents/MacOS/SAR Tracker Electron Validation" --evidence-dir tmp/beta9-local-bad-secret-smoke`
  - PASS. The packaged app reached the normal shell with the expected
  undecryptable-credential warning and Settings recovery path.

Local verification was intentionally **not** the release publication gate. The
Ubuntu smoke below is the packaged-artifact release gate.

### GitHub Actions release run

Completed successfully on 2026-07-07:

- Run: `28875685324`
- Commit: `d6cad5b5219c859784bd349bdd15a0983a6411de`
- Gates: lint, unit tests, web build, standard Chromium E2E.
- Bundle: Linux x86_64 AppImage and `.deb`; native SQLite module inspected;
  private-map-data guard passed.
- CI launch smoke: AppImage launched under Xvfb and evidence uploaded.
- Draft prerelease and `SHA256SUMS` were created.

CI-built checksums:

```text
7d3490b4da53743b5a4a2d38ff36b951c1ad73131589afdf2d288e6bd6d34641  sartracker-electron-validation_0.1.0-beta.9_linux_amd64.deb
99d3aeb3d543ad4b5b95f3cc24ce29c1b3f21963095a30040d60588e3789ce7c  sartracker-electron-validation_0.1.0-beta.9_linux_x86_64.AppImage
```

### Ubuntu deep smoke

Completed on 2026-07-08 on the Ubuntu smoke box
`donal-Precision-5570` (`6.17.0-35-generic`, X11 display `:0`) against the
**CI-built** beta.9 AppImage and `.deb` downloaded from the draft GitHub
release. Evidence was mirrored locally under `output/beta9-ubuntu-smoke/`.

- `sha256sum -c SHA256SUMS --ignore-missing` - PASS for both AppImage and
  `.deb`.
- `.deb` metadata inspection - PASS. Package `sartracker-web`,
  version `0.1.0~beta.9`, architecture `amd64`, expected Electron/Linux
  dependencies present.
- Packaged AppImage core lifecycle smoke - PASS critical gates: app shell and
  map canvas rendered, real SQLite mission started, marker saved, mission
  recovered after restart, mission finished, mission finalized, and standalone
  archive written (`5008` bytes). Evidence:
  `output/beta9-ubuntu-smoke/evidence-core/`.
- Coordinate/diagnostics smoke - PASS after manual inspection of the legacy
  script's broad secret regex: out-of-Ireland DD was rejected; diagnostics
  contained only `safeStorage backend: gnome_libsecret` and
  `secret present: no`, with no password, token, Basic auth header, or known
  credential value. Evidence:
  `output/beta9-ubuntu-smoke/evidence-coord-diag/`.
- Bad/corrupt credential startup smoke - PASS. The packaged app reached the
  normal shell, surfaced the expected stored-credential warning, and allowed
  Settings recovery. Evidence:
  `output/beta9-ubuntu-smoke/evidence-bad-secret/`.
- Live Traccar smoke - PASS using throwaway user data seeded from the Ubuntu
  box's persisted settings/credentials: provider URL `https://kmrtsar.eu`
  loaded, connection test succeeded, and tracking went online with live fixes.
  Evidence: `output/beta9-ubuntu-smoke/evidence-live-tracking/`.
- Private Discovery offline map smoke - PASS with the regional Reeks MBTiles
  package, renderer network blocked: local MBTiles tile bytes returned,
  Discovery Topo rendered, inside/outside coverage messaging worked, Settings
  showed `1/1 ready`, and the diagnostics report was sanitized. Evidence:
  `output/beta9-ubuntu-smoke/evidence-official-offline-reeks/`.
- Beta.9-specific packaged UI checks - PASS for coarse Irish Grid ref
  `V 80 84` resolving to `V 80500 84500`, and Settings rejecting provider URLs
  with embedded credentials.
- Diagnostics export matrix - PASS: diagnostics report, support bundle, and
  incident support bundle exported without credential leaks. Evidence:
  `output/beta9-ubuntu-smoke/evidence-support-bundles/`.
- Duplicate launch / single-instance smoke - PASS. A second AppImage launch
  exited with code `0` while the primary app remained usable. Evidence:
  `output/beta9-ubuntu-smoke/evidence-single-instance/`.

One non-blocking harness correction: the first official-map run used a national
package, so the old "jump to Dublin means outside package" assertion was
invalid because Dublin is inside that package's bounds. The release gate was
rerun against the regional Reeks package where inside/outside coverage is
meaningful, and it passed.

## Rollback / Reinstall

- AppImage: delete the file. `.deb`: `sudo apt remove sartracker-electron-validation`.
- Mission data lives under the app's per-user data directory and is not removed
  by uninstalling the bundle. If corruption is suspected, capture diagnostics
  first and do not delete anything until recorded.

## Publication State

**Published prerelease.** Beta.9 passed the local, CI, and Ubuntu packaged
release gates and is ready for internal tester sharing.
