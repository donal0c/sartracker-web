# SAR Tracker Electron 0.1.0-beta.13.5 — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64,
> unsigned, no auto-update. Supersedes beta.13.4.

## ⚠ Read first

- **Devices → Add is gone.** In 13.4 it silently hid, and stopped recording,
  every other participant [DON-295]. If you used it in 13.4, check that
  mission's tracks in Review. 13.5 tracks and shows every participant.
- **Adding devices after Start: choose "History from: Mission start"** to
  bring in the Start Offset (for example 48 hours) of earlier tracks. In 13.4,
  devices added after Start silently got no earlier history. 13.5 asks every
  time [DON-291]. Ticking devices or the KMRT group before pressing Start also
  brings the history.
- **Starting a second mission in the same session now tracks the devices you
  ticked.** In 13.4 they were silently dropped after finishing an earlier
  mission [DON-292].
- **Tracks a phone uploads late now appear within about five minutes.** When a
  phone regains signal, or the tracking server comes back after an outage, the
  phone uploads the positions it held. 13.4 fetched these only in a slow
  background pass, oldest first: on a 48-hour mission a stretch could take up
  to about two hours to appear, with no sign that it was missing [DON-305]. If a 13.4 mission has a gap after a signal
  loss, check it in Review.

## Before you upgrade

1. Finish any active mission in 13.4 first, as usual.
2. Copy your profile folder (`~/.config/sartracker-web`) if you might roll back.
3. Install:
   - **AppImage** (PCLinuxOS and other systems): quit 13.4, replace the old
     AppImage file on your desktop with
     `sartracker-electron-validation_0.1.0-beta.13.5_linux_x86_64.AppImage`,
     make it executable (right-click → Properties → Permissions, or
     `chmod +x`), and start it the way you started 13.4.
   - **.deb** (Ubuntu/Debian):
     `sudo apt install ./sartracker-electron-validation_0.1.0-beta.13.5_linux_amd64.deb`

Verify downloads first: `sha256sum -c SHA256SUMS --ignore-missing` must say
**OK** for each file you downloaded. The AppImage may need `libfuse2`
(`libfuse2t64` on Ubuntu 24.04) and, on Ubuntu, `--no-sandbox`.

## What's new

- **Devices no longer has Add/Remove or an "Active" filter** [DON-295]. In
  13.4, pressing **Add** on one device silently hid every other participant
  from the map and stopped recording their positions until **Remove** was
  pressed. Who is tracked is now decided only by **Mission Control →
  Participants**. If you pressed Add in 13.4, 13.5 ignores it and shows and
  records all participants.

- **Discovery map package accepted again** [DON-144]. The Kerry/Reeks package
  that 13.4 rejected ("zoom metadata does not match its tiles") now imports.
  If 13.4 already rejected it for you, open **Settings**, press
  **Save & Close** to check it again, or press **Add Discovery Package** and
  choose the file again.
- **Pre-start participants are kept for a second mission** in the same
  session [DON-292].
- **Archive & Lock targets the mission you just finished.** It no longer
  picks an older finished mission; when there is more than one, choose it from
  the Mission list on the governance card [DON-294].
- **Paused stays paused after a crash.** Resume after a crash no longer
  un-pauses a paused mission [DON-283].
- **Adding a participant after Start asks "History from"** — Mission start,
  Now or Custom. 13.4 silently used "now", so a 48-hour Start Offset brought
  no earlier history for late adds [DON-291].
- **No admin configured no longer blocks Archive & Lock after a crash:** you
  are taken to Settings → Admin Roster and back [DON-281].
- **Upgraded missions no longer stay "History incomplete"** once their older
  positions are confirmed [DON-282].
- **Minimize works during a mission** while an earlier finished mission is
  waiting for Archive & Lock. In 13.4 the button did nothing [DON-307].
- **Re-importing a retired GPX track now explains what to do.** 13.4 showed
  "Cannot update retired GPX evidence" with an internal id. 13.5 says the
  track was retired: copy or rename the file and import the copy [DON-306].
- **Diagnostics reports start with the SAR Tracker version** and keep their
  full content. 13.4 dropped the main section of a large report [DON-308].
- **Late-uploaded positions are fetched promptly** [DON-305]. Every five
  minutes the app re-reads the last six hours of every participant, so a
  stretch a phone uploads after regaining signal is on the map within about
  five minutes. Older history is re-read newest first, about every 35 minutes
  on a 48-hour mission. If that re-read fails, Tracking names the device.

## Please test

**First, on your own machine (we test on Ubuntu, you run PCLinuxOS):** start
the new AppImage from the desktop the way you normally do. Confirm the map
appears (not a black window), **Maps → Discovery Topo** draws the Reeks, and
**F11** with **Focus Mode** goes full screen and back. If anything fails, tell
us what you saw; a photo of the screen is enough.

1. Put a phone in flight mode (or out of coverage) for 20 minutes while it
   records, then reconnect; its trail for that time should appear within
   about five minutes.
2. Open **Devices** during a mission, hide and show a device, zoom to one;
   confirm every participant stays on the map and keeps its trail.
3. Finish a mission, then start a second one in the same session with
   devices ticked before Start; confirm they track and their lookback history
   appears.
4. Import the Discovery package (or re-check it as above); switch the basemap
   to **Discovery Topo** and confirm the map draws with Wi-Fi off.
5. Finish → Archive & Lock → reopen the archive in Review; confirm it is the
   mission you just finished.
6. Pause a mission, close the app, reopen and Resume; it should stay paused.
7. Report problems with a support bundle (Diagnostics → Export Support Bundle).

## Known issues

- **Discovery is not remembered after a restart.** The app opens on
  OpenTopoMap (an online map). After starting, choose **Maps → Discovery
  Topo**, especially without internet [DON-304].
- **Closing with the window X or a normal quit may show "Unexpected shutdown
  detected"** on the next launch. Data is unaffected [DON-284].
- **Unwritable profile folder:** the app exits silently. If the app "does
  nothing" on launch, check the permissions of `~/.config/sartracker-web`
  [DON-285].
- **No WebGL / blocklisted graphics:** the window can stay black with no
  message. Tell us your machine; the test box runs with
  `--ignore-gpu-blocklist` [DON-288].
- **A retired GPX track cannot be restored by importing the same file.** Copy
  or rename the file and import the copy; it appears as a new track. A proper
  Restore is planned [DON-306, DON-309].
- **Under very heavy, long tracking load the app can briefly freeze** (under a
  second at a time). Seen only in a 5-day accelerated test with 100 devices;
  no data was lost. If it ever stops responding for more than a couple of
  seconds, export a support bundle and tell us [DON-310].
- **Quitting can take 10–15 seconds.** Wait for the window to close before
  relaunching.
- AppImage on Ubuntu may need `--no-sandbox`.

## Rollback

Quit the app, remove it (`sudo apt remove sartracker-electron-validation`, or
delete the AppImage) and reinstall the previous release. A newer database
schema is refused by older releases, so restore the profile copy you made
before upgrading. Never delete mission data; capture diagnostics first.

## Regression provenance

- Classification: Regression correction
- Linear issue: [DON-292](https://linear.app/donal-oc/issue/DON-292)
- Affected release(s): 0.1.0-beta.13.4
- Last known good: none — the pre-start participant picker first shipped in 13.4
- First known bad: 0.1.0-beta.13.4
- Root cause: after Finish, the finished mission stays current for Archive &
  Lock; starting the next mission refreshed the participant runtime, which
  cleared the pre-start draft before it was read, and an empty selection was
  accepted without error.
- Escape analysis: every earlier smoke and E2E flow started the first mission
  of a fresh profile.
- Before/after evidence: packaged probe on the same build — fresh profile
  records [group, device]; after a finished mission, 13.4 code records [] and
  the fix records [group, device].
- Regression gate: E2E `participants.spec.ts` "keeps pre-start selections for
  a mission started after finishing an earlier one"; team-smoke
  `team-mission` (lived-in profile with a finished mission first).
- Remaining uncertainty: the reporter's exact click path is unconfirmed.

## Owner-approved exceptions

Applies to: `electron-v0.1.0-beta.13.5`
Approved AppImage SHA-256: `3847d36d6092d8da6562ef783fbb7ae69daecd56ae04232109385b4c759294e0`
Approved .deb SHA-256: `012ec1fecaef1fe3ecd8e3662180894806f4c494982252fe3a1e14008a1e2e61`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| Unwritable profile shows an error | FAIL | Ship with known issue | Silent exit when `~/.config/sartracker-web` is not writable; check folder permissions. Same as 13.4. | Donal | In-session go/no-go, 1 Oct 2026, on the AppImage and .deb digests above | DON-285 |
| Mission lifecycle and crash recovery | FAIL | Ship with known issue | A graceful quit is recorded as an unexpected shutdown; the next launch may say so. Fixes gap-free. Same as 13.4. | Donal | In-session go/no-go, 1 Oct 2026, on the AppImage and .deb digests above | DON-284 |
| Team mission scenario | FAIL | Ship with known issue | `team-workflow` (the team's own steps, SAR-QA-025): Discovery is not remembered after restart; choose Maps → Discovery Topo after starting. All other steps pass. Same as 13.4. | Donal | In-session go/no-go, 1 Oct 2026, on the AppImage and .deb digests above | DON-304 |
| Markers, attachments and GPX import | NOT TESTED | Backlog | The import through the app passed on this build. The native file picker was checked by hand on candidate 3 (30 Sep); this build does not change the picker. | Donal | In-session go/no-go, 1 Oct 2026, on the AppImage and .deb digests above | Hand check on the next candidate |
| Replay, basemaps and layers | FAIL | Ship with known issue | Without `--ignore-gpu-blocklist`, a blocklisted GPU leaves the map window black with no message (same as 13.4; the note asks testers to report their machine). Replay passes and all four public basemaps render; layer toggles not exercised by hand (Chromium E2E covers them, 232/232). | Donal | In-session go/no-go, 1 Oct 2026, on the AppImage and .deb digests above | DON-288, DON-299 |
| Packaged soak | FAIL | Ship with known issue | CI soak green (run 36784213719). The installed normal-profile soak (100 devices, about 5 days accelerated) stored all 691,224 positions exactly but had main-thread stalls of 434–672 ms (limit 200 ms). The approved candidate 3, before DON-305, stalls as much or more (673 ms), so this is not new; the box renders in software (llvmpipe). | Donal | In-session go/no-go, 1 Oct 2026, on the AppImage and .deb digests above | DON-310 |

## Release checklist results

Run on 2026-10-01 against the exact CI artifacts from release run 36784213719
(tag at fac5adcf), team-smoke tool commit fac5adcf, on Ubuntu 24.04 (test box),
installed .deb verified byte-identical to the draft. Launch args:
`--ignore-gpu-blocklist` (the box GPU is blocklisted, DON-288). The team runs
the AppImage on PCLinuxOS, which is not tested here (DON-298).

| Check | Result | Evidence |
| --- | --- | --- |
| CI release run | PASS | Run 36784213719 green on fac5adcf (lint, correctness, strict responsiveness, build, Chromium E2E, Linux bundle, packaged soak, AppImage launch). |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.5_linux_x86_64.AppImage` `3847d36d6092d8da6562ef783fbb7ae69daecd56ae04232109385b4c759294e0`: draft asset digest = box-measured = SHA256SUMS; downloaded from the CI-created draft with `gh release download`. |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.5_linux_amd64.deb` `012ec1fecaef1fe3ecd8e3662180894806f4c494982252fe3a1e14008a1e2e61`: draft asset digest = box-measured = SHA256SUMS; same custody. |
| Installed .deb payload | PASS | sartracker-web 0.1.0~beta.13.5 installed; dpkg -V clean; 140/140 payload files byte-identical. |
| Startup with bad stored credential | PASS | Reached the shell; tracking disabled with the re-enter-password warning. |
| Corrupt or newer database refused | PASS | Newer schema and corrupt database refused with clear messages. |
| Unwritable profile shows an error | FAIL | Silent exit (code 0), no window or message. DON-285. |
| Duplicate launch | PASS | Second instance exited without a window; the first kept its ACTIVE mission. |
| Upgrade from the team's current release | PASS | Profile made by installed 13.4 (finished + active mission): missions, markers, drawings and fixes row-for-row equal (2/2/18); active mission held paused for Resume. |
| Mission lifecycle and crash recovery | FAIL | Graceful quit recorded as unexpected shutdown (DON-284). Pause, SIGKILL, renderer crash and quit: 45 fixes gap-free. `crash-archive` PASS: after a renderer crash and SIGKILL with an empty Admin Roster, Archive & Lock completed via Settings (DON-281). |
| Tracking matches provider exactly | PASS | 27 live fixes equal the provider; walkers contiguous; lookback history exact. |
| Provider outage warning and backfill | PASS | Visible OFFLINE warning during the 90 s outage; gap-free after reconnect. |
| Live Traccar | PASS | 4,431/4,431 provider positions for the approved device stored exactly, including 2,463 uploaded late (DON-305); 48 h roll back, device added after Start with "Mission start", 7 min live; GET only. |
| Coordinate conversion and rejection | PASS | DD↔IG round trip (Q 99842 04015); DD/DMS paste; invalid input rejected. |
| Markers, attachments and GPX import | NOT TESTED | 2 markers; photo stored byte-identical; GPX (30 timed points) via the app's import path. Native picker not repeated on this build (exception above). |
| Replay, basemaps and layers | FAIL | `no-gpu-flag` FAIL: without `--ignore-gpu-blocklist` WebGL is unavailable and no message explains the missing map (DON-288). Replay reconstructed 1 min back; live stayed ACTIVE; ESRI Satellite, OpenStreetMap, ESRI World Topo and OpenTopoMap render tiles (screenshots checked). Layer toggles not done by hand. |
| Encrypted archive create and reopen | PASS | Archived with passphrase and recovery code, restarted, reopened read-only; wrong passphrase refused. |
| Settings, secrets and support bundle | PASS | Settings persisted; secret empty after restart; bundle has no secret, home path or username. |
| Team mission scenario | FAIL | `team-mission` passes every automated step (screenshots checked): 9,791 fixes across 19 devices exact; 49 late-uploaded fixes stored 295 s after upload (DON-305); Minimize on a lived-in profile (DON-307); GPX retire and re-import refusal plus renamed copy (DON-306). `team-workflow` (SAR-QA-025): every step passes except Discovery after relaunch (DON-304). |
| Large mission opens responsive | PASS | Installed candidate 6 on a copy of the 959,988-fix profile: shell 3.1 s and mission ACTIVE 6.2 s from process start; Settings opens in 31–93 ms; renderer timer gaps under 1 ms (screenshot checked). |
| Packaged soak | FAIL | CI soak green. Installed normal profile: 691,224/691,224 positions exact; main-thread stalls 434–672 ms; candidate 3 baseline 611–673 ms (DON-310). |
| Strict responsiveness (<200 ms) | PASS | Release workflow strict responsiveness step green (run 36784213719). |
| Offline map package | PASS | Team package (sha256 e317fd01…, z9–16, 31,729 tiles) imported offline, ready after restart; Discovery Topo tiles render before and after restart (screenshots checked). |
