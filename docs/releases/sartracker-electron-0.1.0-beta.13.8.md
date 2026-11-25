# SAR Tracker Electron 0.1.0-beta.13.8 — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64,
> unsigned, no auto-update. Supersedes beta.13.7.

## ⚠ Read first

- **The screen looks different.** After you press **Start**, the map fills the
  screen and panels open only when you ask for them. Mission Control is the
  **Mission** button at the top left. See "Where things are now" below
  [DON-341, DON-342, DON-368].
- **The map scale was wrong since it was added in beta.8.** The bar showed
  twice the true distance: "1 km" covered only 500 m. It is now correct, and
  is a black-and-white OS-style bar [DON-339, DON-369]. Only the scale bar was
  wrong; positions and grid references were not affected.
- **Breadcrumb dots no longer cut a long trail short.** Before, choosing
  Breadcrumb dots could show only part of a trail once a mission passed
  10,000 positions. Now the trail line stays drawn under the dots. While older
  history is still loading, the tracking line says **Mission history not
  complete yet**. A team tester reported this from the Dublin test [DON-338].
- **Pausing a mission stops new positions coming in until you press Resume.**
  The map does not update while paused. Do not count on positions from the
  paused time being filled in later. **If anyone is still out overnight,
  leave the mission running; do not pause it.**
- **The light theme is now the default.** For night use, open **More** and
  press **Theme: Light** to switch to dark [DON-344].

## Before you upgrade

1. Finish any active mission in 13.7 first, as usual.
2. Copy your SAR Tracker data folder (`~/.config/sartracker-web`) if you
   might roll back. 13.8 does not change the mission database version.
3. Install:
   - **AppImage** (PCLinuxOS and other systems): quit 13.7, replace the old
     AppImage file with
     `sartracker-electron-validation_0.1.0-beta.13.8_linux_x86_64.AppImage`,
     make it executable (right-click → Properties → Permissions, or
     `chmod +x`), and start it the way you started 13.7.
   - **.deb** (Ubuntu/Debian):
     `sudo apt install ./sartracker-electron-validation_0.1.0-beta.13.8_linux_amd64.deb`
4. After the first start, check **Settings → Tracking sources → Team default
   group** shows your team's group (for example KMRT).

Verify downloads first: `sha256sum -c SHA256SUMS --ignore-missing` must say
**OK** for each file you downloaded. The AppImage may need `libfuse2`
(`libfuse2t64` on Ubuntu 24.04) and, on Ubuntu, `--no-sandbox`.

## What's new

### Where things are now [DON-341, DON-342, DON-343, DON-368]

- **Start screen.** If a mission was not finished, **Resume** comes first.
  Otherwise **New** asks for a name and the **Roll back time (hours)**. Your
  team default group is already ticked, so you can usually just press
  **Start**. To pick other groups or devices, open **Change who's taking
  part**.
- **Top bar, from the left:** the **Mission** button (pause, resume, finish,
  add people) with the search clock; the **tracking line** (press it for
  what is wrong and what to do); **People**, **Layers** and **Full map**;
  then **Settings** and **More**.
- **More** holds Review and replay, Diagnostics, Help, Weather and the
  light/dark **Theme** switch.
- **The map has the whole screen by default.** People, Layers and other
  panels open on the right; **Full map** closes the side panel (the button
  then reads **Show panel**). Review and All devices can also sit on the
  left. Warnings never go away when you close a panel. Mission setup or a
  mission warning can open the Mission panel by itself.
- **Adding people during a mission:** Mission → **Change who's taking
  part**, choose the person or group and when their positions should start,
  then press **Add**.
- **All devices** is at the top of the People panel.
- **GPS track files (GPX) and helicopters:** Layers → **Add GPX,
  helicopters**.
- **Maps** and **Map Tools** (draw, measure) are at the top left of the map.
  The scale and the coordinate bar are at the bottom.
- **Settings** is a menu of five parts: Mission defaults, Tracking sources,
  Mapping, Weather links and Advanced. It opens on Tracking sources.
- People no longer opens by itself after Start. The casualty marker is
  larger and stands out above place names.

### Team default group

- Set it once in **Settings → Tracking sources → Team default group**. It is
  ticked for you at Start in every new mission, marked *team default*. You
  can untick it under **Change who's taking part**.
- Anyone added to a ticked group in Traccar during a mission appears once
  SAR Tracker next reads the group from Traccar. An amber notice says which
  devices joined which group. Their trail starts from when they joined.

### Map

- **Correct scale** [DON-339] and a **chequered OS-style scale bar** with
  marks such as 0 / 250 / 500 m [DON-369]. If the app cannot work out the
  scale, it says **Map scale unavailable** instead of drawing a wrong bar.
- **Warnings, the GPX notice and the scale no longer overlap** at the bottom
  of the map [DON-369]. On a small window, an open Map Tools panel can still
  cover part of a tall warning list; close it to read them all.
- **Trail line kept in Breadcrumb dots** [DON-338]. The dots sit on top of
  the trail line; Earlier and Later move only the dots. A trail you have
  hidden in Layers stays hidden.
- **Coordinate converter** [DON-351]: changing any box clears the old
  result, so **Go To Location** and **Create Marker Here** can no longer use
  an old position. East Co. Down (Ards Peninsula, Portaferry, Copeland
  Islands) is no longer refused as "Outside Ireland".

### GPS track files (GPX)

- **A watched folder is remembered after a restart** [DON-337]. Reopening
  the mission says *Resumed watching N folders saved for this mission*, and
  files dropped in while the app was closed are imported at once. If the
  folder cannot be opened (a USB stick unplugged), a red line names it.
- **Imported tracks are drawn, up to 512** [DON-350]. If not all of them can
  be drawn, the map says *Map shows X of Y imported GPX tracks* and names the
  first few left out.
- Watched folders of up to 1,000 files work. Unchanged files are not imported
  again. A stalled import is stopped and says what was saved before it
  stopped [DON-350].

### Tracking warnings you can trust

- The tracking line and People **never say healthy while positions are out
  of date**. People shows **Out of date** or **Last known** with the
  position's age; All devices shows **Stale** [M-20, M-21, M-22].
- **MAP NOT UPDATING** (red) appears if the map stops taking in new
  positions, so old dots never look live [DON-357].
- **LIVE REFRESH SUSPENDED** appears if new positions cannot be saved fast
  enough and live updates stop to protect the record [DON-349].
- A position timed more than 2 minutes ahead of the laptop clock is not
  shown as live: **FIX TIME AHEAD OF THIS LAPTOP**. Check the laptop's clock
  and the tracker's time zone [DON-349].
- **One unknown device no longer loses everyone else's positions.** The
  others are saved and the refused ones are reported [M-34].
- **Re-enter password** in the top bar appears when the saved tracking
  password cannot be read; the tracking details say what to do and have a
  button to open Settings [DON-353].
- While paused, the People badge counts only people with a problem of their
  own; the red MISSION PAUSED strip covers everyone else [DON-356].

### Crashes, hangs and saving

- **If the map window crashes, it normally reopens by itself** with a notice
  to check tracking is live. If it keeps crashing, or the app cannot safely
  record what was waiting to be saved, it says so and does not restart. The
  AppImage now restarts itself after a serious fault [M-45, M-46].
- **A hung window no longer stops you closing.** If the window does not
  respond 15 seconds after you try to close it, you see **SAR Tracker is not
  responding** with **Wait** or **Close now**. **Close now** may leave the
  last unsaved positions marked as possibly missing [M-48].
- **A blank window at start** now shows a message to reinstall instead
  [DON-354].
- **Damaged settings are set aside, not lost.** The app starts, says the
  settings were damaged, and **Save** repairs them. The damaged file is kept [M-47].
- **Backups pause when the disk is nearly full** instead of filling it: you
  see **Disk nearly full: mission backup paused**, and the last good backup
  is kept. A damaged copy is never saved over the last good backup
  [M-42, M-44].
- **Saving Settings no longer stops tracking without asking**
  ("Stop Tracking and Save") [DON-352].
- **Marker treatment updates:** text typed in **New Treatment Update** is
  added to the log when you press **Save**, and closing a marker with unsaved
  changes asks first [DON-348].
- Photos attached to markers are saved safely before they are recorded [M-41].
- A mission carried over from an older version can now be finished, once its
  missing history has downloaded [M-26].
- Weather links open again (**More → Weather**) [DON-340].
- The Tools panel no longer jumps while it loads [DON-355].

## Please test

1. **Find your way around:** start, pause, resume and finish a mission
   using only the new screen. Tell us anything you could not find.
2. **Team default group:** check it is ticked at Start. With a mission
   running, add someone to the group in Traccar; they should appear with an
   amber "joined" notice.
3. **Scale bar:** on Discovery and OpenTopoMap, compare the bar with a
   distance you know (for example two grid lines 1 km apart).
4. **Watched GPX folder:** watch a folder, quit, drop a new file in, restart
   and reopen the mission. The file should import by itself.
5. **Long trails:** on a long mission, switch between Solid line and
   Breadcrumb dots. The whole trail should stay on the map.
6. **Light and dark:** try **More → Theme** in daylight and at night.
7. Report problems with a support bundle (More → Diagnostics → Export Support
   Bundle).

## Known issues

- **Under very heavy, long tracking load the app can briefly freeze** (up to
  about a third of a second at a time). Seen in the 13.7 5-day accelerated
  test with 32 devices; every position was stored exactly. If it ever stops
  responding for more than a couple of seconds, export a support bundle and
  tell us [DON-312, DON-313].
- **Positions are not recorded while a mission is paused** (see Read first).
  Leave the mission running if anyone is still out overnight. Named days for
  multi-day missions are planned [DON-100].
- **The 1 km grid shows on the online Discovery map but not on the offline
  Reeks map.** The offline map was made without the grid lines. A switchable
  grid is planned [DON-346].
- **The online Premium Basemap may not load** (the server refuses it). Use
  Discovery or another map [DON-346].
- **Replay does not show history at times before it was fetched**
  [DON-293]: history brought in by the roll back time, or by adding a device
  with "Mission start", appears in Replay only from the moment it was fetched.
- **Quitting can take 10–15 seconds**, longer if a backup is running. Wait
  for the window to close before starting it again.
- **Hidden GPX tracks:** we still need the affected GPX files to find why
  some 13.5 imports were hidden; each track says whether it is on the map and
  why [DON-319].
- Most pictures in the Help manual still show the old dark screens.
- Not yet tested on PCLinuxOS by us [DON-298]. AppImage on Ubuntu may need
  `--no-sandbox`.

## Rollback

Quit the app, remove it (`sudo apt remove sartracker-electron-validation`, or
delete the AppImage) and reinstall 13.7. 13.8 uses the same mission database
version as 13.7; if 13.7 refuses the data folder, restore the copy you made before
upgrading. Watched GPX folders saved by 13.8 are not used by 13.7; add them
again there. Never delete mission data; capture diagnostics first.

## Regression provenance

- Classification: Regression correction
- Linear issue: [DON-338](https://linear.app/donal-oc/issue/DON-338)
- Affected release(s): 0.1.0-beta.12.10 through 0.1.0-beta.13.7
- Last known good: unknown — no earlier build is recorded drawing a trail of
  more than 10,000 positions whole in Breadcrumb dots; the investigation found
  the August report (SAR-FIELD-002) was never fixed, only reworded
- First known bad: 0.1.0-beta.12.10 (the 10,000-position dot page arrived
  with source-exact dots, 63474fa7, DON-260)
- Root cause: in Breadcrumb dots mode the map removed the trail line and drew
  one page of the newest 10,000 positions, shared across the selected devices;
  Earlier and Later swapped one page for another, and the choice was
  remembered across restarts. DON-295 (13.5) widened which devices used that
  page, so the limit arrived sooner.
- Escape analysis: no test or fixture had more than 10,000 positions on one
  device (largest 9,600); a contract test pinned the 10,000-dot page as
  correct; the August report was treated as wording and got no register line
  or scale check.
- Before/after evidence: real-store unit test with one device and 12,000
  positions — before, Breadcrumb dots left 2,000 positions off the map and
  Earlier left 10,000 off; after, none. Team-smoke `don-338-whole-trail`
  (25,000 positions, one device) and `don-338-many-devices` (156,960
  positions, 34 devices) PASS on a local unsigned macOS package with
  synthetic data (PR 66, 21 Nov).
- Regression gate: unit `don-338-whole-trail-with-breadcrumb-dots`,
  `don-338-field-scale-trails`, `don-338-many-device-dots`; team-smoke
  `don-338-whole-trail` and `don-338-many-devices`, which fail naming any
  stored stretch not on the drawn trail.
- Remaining uncertainty: the team-smoke phases have not yet run on the
  CI-built artifact (see the results below); not checked with field data; we
  have not confirmed the tester's screen was on Breadcrumb dots; open
  decisions are listed on DON-338.

Also corrected before release: DON-367 (Regression). A diagnostics change made
for DON-338 (d3c0f687, never in a released build) made late positions stall
after a restart under heavy load; fixed in PR 101 and caught by the packaged
soak. Not regressions: DON-339 (the scale has been wrong since it was added in
0.1.0-beta.8, DON-195) and DON-337 (long-standing, per its Linear issue).

Team reports also corrected here: DON-338 (team testers, Dublin test, about
7 Nov), DON-339 (team, SARNOV 8) and DON-340 (team, Nov). Each carries its
escape note and register line. DON-337 (found in the 13.7 hand check) has its
register line.

## Owner-approved exceptions

**PLACEHOLDER — fill after the Ubuntu-box run.** Delete this section if every
row passes. Otherwise one row per FAIL or NOT TESTED check, with Donal's
decision.

Applies to: `electron-v0.1.0-beta.13.8`
Approved AppImage SHA-256: `TODO`
Approved .deb SHA-256: `TODO`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |

## Release checklist results

**PLACEHOLDER — fill after the Ubuntu-box run.** Run on TODO against the exact
CI artifacts from run TODO, team-smoke tool commit TODO. Results: PASS, FAIL
or NOT TESTED. No row may be NOT APPLICABLE.

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
