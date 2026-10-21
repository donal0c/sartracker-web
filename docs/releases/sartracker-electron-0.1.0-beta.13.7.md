# SAR Tracker Electron 0.1.0-beta.13.7 — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64,
> unsigned, no auto-update. Supersedes beta.13.6.

## ⚠ Read first

- **A team created in Traccar after you started the app now appears** at
  mission setup and in **Add participant → Traccar group**, without
  restarting. Seán reported this on 13.5 [DON-330].
- **The position marker no longer lags behind the trail.** It is drawn at the
  newest known position, and the device list and readouts show the same
  position [DON-328].

## Before you upgrade

1. Finish any active mission in 13.6 first, as usual.
2. Copy your profile folder (`~/.config/sartracker-web`) if you might roll
   back. 13.7 does not change the mission database version.
3. Install:
   - **AppImage** (PCLinuxOS and other systems): quit 13.6, replace the old
     AppImage file with
     `sartracker-electron-validation_0.1.0-beta.13.7_linux_x86_64.AppImage`,
     make it executable (right-click → Properties → Permissions, or
     `chmod +x`), and start it the way you started 13.6.
   - **.deb** (Ubuntu/Debian):
     `sudo apt install ./sartracker-electron-validation_0.1.0-beta.13.7_linux_amd64.deb`

Verify downloads first: `sha256sum -c SHA256SUMS --ignore-missing` must say
**OK** for each file you downloaded. The AppImage may need `libfuse2`
(`libfuse2t64` on Ubuntu 24.04) and, on Ubuntu, `--no-sandbox`.

## What's new

- **New Traccar groups appear without a restart** [DON-330]. Mission setup
  and Add participant re-read the groups each time; you see "Refreshing
  Traccar groups…". If the read fails, a message with **Retry** appears and
  the list you had stays. Refreshing never ticks anyone for you.
- **Marker at the newest position** [DON-328]: the marker, device list and
  readouts all use the newest known fix, so the trail never runs ahead.
- **Clearer warnings** [DON-327]: tracking warnings carry the reason from
  where the problem started, so a support bundle says what went wrong.
- **History coverage under heavy tracking** [DON-325, DON-334, DON-335]:
  checks retry every 30 seconds without filling the log. If the history still
  has not been verified after about five minutes, a **Coverage overlay may be
  missing or stale** warning appears on the map and clears by itself once it
  is verified.
- **Map warning stays visible** [DON-264]: if a map cannot be applied, the
  "Choose another basemap" warning is no longer hidden by later tile errors.
- **Backups and quitting** [DON-329, DON-331, DON-333]: quitting waits for a
  backup copy that is already running. If a backup is still running when the
  app closes, you see **SAR Tracker is finishing a backup** (or **is still
  closing**). Press OK and wait; it closes by itself. Do not start it again
  until it has closed. If it is still running after 10 minutes, restart the
  computer; the mission reopens normally.
- **Fewer pauses under heavy tracking** [DON-312, DON-313, DON-240]: less
  memory churn per position, history catch-ups and restart snapshots saved in
  smaller steps, and the backup copy is made in one step so constant new
  positions can no longer make it restart over and over.
- **Support bundles keep the evidence** [DON-336]: routine tracking entries
  no longer push earlier warnings out of the log; the bundle carries up to
  500 earlier warnings and errors, and slow saves are logged.

## Please test

1. **New group:** with SAR Tracker open, create a group in Traccar, then
   start a mission or use **Add participant → Traccar group**. The new group
   should be listed without restarting.
2. **Marker and trail:** while a device is moving (a car is easiest), the
   marker should sit at the end of its trail.
3. **Quit during a long mission:** quit with the window X. It should close
   by itself, possibly after a "finishing a backup" message. Do not relaunch
   until the window has gone.
4. **Long missions:** tell us if the app ever stops responding for more than
   a couple of seconds, and send a support bundle.
5. Report problems with a support bundle (Diagnostics → Export Support Bundle).

## Known issues

- **Replay does not show history at times before it was fetched**
  [DON-293]: history brought in by the Start Offset, or by adding a device
  with "Mission start", appears in Replay only from the moment it was fetched.
- **Quitting can take 10–15 seconds**, longer if a backup is running (see
  above). Wait for the window to close before relaunching.
- **Hidden GPX tracks:** we still need the affected GPX files to find why
  some 13.5 imports were hidden; each track says whether it is on the map and
  why [DON-319].
- AppImage on Ubuntu may need `--no-sandbox`.

## Rollback

Quit the app, remove it (`sudo apt remove sartracker-electron-validation`, or
delete the AppImage) and reinstall 13.6. 13.7 uses the same mission database
version as 13.6; if 13.6 refuses the profile, restore the copy you made before
upgrading. Never delete mission data; capture diagnostics first.

## Regression provenance

- Classification: Regression correction
- Linear issue: [DON-336](https://linear.app/donal-oc/issue/DON-336)
- Affected release(s): 0.1.0-beta.12 through 0.1.0-beta.13.6
- Last known good: unknown — before beta.12 the runtime log did not carry the
  storage incident evidence this regression evicts
- First known bad: 0.1.0-beta.12 (per-write `storage_tracking_positions_completed`
  info entries added in 74cbdea2, DON-244)
- Root cause: one info entry per tracking write filled the 1 MB runtime log
  in about 20 s under a 32-device normal profile, and the support bundle read
  only the last 1,000 lines (about 4 s), so a freeze minutes earlier left no
  evidence in the bundle.
- Escape analysis: support-bundle tests used small logs; no test ran a
  realistic tracking event rate and asked whether an earlier warning survived.
- Before/after evidence: before, a 3.5-minute packaged soak launch kept only
  its last ~23 s in the log and lost a 2.4 s freeze from 13 s in (18 Oct);
  after, the whole packaged soak run fit in 128 KB and every stall ≥150 ms
  matched a `storage_slow_write` entry (PR #61, 18 Oct).
- Regression gate: diagnostics regression running two simulated hours with a
  soak-rate minute, asserting a warning from the start is still in the support
  read (fails on the pre-fix diagnostics).
- Remaining uncertainty: field incident windows longer than the simulated two
  hours are not yet exercised.

Team reports also corrected here: DON-330 (Seán, 13.5), with its escape note
and packaged `team-group-refresh` check on the issue.

## Owner-approved exceptions

Filled after the draft-asset smoke: one row per FAIL or NOT TESTED check
below, with the approved artifact digests. Delete this section if every row
passes.

Applies to: `electron-v0.1.0-beta.13.7`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |

## Release checklist results

Run on TODO against the exact CI artifacts from run TODO, team-smoke tool
commit TODO. Results: PASS, FAIL, NOT TESTED, or NOT APPLICABLE (offline map
package only).

| Check | Result | Evidence |
| --- | --- | --- |
| CI release run | TODO | TODO |
| AppImage SHA-256 | TODO | TODO |
| .deb SHA-256 | TODO | TODO |
| Installed .deb payload | TODO | TODO |
| Startup with bad stored credential | TODO | TODO |
| Corrupt or newer database refused | TODO | TODO |
| Unwritable profile shows an error | TODO | TODO |
| Duplicate launch | TODO | TODO |
| Upgrade from the team's current release | TODO | TODO |
| Mission lifecycle and crash recovery | TODO | TODO |
| Tracking matches provider exactly | TODO | TODO |
| Provider outage warning and backfill | TODO | TODO |
| Live Traccar | TODO | TODO |
| Coordinate conversion and rejection | TODO | TODO |
| Markers, attachments and GPX import | TODO | TODO |
| Replay, basemaps and layers | TODO | TODO |
| Encrypted archive create and reopen | TODO | TODO |
| Settings, secrets and support bundle | TODO | TODO |
| Team mission scenario | TODO | TODO |
| Large mission opens responsive | TODO | TODO |
| Packaged soak | TODO | TODO |
| Strict responsiveness (<200 ms) | TODO | TODO |
| Offline map package | TODO | TODO |
