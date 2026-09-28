# SAR Tracker Electron &lt;version&gt; — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64,
> unsigned, no auto-update. Supersedes &lt;previous version&gt;.

Write for the team first: what to do before upgrading, what changed, what to
test and what is known to be wrong. The release checklist results go at the end.
Follow [the release checklist](../release-checklist.md).

## ⚠ Read first

- &lt;the most important known issue and its workaround, or delete this section&gt;

## Before you upgrade

1. &lt;anything the team must do before installing, e.g. finish active missions&gt;
2. Copy your profile folder (`~/.config/sartracker-web`) if you might roll back.
3. Install the `.deb` (recommended):
   `sudo apt install ./sartracker-electron-validation_<version>_linux_amd64.deb`

Verify downloads first: `sha256sum -c SHA256SUMS --ignore-missing` must say
**OK** for each file you downloaded. The AppImage may need `libfuse2`
(`libfuse2t64` on Ubuntu 24.04) and, on Ubuntu, `--no-sandbox`.

## What's new

- &lt;short, operator-readable changes with Linear IDs in brackets&gt;

## Please test

1. &lt;operator workflows the team should exercise, most important first&gt;
2. Report problems with a support bundle (Diagnostics → Export Support Bundle).

## Known issues

- &lt;each known issue with its workaround; every owner-approved exception below
  must appear here in plain language&gt;

## Rollback

Quit the app, remove it (`sudo apt remove sartracker-electron-validation`, or
delete the AppImage) and reinstall the previous release. A newer database
schema is refused by older releases, so restore the profile copy you made
before upgrading. Never delete mission data; capture diagnostics first.

## Regression provenance

Keep only the first two lines for a release that does not correct a known
regression.

- Classification: &lt;Regression correction | No known regression correction&gt;
- Linear issue: &lt;[DON-XXX](https://linear.app/donal-oc/issue/DON-XXX) | Not applicable — no regression correction in this release.&gt;
- Affected release(s): &lt;versions&gt;
- Last known good: &lt;version, or unknown with reason&gt;
- First known bad: &lt;version&gt;
- Root cause: &lt;confirmed mechanism&gt;
- Escape analysis: &lt;why existing checks missed it&gt;
- Before/after evidence: &lt;same-workload comparison&gt;
- Regression gate: &lt;automated check that now fails on recurrence&gt;
- Remaining uncertainty: &lt;residual risk&gt;

## Owner-approved exceptions

Delete this section when every row passes. Otherwise one row per FAIL or NOT
TESTED check; see the release checklist for the rules.

Applies to: `electron-v<version>`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |

## Release checklist results

Run on &lt;date&gt; against the exact CI artifacts from run &lt;id&gt;, team-smoke
tool commit &lt;sha&gt;. Results: PASS, FAIL, NOT TESTED, or NOT APPLICABLE
(offline map package only).

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
| Large mission opens responsive | TODO | TODO |
| Packaged soak | TODO | TODO |
| Strict responsiveness (<200 ms) | TODO | TODO |
| Offline map package | TODO | TODO |
