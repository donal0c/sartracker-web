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

Status: ready.

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

### B2: Release Note Template

Status: ready.

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

Status: blocked until B1 identifies the build output.

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

- Which OS should be targeted first?
- Are unsigned beta builds acceptable for the first testing pass?
- Where should beta artifacts live?
- How often can the team reasonably install beta updates?
- Who on the team will test desktop installation?
