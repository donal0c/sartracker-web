# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.4 (Tracking stability hotfix)

> **Unpublished superseded candidate.** Do not share. The immutable tag and
> private draft are retained as release-gate evidence. Final review found an
> asynchronous overlay retry/cancellation gap and a changed-surface CI flake;
> both are corrected and must be re-qualified in beta.12.5.

- **Version:** 0.1.0-beta.12.4
- **Build tag:** `electron-v0.1.0-beta.12.4`
- **Cut date (UTC):** 2026-07-29
- **Linear references:** `DON-261`, `DON-262`, `DON-263`; follow-up `DON-264`
- **Supersedes:** `electron-v0.1.0-beta.12.3`
- **Tag commit:** `a312568957b181220bd21329b6081cd9528154e5`
- **Local verification report:** `tmp/beta-artifacts/verify-0.1.0-beta.12.4-sha.a312568957b1-2026-07-29T21-12-55Z.json` (8/8)
- **CI run:** `30491599605` (green)
- **Exact artifact SHA-256:** AppImage `e0fd9ae6232f2846839388de6cbf7bfdc82cf1a4ab731e08b3d1c218430171d6`; `.deb` `12acfe972db362e43d6bc74dd1c179e320d5fc99b737cae1b18a67747f413811`

## Why this hotfix exists

The team installed beta.12.3 as both an AppImage and a Debian package and
reported that the Tracking panel flashed yellow whenever tracking updated.
The supplied PCLinuxOS diagnostics and incident bundle show that the app did not
crash: tracking remained online, consecutive failures and crash history stayed
at zero, storage stayed healthy, and event-loop delay remained bounded.

The runtime log instead proves a deterministic warning-state oscillation. On
109 successful poll cycles, the renderer set `hasWarning:true` and cleared it
77-99 ms later (mean 89.5 ms). A new or genuinely empty-history mission was
being labelled "loading breadcrumb history" before every five-second poll, then
labelled healthy after the valid empty response.

Qualification then exposed a separate map-readiness defect: app-owned tracking
overlays waited for every visible basemap tile to finish or fail before they
could synchronize. Slow or unavailable raster tiles could therefore delay
current positions and breadcrumbs even though their authoritative data was
already available.

This release fixes both operator-visible failures without changing position
coordinates, breadcrumb identity, Traccar requests, or persistence.

## What changed

- `Current fixes loaded; loading breadcrumb history.` is now shown only while
  the first breadcrumb request for the current mission history key is genuinely
  unresolved.
- A successful empty history result becomes a stable healthy state on later
  polls; the amber panel no longer mounts and unmounts on every update.
- Real history conditions remain stable and visible between polls:
  reconciliation, per-device history failure, and mission-storage seed failure.
- A new mission history key correctly starts a fresh first-fetch state.
- **Open Devices** now stays directly below the Tracking header instead of
  moving when loading, healthy, reconciliation, or offline messages change.
  This removes a real pointer-target race found during packaged qualification.
- The packaged soak now re-resolves a focused, hit-testable action target,
  requires stable geometry before one trusted click, and retains a
  launch-wide sequence audit so late, extra, missing, untrusted, or misdirected
  input blocks the release with attributable evidence.
- Current positions, breadcrumbs, markers, drawings, GPX tracks, measurements,
  and helicopter overlays synchronize as soon as the MapLibre style structure
  can accept app layers. They do not wait for public or official basemap tile
  completion.
- Overlay synchronization retries transient style transitions without
  continuously re-entering on app-owned style changes; this prevents rapidly
  updated GeoJSON sources from being left paused and non-renderable.
- Connection failure, recovery, pause/idle/resume, stopped/superseded polls,
  long-mission reconciliation, and bounded breadcrumb rendering remain
  unchanged.

## What the team should test

1. Start a new mission while connected to Traccar and open **Tracking**.
2. Watch at least ten five-second update cycles.
3. The initial history-loading message may appear once while the first request
   is unresolved. It must not flash again after the first result completes.
4. The panel should remain green with **Telemetry stream healthy** when the
   mission correctly has no breadcrumb history.
5. For a long existing mission, a genuine **Breadcrumb history is
   reconciling** message should remain steady until reconciliation completes;
   current fixes must continue updating.
6. Repeat on both the AppImage and `.deb` installation. Export an incident
   bundle with the approximate time if any yellow or red state flashes.
7. While the Tracking message changes between loading, healthy, and offline,
   confirm **Open Devices** remains stationary and opens on the first click.
8. With the basemap still loading or degraded, confirm current team positions
   and breadcrumb trails remain visible and continue updating.

## Verification before tagging

- Strict red-to-green regression captured the exact beta.12.3 sequence:
  `[loading, healthy]` on every successful empty-history poll.
- Polling manager unit suite: 39/39.
- Full unit suite: 1,287/1,287.
- ESLint and production build/bundle budgets: pass.
- Standard Chromium Playwright: 142/142.
- Visual Playwright: 37/37.
- Independent uncached visual review: 43/43, including every critical Tracking
  surface; report:
  `test-results/visual-verification/reports/visual-review-2026-07-29T20-11-58Z.json`.
- Same-session Fable adversarial reviews of the final map synchronization,
  bounded retry, timer cleanup, and held-tile visual proof:
  `PASS_FOR_COMMIT` twice, no P1/P2 findings.
- Deliberately held-open OpenTopoMap tile requests: MapLibre remained
  `isStyleLoaded() === false` while two current positions and the mission
  breadcrumb trail were present and visibly rendered.
- Devices, GPX, and measurement browser matrix: 66/66 across three consecutive
  repeated runs, including the held-open-basemap proof.
- Exact commit `b1e21c22c3232619b654ca5122c6050b9b56fca0` was built on Ubuntu
  24.04. Ten consecutive unpacked-package soaks passed with 86,640/86,640 exact
  positions, zero missing source identities, zero redundant telemetry, zero
  crashes, 40/40 healthy audited interactions, zero sequence/tail errors, and
  one identical Open Devices Y coordinate (`615`) across every mission start,
  restart, and final load. Maximum main heartbeat was 20.4 ms; maximum external
  operator response was 180.7 ms.
- The same pre-tag AppImage and the exact `.deb` payload in its extracted
  installed filesystem layout each passed an additional 8,664-position
  launch/restart soak. The `.deb` was not privileged-installed because the
  Ubuntu account has no non-interactive sudo; exact CI artifact installation
  remains a release blocker.
- Packaged active-tracking basemap-switch proof passed against the AppImage:
  OpenStreetMap was selected and then switched back to OpenTopoMap while 40
  raster requests were deliberately held. MapLibre remained
  `isStyleLoaded() === false`; two current positions and two breadcrumb trails
  rendered; each trail gained six fixes before the requests were released.
  After tile failure, the explicit degraded-map alert appeared while the same
  tracking overlays and green online state remained visible.
- The exact AppImage passed the undecryptable-credential startup smoke: normal
  shell, explicit recovery warning, no startup fault, and Settings accepted a
  replacement secret.
- Pre-tag Ubuntu artifact digests:
  - AppImage:
    `77142e312098cb798060f64a25ffede8c3857f3339feb05a9c84012cf6ec65ff`
  - `.deb`:
    `308c95e36e8b0cbb18e59e6b435a3ba0731c2f44c85be7fffada604fd62b050f`
- A clean Ubuntu `beta:verify` wrapper attempt passed lint, build, and all
  1,287 unit tests, then failed closed before browser/package steps because the
  machine lacks the system development packages required to compile the
  historical Tauri backend (`libdbus-1-dev`, GTK/WebKit/libsoup/libsecret
  development metadata). The backend independently passes `51 / 1 ignored` on
  macOS, but one clean no-skip wrapper run is still required.
- Clean no-skip beta verification, tag CI, and exact CI-built Linux artifact
  results remain pending and are release blockers.

## Known limitations and non-goals

- This is an internal Linux x86-64 field-test build, not final operational
  acceptance and not approved for live incidents.
- Linux artifacts are unsigned and do not auto-update.
- Windows and macOS packages are not produced by this release lane.
- Private Discovery map packages are not bundled.
- Full Discovery map loading, beta.13 bounded-storage migration/retention,
  streamed archives, and archive-backed review remain separate work.
- Persistent overlay-sync exceptions retry with capped backoff and are visible
  in the developer console; durable sanitized diagnostics/map-health elevation
  is tracked in `DON-264` and is non-blocking for this hotfix.
- This hotfix does not claim GPS hardware has zero physical measurement error.

## Packaged smoke matrix

The draft release must not be published until every row is complete. Only the
unchanged private-map-package row may be `NOT APPLICABLE` with a concrete reason.

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

Beta.12.4 also adds this release-specific blocking observation:

| Gate | Result | Evidence |
| --- | --- | --- |
| Empty-history Tracking panel remains stable for at least ten polls on AppImage and installed `.deb` | TODO | no repeated amber loading warning; diagnostics status sequence retained |
| Open Devices target remains stationary across Tracking status changes | TODO | fixed bounding-box/browser proof plus exact packaged click coordinates |
| Current positions and breadcrumbs render while basemap tiles remain pending/degraded | TODO | held-tile browser regression plus exact packaged AppImage/`.deb` observation |

## Rollback / reinstall

1. Quit SAR Tracker.
2. AppImage: remove the beta.12.4 AppImage and run the previously qualified
   beta.12.3 AppImage. `.deb`: install the previous package version.
3. Mission databases remain under the per-user application data directory and
   are not removed by uninstalling. Capture diagnostics before changing any
   mission data.

## Pre-share checklist

- [ ] Product commit is clean, pushed, and tagged immutably
- [ ] Clean no-skip local `npm run beta:verify` passes every step
- [ ] Tag-driven Electron release workflow is green
- [ ] Draft assets are AppImage, `.deb`, and `SHA256SUMS` only
- [ ] Exact draft bytes match `SHA256SUMS`
- [ ] Exact CI AppImage and installed `.deb` pass the packaged smoke matrix
- [ ] Empty-history status remains visually stable for at least ten polls on
      both Linux package paths
- [ ] Current positions and breadcrumbs remain live while basemap tiles are
      pending or degraded on both Linux package paths
- [ ] Release note contains exact commit, run, checksums, and evidence
- [ ] Linear and `handoff/HANDOFF.md` reflect the verified result
- [ ] Release remains an internal prerelease until guarded publication succeeds
