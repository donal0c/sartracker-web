# Tauri Beta Release Plan

> Supporting Phase 1 beta detail. The active queue and next-task order live in `docs/two-track-execution-workplan.md`; update that workplan before treating new beta work as planned.

## Purpose

The hosted browser build is the fast feedback lane. The Tauri beta lane is where we validate the operational runtime: durable mission records, filesystem-backed workflows, local map packages, recovery, diagnostics, and install/update friction.

The first beta does not need to be polished or auto-updating. It needs to be repeatable, identifiable, and honest about limitations.

## Phase 1 Goal

Produce a repeatable desktop beta process that lets the team test the installed app without bespoke developer intervention each time.

## Release Channel Stance

- Initial beta artifacts can be distributed through GitHub Releases or another controlled shared location.
- Code signing, notarization, Windows SmartScreen reputation, and auto-update are important, but they do not need to block the first internal beta unless the team machines reject unsigned builds.
- Every beta must include a visible build/version and a short release note.
- Vercel remains the place for rapid UI iteration between beta packages.

## Work Chunks

### B1: Packaging Recon

Status: done 2026-05-16.

Questions to answer:

- What exact command builds the packaged app on this machine?
- Which package formats are produced?
- Where are artifacts written?
- Does the current build require signing credentials?
- What warnings appear on macOS/Windows?
- Which target OS does the team need first?

Expected commands to investigate:

```bash
npm run tauri build
npm run build
npm run test:backend
```

Do not assume these are sufficient until run and recorded.

Deliverable:

- Update this file with the actual command, artifact path, package format, warnings, and blockers.

Result from the current macOS development machine:

| Item | Result |
| --- | --- |
| Machine/runtime | macOS arm64 development machine; Node `v22.17.1`; npm `10.9.2`; Rust `1.94.1`; Cargo `1.94.1`; Tauri CLI `2.10.1` |
| Configured command | `npm run tauri build` |
| Reliable first-beta command on this machine | `npm run tauri build -- --bundles app` |
| App artifact | `src-tauri/target/release/bundle/macos/sartracker-web.app` |
| Release binary | `src-tauri/target/release/sartracker-web` |
| App size | about 25 MB |
| Zip command for sharing | `ditto -c -k --keepParent src-tauri/target/release/bundle/macos/sartracker-web.app tmp/beta-artifacts/sartracker-web_0.1.0_aarch64.app.zip` |
| Zip artifact from recon run | `tmp/beta-artifacts/sartracker-web_0.1.0_aarch64.app.zip` at about 15 MB |
| macOS install path | unzip, then drag/copy `sartracker-web.app` to `/Applications`; for local smoke testing it can also be opened from the extracted folder |
| Windows artifact | not produced from this macOS run; needs a Windows build host or explicit cross-build plan |
| Windows install path assumption | unknown until Windows packaging is run; expect installer-managed install location rather than promising one in beta notes |

Important findings:

- `npm run tauri build -- --bundles app` completed successfully and produced a macOS arm64 `.app` bundle.
- `npm run tauri build` compiled the release binary and produced the `.app`, but failed during DMG bundling at the generated `bundle_dmg.sh` step. Tauri reported:
  `failed to bundle project error running bundle_dmg.sh`.
- The failed DMG run left a temporary writable image at
  `src-tauri/target/release/bundle/macos/rw.64181.sartracker-web_0.1.0_aarch64.dmg`.
  Treat that file as a failed intermediate, not a shareable installer.
- Current signing is ad-hoc/linker-signed only. `spctl -a -vvv -t open src-tauri/target/release/bundle/macos/sartracker-web.app`
  rejected the app with `source=Insufficient Context`. This is expected for an unsigned internal beta and should be called out in any sharing instructions.
- `codesign -dv --verbose=4` reports `Signature=adhoc`, `TeamIdentifier=not set`,
  `Info.plist=not bound`, and `Sealed Resources=none`.
- No Developer ID signing, notarization, or stapling was configured or attempted.

Recommendation for the first internal beta:

- Use the macOS arm64 `.app` bundle zipped with the `ditto` command above if the first testers are on Apple Silicon Macs and can accept unsigned beta warnings.
- Do not treat DMG packaging as ready. Create a follow-up blocker if a DMG is required before the first internal beta.
- Do not promise Windows install behavior until B1-equivalent packaging has been run on a Windows machine or CI runner.

### B2: Release Note Template

Status: ready. B1 found a usable macOS `.app` path, so release notes can now target that artifact while DMG packaging remains a known limitation.

Each beta release note should use this shape:

```md
# SAR Tracker Desktop Beta <version/build>

## Install

- Artifact:
- Platform:
- Install/open steps:
- Known OS warnings:

## What Changed

-

## What To Test

-

## Known Limitations

-

## Rollback / Reinstall

-

## Verification Before Sharing

- [ ] npm run lint
- [ ] npm run build
- [ ] npm run test
- [ ] npm run test:backend
- [ ] packaged app launches
- [ ] mission can be started
- [ ] app restart/recovery path checked
- [ ] tracking settings checked where relevant
```

Deliverable:

- Add the first draft beta release note under `docs/releases/` or another agreed release-notes location when the first beta artifact exists.

### B3: First Internal Smoke Build

Status: ready after B2 release-note template. B1 identified a usable macOS `.app` output, but the smoke pass should use a release note or at least the B2 template so testers receive the known unsigned-app limitations with the artifact.

Smoke path:

1. Install/open the packaged app.
2. Confirm build/version is visible in the mast.
3. Start a mission.
4. Pause/resume/finish the mission.
5. Restart the app and confirm recovery/persistence behavior.
6. Configure Traccar if credentials are available and confirm connection.
7. Open Diagnostics and confirm export/open behavior.

Deliverable:

- Record result in `handoff/HANDOFF.md`.
- If smoke passes, create a shareable beta release note.
- If smoke fails, create a bead for the blocker.

## Beta Release Gate

Before sharing a desktop beta outside the dev machine:

- The app must build cleanly.
- The packaged app must open.
- Mission start must work.
- Persistence/restart behavior must be checked.
- Known limitations must be written down.
- The artifact must have a visible version/build ID.

## Not In Phase 1

- Auto-update.
- Polished installer UX.
- Full signing/notarization unless required to run.
- High-definition map integration.
- Browser IndexedDB hardening.
- Stable operational release.

## Open Questions

- Which OS should be targeted first? Current recon only proves macOS arm64 packaging.
- Are unsigned beta builds acceptable for the first testing pass? Current app is ad-hoc signed and rejected by `spctl`.
- Where should beta artifacts live? The recon zip is local only under `tmp/beta-artifacts/`.
- How often can the team reasonably install beta updates?
- Who on the team will test desktop installation?
- Is a DMG required for the first internal beta, or is a zipped `.app` acceptable?
