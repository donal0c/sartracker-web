# SAR Tracker Electron 0.1.0-beta.13.4 — team test build

> **Controlled team testing only. Not for live incidents.** Linux x86-64, unsigned, no auto-update. Supersedes beta.12.11.

## ⚠ Read first — known issue to be fixed in the next build

**After a crash, a mission cannot be archived unless an Admin Roster is configured.** If the app crashes mid-mission, relaunch and press **Resume** — tracking continues with no position gaps. The mission may then show **EVIDENCE HEALTH CRITICAL**, and **Archive & Lock** requires an admin to acknowledge the known gap. With no admin configured, the dialog only says "No admins configured" and you are stuck.
**➡ Immediately after installing, add at least one name under Settings → Admin Roster.** A fix is scheduled for the next build.

## Before you upgrade from 12.11

1. **Finish any active mission in 12.11 first.** Finished missions upgrade cleanly and can be reviewed, finalized and archived in 13.4. A mission still *active* at upgrade keeps all its data, but its coverage panel will permanently say *History incomplete*.
2. **Copy your profile folder** (`~/.config/sartracker-web`) if you might roll back — once 13.4 opens your data, 12.11 refuses it (database schema v7 → v13).
3. Install the `.deb` (recommended): `sudo apt install ./sartracker-electron-validation_0.1.0-beta.13.4_linux_amd64.deb`

## What's new since 12.11

- **Participants (important change):** a new mission tracks *no one* until you add devices (or a Traccar group) under **Mission Control → Participants**.
- **Outings:** coordinator-defined operational periods within a mission.
- **Stationary attention:** flags a device that hasn't moved for 20 minutes.
- **Mission history coverage** and **Replay** (Review → Replay): read-only view of what was known at a chosen time; the live map stays live.
- **Archive & Lock = encrypted archive:** passphrase (14+ characters, 3 character types) plus a one-time recovery code. **Record both — they cannot be recovered.** Archives reopen read-only from Review.
- Tracking ingest health, evidence-loss accounting, safer diagnostics exports, many reliability fixes.

## Please test

1. Upgrade with your existing (finished) missions; open them in Review.
2. Start a mission, add participants, confirm positions, breadcrumbs and coverage.
3. Pause/resume; close and reopen mid-mission and accept Resume.
4. Markers (including a photo attachment), search areas, coordinate converter, GPX import (**Import Files** — not yet tested with the native file picker).
5. Finish → Archive & Lock → reopen the archive in Review.
6. Report anything wrong or confusing with a support bundle (Diagnostics → Export Support Bundle).

## Other known issues

- **Resume after a crash un-pauses** a mission that was paused (audited; paused time counted). Re-pause if needed.
- **Closing with the window X may show "Unexpected shutdown detected"** on the next launch. Data is unaffected.
- **Quitting can take 10–15 seconds.** Wait for the window to close before relaunching.
- **Corrupted database:** the app refuses to start with a clear message and leaves the database and its backup untouched; it does not auto-restore. Send us the profile folder.
- **Unwritable profile folder:** the app exits silently. If the app "does nothing" on launch, check folder permissions.
- AppImage on Ubuntu may need `--no-sandbox` (as with 12.11).
- Engineering-scale items (multi-million-fix paging, very large archives, first open of a ~1M-fix mission taking >2 min, memory growth ~6 MB/hour of tracking) are not expected to matter at team scale.

## Regression provenance

- Classification: No known regression correction
- Linear issue: Not applicable — feature and reliability release after beta.12.11; qualification tracked in DON-254, publication decision in DON-255

## Packaged smoke matrix

Executed 27–28 Sep 2026 on Ubuntu 24.04 against the exact CI artifacts from run 36319976860. This is a controlled-team-test smoke matrix, not the full 205-binding qualification programme, which continues as non-gating qualification.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.4_linux_x86_64.AppImage` — `466ce20dc0d7ddc58dd6424ef281649759607f1f8bf0114f6844e21d816141fc`; CI artifact, draft asset and `SHA256SUMS` agree |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.13.4_linux_amd64.deb` — `804aa08faec70913b302289d53026a53858d20e72a8c88632d09d85297271891`; CI artifact, draft asset and `SHA256SUMS` agree |
| AppImage launch | PASS | CI launch smoke plus Ubuntu upgrade, lifecycle, archive and live-provider runs on the exact AppImage |
| .deb install and launch | PASS | `sartracker-web 0.1.0~beta.13.4` installed; `dpkg -V` clean; 140/140 installed files byte-identical to the package payload |
| Core lifecycle, restart/recovery, finish/finalize/archive | PASS | Pause → SIGKILL → Resume; renderer crash → relaunch → Resume; graceful restart; fixes gap-free across every interruption; finish → encrypted archive → restart → archive reopened; wrong passphrase refused; 12.11 → 13.4 upgrade row-for-row intact |
| Coordinate rejection | PASS | DD↔IG round trip (`Q 99842 04015` ↔ `52.179336, -9.464944`); `V 80 84` → `V 80500 84500`; latitude 95, `I 12345 67890`, `hello`, mixed-precision grid all rejected with clear messages |
| Diagnostics/support/incident exports sanitized | PASS | Support bundle contains no credential, email or home-directory path; profile path redacted |
| Bad/corrupt stored credential reaches shell | PASS | Packaged bad-secret smoke reached the shell with the re-enter-password warning; corrupt database refused with a clear message, primary and backup byte-identical |
| Live Traccar connection and breadcrumb reconciliation | PASS | Approved device, GET-only: 28/28 persisted fixes exactly equal provider position id, coordinates and fix time |
| Official offline Discovery package | NOT APPLICABLE | No offline Discovery package configured or bundled |
| Duplicate launch | PASS | Second instance exited 0; primary kept its active mission and tracking |
| Five-day and fourteen-day packaged soak | NOT RUN (DEVIATION) | 5-/14-day profiles not run for this team build. Substitute: CI packaged soak (run 36319976860) PASS, plus a 15-hour installed-`.deb` soak with 16,394 fixes, zero gaps, integrity ok, main-loop max ~46 ms, no crash. Accepted by the release owner for controlled team testing |
| Cross-profile exact breadcrumb identity comparison | PASS | Installed `.deb` profile: every stored fix equal to mock-provider coordinates and time (0 mismatches); AppImage upgrade profile: all 12.11 fixes identical after migration; live profile 28/28 |
| Strict responsiveness (<200 ms) | PASS | Release workflow strict responsiveness qualification green (run 36319976860); 960k-fix mission p99 main-loop 35 ms on Ubuntu |

Publication note: because one gate is a recorded deviation rather than PASS, this release was published manually after repeating the guarded publisher's checks (tag → commit, fresh draft download, installer hashes vs `SHA256SUMS`), on the release owner's explicit approval.

## CI Provenance

- Build commit: `a273ae6df6e267859b6e550731d3f2ef0426a5d6`
- Run: [#50](https://github.com/donal0c/sartracker-web/actions/runs/36319976860)
- Workflow: `.github/workflows/electron-release.yml`
- Release gates: lint, correctness tests, strict responsiveness qualification (<200 ms), web build, standard Chromium E2E
- Linux launch smoke: passed
