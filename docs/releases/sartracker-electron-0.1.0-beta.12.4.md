# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.4 (stable Tracking status hotfix)

> **Internal beta draft.** Do not share or use for a live incident until every
> packaged smoke row below is complete and the GitHub prerelease is published.

- **Version:** 0.1.0-beta.12.4
- **Build tag:** `electron-v0.1.0-beta.12.4`
- **Cut date (UTC):** 2026-07-29
- **Linear reference:** `DON-261`
- **Supersedes:** `electron-v0.1.0-beta.12.3`
- **Tag commit:** pending
- **Local verification report:** pending clean no-skip `npm run beta:verify`
- **CI run:** pending tag-driven `.github/workflows/electron-release.yml`
- **Exact artifact SHA-256:** pending draft-release qualification

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

This release fixes that operator-visible state error without changing position
coordinates, breadcrumb identity, Traccar requests, persistence, or map
rendering.

## What changed

- `Current fixes loaded; loading breadcrumb history.` is now shown only while
  the first breadcrumb request for the current mission history key is genuinely
  unresolved.
- A successful empty history result becomes a stable healthy state on later
  polls; the amber panel no longer mounts and unmounts on every update.
- Real history conditions remain stable and visible between polls:
  reconciliation, per-device history failure, and mission-storage seed failure.
- A new mission history key correctly starts a fresh first-fetch state.
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

## Verification before tagging

- Strict red-to-green regression captured the exact beta.12.3 sequence:
  `[loading, healthy]` on every successful empty-history poll.
- Polling manager unit suite: 39/39.
- Full unit suite: 1,277/1,277.
- ESLint and production build/bundle budgets: pass.
- Standard Chromium Playwright: 136/136.
- Visual Playwright: 36/36.
- Independent visual review: 41/41, including every critical Tracking surface.
- Same-session Fable adversarial review:
  `PASS_FOR_FULL_QUALIFICATION`, no P1/P2 findings.
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
- [ ] Release note contains exact commit, run, checksums, and evidence
- [ ] Linear and `handoff/HANDOFF.md` reflect the verified result
- [ ] Release remains an internal prerelease until guarded publication succeeds
