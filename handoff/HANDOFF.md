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

## Next action — beta.13.5: publish when the live check passes

**Go given by Donal (30 Sep)** on draft `electron-v0.1.0-beta.13.5` (0ed54a4a,
CI 36695835717): AppImage `52254f13…`, .deb `3e0197b2…`. Exceptions DON-284,
DON-285 and DON-304, layer toggles and the overnight soak are approved.
**Donal then chose to hold publication until the live Traccar check passes**:
the server was unreachable on 30 Sep.

- The box watcher `~/sartracker-13.5-smoke/live-watch/watch.sh` checks the
  server every 3 min for 12 h, then runs team-smoke `live-traccar` once
  (installed 13.5, approved device, GET-only). Result is in `live-watch/result`.
- PASS: set the Live Traccar row to PASS, remove its exception, then
  `npm run electron:release:publish -- --tag electron-v0.1.0-beta.13.5 --check-notes …`,
  dry-run, and publish. Then check a fresh download and draft the team note.
- FAIL: stop and tell Donal. It gave up after 12 h: ask Donal.
- The full box smoke (smoke-3) and the manual rows are done; see the note's table.

**Waiting on Donal (Claude raises these):** DON-296 default KMRT group ·
DON-284 wording · DON-288 fallback · DON-302 retire the old script (replaced
by `live-traccar`) · box sleep mask (the first attempt did not apply).
**Ask the team on the next call:** DON-293. Queue: the workplan table "After beta.13.5".

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`, post-mortem `~/workspace/vibes/release post-mortem/`.
