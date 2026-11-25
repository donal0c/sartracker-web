# SAR Tracker Electron 0.1.0-beta.13.8 — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64,
> unsigned, no auto-update. Supersedes beta.13.7.

## ⚠ Read first

- **The screen looks different.** The map now fills the screen and panels
  open only when you ask for them. Mission Control is the **Mission** button
  at the top left. See "Where things are now" below [DON-341, DON-342,
  DON-368].
- **The map scale was wrong in every earlier version.** The bar showed twice
  the true distance: "1 km" covered only 500 m. It is now correct, and is a
  black-and-white OS-style bar [DON-339, DON-369]. Only the scale bar was
  wrong; positions and grid references were not affected.
- **Whole trails are always drawn.** Before, choosing Breadcrumb dots could
  show only part of a long trail once a mission passed 10,000 positions. Seán
  reported this from the Dublin test [DON-338].
- **Pausing a mission stops new positions coming in until you press Resume.**
  The map does not update while paused. Do not count on positions from the
  paused time being filled in later. **If anyone is still out overnight,
  leave the mission running; do not pause it.**
- **The light theme is now the default.** For night use, choose **More →
  Theme** to switch to dark [DON-344].

## Before you upgrade

1. Finish any active mission in 13.7 first, as usual.
2. Copy your profile folder (`~/.config/sartracker-web`) if you might roll
   back. 13.8 does not change the mission database version.
3. Install:
   - **AppImage** (PCLinuxOS and other systems): quit 13.7, replace the old
     AppImage file with
     `sartracker-electron-validation_0.1.0-beta.13.8_linux_x86_64.AppImage`,
     make it executable (right-click → Properties → Permissions, or
     `chmod +x`), and start it the way you started 13.7.
   - **.deb** (Ubuntu/Debian):
     `sudo apt install ./sartracker-electron-validation_0.1.0-beta.13.8_linux_amd64.deb`
4. After the first start, check **Settings → Mission defaults → Team default
   group** shows your team's group (for example KMRT).

Verify downloads first: `sha256sum -c SHA256SUMS --ignore-missing` must say
**OK** for each file you downloaded. The AppImage may need `libfuse2`
(`libfuse2t64` on Ubuntu 24.04) and, on Ubuntu, `--no-sandbox`.

## What's new

### Where things are now [DON-341, DON-342, DON-343, DON-368]

- **Start screen.** If a mission was not finished, **Resume** comes first.
  Otherwise **New** asks for a name and the roll back time (Start offset),
  with the groups and devices taking part below. Your team default group is
  already ticked, so you can usually just press Start.
- **Top bar, from the left:** the **Mission** button (pause, resume, finish,
  add people) with the search clock; the **tracking line** (press it for
  what is wrong and what to do); **People**, **Layers** and **Full map**;
  then **Weather**, **Settings** and **More**.
- **More** holds Review and replay, Diagnostics, Help and Theme.
- **One panel at a time, on the right.** **Close** or **Full map** gives the
  map the whole width. Warnings never go away when you close a panel.
- **Adding people during a mission:** Mission → **Add participant**.
- **All devices** is at the top of the People panel.
- **GPX tracks and helicopters:** Layers → **Add GPX, helicopters**.
- **Maps** and **Map Tools** (draw, measure) are at the top left of the map.
  The scale and the coordinate bar are at the bottom.
- **Settings** is a menu of five parts: Mission defaults, Tracking sources,
  Mapping, Weather links and Advanced. It opens on Tracking sources.
- People no longer opens by itself after Start. The casualty marker is
  larger and stands out above place names.

### Team default group

- Set it once in **Settings → Mission defaults → Team default group**. It is
  ticked for you at Start in every new mission, marked *team default*. You
  can untick it.
- Anyone added to a ticked group in Traccar during a mission appears by
  themselves. An amber notice says who joined (for example *2 joined Hill
  Team*). Their trail starts from when they joined.

### Map

- **Correct scale** [DON-339] and a **chequered OS-style scale bar** with
  marks such as 0 / 250 / 500 m [DON-369]. If the app cannot work out the
  scale, it says **Map scale unavailable** instead of drawing a wrong bar.
- **Nothing covers anything else** at the bottom of the map: map warnings,
  the GPX notice and the scale each have their own place [DON-369].
- **Whole trail always drawn** [DON-338]. Breadcrumb dots sit on top of the
  trail line; Earlier and Later move only the dots.
- **Coordinate converter** [DON-351]: changing any box clears the old
  result, so Go To and Create Marker Here can no longer use an old position.
  East Co. Down (Ards Peninsula, Portaferry, Copeland Islands) is no longer
  refused as "Outside Ireland".

### GPX

- **A watched folder is remembered after a restart** [DON-337]. Reopening
  the mission says *Resumed watching N folders saved for this mission*, and
  files dropped in while the app was closed are imported at once. If the
  folder cannot be opened (a USB stick unplugged), a red line names it.
- **Every imported track is drawn** [DON-350]. If not all of them can be
  drawn, the map says *Map shows X of Y imported GPX tracks* and names the
  ones left out.
- Watched folders with more than 100 files work. Unchanged files are not
  imported again. A stalled import finishes by itself and says what was
  imported [DON-350].

### Tracking warnings you can trust

- The tracking line and People **never say healthy while positions are out
  of date**. A stale person always reads **Stale** [M-20, M-21, M-22].
- **MAP NOT UPDATING** (red) appears if the map stops taking in new
  positions, so old dots never look live [DON-357].
- **LIVE REFRESH SUSPENDED** appears if new positions are not being saved
  [DON-349].
- A position timed more than 2 minutes ahead of the laptop clock is marked
  stale: *Fix time ahead of laptop clock*. Check the laptop's clock [DON-349].
- **One unknown device no longer loses everyone else's positions.** The
  others are saved and the refused ones are reported [M-34].
- **Re-enter tracking password** in the top bar says what to do when the
  saved password cannot be read, with a button to open Settings [DON-353].
- While paused, the People badge counts only people with a problem of their
  own; the red MISSION PAUSED strip covers everyone else [DON-356].

### Crashes, hangs and saving

- **If the map window crashes, it reopens by itself** with a notice to check
  tracking is live. If it keeps crashing, the app says so and closes. The
  AppImage now restarts itself after a serious fault [M-45, M-46].
- **A hung window no longer stops you closing.** After 15 seconds you see
  **SAR Tracker is not responding** with **Wait** or **Close now** [M-48].
- **A blank window at start** now shows a message to reinstall instead
  [DON-354].
- **Damaged settings are set aside, not lost.** The app starts, says the
  settings were damaged, and **Save** repairs them. The damaged file is kept [M-47].
- **Backups never fill the disk.** If space is low you see **Disk nearly
  full: mission backup paused**; the last good backup is kept. A damaged
  copy is never saved over the last good backup [M-42, M-44].
- **Saving Settings no longer stops tracking without asking**
  ("Stop Tracking and Save") [DON-352].
- **Marker treatment updates are never lost.** Text typed in **New Treatment
  Update** is added to the log on Save, and closing a changed marker asks
  first [DON-348].
- Photos attached to markers are saved safely before they are recorded [M-41].
- A mission carried over from an older version can now be finished [M-26].
- Weather links open again [DON-340].
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
  about a third of a second at a time). Seen in a 5-day accelerated test with
  32 devices; every position was stored exactly. If it ever stops responding
  for more than a couple of seconds, export a support bundle and tell us
  [DON-312, DON-313].
- **Positions are not recorded while a mission is paused** (see Read first).
  Leave the mission running if anyone is still out overnight. Named days for
  multi-day missions come in the next release [DON-100].
- **The 1 km grid shows on the online Discovery map but not on the offline
  Reeks map.** The offline map was made without the grid lines. Next release
  [DON-346].
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
version as 13.7; if 13.7 refuses the profile, restore the copy you made before
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
  one page of the newest 10,000 positions, counted across all devices
  together; Earlier and Later swapped one page for another, and the choice was
  remembered across restarts. DON-295 (13.5) pooled all devices into that one
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

Team reports also corrected here: DON-338 (Seán and Eamonn, Dublin test,
about 7 Nov), DON-339 (Eamonn, SARNOV 8) and DON-340 (team, Nov). DON-338 and
DON-340 carry their escape note and register line; DON-339's escape note and
register line are still to be added. DON-337 (found in the 13.7 hand check)
has its register line.

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
CI artifacts from run TODO, team-smoke tool commit TODO. Results: PASS, FAIL,
NOT TESTED, or NOT APPLICABLE (offline map package only).

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
