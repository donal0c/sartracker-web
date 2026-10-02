# SAR Tracker Electron 0.1.0-beta.13.6 — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64,
> unsigned, no auto-update. Supersedes beta.13.5.

## ⚠ Read first

- **Upgrading is one-way.** 13.6 updates the mission database so a restored
  GPX track replays truthfully. Once 13.6 opens your profile, 13.5 refuses
  it. **Copy `~/.config/sartracker-web` before the first 13.6 start** if you
  might go back [DON-309].
- **The false "EVIDENCE HEALTH CRITICAL — evidence was lost" block is fixed.**
  In 13.5 it could appear after any unexpected close, even with nothing lost,
  and it blocked Finish and Archive. 13.6 shows it only when unsaved evidence
  was really held [DON-318].
- **A team no longer drops out when Traccar briefly lists its group empty.**
  In 13.5 every member was dropped at once: off the map, not recorded, with a
  "left" notice each. 13.6 waits for a second complete roster to agree and
  meanwhile shows one notice that the group is still tracked. Checked on our
  test machine: one blank roster, no false leave, no lost positions [DON-300].
- **Discovery stays your map after a restart**, in the live map and in
  Replay [DON-304, DON-314].

## Before you upgrade

1. Finish any active mission in 13.5 first, as usual.
2. **Copy your profile folder (`~/.config/sartracker-web`).** This copy is
   the only way back to 13.5.
3. Install:
   - **AppImage** (PCLinuxOS and other systems): quit 13.5, replace the old
     AppImage file on your desktop with
     `sartracker-electron-validation_0.1.0-beta.13.6_linux_x86_64.AppImage`,
     make it executable (right-click → Properties → Permissions, or
     `chmod +x`), and start it the way you started 13.5.
   - **.deb** (Ubuntu/Debian):
     `sudo apt install ./sartracker-electron-validation_0.1.0-beta.13.6_linux_amd64.deb`

Verify downloads first: `sha256sum -c SHA256SUMS --ignore-missing` must say
**OK** for each file you downloaded. The AppImage may need `libfuse2`
(`libfuse2t64` on Ubuntu 24.04) and, on Ubuntu, `--no-sandbox`.

Archives made by 13.6 open only in 13.6 or later. Archives made by 13.5 still
open in 13.6.

## What's new

- **No false "evidence lost" block** [DON-318]. When the app cannot tell
  whether anything was held, it still blocks, and says the evidence "may have
  been lost when the app closed unexpectedly".
- **A group member leaves only when two complete Traccar rosters agree**
  [DON-300].
- **Discovery is remembered after a restart, and Replay uses it** [DON-304,
  DON-314]. If it cannot open, the app stays on OpenTopoMap and says why.
- **No graphics, no black window** [DON-288]. When the computer cannot draw
  the map, the map area says so and everything else stays usable. **Restart
  with software rendering** works on most machines and is remembered.
- **"Unexpected shutdown" only after a real one** [DON-284]. A normal quit,
  including the window X, no longer reports a crash.
- **An unwritable profile folder now explains itself** [DON-285]: "SAR Tracker
  could not start", naming the folder and what to do. 13.5 exited silently.
- **Bring back a retired GPX track** by importing the same file again with
  **Import Files** [DON-309]. It returns with its colour and name; Review
  records the restore; Replay keeps it hidden for the time it was retired.
- **Imported GPX tracks say whether they are on the map** [DON-319]: **On
  map** or **Hidden on map** with the reason, and a **Show on map** button. If
  a 13.5 import was not visible, press Show on map.
- **A watched GPX folder stops repeating itself** [DON-320, DON-322]: a
  retired file is skipped quietly, a broken file is reported once.
- **Diagnostics reports cover much more time** [DON-321]. Routine tracking
  entries no longer push out the ones that matter, a history catch-up is one
  entry instead of dozens, and reports no longer contain device names.
- **The team's default group is ticked at Start** [DON-296]. Set it once in
  **Settings → Mission Defaults → Team default group**; untick it for a
  mission if needed.
- **Mission Control folds Participants and Outings during a mission**
  [DON-300], so the Tracking, Tools and Layers tabs have room. Timers and
  Pause/Finish always show. **Show** opens a section; one that needs you
  stays open and says **Needs attention**. Press **Show** on Outings before
  starting an outing.
- **Live trails keep moving during a big history catch-up** [DON-311], and
  history is saved in smaller steps to cut pauses [DON-313].
- Smaller fixes: tidier top bar and Diagnostics panel, clearer Devices search
  and Search Area hints [DON-300]; the operator manual (Help) is rewritten
  with current screenshots [DON-301].

## Please test

**First, on your own machine (we test on Ubuntu, you run PCLinuxOS):** copy
your profile folder, start the new AppImage the way you normally do, and
confirm your missions and archives are there. If anything fails, tell us what
you saw; a photo of the screen is enough.

1. **Discovery after a restart:** choose **Maps → Discovery Topo**, quit,
   restart with Wi-Fi off. Discovery should be the map, in Replay too.
2. **Quit and restart** with the window X: no "unexpected shutdown" and no
   evidence block. If you ever see the red evidence banner, send us a support
   bundle.
3. **GPX:** import a track, retire it, import the same file again; it should
   come back. Every track in Imported Tracks should say **On map** (or why
   not).
4. **Mission Control during a mission:** Pause/Finish and timers always
   visible; Participants and Outings open with **Show**.
5. **Team default group:** set it in Settings and confirm it is ticked at
   Start.
6. Report problems with a support bundle (Diagnostics → Export Support Bundle).

## Known issues

- **Upgrading is one-way** (above): keep your pre-13.6 profile copy if you
  might roll back [DON-309].
- **At road speed the trail can briefly run ahead of the position marker.**
  The marker catches up on the next update (within 30 seconds); nothing is
  lost. On foot the difference is a few metres. Fix planned for 13.7
  [DON-328].
- **Replay does not show history at times before it was fetched.** History
  brought in by the Start Offset, or by adding a device with "Mission start",
  appears in Replay only from the moment it was fetched. Whether it should
  appear earlier is an open question for the team [DON-293].
- **Under very heavy, long tracking load the app can briefly freeze** (up to
  half a second at a time) and use over 2 GB of memory. Seen only in a
  5-day accelerated test with 100 devices; every position was stored exactly.
  If it ever stops responding for more than a couple of seconds, export a
  support bundle and tell us. Planned for 13.7 [DON-312, DON-313].
- **Quitting during a backup can leave one backup log line missing.** The
  backup copy itself is always complete; no data is affected [DON-329].
- **Quitting can take 10–15 seconds.** Wait for the window to close before
  relaunching.
- **Hidden GPX tracks:** we still need the affected GPX files to find why
  some 13.5 imports were hidden; 13.6 shows whether each track is drawn and
  why [DON-319].
- AppImage on Ubuntu may need `--no-sandbox`.

## Rollback

Quit the app, remove it (`sudo apt remove sartracker-electron-validation`, or
delete the AppImage) and reinstall the previous release. **13.5 refuses a
profile opened in 13.6: restore the profile copy you made before upgrading.**
Missions recorded in 13.6 after that copy stay in the 13.6 profile; keep it.
Never delete mission data; capture diagnostics first.

## Regression provenance

- Classification: Regression correction
- Linear issue: [DON-284](https://linear.app/donal-oc/issue/DON-284)
- Affected release(s): 0.1.0-beta.13.4 and 0.1.0-beta.13.5 (13.5 shipped it as a known issue)
- Last known good: unknown — Linear records no release where a clean quit was reported correctly
- First known bad: 0.1.0-beta.13.4 (reproduced on its unchanged source a273ae6d, 28 Sep 2026)
- Root cause: the crash-recovery read re-ran the unclean-shutdown check after
  this session's own start marker was written, so every running session
  reported an unexpected shutdown; the quit path itself left the clean-exit
  record correctly.
- Escape analysis: unit tests covered the unclean-shutdown check alone, never
  the read made after this session's marker existed; no smoke asserted the
  next launch after a clean quit.
- Before/after evidence: before, a SIGTERM quit on 13.4 was reported as
  unexpected (team-smoke tool 7173c301); after, on the 13.6 pre-tag build
  (e7a7a0f8) on the Ubuntu test box, team-smoke `lifecycle` read a graceful
  quit as clean, and a window-X close by hand showed no unexpected-shutdown
  report or evidence block (2 Oct 2026).
- Regression gate: `electron-main-startup.test.ts` (DON-284 cases over clean
  and unclean previous sessions read through the IPC),
  `diagnostics-crash-notice.test.tsx`, and team-smoke `lifecycle` (graceful
  quit, then the next launch must not report a crash).
- Remaining uncertainty: the window-X close cannot be driven by the smoke
  tool on Linux and stays a hand check; PCLinuxOS is not yet tested (DON-298).

Team reports also corrected here, not labelled Regression in Linear: DON-318,
DON-319, DON-320, DON-321 and DON-300 item 8; each carries its escape note and
regression check on its issue.

## Owner-approved exceptions

Applies to: `electron-v0.1.0-beta.13.6`
Approved AppImage SHA-256: `38568d4f26665fba9437b3654abdbaed64fd8d292579df1988a33580b0eb2b0a`
Approved .deb SHA-256: `907b1129a48c4196396d6959a13493deea7f699f1ae01e2da830612001df0010`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| Packaged soak | FAIL | Ship with known issue | Under very heavy, long tracking load (5-day accelerated, 100 devices) the app froze briefly (up to 0.5 s, rare) and used 2.27 GB; every position was stored exactly. Known issue in this note: if it stops responding for more than a couple of seconds, export a support bundle and report. | Donal | Claude Code session, 2 Oct 2026: approved "Ship with known issue" for these exact artifact digests after the draft-asset smoke | DON-312, DON-313 (13.7) |

## Release checklist results

Run on 2 Oct 2026 on the Ubuntu test box against the exact CI artifacts from
run 37011458608 (installed draft .deb), team-smoke tool commit e7a7a0f8. Every
run used `--ignore-gpu-blocklist` (test-box accommodation, DON-288), except
`no-gpu-flag`. Results: PASS, FAIL, NOT TESTED, or NOT APPLICABLE (offline map
package only).

| Check | Result | Evidence |
| --- | --- | --- |
| CI release run | PASS | [Run 37011458608](https://github.com/donal0c/sartracker-web/actions/runs/37011458608) on tag commit 01c43873: Gates (lint, correctness, strict responsiveness, build, Chromium E2E), Bundle (incl. packaged soak), AppImage launch smoke and draft prerelease all green. |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.6_linux_x86_64.AppImage` `38568d4f26665fba9437b3654abdbaed64fd8d292579df1988a33580b0eb2b0a`; matches SHA256SUMS, the CI artifact and GitHub's digest for the draft asset (checked 2 Oct). [team-smoke identity-appimage] |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.6_linux_amd64.deb` `907b1129a48c4196396d6959a13493deea7f699f1ae01e2da830612001df0010`; matches SHA256SUMS, the CI artifact and GitHub's digest for the draft asset (checked 2 Oct). [team-smoke identity-deb] |
| Installed .deb payload | PASS | sartracker-web 0.1.0~beta.13.6 installed; dpkg -V clean; 140/140 payload files byte-identical. [team-smoke installed-payload] |
| Startup with bad stored credential | PASS | Reached the shell; tracking disabled with the re-enter-password warning. [team-smoke bad-credential] |
| Corrupt or newer database refused | PASS | Newer schema (99) and a corrupt database each refused with "SAR Tracker could not start" and a reason; mission-store.sqlite byte-identical both times. [team-smoke database-refusal] |
| Unwritable profile shows an error | PASS | Visible error shown for the unwritable profile. [team-smoke unwritable-profile] |
| Duplicate launch | PASS | Second instance exited (code 0) without a window; first kept its ACTIVE mission. [team-smoke duplicate-launch] |
| Upgrade from the team's current release | PASS | Profile made by installed 13.5 (finished + active mission) opened; missions, markers, drawings and fixes row-for-row equal (counts [2,2,36]); active mission held paused for Resume. [team-smoke upgrade] |
| Mission lifecycle and crash recovery | PASS | Pause, SIGKILL, renderer crash and graceful quit: 123 fixes, walkers gap-free, recording live after each relaunch, pause preserved, graceful quit not reported as a crash, evidence health healthy [team-smoke lifecycle]. After a renderer crash and SIGKILL with an empty Admin Roster, Archive & Lock completed with no evidence-loss acknowledgement [team-smoke crash-archive]. By hand (Donal at the box, Claude checking over CDP, 2 Oct, installed draft .deb): window-X close, then relaunch showed no unexpected-shutdown report (uncleanShutdown false), no evidence warning, mission held paused with the Resume prompt. |
| Tracking matches provider exactly | PASS | 27 fixes, 0 differ from the provider; 48 h lookback: every participant row showed it was still waiting for history during a history outage, then 2,554 fixes equal the provider, 0 stored before start, unselected device absent, late "From mission start" device complete, rows kept after restart. Controls: walkers kept recording live with layers hidden, Focus Mode, Devices, Review and Replay open and the basemap switched (225 fixes, gap-free). [team-smoke tracking, controls] |
| Provider outage warning and backfill | PASS | 90 s outage shown as OFFLINE MODE with last known positions; 84 fixes after reconnect, walkers gap-free; a 75 s single-device signal loss delivered its held fixes on release. [team-smoke outage] |
| Live Traccar | PASS | 8,714/8,714 provider positions for the approved device stored exactly (48 h roll back, device added after Start with "Mission start", 7 min live); provider read with GET only. [team-smoke live-traccar] |
| Coordinate conversion and rejection | PASS | DD↔IG round trip; pasted DD and DMS pairs and a short grid reference converted; latitude 95, "I 12345 67890", "hello" and "V 1234 567" rejected. [team-smoke coordinates] |
| Markers, attachments and GPX import | PASS | 2 markers stored; photo attachment byte-identical; 30-point timed GPX drawn after a relaunch and a basemap switch; hidden track described and redrawn by Show on map [team-smoke markers-gpx]. By hand (Donal at the box, Claude checking over CDP, 2 Oct, installed draft .deb): Import Files through the native picker drew the track at once; Watch Folder imported its files and drew them at once; a new file in the watched folder appeared on Rescan Watches (3 listed, 3 on map, 3 drawn), no relaunch [DON-319]. |
| Replay, basemaps and layers | PASS | Replay reconstructed state 1 min back while the live mission stayed ACTIVE; ESRI Satellite, OpenStreetMap, ESRI World Topo and OpenTopoMap tiles rendered (screenshots reviewed by Claude, 2 Oct). Without the GPU flag the map area showed the WebGL message and button; Restart with software rendering drew the map in 2 s and was remembered (screenshots reviewed). [team-smoke replay-basemaps, no-gpu-flag] |
| Encrypted archive create and reopen | PASS | Finished, archived with passphrase and recovery code, restarted, reopened read-only; wrong passphrase refused. [team-smoke archive] |
| Settings, secrets and support bundle | PASS | Provider settings persisted; secret field empty after restart; support bundle has no secret, home path or username. [team-smoke settings-support] |
| Team mission scenario | PASS | SAR-QA-025 replay: one blank KMRT roster recorded no "left" [DON-300 item 8]; 4,216 KMRT fixes equal the provider from the 48 h start; default group pre-ticked; Discovery, OpenTopoMap and satellite tiles, casualty marker and KMRT tracks seen in its screenshots [team-smoke team-workflow]. Long scenario: 9,805 fixes across 19 devices equal the provider; 49 late uploads stored; diagnostics report kept pre-Start events (DON-321 checks); overnight quit and resume; outage shown; Measure after relaunch; archive reopened with recovery code; screenshots show both groups' tracks, stationary and stale indicators, casualty marker and search area [team-smoke team-mission]. Replay at start+24 h read 0 records: known issue DON-293. Screenshots reviewed by Claude. By hand: F11 with Focus Mode went full screen and back (Donal, 2 Oct, installed draft .deb). |
| Large mission opens responsive | PASS | 960k-fix mission on the installed draft: shell 2.1 s, mission ACTIVE 5.3 s, Settings opened in 175/32/24 ms, renderer timer gaps p99 1.6 ms, max 2.1 ms. (First open with the one-time schema upgrade on the pre-tag build fc731f1e: shell 3.1 s, ACTIVE 6.3 s.) |
| Packaged soak | FAIL | CI packaged soak (CI profile) green in [run 37011458608](https://github.com/donal0c/sartracker-web/actions/runs/37011458608). Installed soak on the draft .deb on the box (normal profile, 5-day accelerated, 100 devices, 2 Oct): 691,224/691,224 positions stored exactly, 2/2 archive cycles; failed limits: main-loop maxima 329 ms and 516 ms (4 of 26,936 main samples over 200 ms, p99 54 ms), renderer 32 of 61,564 over 250 ms (p99 67 ms), process-tree peak 2.27 GB over the 2 GB budget [DON-312, DON-313]. |
| Strict responsiveness (<200 ms) | PASS | "Strict responsiveness qualification (<200 ms)" step green in [run 37011458608](https://github.com/donal0c/sartracker-web/actions/runs/37011458608). |
| Offline map package | PASS | Team Discovery package (sha256 e317fd016b02d88f…, z9–16, 31,729 tiles) imported with the network off, verified ready, selected, still the map after restart; tiles rendered before and after restart (screenshots reviewed by Claude, 2 Oct). [team-smoke offline-map] |
