# HANDOFF.md — Current state

Updated 2026-09-28. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.4** is the published controlled team beta (not for live incidents);
  immutable. See its [release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- Foundation reset (P01–P05) is complete; CI 36445372627 passed.
- **DON-281 (R01)** complete on master (6a7cfd53), Linux-validated; unreleased.

## Verification limits

- DON-281: CI 36454746119 and exact-AppImage Ubuntu recovery proof (see
  DON-281). Development-package proof only, not a release.
- Crash marker "was lost" wording overstates; recorded for 1.8, needs Donal.

## Next action

**1.1 / DON-282 reviewed; Linux CI/package proof pending, not released.**
Fix 019ccdbe + rollback repair 2a6cc03f. Codex: 21 focused tests pass;
Mac package built; packaged store/worker upgrade, promotion and three opens
pass. Real packaged UI retains the honest reconciliation warning. This is
synthetic Mac proof, not Linux or live Traccar proof. Cursor remains 1.1.
Detail: `sartracker-web/tmp/claude-handoffs/03-legacy-upgrade-coverage-result.md`.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
