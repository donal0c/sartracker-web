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
| Mission lifecycle and crash recovery | Start, pause, SIGKILL, renderer crash, graceful quit, resume; fixes gap-free; window X close is not reported as a crash | team-smoke `lifecycle`; window X close by hand |
| Tracking matches provider exactly | Every stored fix equals the real-time mock's coordinates and time | team-smoke `tracking` |
| Provider outage warning and backfill | Visible warning during a 90 s outage; zero-gap backfill after | team-smoke `outage` |
| Live Traccar | One approved device, GET-only, stored fixes equal provider | Manual |
| Coordinate conversion and rejection | Known round trip; invalid input rejected with clear messages | team-smoke `coordinates` |
| Markers, attachments and GPX import | Marker saved; attachment byte-identical; GPX points imported and shown | team-smoke `markers-gpx`; native picker by hand |
| Replay, basemaps and layers | Replay reconstructs a past time; live map unaffected; public basemaps render; layer toggles work | team-smoke `replay-basemaps`; render/layer checks by hand |
| Encrypted archive create and reopen | Finish, archive, restart, reopen read-only; wrong passphrase refused | team-smoke `archive` |
| Settings, secrets and support bundle | Settings persist; secret never echoed; bundle has no secret or home path | team-smoke `settings-support` |
| Large mission opens responsive | One representative large mission opens and stays responsive | Manual with a large fixture |
| Packaged soak | CI packaged soak green; plus one overnight installed soak when tracking or storage changed | CI link; overnight log |
| Strict responsiveness (<200 ms) | Release workflow strict responsiveness step green | CI link |
| Offline map package | Package imports and renders offline, or NOT APPLICABLE with reason | Manual |

Identity checks (the first four) must PASS and cannot be excepted. Only
**Offline map package** may be NOT APPLICABLE.

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
