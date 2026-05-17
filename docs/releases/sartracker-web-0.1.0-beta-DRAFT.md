# SAR Tracker Desktop Beta 0.1.0 (sha.5d3ba8ad7603)

> **Draft, not yet shared.** Produced as the dry-run release note that
> proves the B2 beta release template end-to-end. No artifact has been
> uploaded to a distribution channel for this draft. Do not hand this to
> testers as-is.

> **Internal beta only.** Not a production release. Do not use for live
> incidents until this beta has passed the desktop smoke checklist below and
> a team member has signed off in writing.

- **Version:** 0.1.0
- **Build tag:** sha.5d3ba8ad7603 (dry-run; the real beta cut must rerun
  `npm run beta:verify` and use the build tag from that run's report)
- **Cut date (UTC):** 2026-05-17
- **Cut by:** Claude Opus 4.7 (B2 dry run)
- **Bead reference:** sartracker-web-xhz
- **Verification report:** tmp/beta-artifacts/verify-0.1.0-sha.5d3ba8ad7603-2026-05-17T06-34-52Z.json

## Install

- **Artifact:** sartracker-web_0.1.0_aarch64.app.zip (not produced for this
  dry run; B1 produced the equivalent zip from the same machine on
  2026-05-16)
- **Platform:** macOS 13+, Apple Silicon (arm64)
- **Distribution channel:** GitHub Releases draft on donal0c/sartracker-web,
  internal beta tag (not yet uploaded for this dry run)
- **Install / open steps:**
  1. Download the zip from the agreed internal channel.
  2. Unzip and copy `sartracker-web.app` to `/Applications` (or run from the
     extracted folder for local smoke tests).
  3. Open the app from `/Applications` or the extracted folder.
- **Known OS warnings:**
  - macOS Gatekeeper rejects the bundle with `source=Insufficient Context`
    because it is ad-hoc signed only.
  - First-launch dialogs may say Apple cannot verify the developer or that
    the app may be damaged. This is expected for the current internal beta
    lane.
- **macOS unsigned app guidance:**
  - Try **Control-click / right-click → Open** first.
  - If quarantine still blocks launch, follow the
    `xattr -dr com.apple.quarantine` guidance in the operator manual under
    "Desktop Beta". Do not run quarantine-removal commands from any other
    source.
  - If a managed Mac blocks unsigned apps by policy, stop and report the
    blocker — do not bypass managed security settings.

## What Changed

- B2: Tauri Beta Release Template — checked-in template, beta verification
  gate, and release-note workflow now live in the repo
  [sartracker-web-xhz].
- This is a dry-run release note. No code changes ship in the artifact
  beyond what was already on `master` at sha 5d3ba8ad7603.

## What To Test

- (Dry run — no live testing). For the first real beta, populate this
  section with operator workflows that exercise: mission start, mission
  pause/resume/finish, restart-and-recover, Traccar configure-and-connect,
  Diagnostics export/open, layer visibility, and marker placement.

## Known Limitations

- macOS arm64 only; no Windows/Linux artifacts in this drop.
- Ad-hoc signed only; expect Gatekeeper warnings on macOS.
- DMG packaging is not currently produced; a zipped `.app` is the only
  shareable artifact.
- High-definition mountain map packages are not bundled with this build.
- Browser hosted-mode persistence is testing-only and not part of this
  desktop beta.

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
gate must end with `OVERALL: PASS` and no `WARNING: ... skipped` line.

For this dry run, only the `lint` step was executed via
`npm run beta:verify -- --steps lint --no-smoke`, so the checklist below
intentionally remains unchecked. The first real beta cut must rerun the
gate without `--steps` filters and check every box.

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
