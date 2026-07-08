# SAR Tracker Electron Desktop Beta 0.1.0-beta.11 (DON-240 fsync-storm fix)

> **Internal beta only.** Not a production release. Use for DON-240 field retest
> and smoke validation before any wider team rollout.

- **Version:** 0.1.0-beta.11
- **Build tag:** `electron-v0.1.0-beta.11`
- **Cut date (UTC):** 2026-07-08
- **Cut by:** Codex agent (Donal supervising)
- **Supersedes:** `electron-v0.1.0-beta.10` (**HOLD for field freeze**)
- **Linear reference:** `DON-240`
- **Verification report:** local gates, GitHub Actions release run, and Ubuntu packaged smoke pending.
- **CI run:** TODO after tag-driven `.github/workflows/electron-release.yml` completes.
- **GitHub release:** draft prerelease until packaged smoke is recorded.

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

The GitHub release must remain a draft until this matrix is complete.

| Gate | Result | Evidence |
| --- | --- | --- |
| Tag-driven `electron-release.yml` run green | TODO | TODO |
| Checksum verified against `SHA256SUMS` | TODO | TODO |
| Packaged AppImage launches to normal shell | TODO | TODO |
| Full-profile tracking/map smoke on Ubuntu | TODO | TODO |
| Official offline map package smoke | TODO | TODO |
| Diagnostics/support/incident bundle export sanitized | TODO | TODO |
| Mission lifecycle / restart / recovery / finalize / archive | TODO | TODO |
| Coordinate rejection and Irish Grid coarse-ref behavior | TODO | TODO |
| Bad/corrupt stored credential reaches shell, not runtime fault | TODO | TODO |
| Live Traccar connection | TODO | TODO |
| Duplicate launch / single-instance smoke | TODO | TODO |

## Known Limitations

- The Ubuntu smoke box uses a fast SSD and cannot reproduce the slow-disk fsync
  field freeze. Its smoke is still required as release-regression coverage.
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
