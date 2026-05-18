# Deployment Strategy And Hosted Browser Testing Plan

> **Current deployment-product source of truth.** This document supersedes older assumptions that the Vercel-hosted app is automatically equivalent to the installed Tauri app. Keep it folded into `docs/plugin-parity-matrix.md`, `docs/bead-readiness.md`, and `handoff/HANDOFF.md` whenever browser, desktop, map, or release-channel capability changes.

## Purpose

The team needs fast access to the app for feedback, but the eventual field runtime must be reliable under search-and-rescue conditions: durable mission records, offline/high-definition maps, clear recovery, controlled credentials, and predictable deployments.

The strategy is **not** to force browser and Tauri into full parity immediately. The strategy is to use each runtime where it is strongest:

- Vercel/hosted browser for rapid surface-level testing and team feedback.
- Tauri desktop for operational readiness, field use, large map bundles, filesystem integration, and durable persistence.

Shared React UI and domain logic should stay common. Platform-specific concerns should live behind explicit adapters.

Tracking Linear issue: `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.

Supporting execution docs:

- `docs/two-track-execution-workplan.md` — single active planning path and next-work queue.
- `docs/team-testing-feedback-loop.md` — supporting tester instructions, bug template, and triage buckets.
- `docs/tauri-beta-release-plan.md` — supporting Phase 1 desktop beta packaging and release-note details.

## Product Position

- **Hosted browser testing mode:** the fast feedback channel. It should let the team test the app surface, tracking, layers, mission controls, drawing/marker flows, devices, and general ergonomics with minimum deployment friction.
- **Tauri desktop beta:** the operational rehearsal channel. It should be used once a batch needs persistence, filesystem, map-package, or restart/recovery validation.
- **Tauri desktop stable:** the field-readiness channel. It should be used for real incident preparation only after beta validation and explicit release notes.
- **Future hardened browser app:** optional. It becomes first-class only if the team has a real need for browser deployment beyond testing/training and we deliberately solve browser persistence, backups, secrets, offline maps, and file workflows.

## Strategic Decision

Tauri should be the primary operational runtime for the foreseeable future.

Reasons:

- High-definition mountain maps are likely to be large local packages. Desktop filesystem access is the cleaner and safer path for storing, indexing, validating, and updating them.
- SQLite with WAL mode and backup mirror already gives us a strong mission-record foundation.
- Field use needs fewer surprises around browser storage quotas, cache eviction, permissions, and offline behavior.
- GPX watch/import, marker attachments, diagnostics exports, and incident archives are naturally desktop/file workflows.
- The team still needs fast iteration; Vercel is excellent for that, but it should remain a testing lane until hardened.

This means we should not spend early energy trying to make the browser app operationally equal to Tauri. We should instead keep the browser path useful, honest, and intentionally limited while the desktop path becomes the field app.

## Release Lanes

| Lane | URL / artifact | Purpose | Persistence | Who uses it | Release cadence |
| --- | --- | --- | --- | --- | --- |
| Hosted browser latest | `https://sartracker-web.vercel.app/?missionHarness=1` | Fast testing of the current surface | Browser session storage | Team testers and product reviewers | Every useful change |
| Hosted browser preview | Vercel preview deployments | Review a branch before it becomes latest | Browser session storage | Maintainers/testers | Per change/PR when useful |
| Tauri beta | Versioned installer/package from GitHub Releases or equivalent | Validate operational runtime, persistence, files, maps, recovery | SQLite + filesystem | Smaller trusted test group | After coherent batches |
| Tauri stable | Promoted beta build | Field-ready operational release | SQLite + filesystem | Operational users | Deliberate, less frequent |

## Phase 0: Surface-Level Hosted Testing

Goal: make the hosted app useful for structured team testing without pretending it is operational-grade.

This is the current phase.

What the team should test in this phase:

- app shell and layout
- mission start/pause/resume/finish as an operator workflow
- live Traccar connection via the Vercel proxy
- tracking display, devices workspace, stale/offline states
- layer visibility, filtering, inspection, and map overlay behavior
- markers, drawings, measurements, coordinate display
- general usability, terminology, button placement, and confusion points

What the team should not treat as final in this phase:

- mission durability after browser/session loss
- field offline readiness
- long-term incident records
- secrets storage
- desktop file workflows
- high-definition mountain map package handling

Implementation scope:

- Use `?missionHarness=1` to enable browser testing mode on Vercel.
- Use session storage as the temporary mission store.
- Use the Vercel HTTPS Traccar proxy for the team-managed HTTP Traccar server.
- Guard hosted Settings against direct `http://` Traccar provider URLs, and offer the hosted proxy base URL as the safe default.
- Keep visible operator copy that says browser testing mode is temporary/local and not for live incidents.
- Keep manual instructions with exact setup steps for hosted testing.
- Validate the hosted flow end to end:
  - open hosted browser testing URL
  - configure Traccar with `https://sartracker-web.vercel.app`
  - authenticate with the provided team credentials
  - start a mission
  - confirm tracking status, devices, and current positions render
  - refresh once and record what browser state does and does not preserve

Out of scope for Phase 0:

- production-grade browser persistence
- multi-machine shared missions
- secure long-lived browser credential storage
- full offline map packages
- browser-native replacement for every desktop filesystem workflow

Phase 0 exit standard:

- The team can test as much of the current app as possible from Vercel.
- The app clearly labels the hosted runtime as browser testing mode.
- Known browser limitations are documented in the app/manual, not hidden in chat history.
- No operator should be able to mistake the Phase 0 browser mode for the installed app's durability model.
- Feedback from the team is triaged into:
  - app-surface fixes that can ship quickly to Vercel
  - desktop-runtime issues that need Tauri beta validation
  - future hardening items

## Phase 1: Tauri Beta Release Foundation

Goal: make it easy to give the team packaged desktop builds without turning every small change into a manual deployment chore.

Scope:

- Define a repeatable Tauri build command and artifact location.
- Produce versioned beta builds with visible app version/build ID.
- Write a short beta release note template:
  - what changed
  - what to test
  - known limitations
  - rollback/reinstall guidance
- Decide initial distribution mechanism:
  - GitHub Releases is enough for beta unless signing/auto-update becomes urgent.
  - Auto-update can come later, after build/signing/release cadence is stable.
- Confirm installer/package behavior on target team machines.
- Keep Vercel as the fast feedback lane between desktop beta batches.

Phase 1 exit standard:

- A maintainer can produce a desktop beta build repeatably.
- The team can install/run it without bespoke developer help each time.
- Each desktop beta has a matching release note and build ID.
- The same workflow tested on Vercel can be re-tested against the desktop runtime for persistence/file/map behavior.

Detailed Phase 1 execution plan: `docs/tauri-beta-release-plan.md`.

## Phase 2: Desktop Operational Core

Goal: make Tauri the trustworthy operational runtime.

Scope:

- Validate SQLite mission lifecycle, recovery, backup mirror, archive/export, and audit behavior in the packaged app.
- Validate real Traccar connectivity and credential handling in desktop settings.
- Validate GPX import/watch, marker attachments, diagnostics export/open, and mission review flows against the filesystem.
- Add operator-facing recovery guidance for interrupted/paused missions.
- Keep browser testing available for fast UI feedback, but do not use it as proof of desktop persistence correctness.

Phase 2 exit standard:

- A desktop beta can run a full mission rehearsal without relying on browser-only storage.
- Operators can recover from restart/interruption in the packaged app.
- The team can export or inspect incident records according to the current workflow.

## Phase 3: High-Definition Mountain Maps And Offline Readiness

Goal: integrate the provided mountain maps in the runtime most likely to behave well in the field.

Default stance: desktop-first.

Scope:

- Inventory the map deliverables:
  - format
  - projection/CRS
  - file size
  - tiling strategy
  - update cadence
  - license/usage constraints
- Decide map packaging:
  - bundled with the app
  - separate downloadable map package
  - local folder selected by operator/maintainer
  - versioned map pack managed alongside app releases
- Validate map rendering and coordinate alignment against known points.
- Validate offline behavior with network disabled.
- Add visible map package/version/readiness status in the app.
- Keep browser map use limited to hosted/online test layers unless a separate browser offline-map design is justified.

Phase 3 exit standard:

- Desktop app can use the high-definition mountain maps predictably.
- Operators can see whether the required map package is available.
- Offline map failure modes are visible, not silent.

## Phase 4: Browser Hardening Decision

Goal: decide whether browser should remain a testing lane or become a first-class operational option.

Only start this after the team has tested the surface and we understand whether browser deployment solves a real operational problem.

Work items:

- Decide if browser operational mode is actually needed.
- If yes, replace session storage mission state with IndexedDB behind the same mission-store interface where practical.
- Add explicit browser backup/export/import for missions.
- Add restart/recovery behavior equivalent to desktop where possible.
- Decide and document browser secret handling:
  - short-lived in-memory credentials
  - optional operator re-entry after reload
  - possible future encrypted local storage only after a deliberate design pass
- Add browser-compatible diagnostics export using downloads rather than filesystem paths.
- Add browser-native GPX file import using file picker APIs.
- Decide whether marker attachments use IndexedDB, browser File System Access API, or remain desktop-only.
- Add automated browser-mode parity tests for mission lifecycle, tracking, layers, review, diagnostics, and import/export.

Phase 4 exit standard:

- Either browser is formally kept as testing/training only, or it has a real persistence/export/recovery design and release criteria.
- The team is not left with two confusing "sort of operational" versions.

## Phase 5: Stable Operational Release

Goal: promote a tested desktop build to the recommended operational release.

Scope:

- Freeze a release candidate.
- Run full verification:
  - unit tests
  - backend tests
  - E2E/visual workflow coverage
  - packaged Tauri smoke test
  - live Traccar test
  - offline map test
  - mission recovery test
- Publish release notes and known limitations.
- Provide install/update instructions.
- Keep Vercel latest available for ongoing feedback, clearly labelled as testing.

## Open Product Questions

These should be answered before browser or desktop stable claims expand:

- Is the hosted browser app only for testing/training, or can it become field-operational?
- Does the team need shared multi-machine mission state?
- Are mission records allowed to stay local to a browser profile?
- What are the retention and export expectations for incident records?
- Which file workflows must work in browser before the hosted app can be recommended outside testing?
- How large are the provided mountain map datasets, and how often will they change?
- Do teams expect automatic desktop updates, or is a controlled manual beta/stable release acceptable at first?
- What operating systems and machine restrictions do the team laptops have?
- Who is allowed to configure tracking credentials and map packages?
- What is the minimum field-offline guarantee before the desktop app is considered operationally useful?

Possible outcomes:

- Tauri remains the recommended live-incident app; browser remains training/testing.
- Browser becomes a first-class local-only runtime with IndexedDB plus export/import.
- Browser grows a backend for shared missions, audit records, and managed credentials.

## Current Browser/Tauri Capability Snapshot

| Capability | Hosted browser Phase 0 | Tauri desktop |
| --- | --- | --- |
| App shell and map | Available | Available |
| Mission start/pause/resume/finish | Available once browser testing mode is enabled | Available |
| Mission persistence | Session storage only | SQLite, WAL, backup mirror |
| Crash/restart recovery | Limited browser-session behavior | Persisted recovery prompt |
| Traccar live connectivity | Vercel HTTPS proxy to configured upstream | Direct configured provider |
| Tracking devices/current positions | Available after mission start | Available |
| Tracking history persistence | Temporary browser store | Persisted mission store |
| Settings secrets | In-memory/session-limited browser handling | Desktop settings/secret path |
| GPX import/watch | Limited or unavailable | Desktop filesystem-backed |
| Marker attachments/files | Limited or unavailable | Desktop filesystem-backed path |
| Diagnostics export/open path | Browser-compatible path still needed | Desktop filesystem-backed |
| Offline map resilience | Viewed-tile browser cache only | Viewed-tile cache today; stronger packaged offline work still open |
| High-definition mountain maps | Not planned for Phase 0 | Desktop-first integration target |

## Immediate Phase 0 Implementation Checklist

- [x] Enable `?missionHarness=1` on hosted Vercel browser builds.
- [x] Add a visible browser-testing banner or status treatment in the app shell.
- [x] Add hosted browser testing instructions to the operator manual.
- [x] Add hosted Settings guardrails for direct HTTP Traccar URLs.
- [x] Update README and parity docs to name the hosted runtime explicitly.
- [x] Add or update tests for hosted browser testing mode gating.
- [x] Deploy to Vercel.
- [x] Validate hosted asset/proxy delivery with live Traccar credentials by command-line checks.
- [ ] Validate the full browser UI flow from the hosted page.
- [x] Record final proof and remaining limits in `handoff/HANDOFF.md`.
