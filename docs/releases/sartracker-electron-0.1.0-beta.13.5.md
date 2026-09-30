# SAR Tracker Electron 0.1.0-beta.13.5 — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64,
> unsigned, no auto-update. Supersedes beta.13.4.

## ⚠ Read first

- **Starting a second mission in the same session now tracks the devices you
  picked.** In 13.4, if you finished one mission and then started another
  without restarting, the devices ticked before Start were silently dropped:
  the new mission tracked nobody and imported no lookback history. This is
  fixed [DON-292]. If you saw "no history before the mission started" in 13.4,
  please try again on 13.5.

## Before you upgrade

1. Finish any active mission in 13.4 first, as usual.
2. Copy your profile folder (`~/.config/sartracker-web`) if you might roll back.
3. Install the `.deb` (recommended):
   `sudo apt install ./sartracker-electron-validation_0.1.0-beta.13.5_linux_amd64.deb`

Verify downloads first: `sha256sum -c SHA256SUMS --ignore-missing` must say
**OK** for each file you downloaded. The AppImage may need `libfuse2`
(`libfuse2t64` on Ubuntu 24.04) and, on Ubuntu, `--no-sandbox`.

## What's new

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

## Please test

1. Finish a mission, then start a second one in the same session with
   devices ticked before Start; confirm they track and their lookback history
   appears.
2. Import the Discovery package (or re-check it as above); switch the basemap
   to **Discovery Topo** and confirm the map draws with Wi-Fi off.
3. Finish → Archive & Lock → reopen the archive in Review; confirm it is the
   mission you just finished.
4. Pause a mission, close the app, reopen and Resume; it should stay paused.
5. Report problems with a support bundle (Diagnostics → Export Support Bundle).

## Known issues

- **Closing with the window X or a normal quit may show "Unexpected shutdown
  detected"** on the next launch. Data is unaffected [DON-284].
- **Unwritable profile folder:** the app exits silently. If the app "does
  nothing" on launch, check the permissions of `~/.config/sartracker-web`
  [DON-285].
- **No WebGL / blocklisted graphics:** the window can stay black with no
  message. Tell us your machine; the test box runs with
  `--ignore-gpu-blocklist` [DON-288].
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
Approved AppImage SHA-256: `TODO`
Approved .deb SHA-256: `TODO`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| Mission lifecycle and crash recovery | TODO | Ship with known issue | Clean quit may be reported as an unexpected shutdown; data unaffected. | TODO | TODO | DON-284 |
| Unwritable profile shows an error | TODO | Ship with known issue | Silent exit; check folder permissions. | TODO | TODO | DON-285 |

DON-288 (black window without WebGL) is a known issue, not a checklist row;
it is recorded here as a test-box accommodation (`--ignore-gpu-blocklist`).

## Release checklist results

Run on TODO against the exact CI artifacts from run TODO, team-smoke tool
commit TODO. Results: PASS, FAIL, NOT TESTED, or NOT APPLICABLE.

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
