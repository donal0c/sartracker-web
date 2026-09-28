# HANDOFF.md — Current state

Updated 2026-09-28. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.4** is the published controlled team beta (not for live incidents);
  immutable. See its [release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- Foundation reset (P01–P05) is complete; CI 36445372627 passed.
- **DON-281 (R01)** is fixed on master (6a7cfd53). Codex has reviewed and
  pushed it, and accepted its scope during review. It is not in any release.

## Verification limits

- DON-281 passed local and Codex checks: unit, Chromium e2e, full correctness
  and a macOS packaged crash → archive probe. **Linux CI and the Linux packaged
  check are still pending (Codex).**
- The outbox durability defect is not established. The crash marker is written
  for every open mission; its "was lost" wording overstates that. This is a
  recorded finding: do not change it without Donal.

## Next action

Codex finishes Linux CI and the packaged check for DON-281. Start no other
product slice until that is done. After that, follow the workplan's issue order.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
