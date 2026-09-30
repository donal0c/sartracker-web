# HANDOFF.md — Current state

Updated 2026-09-30. Issue order and known 13.4 issues: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md).

## Status

- **beta.13.4** is the published controlled team beta (not for live incidents);
  immutable. See its [release note](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).
- Foundation reset (P01–P05) is complete; CI 36445372627 passed.

## Verification limits

- All proofs are synthetic providers on the Ubuntu box, not live Traccar or
  field acceptance. Per-issue evidence and hashes are in Linear (DON-281/282/291/292/294).
- The crash-marker "was lost" wording overstates (1.8, needs Donal).
- The box auto-suspends when idle; the sleep inhibitor is denied over SSH. Ask
  Donal to run `sudo systemctl mask sleep.target suspend.target`.

## Next action — beta.13.5 retag after DON-295

First candidate (tag at d10ba78f, CI 36677312888, AppImage `85fe6a16…`): box
smoke all automated steps PASS except known DON-284 (lifecycle) and DON-285
(unwritable profile); offline-map verified the team's package. Then the
manual-refresh pass found **DON-295**: Devices "Add" hid and stopped recording
all other participants (reproduced packaged; 13.4 has it too). Donal: fix in
13.5, remove the button, rebuild and retag approved (30 Sep).

Fix 984e3abd (legacy list removed), smoke step af694cf2, note 9700b3ad.
Codex review eb1e913fae51: no blockers; its smoke point is applied. Full
correctness 6,235 passed (2 load-induced timeouts, pass alone). Chromium
specs 20/20. Mac package team-mission: no findings.

Next:
1. Falsify the new team-mission step on the old draft (box
   `~/sartracker-13.5-smoke/falsify-295`): it must report the Add control.
2. Push, delete the draft release and tag, retag `electron-v0.1.0-beta.13.5`
   at the new HEAD, and wait for CI.
3. Re-run the full box smoke on the new draft assets (same flags; upgrade
   profile and --map-package as before); tool checkout at the new HEAD.
4. Manual rows (window-X, GPX picker, basemap glance, live Traccar), note table
   and hashes, Donal's go/no-go, guarded publish, fresh-download check.
5. Tell the manual-refresh session (`sartracker-foundation-reset-b6`, branch
   docs/manual-refresh) when the fix is on origin/master so it can recapture
   the Devices screenshots.
Obsolete: `scripts/release-smoke/breadcrumb-live-exact-smoke.mjs` clicks the
removed button (not in CI). Backlog: 8 cosmetic items on DON-295.
**DON-293** (replay of backfilled history) awaits the team's answer.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
