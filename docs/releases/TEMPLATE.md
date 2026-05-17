# SAR Tracker Desktop Beta &lt;version&gt; (&lt;build tag&gt;)

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** &lt;e.g. 0.1.0&gt;
- **Build tag:** &lt;e.g. sha.f352391035a1 or run.42.sha.abc123def456&gt;
- **Cut date (UTC):** &lt;YYYY-MM-DD&gt;
- **Cut by:** &lt;name or agent ID&gt;
- **Bead reference:** &lt;sartracker-web-XXXX&gt;
- **Verification report:** &lt;relative path under tmp/beta-artifacts/&gt;

## Install

- **Artifact:** &lt;e.g. sartracker-web_0.1.0_aarch64.app.zip&gt;
- **Platform:** &lt;e.g. macOS 13+, Apple Silicon (arm64)&gt;
- **Distribution channel:** &lt;e.g. GitHub Releases draft on donal0c/sartracker-web, internal beta tag&gt;
- **Install / open steps:**
  1. Download the zip from the agreed internal channel.
  2. Unzip and copy `sartracker-web.app` to `/Applications` (or run from the
     extracted folder for local smoke tests).
  3. Open the app from `/Applications` or the extracted folder.
- **Known OS warnings:** &lt;list per-OS warnings the tester should expect&gt;
- **macOS unsigned app guidance:**
  - The current beta is ad-hoc signed. macOS may refuse to open it and may
    say Apple cannot verify the developer.
  - Try **Control-click / right-click → Open** first.
  - If quarantine blocks launch, run the project-supplied quarantine-removal
    command from the operator manual. Do not run quarantine-removal commands
    from any other source.
  - If a managed Mac blocks unsigned apps by policy, stop and report the
    blocker — do not bypass managed security settings.

## What Changed

- &lt;short, operator-readable bullet list of changes since the previous beta&gt;
- &lt;include bead IDs in square brackets&gt;

## What To Test

- &lt;short list of operator workflows the tester should exercise&gt;
- &lt;mark any items as critical so testers know which signal to prioritise&gt;

## Known Limitations

- &lt;explicit limitations the tester must understand before running the beta&gt;
- For the current internal beta lane this normally includes:
  - macOS arm64 only; no Windows/Linux artifacts in this drop.
  - Ad-hoc signed only; expect Gatekeeper warnings on macOS.
  - DMG packaging is not currently produced; a zipped `.app` is the only
    shareable artifact.
  - High-definition mountain map packages are not bundled with this build.

## Rollback / Reinstall

- **To roll back to a previous beta:**
  1. Quit the running app.
  2. Move the current `/Applications/sartracker-web.app` to the bin or to a
     versioned holding folder.
  3. Reinstall the older beta from its release note.
- **To reinstall the same beta:**
  - Quit the app, replace `/Applications/sartracker-web.app` with the
    extracted bundle, and reopen.
- **Mission data:** Mission databases live under the app's local data
  directory and are not deleted by reinstalling the bundle. If mission data
  is suspected of corruption, capture diagnostics first and do not delete
  anything until the issue is recorded.

## Verification Before Sharing

Run `npm run beta:verify` and attach the resulting JSON report path. The
gate must end with `OVERALL: PASS` and no `WARNING: ... skipped` line. If
any step needed to be skipped, do not share the beta.

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run test:backend`
- [ ] `npm run tauri build -- --bundles app` produced a packaged app
- [ ] Packaged app launches
- [ ] Build/version is visible in the mast
- [ ] A new mission can be started
- [ ] Mission persists after closing and reopening the app
- [ ] Tracking settings can be opened and saved
- [ ] Diagnostics export/open works
- [ ] Release note includes the unsigned/Gatekeeper warning
- [ ] Verification report from `tmp/beta-artifacts/` referenced above
