# Hosted Browser Testing And Parity Plan

> **Current browser-product source of truth.** This document supersedes older assumptions that the Vercel-hosted app is automatically equivalent to the installed Tauri app. Keep it folded into `docs/plugin-parity-matrix.md`, `docs/bead-readiness.md`, and `handoff/HANDOFF.md` whenever browser capability changes.

## Purpose

The hosted Vercel app is now an important testing and possible deployment path. The immediate need is to let the team exercise the current operator surface from a browser while we are honest about durability gaps.

The target direction is browser and Tauri feature parity wherever technically possible. The short-term release can use browser session storage to unblock testing, but it must be labelled as a testing mode and must not be represented as live-incident-grade persistence.

Tracking bead: `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.

## Product Position

- **Tauri desktop app:** current operational-grade runtime with SQLite persistence, WAL mode, backup mirror, filesystem integration, and desktop adapters.
- **Hosted browser testing mode:** near-term Vercel runtime for team testing, backed by browser storage and the HTTPS Traccar proxy.
- **Future browser app:** hardened browser runtime with durable IndexedDB persistence, explicit backup/export/import, and browser-native file handling where appropriate.

## Phase 0: Unblock Team Testing Now

Goal: make the hosted app usable for structured team testing of the current UI and workflows.

Scope:

- Enable mission runtime on Vercel when the URL explicitly opts into hosted browser testing mode.
- Keep session storage as the temporary mission store.
- Keep the Vercel HTTPS Traccar proxy for the team-managed HTTP Traccar server.
- Add visible operator copy that says browser testing mode is temporary/local and not for live incidents.
- Add a manual section with exact setup steps for hosted testing.
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

Phase 0 release standard:

- The team can test as much of the current app as possible from Vercel.
- The app clearly labels the hosted runtime as browser testing mode.
- Known browser limitations are documented in the app/manual, not hidden in chat history.
- No operator should be able to mistake the Phase 0 browser mode for the installed app's durability model.

## Phase 1: Harden Browser Runtime

Goal: turn browser testing mode into a credible standalone browser runtime.

Work items:

- Replace session storage mission state with IndexedDB behind the same mission-store interface where practical.
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

## Phase 2: Deployment Choice

Goal: make browser vs desktop a product choice, not a capability accident.

Decision questions:

- Is the hosted browser app only for testing/training, or can it become field-operational?
- Does the team need shared multi-machine mission state?
- Are mission records allowed to stay local to a browser profile?
- What are the retention and export expectations for incident records?
- Which file workflows must work in browser before the hosted app can be recommended outside testing?

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

## Immediate Phase 0 Implementation Checklist

- [x] Enable `?missionHarness=1` on hosted Vercel browser builds.
- [x] Add a visible browser-testing banner or status treatment in the app shell.
- [x] Add hosted browser testing instructions to the operator manual.
- [x] Update README and parity docs to name the hosted runtime explicitly.
- [x] Add or update tests for hosted browser testing mode gating.
- [ ] Deploy to Vercel.
- [ ] Validate the hosted flow with live Traccar credentials.
- [ ] Record final proof and remaining limits in `handoff/HANDOFF.md`.
