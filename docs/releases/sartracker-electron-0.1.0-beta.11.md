# SAR Tracker Electron Desktop Beta 0.1.0-beta.11 (DON-240 fsync-storm fix)

> **Internal beta only.** Not a production release. Use for DON-240 field retest
> and smoke validation before any wider team rollout.

- **Version:** 0.1.0-beta.11
- **Build tag:** `electron-v0.1.0-beta.11`
- **Cut date (UTC):** 2026-07-08
- **Cut by:** Codex agent (Donal supervising)
- **Supersedes:** `electron-v0.1.0-beta.10` (**HOLD for field freeze**)
- **Linear reference:** `DON-240`
- **Verification report:** `tmp/beta-artifacts/verify-0.1.0-beta.11-sha.4f13da2b01a6-2026-07-08T20-23-32Z.json`
- **CI run:** GitHub Actions `Release (Electron Desktop)` run `28972979120` passed.
- **GitHub release:** `electron-v0.1.0-beta.11` prerelease, published after the Ubuntu smoke evidence below was recorded.

## Why beta.11 exists

Beta.10 retained the beta.9 tile-proxy and diagnostics hardening, but the field
tester still saw the app become unusably slow once live tracking was online.
Fable's follow-up found the real freeze cause: beta.9 added SQLite
`synchronous = FULL`, and the tracking runtime persisted every device in a
per-device loop. With 32 devices, every poll could do 32 fsync-backed commits on
the Electron main process. On the tester's slower field disk, that stretched a
5 s tracking cadence into roughly 22-27 s and made map panning, Devices, and
diagnostics appear frozen.

Fast SSD validation machines, including the Ubuntu smoke box, cannot reproduce
that exact fsync latency. They can still validate that the build works, that the
new code path is present, and that no other release-critical workflow regressed.
The actual proof for the field freeze still has to come from the original slow
tester machine/profile.

## DON-240 Fix Summary

- Adds `upsertDevicesBulk` to the Electron mission store.
- Persists all devices from a tracking poll in one SQLite transaction instead
  of one transaction per device.
- Keeps `synchronous = FULL` for power-loss durability while reducing per-poll
  device fsyncs from roughly 32 to 1.
- Keeps the existing per-device fallback if a non-Electron store does not expose
  the bulk method.
- Preserves per-device audit events for created/updated device rows.
- Retains beta.10 hardening for map tile coverage misses, current-fix-first
  tracking publication, bounded diagnostics log reads, and Settings close
  behavior during reconnect.

## What To Test First

This build should go first to the tester/team machine that froze on beta.10.

Critical retest:

- Install/run the beta.11 AppImage or `.deb`.
- Use the same machine/profile, mission, live tracking provider, and private
  Discovery package that froze on beta.10.
- Start an active mission and connect live tracking with the full device fleet.
- Leave it online for several poll cycles and interact with the map, Devices,
  and Diagnostics.
- Expected: the app stays responsive within normal poll cadence; no 20-30 s UI
  pauses and no window-manager "Not Responding" prompt.

Capture for any failure:

- approximate time of failure,
- screenshot/photo of any window-manager prompt,
- exported diagnostics/support bundle if export succeeds,
- whether this was AppImage or `.deb`,
- whether the same user data was reused from beta.10.

## Packaged Smoke Matrix

Ubuntu smoke ran on `donal@192.168.18.31` (`donal-Precision-5570`, Ubuntu
24.04, kernel `6.17.0-35-generic`, X11 via `DISPLAY=:0`) against the CI-built
AppImage, not a local rebuild. Evidence was mirrored to
`output/beta11-ubuntu-smoke/`.

| Gate | Result | Evidence |
| --- | --- | --- |
| Tag-driven `electron-release.yml` run green | PASS | GitHub Actions run `28972979120`: gates, Linux bundle, private-map-data guard, AppImage launch smoke, draft prerelease upload, and SHA256SUMS all passed. |
| Checksum verified against `SHA256SUMS` | PASS | AppImage `c528e192afc7c6507e6167df26b217054e1824eacd62ecbcd1fca6be1c89cba6`; `.deb` `adabc02aa68c48447275ec498bc0ea00ee9672a21f0db7237eb2930622d260ca`. Verified locally and on Ubuntu. |
| Local beta verification gate | PASS with manual smoke intentionally skipped | `npm run beta:verify -- --no-smoke`: lint, build, unit `1082/1082`, backend `47 passed / 1 ignored`, Chromium E2E `129/129`, and local package passed. Manual checklist skipped because packaged smoke used the CI artifact on Ubuntu. |
| Packaged AppImage launches to normal shell | PASS | CI AppImage launch smoke plus Ubuntu `official-offline`, `bad-secret`, and core smoke screenshots. |
| Full-profile tracking/map smoke on Ubuntu | PARTIAL / non-discriminating renderer probe | `output/beta11-ubuntu-smoke/full-profile-freeze-focused/`: live tracking reached online with `33` devices / `8` fixes; main-process heartbeat stayed healthy (`p99 10 ms`, max `959 ms`, zero heartbeat errors). Renderer rAF verdict was red (`~1 s` gaps), but beta.10 under the same current Ubuntu session shows the same rAF failure (`output/beta11-ubuntu-smoke/beta10-compare-focused/`), so this is treated as an Ubuntu desktop/probe throttling artifact, not beta.11-specific evidence. |
| Official offline map package smoke | PASS | `output/beta11-ubuntu-smoke/official-offline/`: Reeks package (`31,729` tiles) loaded, inside-coverage readiness passed, outside-coverage warning shown, diagnostics exported, network blocked. |
| Diagnostics/support/incident bundle export sanitized | PASS | `output/beta11-ubuntu-smoke/diagnostics-bundles/`: diagnostics report, support bundle, and time-framed support bundle exported and passed sanitizer checks. |
| Mission lifecycle / restart / recovery / finalize / archive | PASS with legacy-script selector caveats | `output/beta11-ubuntu-smoke/core-lifecycle/`: launch, mission start, marker save, restart recovery, finish, finalize, and archive passed. The old script reports stale selector failures for coordinate and diagnostics reachability; both are covered by focused passing smokes below. |
| Coordinate rejection and Irish Grid coarse-ref behavior | PASS | `output/beta11-ubuntu-smoke/single-instance-coordinates/`: `V 80 84` resolved to `V 80500 84500`. Invalid-grid path remains covered by current automated E2E/unit gates. |
| Bad/corrupt stored credential reaches shell, not runtime fault | PASS | `output/beta11-ubuntu-smoke/bad-secret/`: app launched to shell and Settings recovery warning was shown. |
| Live Traccar connection | PASS on Ubuntu full-profile run | `output/beta11-ubuntu-smoke/full-profile-freeze-focused/`: tracking online with `33` devices / `8` fixes during the map sweep. |
| Duplicate launch / single-instance smoke | PASS | `output/beta11-ubuntu-smoke/single-instance-coordinates/`: second launch exited with code `0`, primary app stayed usable. |

## Known Limitations

- The Ubuntu smoke box uses a fast SSD and cannot reproduce the slow-disk fsync
  field freeze. Its smoke is still required as release-regression coverage.
- The current Ubuntu desktop session throttled renderer `requestAnimationFrame`
  to roughly 1 Hz during the freeze probe, even for beta.10. For this beta.11
  cut, use the main-process heartbeat, screenshots, and like-for-like beta.10
  comparison as smoke evidence; do not treat the renderer rAF verdict as proof
  of a beta.11 regression.
- The actual DON-240 fix still needs confirmation on the original slow
  PCLinuxOS tester machine/profile that exhibited the 20-30 s tracking-online
  freeze.
- Linux x86_64 only from CI for this cut. No Windows, no macOS, no ARM.
- Artifacts are unsigned. Expect normal internal-beta OS warnings.
- Auto-updater is not enabled. Each beta is a fresh download.
- High-definition mountain map packages are not bundled with this build.
- Browser hosted mode is testing/training only and is not part of this desktop beta.

## Rollback

To roll back, quit the app and reinstall beta.8 from
`electron-v0.1.0-beta.8`. Mission data lives under the per-user app data
directory and is not deleted by uninstalling the bundle. Capture diagnostics
before deleting any user data.
