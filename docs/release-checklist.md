# Release checklist — team beta

This is the only release gate. It decides whether a CI-built draft can go to the
team for **controlled testing**. It is not operational/live-incident acceptance,
which is a separate, explicit decision by Donal. Target: under one day of wall
clock and under half a day of Donal's attention.

## Steps

1. Write `docs/releases/sartracker-electron-<version>.md` from
   [TEMPLATE.md](releases/TEMPLATE.md), bump `package.json`, commit, push, then
   tag `electron-v<version>`. The tag runs `.github/workflows/electron-release.yml`
   (lint, correctness, strict responsiveness, build, Chromium E2E, Linux bundle,
   packaged soak, AppImage launch) and creates a **draft** prerelease with
   `SHA256SUMS`.
2. Download the exact draft assets to the Ubuntu test box and run the smoke on
   them — never on a local rebuild:
   `node scripts/team-smoke/run.mjs --appimage <file> --deb <file> --sha256sums <file> --out <dir>`
   (see [team-smoke README](../scripts/team-smoke/README.md)). It prints the
   table below with PASS / FAIL / NOT TESTED. Mixed rows stay NOT TESTED when
   only their automated portion completed. Do the remaining manual checks,
   retain the tool evidence and add who checked what, when, on which artifact
   before marking the combined row PASS. Preserve any product FAIL.
3. Paste the table into the release note and the draft body. Classify every
   FAIL or NOT TESTED row with the severity rule. Get Donal's decision on each
   non-Block one; record it under **Owner-approved exceptions**.
4. Check the note offline, then dry-run and publish with the guarded publisher:
   `npm run electron:release:publish -- --tag <tag> --check-notes <note.md>`,
   then `npm run electron:release:publish -- --tag <tag> --repo donal0c/sartracker-web --dry-run`,
   then the same without `--dry-run`.
5. Update `handoff/HANDOFF.md` and the Linear release issue.

## Severity, decided in advance

- **Block** — data loss, wrong coordinates or mission state, silent failure in a
  safety path, sustained unresponsiveness, corruption of stored history. Cannot
  be published; the publisher rejects it.
- **Ship with known issue** — visible, recoverable, with a written workaround
  shown prominently in the release note.
- **Backlog** — cosmetic, engineering-scale, or a single timing outlier that does
  not reproduce.

A **tool failure is missing evidence, not a product result**: record NOT TESTED,
verify by hand if cheap, and move on. If a smoke script fails twice on the same
step, stop fixing it during the release.

## Checks

Check names are a contract: `build/release-checklist.js` holds the list and a
unit test keeps this table, the template and the publisher in agreement.

| Check | What must be true | How |
| --- | --- | --- |
| CI release run | Tag workflow green on the tagged commit | Run link |
| AppImage SHA-256 | Draft asset = CI artifact = `SHA256SUMS` | team-smoke `identity` |
| .deb SHA-256 | Draft asset = CI artifact = `SHA256SUMS` | team-smoke `identity` |
| Installed .deb payload | `dpkg -V` clean after installing the exact `.deb` | team-smoke `installed-payload` |
| Startup with bad stored credential | Reaches the shell with tracking disabled, not a fault | team-smoke `bad-credential` |
| Corrupt or newer database refused | Clear message; database and backup byte-identical | team-smoke `database-refusal` |
| Unwritable profile shows an error | Visible error, not a silent exit | team-smoke `unwritable-profile` |
| Duplicate launch | Second instance exits; first keeps its mission | team-smoke `duplicate-launch` |
| Upgrade from the team's current release | Profile made by the installed previous release opens; missions, markers and fixes row-for-row equal | team-smoke `upgrade` with `--previous-profile` |
| Mission lifecycle and crash recovery | Start, pause, SIGKILL, renderer crash, graceful quit, resume; walkers record live after each relaunch (not only backfilled); fixes gap-free; window X close is not reported as a crash | team-smoke `lifecycle`; window X close by hand |
| Tracking matches provider exactly | Every stored fix equals the real-time mock's coordinates and time; a 48 h Start Offset brings in exact earlier history for selected participants; with each mid-mission control left set (devices, breadcrumbs or Tracking layer hidden, Focus Mode, Devices workspace, Review, Replay, basemap switched) walkers stay within 6 fixes of the provider | team-smoke `tracking`, `controls` |
| Provider outage warning and backfill | One phone without signal for 60 s: the others keep recording live and its held fixes arrive on release; visible warning during a 90 s outage; zero-gap backfill after | team-smoke `outage` |
| Live Traccar | One approved device, GET-only, stored fixes equal provider | Manual |
| Coordinate conversion and rejection | Known round trip; invalid input rejected with clear messages | team-smoke `coordinates` |
| Markers, attachments and GPX import | Marker saved; attachment byte-identical; GPX points imported and shown | team-smoke `markers-gpx`; native picker by hand |
| Replay, basemaps and layers | Replay reconstructs a past time; live map unaffected; public basemaps render; layer toggles work | team-smoke `replay-basemaps`; render/layer checks by hand |
| Encrypted archive create and reopen | Finish, archive, restart, reopen read-only; wrong passphrase refused | team-smoke `archive` |
| Settings, secrets and support bundle | Settings persist; secret never echoed; bundle has no secret or home path | team-smoke `settings-support` |
| Team mission scenario | One realistic mission on a lived-in profile: 48 h offset, Traccar groups and devices before and after Start, about 30 devices, outings, casualty marker, two-stage delete, search area, timed and untimed GPX, outage, overnight quit and resume, replay into the backfilled window, archive reopened with the recovery code; every fix exact per device | team-smoke `team-mission`; screenshots by eye |
| Large mission opens responsive | One representative large mission opens and stays responsive | Manual with a large fixture |
| Packaged soak | CI packaged soak green; plus one overnight installed soak when tracking or storage changed | CI link; overnight log |
| Strict responsiveness (<200 ms) | Release workflow strict responsiveness step green | CI link |
| Offline map package | The package the team actually holds imports, renders offline, and survives restart | team-smoke `offline-map` with `--map-package`; rendered tiles by eye from its screenshots |

### Start-with-lookback — part of the tracking row (DON-291)

The team-smoke `tracking` check runs a second phase after the exactness phase,
so the **Tracking matches provider exactly** row cannot PASS unless both ran.
Against a history provider it starts a mission with a 48-hour Start Offset,
ticks a history-only device (no fresh fix) and a walker before Start, and adds
a third device after Start with **History from: Mission start**. Provider
history fails at first: every participant row must show pending. After
recovery every in-window provider fix must be stored exactly, nothing before
mission start (checked to the second in a dense boundary band), nothing for an
unselected device, all three devices shown in the device list, and all rows
preserved with live fixes continuing after a restart. Window-boundary and
restart rules are also pinned by unit tests.

Recorded after Eamonn's report on 28 September: live tracking and outage
backfill passes do not prove initial lookback.

### Team-reported issues become release checks

Every issue the team reports is evidence that our testing missed something.
Before its Linear issue closes:

1. Record the **escape**: why the existing tests and this checklist did not catch it.
2. Add a failing regression at the lowest level that shows the fault, then fix it.
3. If the team met it through an operator workflow, make the smoke reproduce that
   workflow (a new phase or row), so the same report cannot reach the team again.
   If automation is not practical, add a named manual step to the relevant row.
4. Add a line to the register below. A report that turns out not to be a product
   defect still gets a line, saying why no check was added.

| Report | Linear | Escape | Check that now covers it |
| --- | --- | --- | --- |
| TB13-01 map orientation | — | Not a defect: the map had been rotated; the compass resets it (confirmed by the reporter). | None needed. |
| TB13-02 Discovery package rejected | DON-144 | The 13.4 smoke did not test offline maps; the supplied package declares zoom 8 but starts at 9. | **Offline map package** row must use the package the team actually holds: team-smoke `offline-map`; unit `official-map-package` "declares more zoom levels" [DON-144]. |
| TB13-03 no history before mission start | DON-291 | The smoke never used a Start Offset, and added participants after Start. | **Tracking** row, start-with-lookback phase (above). |
| TB13-03 cause, found by team-mission | DON-292 | Every earlier flow started the first mission of a fresh profile; after any finished mission the pre-start selection was dropped. | **Team mission scenario** (lived-in profile); E2E `participants.spec.ts` [DON-292]. |
| Devices "Add" hides and stops recording other participants (manual-refresh pass, 30 Sep) | DON-295 | Every check verified tracking from mission setup, then only read the Devices list. No check pressed a Devices control during a mission and then compared all participants. A pre-Participants control stayed live under the new model with no test of how the two interacted. | Unit `start-app-runtime` and `devices-workspace` with a saved legacy list [DON-295]; E2E `devices-workspace.spec.ts` [DON-295]; **Team mission scenario** uses Devices controls mid-mission before its exact per-device comparison. |
| TB13-03 set-up order (reporter's answer, SAR-QA-023/025) | DON-291 | The smoke never ran the team's own order: AppImage, name, roll back, Start with nothing ticked, then add the KMRT group. | team-smoke `team-workflow` replays SAR-QA-025 step by step [DON-291]. |
| Discovery not kept as the map after restart (found by team-workflow) | DON-304 | `offline-map` reselected Discovery after restart instead of checking it was still selected; the app deliberately drops a stored official map. | Unit `startup-map-restore`, `map-preferences`, `use-map-instance-startup-restore` [DON-304]; Playwright `map.spec` stored-map notice and Leaflet no-overwrite; team-smoke `team-workflow` waits for Discovery after relaunch and `offline-map` now asserts Discovery is still the map after restart (no reselect). |
| 13.4 "Read first": Archive blocked after a crash with no Admin Roster | DON-281 | Only a browser E2E covered it; no packaged step crashed a mission and archived with an empty roster. | team-smoke `crash-archive` (renderer crash + SIGKILL, empty roster, routed through Settings) [DON-281]. |
| Paused mission un-paused after crash recovery | DON-283 | Recovery was only checked on active missions. | team-smoke `lifecycle` asserts PAUSED survives SIGKILL and Resume [DON-283]. |
| Archive & Lock targeted an older finished mission | DON-294 | Every archive check had one finished mission. | team-smoke `team-mission` asserts the just-finished mission is offered [DON-294]. |
| Live Traccar check drove a removed control | DON-302 | The old live proof selected its device through Devices Add. | team-smoke `live-traccar` (approved device added after Start, GET-only, exact positions). The old `breadcrumb-live-exact-smoke.mjs` was retired on 1 Oct 2026 (Donal); the qualification live variant now refuses to run and points to `live-traccar`. |
| Late-uploaded Traccar positions missing (found by live-traccar, 30 Sep) | DON-305 | Every fake Traccar delivered fixes promptly (serverTime = fixTime); the old live proof compared 28 prompt fixes, and the new check compared 3 min after backfill, before any sweep. The history sweep walked oldest-first, one 2 h chunk per tick. | Unit `breadcrumb-history-reconciler` late-upload suite [DON-305]; team-smoke `team-mission` holds back 5 h to 1 h of a walker's fixes and requires them stored within 7 min of the late upload; `live-traccar` watches 7 min and counts late uploads. |
| Re-importing a retired GPX file fails with an internal id (team tester, 30 Sep) | DON-306 | GPX tests covered import, alias and retire separately; no test or smoke step retired a track and then imported the same file. | Unit `electron-mission-evidence-versioning` [DON-306]; team-smoke `team-mission` retires a GPX track, imports a renamed copy (new track) and re-imports the file (since DON-309: the same track is restored). |
| "EVIDENCE HEALTH CRITICAL — evidence was lost" with nothing pending, blocking Finish/Archive (Eamonn, 1 Oct, PCLinuxOS) | DON-318 | `crash-archive` deliberately crashed and expected the loss; no check asserted that a kill, crash or quit with no rejected position held leaves evidence health healthy. Main sealed every open mission without knowing whether the renderer held anything. | Unit `renderer-evidence-pending-integration` (real store + coordinator: no marker → healthy; marker → "may have been lost" block, per loss path; restart; damaged marker = uncertain; finalized ignored; re-derivation; IPC), `ingest-anomaly-outbox`, `renderer-teardown-coordinator`, `rejection-evidence-delivery`, `polling-manager` [DON-318]; team-smoke `lifecycle` requires healthy evidence after SIGKILL, renderer crash and graceful quit. |
| Watched folder piles up identical "retired" issues on every rescan (Eamonn, 1 Oct) | DON-320 | DON-306's checks used a deliberate import only; no test or smoke step kept a retired file in a watched folder and rescanned it. | Unit `electron-mission-evidence-versioning` (unchanged retired file: no issue, no batch; changed retired file: one issue across rescans; new file still imports), `start-gpx-runtime`, `electron-gpx-evidence-import-runner` [DON-320]; team-smoke `team-mission` rescans the retired file twice and requires no new import issue. |
| Watched folder re-reports a malformed GPX on every rescan (found fixing DON-320) | DON-322 | DON-320 deduped retired files only; no test rescanned a malformed, non-retired file. | Unit `electron-mission-evidence-versioning` [DON-322] (unchanged bad file reports once; changed bytes report again; a retry-type failure is retried; manual import always retries); team-smoke `team-mission` rescans a malformed file twice. |
| Restore a retired GPX track (team request, DON-306 follow-up) | DON-309 | Feature; schema 14. Escape found in development: schema/DDL changes must run the archive suites (DON-322). | Unit `gpx-retire-restore` [DON-309], v2 integration archive round-trip (schema 13 and 14 inside); team-smoke `team-mission` restores by deliberate re-import (same id back), Replay hides it inside the retired gap and shows it before and after, and a watched rescan never restores it. |
| Hidden-gap sweep after Devices "add" silently stopped recording (DON-295) | DON-299 (DON-315/316/317) | Recording was checked only at the end, after backfill had filled any pause, and only after a control was undone; lived-in profiles ran in two checks only. | Unit `recording-ignores-persisted-view-state` (class 1); team-smoke `controls` [DON-315] and live watches in `lifecycle`/`outage` [DON-316], unit `team-smoke-live-recording`; full Chromium suite when a UI control is removed (cadence doc) [DON-317]. Gap: lived-in profiles for tracking/lifecycle/markers-gpx/replay-basemaps still open (DON-317). |
| Mission Control Minimize does nothing (team tester, 30 Sep) | DON-307 | Minimize was only tested on a fresh profile; a finished, unarchived mission silently blocked it while the button still showed. | Unit `workspace-hide-blocked-reason`; E2E `mission.spec.ts` [DON-307]; team-smoke `team-mission` presses Minimize on its lived-in profile. |
| Diagnostics report had no app version and dropped the support report (found triaging the above) | DON-308 | Report tests used short contents; nothing exported a realistic, larger report. | Unit `electron-runtime-files` [DON-308] (version first; 2,000-line report kept and redacted; truncation note). |
| Map recentres on first update | DON-185 | Pre-register. | E2E `map.spec.ts` [DON-185]. |
| Layer tree scroll resets | DON-187 | Pre-register. | E2E `layer-panel.spec.ts` [DON-187]. |
| Map Tools chevron / Devices clicks open Marker Details | DON-186, DON-184 (63/84/119) | Pre-register. | E2E `drawing-tools.spec.ts` [DON-186], `devices-workspace.spec.ts` [DON-184]; unit `map-interaction-guards`. |
| Sector radius wipes entry | DON-88, DON-120/188 | Pre-register. | Unit `drawing-dialog`; E2E `drawing-tools.spec.ts` [DON-188]. |
| Layer toggles / hidden layers reappear | DON-62, DON-85 | Pre-register. | Unit `layer-stale-refresh-integration`; E2E `parity-visibility.spec.ts` DON-85. Gap: no rapid-toggle test across a tracking refresh. |
| DD/DMS converter paste | DON-86, DON-128 | Pre-register. | E2E `coordinate-converter.spec.ts`; unit `coordinate-tool`. Gap: the smoke **coordinates** row covers DD and IG only. |
| Weather links | DON-89/90/127 | Pre-register. | E2E `weather.spec.ts`; settings units. Gap: no packaged open-external check. |
| Breadcrumb gaps, density, exact dots | DON-189, DON-259, DON-260 | Pre-register. | E2E `devices-workspace.spec.ts`; visual tracking; exact-dot units. |
| Warning flashes on healthy polls | DON-261 | Pre-register. | Unit `polling-manager` [DON-261]; E2E `v1-regression`. |
| Review freeze / blocks controls | DON-148, DON-176 | Pre-register. | E2E `mission-review.spec.ts`; bounded audit units. Gap: no 93k-event scale test (manual **Large mission** row). |
| Map Tools fail until Reset Layer Catalog Metadata | DON-118 | Pre-register; hidden persisted catalog state. | E2E `measurement.spec.ts` "reveals hidden Map Tools layers…"; unit `drawing-toolbar`. Gap: no packaged test on a lived-in catalog; add Measure after relaunch to **Team mission scenario**. |
| Test launch differs from the team's | DON-288 | Every smoke run on the test box uses `--ignore-gpu-blocklist` because its GPU is blocklisted (software rendering). Without it, 13.4 shows no map and no message. | Record the flag in every result table as a test-box accommodation. team-smoke `no-gpu-flag` launches without it and requires a drawn map or a visible message [DON-288]. |

Older field regressions are recorded in the Linear Reliability & Regression Ledger.

Identity checks (the first four) must PASS and cannot be excepted. No row may
be NOT APPLICABLE: offline maps are a team workflow (TB13-02).

## Owner-approved exceptions

A FAIL or NOT TESTED row is publishable only with an exception row in the note:

```
## Owner-approved exceptions

Applies to: `electron-v<version>`
Approved AppImage SHA-256: `<64-hex digest approved by Donal>`
Approved .deb SHA-256: `<64-hex digest approved by Donal>`

| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
```

The exception restates the observed result, so a FAIL is never relabelled as a
pass. `Applies to` must match the tag being published, so an approval never
carries into the next release. Both approved artifact digests must match the
current checklist; replacing an artifact requires renewed approval, even under
the same draft tag. The approval reference must cover those exact bytes and
the recorded exposure. Severity must be **Ship with known issue** or
**Backlog**.

## Rules for agents on a release

- One execution owner for the Ubuntu box and the release. A second agent may
  review; it does not co-drive.
- **No rebuild or retag after a failure without Donal's explicit approval.**
  Record the failure, continue the independent checks, report.
- A test-tool fix never requires rebuilding the app. The product is identified
  by its artifact SHA-256; the smoke records its own git SHA separately.
- Report only measured results in the table shape, plus the one decision needed.
- Check the private release-environment note (path in `handoff/HANDOFF.md`) before asking Donal for
  paths, credentials or approvals that are already recorded.
