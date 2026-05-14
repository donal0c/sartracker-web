# HANDOFF.md — Live Baton

> Read this before doing any work. Keep it short. This is the baton, not the project diary.

## Last Updated

- 2026-05-14 by Codex — planning docs consolidated into one active path: `docs/two-track-execution-workplan.md`.

## Operating Rule

The single active planning path is `docs/two-track-execution-workplan.md`.

All new work must be routed there before implementation:

- Track A: hosted team testing
- Track B: Tauri operational readiness
- Shared foundation
- Verification
- Deferred / decision-gated

Supporting docs may explain details, but they must not become separate queues. The old hardening backlog has been folded into the two-track workplan and removed as an active board.

## Current State

- `master` is the canonical working branch.
- The hosted Vercel test lane is live at `https://sartracker-web.vercel.app/?missionHarness=1`.
- Hosted browser mode is testing/training only. It uses browser session storage and should not be treated as operational mission persistence.
- Hosted Traccar testing uses the Vercel same-origin proxy:
  - app URL: `https://sartracker-web.vercel.app/?missionHarness=1`
  - Traccar provider base URL in hosted mode: `https://sartracker-web.vercel.app`
  - direct `http://kmrtsar.ddns.net:8082` is valid for desktop/Tauri, but browsers block it from the HTTPS hosted app.
- Latest deployed production URL has command-line validation for proxy endpoints:
  - `/api/session` returned 200 for the team credentials
  - `/api/devices` returned the 18-device roster
  - `/api/positions` returned 14 positions
- Full hosted UI validation from the live page still needs an interactive browser pass unless the user tests it directly.

## Active Planning Docs

- `docs/two-track-execution-workplan.md` — canonical queue and next-task order.
- `docs/hosted-browser-testing-plan.md` — product/deployment strategy.
- `docs/team-testing-feedback-loop.md` — tester instructions and bug template.
- `docs/tauri-beta-release-plan.md` — supporting desktop beta release detail.
- `docs/reports/deep-hardening-investigation-2026-05-13.md` — historical evidence only; not an active backlog.

## Next Task

Default next task when the user says “go” or “work on the next task”:

1. `A2: Hosted Mode Guardrails` in `docs/two-track-execution-workplan.md`
2. Bead: `sartracker-web-vpz.3`
3. Goal: stop testers entering the direct HTTP Traccar URL in hosted browser mode and getting confusing browser/network failures.

After A2, the default next task is `S1: Runtime Boot/Fault Guard`, folded from the former hardening T06 item.

## Open Beads That Matter Now

- `sartracker-web-vpz` — Hosted browser testing mode and parity hardening.
- `sartracker-web-vpz.1` — A1 hosted testing instructions and feedback intake.
- `sartracker-web-vpz.2` — B1 Tauri beta packaging reconnaissance.
- `sartracker-web-vpz.3` — A2 hosted mode guardrails for Traccar URL confusion.

Older parity/UI beads still exist, but new work should be selected through the two-track workplan unless the user explicitly asks for a specific bead.

## Known Limits

- Browser mode is not durable enough for live incidents.
- Browser mode does not yet have IndexedDB mission persistence, browser backup/export/import, or browser-native filesystem parity.
- Desktop/Tauri is the intended operational lane for SQLite persistence, filesystem workflows, diagnostics, GPX watch/import, archives, and proprietary HD map packages.
- High-definition mountain maps should be local desktop map packages unless requirements change.

## Verification Snapshot

Most recent completed verification before this planning cleanup:

- `npm run lint` passed.
- `npm run test` passed.
- `npm run build` passed.
- `npm run test:backend` passed.
- Hosted proxy command-line checks against live Traccar succeeded.

This planning cleanup is documentation-only. No runtime tests were required.
