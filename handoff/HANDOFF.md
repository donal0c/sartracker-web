# HANDOFF.md — Current state

Updated 2026-10-02 (night). Queue: [workplan](../docs/two-track-execution-workplan.md).
Release gate: [checklist](../docs/release-checklist.md). Earlier detail:
[archive/handoff-20261002-pretag.md](archive/handoff-20261002-pretag.md).

## Status

- **beta.13.5 published 1 Oct 2026** (controlled team beta).
- **beta.13.6 published 2 Oct 2026** (prerelease): tag 01c43873, run
  37011458608, AppImage `38568d4f…0b0a`, .deb `907b1129…0010`. Every check
  PASS on the installed draft (box) incl. live Traccar and 960k open; hand
  checks (window X, F11, GPX picker/watch/rescan) by Donal. One exception
  (Donal): installed soak limits, data exact; stalls 329/516 ms, 2.27 GB
  [DON-312/313, 13.7]. Box evidence: `~/sartracker-13.6-smoke/out/f-*, g-*`.

## Next action

1. Tell the team 13.6 is out (Donal). Ask Donal before deleting box/Mac
   temp evidence (keep box evidence until the team reports on 13.6).
2. 13.7: DON-312/313 A/B soak (coverage off) with 9f; DON-328 (Seán).

## Verification limits

- Live Traccar: one approved device; other box checks use synthetic
  providers. PCLinuxOS untested (DON-298). Window X is a hand check on Linux.
- The box sleeps when idle; long runs need Donal's sudo for `systemd-inhibit`.

## Who is doing what

- **Coordinator:** release, box, handoff, workplan, all pushes.
- **Session 9f** (commits locally; coordinator pushes): paused until the
  coordinator messages it. Owns mission-store.cjs, main.cjs, preload.cjs, GPX
  runtime, `public/manual/index.html`. 13.7 lead: DON-312/313 A/B soak.
- Rules: announce files before editing; one heavy run at a time.

## Waiting on others

- Eamonn: support bundle, Layers screenshot, Tomies Wood GPX (DON-319 cause,
  DON-318 trigger).
- 13.7 queue: DON-312/313, DON-328 (Seán), DON-325/326/327/329, DON-298.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`.
