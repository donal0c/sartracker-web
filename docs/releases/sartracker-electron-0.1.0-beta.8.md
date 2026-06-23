# SAR Tracker Electron Desktop Beta 0.1.0-beta.8 (operator-feedback polish + runtime/tracking safety hardening + incident diagnostics)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0-beta.8
- **Build tag:** `electron-v0.1.0-beta.8`
- **Cut date (UTC):** 2026-06-23
- **Cut by:** Claude Code agent (Donal supervising)
- **Supersedes:** `electron-v0.1.0-beta.7` (the current published team build)
- **Linear reference:** install-test fixes DON-184–189; operator UI/UX batch DON-190–197 (DON-198/199 are scoping decisions only); workflow hardening DON-203–205; runtime safety hardening DON-206–209; performance hardening DON-165, DON-200–202, DON-210–213; diagnostics DON-158/179/226 (local bundle export) plus single-instance lock DON-180; late smoke fixes DON-222–225; manual refresh DON-150
- **Verification report:** CI green AND deep Ubuntu packaged smoke passed on the CI-built artifact (see Ubuntu deep smoke below)
- **CI run:** `electron-release.yml` run `28012741523` — success (gates, Linux bundle, AppImage launch smoke, draft prerelease + SHA256SUMS all green). This is the post-fix build that was smoked.
- **GitHub release:** **Draft prerelease** at tag `electron-v0.1.0-beta.8` (Linux AppImage + `.deb` + `SHA256SUMS`). Smoke matrix complete; awaiting Donal's approval to publish.

## What this beta is

Beta.8 is a **stabilization and operator-trust release**, not a new-feature release.
It folds in the first round of real install-test feedback, polishes the operator
UI for readability and smaller displays, hardens the safety-critical tracking and
mission-finalization paths, cuts map/tracking render churn, and adds a sustainable
local incident-diagnostics workflow. There is no change to the mission persistence
contract, the coordinate safety model, or the local-credential storage model
introduced in beta.7 — those are carried forward unchanged.

## Artifacts

Expected after the GitHub Actions release run passes:

| Platform | Artifact | Recommended use |
| --- | --- | --- |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.8_linux_x86_64.AppImage` | Single-file portable run; no install required. Most Linux testers. |
| Linux x86_64 | `sartracker-electron-validation_0.1.0-beta.8_linux_amd64.deb` | System install on Ubuntu/Debian/Mint/Pop_OS. |
| All | `SHA256SUMS` | Checksum sidecar to verify downloaded artifacts. |

macOS arm64 is not part of the CI cut. Windows remains gated off pending the
Windows official-map smoke (`DON-141`).

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
2. `sudo apt install ./sartracker-electron-validation_0.1.0-beta.8_linux_amd64.deb`.
3. Launch from the application menu.

## What Changed

Since `0.1.0-beta.7`. Grouped so you can test by area.

### Tracking & devices

- **Live tracks now survive a single bad row from the server.** [DON-206]
  If Traccar returns one malformed device/position row, only that row is dropped
  (and logged); the other valid devices keep updating instead of the whole live
  view going stale. An all-invalid response still fails loudly.
- **Breadcrumb trails are denser and more readable.** [DON-189, DON-193, DON-212]
  Sparse trails now connect across normal zoom, stale/offline/paused-refresh
  states flash red, and device ID labels are clearer on the map.
- **The first device update after starting a mission no longer steals the camera.** [DON-185]
  The map stays where the operator put it instead of jumping to the first fix.
- **Devices workspace is cleaner.** [DON-184, DON-190, DON-213]
  Controls (e.g. Zoom to Device) no longer clip, the active tab auto-selects its
  first device, search is scoped to the selected list, clicks inside the workspace
  no longer leak through to the map, and the closed workspace no longer does work
  in the background.

### Map, tools & drawings

- **Map readability for smaller displays.** [DON-195, DON-223]
  A scale indicator and grouped coordinate readouts were added in the lower
  centre, panels scale better on 24-inch displays, and the top action strip no
  longer overlaps its labels at narrow desktop widths (~1100px).
- **Map Tools consolidated.** [DON-191]
  Redundant Select panel removed, one-shot Measure with larger labels, Marker at
  Grid Reference moved in, and duplicate Tools controls removed from the right side.
- **Drawing detail panels simplified.** [DON-196, DON-188, DON-225]
  Low-value fields removed, required Name/Radius emphasised in red, Search Area
  defaults to a red outline with optional hidden labels, Search Sector draft
  fields are preserved while editing, and blank-name saves are now blocked
  cleanly instead of throwing.
- **Text labels are easier to grab.** [DON-205]
  The full visible label text is draggable, not just a small anchor point.
- **Map clicks ignore tool/panel chrome.** [DON-186]
  Expanding the Map Tools panel no longer opens Marker Details by mistake.

### Layers

- **Per-GPX colour control** and larger, higher-contrast Layer Tree text/checkboxes. [DON-194]
- **Layer Tree keeps its scroll position** across background refreshes. [DON-187]
- Live tracking updates no longer rebuild the layer catalog unless the layer
  structure actually changed. [DON-211]

### Markers

- **Casualty marker terminology updated.** [DON-197]
  "Condition" is now "Casualty Status" with reordered status / evacuation-priority
  options, and marker text size is adjustable.

### Mission control & review

- **Minimized Mission Control is safer.** [DON-192]
  Pause/Finish are no longer exposed in the minimized side panel; the collapsed
  state moved to the top panel, the helicopter slots were removed, and the top
  mast is shorter.
- **Stacked Escape closes only the top layer.** [DON-203]
  Pressing Esc over a dialog/drawing/measurement no longer also closes the docked
  Mission Review beneath it.
- **Mission finalize/archive is crash-safe.** [DON-209]
  If finalization is interrupted after the archive is written, recovery is
  idempotent — it reuses the recorded archive and writes exactly one finalization
  event, so there is no ambiguous archived-vs-finalized state.

### Settings & safety

- **Settings warns before discarding unsaved edits.** [DON-204]
  Closing Settings with unsaved changes now asks for explicit confirmation
  instead of silently dropping them.
- **Credentials embedded in a provider URL are rejected and redacted.** [DON-207]
  A `username:password@host` style Traccar URL is refused at validation, disables
  live tracking if found in manually edited persisted settings, and is redacted
  in diagnostics/support output.
- **Corrupt poll intervals are clamped.** [DON-208]
  Non-finite, zero, or negative persisted autosave/tracking intervals are
  normalized (30s default, clamped 5s–3600s) before polling, preventing a tight
  runaway polling loop.

### Diagnostics (local incident bundles)

- **Export Incident Bundle / Export Support Bundle.** [DON-158, DON-179, DON-226]
  Diagnostics can export a sanitized local support bundle, including a
  **time-framed incident bundle** keyed to an approximate incident time. Bundles
  now include sanitized, bounded breadcrumbs (basemap/map-health changes, marker
  saves, measurement completion, tracking status changes, tracking snapshot
  counts). They intentionally **exclude** precise coordinates, credentials,
  private map package paths, and raw mission data. A startup-fault shell can also
  export a bundle if the app fails to boot.
  **Note:** this is a **local file export** workflow. There is no in-app remote
  upload yet — share the exported bundle through the agreed private team channel.

### Reliability / launch

- **Single-instance lock.** [DON-180]
  Launching the app a second time focuses the existing window instead of starting
  a second runtime/profile. (This is one of the headline things to smoke on the
  packaged Linux build — see the checklist.)

### Performance (no visible behaviour change expected)

Incremental breadcrumb accumulation [DON-165], bulk position writes in one
transaction [DON-200], cached MBTiles readers in the official-map proxy [DON-201],
bounded position-count query for Mission Review [DON-202], and reduced MapLibre
overlay re-serialization on idle [DON-210]. These should make tracking and panning
smoother on long missions; report any regression in track accuracy or map state.

## What To Test

Critical, packaged-build, on the Ubuntu machine:

- **Critical (DON-180):** launch the app, then click the launcher again during
  startup and again after it is ready — the existing window must focus/restore,
  no second runtime/profile starts, and no red startup-fault shell appears.
- **Critical:** app launches; a mission can be started; persists after a full
  restart; finalizes with a standalone archive; the finalized mission cannot be
  destructively edited.
- **Critical (DON-209):** interrupt the app during mission finalization and
  confirm recovery leaves exactly one clean finalized/archived result.
- **Critical:** tracking connects to the team Traccar server (`https://kmrtsar.eu`)
  and devices/breadcrumbs display.
- **Critical (DON-206):** with live tracking running, confirm devices keep
  updating and one device's data problem does not blank the whole live view.
- **Critical (DON-207/208):** a bad provider URL with embedded credentials is
  rejected; diagnostics never show the secret; tracking does not enter a runaway
  poll.
- **Critical:** coordinate entry rejects obviously outside-Ireland or ambiguous
  signed-direction inputs with clear messages.
- **Critical (diagnostics):** Export Incident Bundle and the time-framed variant
  produce a sanitized local bundle (no coordinates, no credentials, no private
  paths).

Operator-feedback areas (the visible polish — confirm it feels right in the field):

- Devices workspace selection/search/zoom (DON-190), Map Tools layout (DON-191),
  minimized Mission Control (DON-192), tracking stale colours + breadcrumb density
  (DON-193), Layer Tree + per-GPX colours (DON-194), map scale + coordinate
  readouts on a smaller display (DON-195/223), drawing panels + required fields
  (DON-196), casualty terminology (DON-197), text-label dragging (DON-205),
  Settings unsaved-edit prompt (DON-204).

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
- Diagnostics support bundles are **local file exports only**; there is no in-app
  remote upload inbox yet (`DON-181` is not in this build).
- Traccar credentials are stored as local app-owned plaintext (best-effort
  `0600` file permissions), unchanged from beta.7 (`DON-177`). This is an
  intentional reliability trade for trusted team machines, not OS-keyring
  encryption.

## Verification (CI-driven)

This beta is produced by `.github/workflows/electron-release.yml` on the
`electron-v0.1.0-beta.8` tag. Before sharing with testers, the release must have:

- GitHub Actions gates green: lint, unit tests, web build, native Linux bundle,
  private-map-data guard, Xvfb launch smoke, and `SHA256SUMS`.
- Real Ubuntu smoke against the **CI-built** artifact (not a local rebuild):
  checksum verification, packaged launch, single-instance/duplicate-launch
  (DON-180), mission lifecycle/restart/recovery/finalize/archive (incl. DON-209
  interrupted-finalize recovery), coordinate rejection, sanitized diagnostics +
  incident-bundle export, live Traccar connection, malformed-row resilience
  (DON-206), credential-in-URL rejection (DON-207), corrupt-interval clamp
  (DON-208), and bad/corrupt credential startup safety.

## Rollback / Reinstall

- AppImage: delete the file. `.deb`: `sudo apt remove sartracker-electron-validation`.
- Mission data lives under the app's per-user data directory and is not removed
  by uninstalling the bundle. If corruption is suspected, capture diagnostics
  first and do not delete anything until recorded.

## Publication State

**Draft — smoke complete, awaiting promotion approval.** CI run `28012741523`
is green and the deep Ubuntu packaged smoke matrix above passed on the CI-built
post-fix artifact. One real defect (DON-226 `runtimeLog`) was found by the smoke
and fixed; the smoked/shipped artifact is the post-fix build. Remaining step:
Donal approves and the draft prerelease is published to the team.

### CI-built artifact checksums (post-fix build, run `28012741523`)

```
43067cb2a99671419da576799beaedd7541b6ade7714fe267ad0c16b68e97911  sartracker-electron-validation_0.1.0-beta.8_linux_x86_64.AppImage
fa60e126faee7a6d0f025d0e460317b6c53da1ed58cd3a3d129ac86ea2ca0a2b  sartracker-electron-validation_0.1.0-beta.8_linux_amd64.deb
```

Verify the downloaded artifact against these before launching
(`sha256sum -c SHA256SUMS --ignore-missing` → **OK**).

### Bug found and fixed by this smoke (release-relevant)

The first beta.8 build had a defect the packaged smoke caught: the DON-226
`record-diagnostic-event` IPC handler referenced an out-of-scope `runtimeLog`,
so every renderer diagnostic event threw `ReferenceError: runtimeLog is not
defined` in the main process. Operator incident bundles still populated (the
breadcrumbs are kept in a renderer-side store), but the **durable main-process
diagnostic log never received the events** and the main process logged an error
on every event. Fixed by threading `runtimeLog` into `registerIpcHandlers`,
with a red→green regression test in `tests/unit/electron-main-startup.test.ts`.
The smoked/shipped artifact is the post-fix build (checksums above): re-launch
shows **zero `runtimeLog` errors** and the durable runtime log now records
`renderer_*` diagnostic events.

### Ubuntu deep smoke (2026-06-23)

CI-built AppImage (SHA256 `43067cb2a99671419da576799beaedd7541b6ade7714fe267ad0c16b68e97911`,
`sha256sum -c` OK) on `donal-Precision-5570`, Ubuntu 24.04.2 LTS, kernel
6.17.0-35, real X11 display (the box was upgraded off Wayland since the beta.7
smoke; driven with `--ozone-platform=x11`). Playwright over CDP against the real
better-sqlite3 backend, throwaway userData per run (the real operator mission DB
in `~/.config/sartracker-web` was never touched). App version
`0.1.0-beta.8+run.13`, Electron 40.10.0, Chromium 144, schema v4.

Suites (all green on the post-fix artifact):

1. **Core lifecycle (10/10):** launch + map canvas; no fault shell; mission
   start; marker; restart → recovery dialog → resume; finish; finalize →
   governance finalized; standalone archive on disk (`userData/archives`);
   second restart on finalized userData boots clean with no spurious recovery.
2. **Duplicate launch / single-instance, DON-180 (8/8):** instance A active;
   second and third launches exit (lock not granted); A still running with its
   mission active; no fault shell; no second profile created.
3. **Coordinate safety + diagnostics, DON-226 (6/6):** out-of-Ireland DD (Paris)
   rejected with a clear message; support bundle written and sanitized (no
   credential leak, home paths redacted); time-framed incident bundle sanitized;
   durable runtime log + bundle `[diagnostic-breadcrumbs]` now populated.
4. **Settings safety, DON-207/204/208 (6/6):** provider URL with embedded
   credentials rejected and save blocked; discard prompt on close with unsaved
   edits + "Keep editing" cancels; clean boot with corrupt persisted intervals.
5. **UI polish, DON-195/223/197 (4/4):** map scale bar + grouped coordinate
   readout; command mast does not overflow at 1100x720; casualty dialog uses
   "Casualty Status".
6. **Live Traccar + credential migration, DON-206/175/177 (9/9):** real
   connection to `https://kmrtsar.eu` — "Connection successful.", online with
   **33 devices / 8 fixes** (DON-206: live rows rendered, not blanked); the
   May-31 stored secret was undecryptable after the box's OS-key change and the
   app handled it gracefully (warning + usable, DON-175/177); re-entered secret
   saved and app-owned `credentials.json` written.
7. **Offline Discovery map (network blocked):** private package registered
   (Discovery Topo z8–z16, 31,729 tiles, READY); real offline tile read
   (2,372 bytes) with network blocked; "Field ready / current view inside
   official offline area"; outside-area correctly flagged.

Evidence (screenshots + per-suite `summary.json` + sanitized bundles) mirrored
to `output/beta8-ubuntu-smoke/evidence-fixed/` in the repo working tree.
