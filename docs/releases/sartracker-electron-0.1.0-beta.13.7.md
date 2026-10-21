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

- **Under very heavy, long tracking load the app can briefly freeze** (up to
  about a third of a second at a time). Seen only in a 5-day accelerated test
  with 32 devices, while saving to disk late in the run; every position was
  stored exactly. It is better than 13.6 (fewer and shorter freezes, less
  memory). If it ever stops responding for more than a couple of seconds,
  export a support bundle and tell us [DON-312, DON-313].
- **A watched GPX folder is forgotten when SAR Tracker restarts** [DON-337].
  Tracks already imported stay, but new files in the folder are not picked up
  after a restart. The GPX panel then says "0 watched". **After every restart,
  add the folder again with Tools → Watch Folder.** Fix planned for 13.8.
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

Applies to: `electron-v0.1.0-beta.13.7`
Approved AppImage SHA-256: `952b4c139d62791c91e04439d2d928463ea58fbf081706d79c3026575f7c8d00`
Approved .deb SHA-256: `c06e486d1a8a5bab12eda86ea5503cb9d972a1de9e35c52f6b436291342e6cbe`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| Packaged soak | FAIL | Ship with known issue | Under very heavy, long tracking load (5-day accelerated, 32 devices) the app froze briefly (up to 353 ms, 25 times late in the second launch, during disk commits) and peaked at 2.147 GB, just within the 2 GiB budget; every position was stored exactly. Better than 13.6 on every measure. Known issue in this note: if it stops responding for more than a couple of seconds, export a support bundle and report. | Donal | Claude Code session, 21 Oct 2026: approved "Ship with known issue" for these exact artifact digests after the draft-asset smoke | DON-312, DON-313 (13.8) |

## Release checklist results

Run on 21 Oct 2026 on the Ubuntu test box against the exact CI artifacts from
run 39563099270 (installed draft .deb), team-smoke tool commit 981e17cd. Every
run used `--ignore-gpu-blocklist` (test-box accommodation, DON-288), except
`no-gpu-flag`. Results: PASS, FAIL, NOT TESTED, or NOT APPLICABLE (offline map
package only).

| Check | Result | Evidence |
| --- | --- | --- |
| CI release run | PASS | [run 39563099270](https://github.com/donal0c/sartracker-web/actions/runs/39563099270) on tag commit 981e17cd: Gates (lint, correctness, strict responsiveness, build, Chromium E2E), Bundle (incl. packaged soak), AppImage launch smoke and draft prerelease green on attempt 2. Attempt 1 failed one strict-timing test (DON-274 50k-point GPX import: one 376 ms write using 4 ms CPU, a runner I/O stall); re-run on the same tag, no rebuild. |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.7_linux_x86_64.AppImage` `952b4c139d62791c91e04439d2d928463ea58fbf081706d79c3026575f7c8d00`; matches SHA256SUMS, the CI artifact `electron-linux-artifacts` of run 39563099270 and GitHub's digest for the draft asset (checked 21 Oct). [team-smoke identity-appimage] |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.7_linux_amd64.deb` `c06e486d1a8a5bab12eda86ea5503cb9d972a1de9e35c52f6b436291342e6cbe`; matches SHA256SUMS, the CI artifact `electron-linux-artifacts` of run 39563099270 and GitHub's digest for the draft asset (checked 21 Oct). [team-smoke identity-deb] |
| Installed .deb payload | PASS | sartracker-web 0.1.0~beta.13.7 installed; dpkg -V clean; 140/140 payload files byte-identical. [team-smoke installed-payload] |
| Startup with bad stored credential | PASS | Reached the shell; tracking disabled with the re-enter-password warning. [team-smoke bad-credential] |
| Corrupt or newer database refused | PASS | Newer schema: refused with "SAR Tracker could not start Cannot open mission store created by newer mission store schema 99; this build supports sch"; mission-store.sqlite byte-identical. Corrupt database: refused with "SAR Tracker could not start SAR Tracker could not open its operational data safely."; mission-store.sqlite byte-identical [team-smoke database-refusal] |
| Unwritable profile shows an error | PASS | Visible error shown for the unwritable profile. [team-smoke unwritable-profile] |
| Duplicate launch | PASS | Second instance exited (code 0) without a window; first kept its ACTIVE mission. [team-smoke duplicate-launch] |
| Upgrade from the team's current release | PASS | Previous-release profile opened; missions, markers, drawings and fixes row-for-row equal (counts [2,2,36]); active mission held paused for Resume (active→paused). Check the coverage panel of any carried-over active mission by eye. [team-smoke upgrade] |
| Mission lifecycle and crash recovery | PASS | On a lived-in profile (finished mission with layer-tracking-breadcrumbs, group-map-tools, group-gpx-tracks hidden, basemap MAPS ESRI World Topo v): pause, SIGKILL, renderer crash and graceful quit; 123 fixes, walkers gap-free {"1":{"expectedFirst":4,"first":4,"last":44,"missing":[]},"2":{"expectedFirst":4,"first":4,"last":44,"missing":[]}}; walkers recorded live after start and after each relaunch; pause state preserved; graceful quit not reported as a crash; evidence health stayed healthy after each. Window X close: check by hand. [team-smoke lifecycle]; After a renderer crash and a SIGKILL with an empty Admin Roster, Archive & Lock completed; no evidence-loss acknowledgement was required [DON-281]. [team-smoke crash-archive] By hand (Donal at the box, Claude checking over CDP, 21 Oct, installed draft .deb): window-X close, then relaunch read `uncleanShutdown: false`, no evidence warning, and the Resume prompt for the active mission; after Resume all 4 GPX tracks were listed and on the map. |
| Tracking matches provider exactly | PASS | On a lived-in profile (finished mission with layer-tracking-breadcrumbs, group-map-tools, group-gpx-tracks hidden, basemap MAPS ESRI World Topo v): 60 stored fixes, 0 differ from provider coordinates/time; walkers contiguous ({"1":{"expectedFirst":4,"first":4,"last":18,"missing":[]},"2":{"expectedFirst":4,"first":4,"last":18,"missing":[]}}). 4 markers each within 30 s of their newest stored fix, including a road-speed vehicle (about 50 m between fixes) after its history refresh. 48 h lookback (start 2026-10-19T09:09:35.315Z): during a history outage all 3 participant rows showed they were still waiting for history; after recovery 2554 stored fixes equal the provider, 0 before start (1 s boundary band), unselected device absent, pre-selected and late "From mission start" devices complete {"11":{"stored":842,"expected":842,"first":"2026-10-19T09:09:36.000Z"},"12":{"stored":870,"expected":866,"first":"2026-10-19T09:09:36.000Z"},"14":{"stored":842,"expected":842,"first":"2026-10-19T09:09:36.000Z"}}; shown in the device list; 5 further fixes after restart with all earlier rows preserved. [team-smoke tracking]; Walkers kept recording live (within 6 fixes of the provider) while the devices layer was hidden, the breadcrumbs layer was hidden, the whole Tracking group was hidden, Focus Mode was on, the Devices workspace was open, Review was open, Replay was showing, the basemap was switched; 225 fixes, walkers gap-free {"1":{"expectedFirst":2,"first":2,"last":76,"missing":[]},"2":{"expectedFirst":2,"first":2,"last":76,"missing":[]}}. [team-smoke controls] |
| Provider outage warning and backfill | PASS | While Walker Alpha had no signal for 75 s, Walker Bravo kept recording live and Alpha's held fixes arrived on release, before the outage. During the 90 s outage the tracking status showed "OFFLINE MODE — showing last known positions. / OFFLINE FIX 3 STALE 0 / ⚠ Disconnected · retrying Last success: 10/21/2026, 10:33:51 AM OFFLINE MODE — showing la"; after reconnect 84 fixes, walkers gap-free {"1":{"expectedFirst":2,"first":2,"last":29,"missing":[]},"2":{"expectedFirst":2,"first":2,"last":29,"missing":[]}}. [team-smoke outage] |
| Live Traccar | PASS | 7983/7983 provider positions for the approved device stored exactly (0 uploaded late; 0 received during the check too recently to be due) (48 h roll back, device added after Start with "Mission start", 7 min live); provider read with GET only. [team-smoke live-traccar] |
| Coordinate conversion and rejection | PASS | DD↔IG round trip (Q 99842 04015); pasted DD pair → V 80009 85011; DMS pair → Q 99842 04015; V 80 84 → V 80500 84500; rejected latitude 95, "I 12345 67890", "hello", "V 1234 567". [team-smoke coordinates] |
| Markers, attachments and GPX import | PASS | On a lived-in profile (finished mission with layer-tracking-breadcrumbs, group-map-tools, group-gpx-tracks hidden, basemap MAPS ESRI World Topo v): 2 markers stored; photo attachment stored byte-identical; GPX (30 timed points) imported via the app's import bridge, drawn after a relaunch and after a basemap switch; hidden in Layers it was described as hidden and "Show on map" drew it again. Not automated: the draw straight after Import Files or a watched-folder scan (the bridge import bypasses the renderer's GPX runtime) and the native file picker; check both by hand. [team-smoke markers-gpx] By hand (Donal at the box, Claude checking over CDP, 21 Oct, installed draft .deb): Import Files through the native picker drew the track at once; Watch Folder imported its new files at once (a byte-identical copy of an imported track was skipped); a new file in the watched folder appeared on Rescan Watches (4 listed, 4 on map), no relaunch. Found: the watched folder is not remembered after a restart ("0 watched"); not a 13.7 change, [DON-337](https://linear.app/donal-oc/issue/DON-337). |
| Replay, basemaps and layers | PASS | On a lived-in profile (finished mission with layer-tracking-breadcrumbs, group-map-tools, group-gpx-tracks hidden, basemap MAPS ESRI World Topo v): replay reconstructed state 1 min back; live mission stayed ACTIVE; basemaps ESRI Satellite, OpenStreetMap, ESRI World Topo, OpenTopoMap selected (review screenshots for tiles). [team-smoke replay-basemaps]; WebGL unavailable without the flag; the operator saw the message, Restart with software rendering relaunched the app, the map loaded after 2 s (20 tiles loaded, 0 errored), and the choice was remembered. [team-smoke no-gpu-flag] Screenshots reviewed by Claude (21 Oct): ESRI Satellite, ESRI World Topo, OpenStreetMap and OpenTopoMap tiles rendered; replay reconstruction shown; without the GPU flag the WebGL message and button, then the drawn map after the software-rendering restart. |
| Encrypted archive create and reopen | PASS | Finished, archived with passphrase and recovery code, restarted, reopened read-only; wrong passphrase refused. [team-smoke archive]; Graceful quit during finalize, on-click finalized during shutdown (quit on the click, exited in 6799 ms); after-admission finalized during shutdown (quit 4 ms after admission, exited in 7189 ms): no false archive-failed audit, no custody recovery, intact backup mirror and no backup temporaries after each quit; relaunch reported no crash; nothing left staged or fenced; each archive reopened with its passphrase. [team-smoke quit-during-finalize] |
| Settings, secrets and support bundle | PASS | Provider settings persisted; secret field empty after restart; support bundle support-bundle-2026-10-21T09-43-44-489Z.txt has no secret, home path or username. [team-smoke settings-support] |
| Team mission scenario | PASS | 9791 fixes across 19 selected devices equal the provider from each device's start (48 h lookback; group + device before Start; group, history-only device and late "Now" device after Start); unselected groups absent; backfill of 5 participant rows complete in 10 s; 49 late-uploaded fixes (5 h to 1 h old) all stored 290 s after upload (sampled every 5 s); diagnostics report kept the pre-Start events (24 breadcrumbs over 4 min; tracking_status_changed 14 (58%); 11 record suppressed repeats); replay at start+24 h read 0 records (open question DON-293); overnight quit and next-day resume; outage shown "OFFLINE MODE — showing last known positions. / OFFLINE FIX 19 STALE 3 / ⚠ Discon"; Measure works after relaunch; stationary and stale indicators shown; casualty required fields enforced; two-stage delete; search area, timed and untimed GPX stored; replay into the backfilled window; archive reopened with the recovery code. [team-smoke team-mission]; Groups created in Traccar after launch: Miscellaneous listed by mission setup without a restart; both it and Search Support (created mid-mission) listed by Add group; adding Miscellaneous enrolled only its device (Misc Alpha) while KMRT Hasty kept recording. [team-smoke team-group-refresh]; SAR-QA-025 replay: one blank KMRT roster recorded no "left" and no notice; 4216 KMRT fixes equal the provider from the 48 h mission start; KMRT pre-ticked as the team default and started with the 48 h roll back; history complete in 10 s; coordinates converted; casualty stored; Focus Mode; OpenTopoMap and satellite selected; tracking "Telemetry stream healthy / ONLINE FIX 8 STALE 1 / ⚠ Tracking connected · 1 stale". [team-smoke team-workflow] Screenshots reviewed by Claude (21 Oct): both groups' tracks, stationary and stale indicators, casualty marker, search area, outage banner, measure after relaunch, archive reopened with the recovery code; the clue marker is deleted by the scenario (two-step delete). Replay at the earlier day read 0 records: known issue DON-293. By hand (Donal at the box, Claude checking over CDP, 21 Oct, installed draft .deb): F11 with Focus Mode went full screen and back. |
| Large mission opens responsive | PASS | 960k-fix mission (copy of the 13.6-opened profile) on the installed draft: shell 2.4 s, mission ACTIVE 5.5 s, Settings opened in 103/50/71 ms, renderer timer gaps p99 0.5 ms, max 0.5 ms (13.6: 2.1 s, 5.3 s, 175/32/24 ms). |
| Packaged soak | FAIL | CI packaged soak (CI profile) green in [run 39563099270](https://github.com/donal0c/sartracker-web/actions/runs/39563099270). Installed soak on the draft .deb on the box (normal profile, 5-day accelerated, 32 devices, 21 Oct): 691,224/691,224 positions stored exactly, integrity ok, 2/2 archive cycles. Failed limits: independent main-loop maximum 353 ms on launch 2 (25 gaps over 200 ms, all on launch 2 between 571 and 739 s; launch 1 maximum 120 ms, 0 over 200 ms); main-process maximum 258 ms (5 of 23,033 samples over 200 ms, p99 55 ms); renderer 21 of 51,862 over 250 ms (max 384 ms, p99 67 ms). Stalls are low-CPU and match `storage_slow_write` entries whose cost is the commit (150–232 ms commit, ≤20 ms body). Process-tree peak 2,146,951,168 bytes, within the 2 GiB budget by about 0.5 MB. 13.6 on the same box: 59 main-loop gaps over 200 ms (max 516 ms), peak 2.27 GB [DON-312, DON-313]. |
| Strict responsiveness (<200 ms) | PASS | "Strict responsiveness qualification (<200 ms)" step green in [run 39563099270](https://github.com/donal0c/sartracker-web/actions/runs/39563099270) (attempt 2; attempt 1 failure recorded under CI release run). |
| Offline map package | PASS | Team package sha256 e317fd016b02d88f… imported offline and verified ready (z9–16, 31729 tiles); Discovery Topo selected; still ready and still the map after restart. [team-smoke offline-map] Discovery Topo tiles rendered before and after restart (screenshots reviewed by Claude, 21 Oct). |
