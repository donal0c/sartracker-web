# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.8 (abandoned candidate)

> **Abandoned and never published.** Tag CI was green, but exact Ubuntu
> qualification exposed unsafe restart margin: the first completed-history
> restart rendered in `10.177 s`, beyond the unchanged `10 s` gate, while a
> clean repeat passed by only `108 ms` at `9.892 s`. The exact SQLite and render
> truth were correct, but an unexplained or borderline packaged gate blocks
> release. Beta.12.9 corrects the SQLite query plan and requires three
> consecutive restart samples. Do not share beta.12.8 with the team.

- **Version:** 0.1.0-beta.12.8
- **Build tag:** `electron-v0.1.0-beta.12.8`
- **Cut date (UTC):** 2026-08-10
- **Linear reference:** `DON-260`
- **Supersedes:** published beta.12.5
- **Replaces:** unpublished beta.12.6 and beta.12.7 candidates
- **Tag commit:** `3b353b3f9df3aede94c285be89e88e6eae49157f`
- **CI run:** `31409778533` (green; draft artifacts only)
- **AppImage SHA-256:** `0b3b1e5111be8fcd19a96a7514f17262f23c457bc5e7459e9ad35988891a4d24`
- **Status:** rejected by exact Ubuntu qualification; never published

## Release purpose

Beta.12.5 could take roughly nine minutes to fill a 36-hour breadcrumb window
and could show route gaps absent from Traccar. The corrected pipeline publishes
current fixes immediately, drains bounded history continuously, commits durable
per-device frontiers, resumes after a crash, preserves an error-bounded route,
and cancels stale mission work safely.

Ubuntu qualification of beta.12.6 found that correct history still performed
one FULL SQLite transaction per device chunk. Beta.12.8 persists each fetched
wave of up to eight chunks and all checkpoints in one atomic transaction. Fetch
failures retain healthy siblings; batch failures isolate devices through an
idempotent bounded fallback; empty windows checkpoint; and nothing advances or
renders before durable acknowledgement. The local exact 279,936-fix proof
completed reconciliation in 28.119 seconds against the unchanged 60-second
gate.

Beta.12.7 was abandoned before artifacts because its 198,000-position
worst-case GeoJSON test took 5.627 seconds on the shared CI runner, beyond the
generic five-second Vitest timeout. The deterministic assertions passed locally
and now have an explicit 15-second test budget; no product threshold was
weakened.

## Required qualification

- [ ] Clean no-skip local `npm run beta:verify`
- [ ] Annotated tag and green tag-driven workflow
- [ ] Exact AppImage and `.deb` match `SHA256SUMS`
- [ ] Exact CI AppImage 36-hour fault/503/SIGKILL/checkpoint/restart proof
      completes within 60 seconds with `279,936/279,936`, integrity `ok`, max
      history concurrency 8, and exact line/dot render oracles
- [ ] Exact CI AppImage 14-day soak matches all `1,935,384` rows and five-day
      prefix through two restarts, WAL/integrity, responsiveness, and 2 GiB RSS
- [ ] Native Ubuntu AppImage and real installed `.deb` pass lifecycle,
      recovery/finalize/archive, coordinate rejection, sanitized exports,
      corrupt credentials, duplicate launch, and live Traccar
- [ ] Release note, handoff, and Linear contain exact evidence
- [ ] Guarded publish succeeds and fresh public bytes plus final Ubuntu
      AppImage lifecycle smoke re-verify

## Known limits

Internal Linux x86-64 field-test build only; unsigned; no auto-update; not final
operational acceptance and not approved for live incidents. No private
Discovery package is bundled. Full accepted breadcrumb truth remains in SQLite;
the map uses a deterministic bounded representation with an explicit geometry
error bound.

## Rollback

Quit SAR Tracker and return to the qualified beta.12.5 artifact. Uninstalling
does not remove per-user mission databases; capture diagnostics first.
