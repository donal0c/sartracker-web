# HANDOFF.md — Current state

Updated 2026-10-17 (13.7 work under way; DON-325/329 draft PR). Queue: [workplan](../docs/two-track-execution-workplan.md).
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

1. 13.7 landed on master (not released): DON-330 group refresh c8cfbf35,
   DON-328 marker at newest fix 9ec0011c (Donal approved 4 Oct; stale flag kept
   from the position; list/readout follow-up 18580e93), DON-327 warning codes
   7a5b2325. New smoke checks a648b22c PASS on a local macOS package (4 Oct:
   team-group-refresh 82 s, tracking 305 s); Linux 13.7 candidate run owed.
   DON-325/329 now implemented locally: bounded automatic coverage refreshes,
   typed stale results, backup shutdown ownership and bounded orphan cleanup.
   Mac A/B confirmed a material coverage contribution; the fixed normal soak
   still FAILS memory (2,217,132,032 bytes) and independent main-loop (226 ms)
   budgets. Exact 691,224 fixes/integrity PASS; both native backup-overlap quits
   and separate full-profile quiet coverage recovery PASS. See
   [evidence and limits](archive/2026-10-17-don325-don329-local-validation.md).
   [Draft PR #56](https://github.com/donal0c/sartracker-web/pull/56) remains In Review.
   Donal's review exposed finalize/shutdown cancellation and coverage-error masking
   gaps despite earlier green CI. Both are repaired; 6,611 local tests, Chromium
   9/9, lint/build/package and packaged-store race controls PASS. Linux39032048967
   passed correctness/package checks but exposed an older map-warning race:
   late tile errors replaced the actionable application failure. Narrow repair
   passes the deterministic regression, 34 browser flows, 34 focused tests,
   full 6,611-test correctness run and lint/build. Fresh CI remains owed;
   Checks owns the current result. Prior native receipts precede this map repair.
   Failed-quit session recovery needs a separate lifecycle decision: resetting
   backups alone cannot reopen other closed services. No merge or qualification.
2. Linear tidy 4 Oct: closed DON-321/315/316/288/285/284/304 (named 13.6 PASS
   rows). Still In Review for want of a named check: DON-311, 314, 320, 322,
   309, 317 — name them on the 13.7 candidate run.
3. Team told 13.6 is out (Donal, 4 Oct). DON-296 was decided 1 Oct and
   shipped in 13.6 (78b00506). Waiting: box for DON-312/313 Linux A/B soak and the
   new smoke steps' first packaged run; DON-247/240 gate call.

## Verification limits

- Live Traccar: one approved device; other box checks use synthetic
  providers. PCLinuxOS untested (DON-298). Window X is a hand check on Linux.
- The box sleeps when idle; long runs need Donal's sudo for `systemd-inhibit`.
- Review repair: 629 local suites / 6,611 pass / 27 skip. Synthetic packaged-store
  cancellation/reopen checks pass; actual quit-during-finalize UI and installed
  Ubuntu remain unproven. DON-312/313 budgets remain failed.

## Who is doing what

- **Coordinator:** Linear, review, PR, release, box and all pushes.
- **GPT-6.1 Sol:** finalize repair and focused checks; independent coverage review
  found the periodic-poll variant, now fixed. Coordinator owns final verification
  and PR updates. Earlier clean review is superseded by Donal's findings.
  Fable supplied design opinions; final code review hit quota.
- Rules: announce files before editing; one heavy run at a time.

## Waiting on others

- Eamonn: support bundle, Layers screenshot, Tomies Wood GPX (DON-319 cause,
  DON-318 trigger).
- 13.7 queue: DON-312/313, DON-328 (Seán), DON-325/326/327/329, DON-298.

## Pointers

- Private environment: `~/workspace/vibes/sartracker-private/release-environment.md`.
- History: `handoff/archive/`, `docs/archive/`.
