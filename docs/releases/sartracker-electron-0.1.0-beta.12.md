# SAR Tracker Electron Desktop Beta 0.1.0-beta.12 (mission-store freeze remediation)

> **Internal beta only.** Not a production release. Keep this GitHub release in
> draft until the exact CI artifact passes the Ubuntu qualification matrix and
> the original team machine confirms the beta.9-beta.11 freeze is gone.

- **Version:** 0.1.0-beta.12
- **Build tag:** `electron-v0.1.0-beta.12`
- **Cut date (UTC):** 2026-07-10
- **Cut by:** Codex agent (Donal supervising)
- **Supersedes:** `electron-v0.1.0-beta.11` (**field freeze still present**)
- **Linear references:** `DON-240`, `DON-241`, `DON-242`-`DON-247`
- **Local verification report:** `tmp/beta-artifacts/verify-0.1.0-beta.12-sha.46662a97137e-2026-07-10T19-58-27Z.json`
- **CI run:** replacement run pending; initial run `29119914249` failed closed
  in the packaged-soak UI-readiness assertion before artifact promotion
- **GitHub release:** must remain draft pending `DON-247`

## Why beta.12 exists

Beta.9, beta.10, and beta.11 all remained responsive in earlier local/Ubuntu
checks but still froze on the team machine. The decisive field evidence was a
3.69 GB `mission-store.sqlite`; moving that file aside and starting with a fresh
database removed the freeze.

The corrected baseline reproduced the failure with the exact beta.11 AppImage
and a synthetic 3.704 GB database. Every rolling autosave synchronously ran a
full SQLite `integrity_check` on Electron's main isolate. The validation phase
took 6.11-6.36 seconds and produced repeatable 5.70-5.82 second application
stalls. Redundant tracking audit rows were responsible for most historical
database growth.

## What changed

- Rolling SQLite backup copying runs entirely in a dedicated worker thread.
- Periodic autosave performs only a fixed 100-byte SQLite header/file-metadata
  sanity check before atomic rename. Full archive integrity validation remains.
- Device rows and `last_seen` still update every poll, but `device_updated` is
  written only for real name/status/colour changes.
- Positions remain authoritative mission records; new `position_recorded`
  telemetry echoes are no longer written.
- Bounded durable storage checkpoints, backup phase timings, event-loop
  summaries, tracking-growth counters, restart evidence, and sanitized support
  bundle sections are available for field diagnosis.
- Multi-day restart hydration now uses an indexed recent-position window capped
  at 5,000 rows per device. Full mission history remains in SQLite; the bounded
  window prevents renderer memory exhaustion during Resume.
- `beta:verify` and the tag-driven Linux bundle now run a deterministic packaged
  Traccar/persistence soak with machine-readable fail-closed evidence.

## Pre-release evidence already completed

- Beta.11 field-scale reproduction: three Ubuntu runs, nine backups, repeatable
  main-isolate freezes attributed to synchronous integrity validation.
- Candidate field fixture: nine worker backups across three packaged runs with
  main maxima of 10.9, 6.5, and 2.5 ms.
- Forced-kill/restart/support-export proof retained the interrupted operation,
  preserved the mission, passed integrity, and passed privacy scanning.
- Redundant-write proof: 2,000 polls / 64,000 device upserts / 16,000 positions;
  32 creates, one genuine update, zero position telemetry echoes.
- Corrected five-day packaged soak: 32 devices, exactly 691,224 positions, one
  restart, zero redundant-event slope, main max 147.9 ms, integrity `ok`, WAL
  busy zero, zero renderer crashes, peak process-tree RSS 1.49 GB.
- Corrected fourteen-day packaged soak: 32 devices, exactly 1,935,384 positions,
  two restarts, zero redundant-event slope, main max 146.9 ms, integrity `ok`,
  WAL busy zero, zero renderer crashes, peak RSS 1.64 GB.
- Local pre-version closeout: 163 unit files / 1,143 tests, backend 47 passed /
  1 ignored, Chromium 129/129, visual Playwright 34/34, independent visual
  review 39/39, package, CI soak, lint/build/actionlint all passed.

Durable evidence:

- `docs/releases/beta12-mission-store-baseline.md`
- `docs/releases/beta12-storage-diagnostics-evidence.md`
- `docs/releases/beta12-autosave-freeze-fix.md`
- `docs/releases/beta12-redundant-write-removal.md`
- `docs/releases/beta12-tracking-soak-evidence.md`

## Operator workflow for multi-day missions

- Keep one mission open throughout the search. Do not create a new mission each
  day as a storage workaround.
- It is safe to close the application or machine during that mission. Choose
  **Resume** when SAR Tracker offers recovery.
- Finish and finalize only at operational stand-down.
- After Resume, the live map initially reloads a bounded recent trail per
  device; older positions remain stored and included in mission counts.

## Exact CI artifact qualification — pending

`DON-247` must complete before publication:

1. Tag-driven workflow green, including packaged CI soak and AppImage launch.
2. Verify AppImage/`.deb` checksums and prove the tested bytes are the release
   bytes.
3. Three consecutive field-fixture candidate passes with at least three
   autosaves each and zero main heartbeat failures.
4. Corrected 5-day and 14-day packaged soaks on the CI-built artifact.
5. Packaged lifecycle/restart/recovery/finish/finalize/archive, coordinate
   rejection, official offline map, diagnostics/support bundle, bad-secret
   startup, live tracking, and duplicate-launch smoke.
6. Support bundle completeness, boundedness, backup timings, and redaction.
7. Short representative confirmation on the original team machine/profile
   with 30+ devices, followed by support bundle collection even on success.

Any unexplained flake, renderer crash, heartbeat failure, missing evidence, or
field-machine recurrence keeps this release on hold.

## Known limitation deferred to beta.13

Finalizing a shared mission database larger than Node's single-buffer limit can
hit `ERR_FS_FILE_TOO_LARGE` because the current archive path reads the whole
database at once. `DON-252` owns mission-scoped streamed archives for beta.13.
Beta.12 does not claim multi-gigabyte legacy finalization support; fresh-store
packaged finalization/archive remains green.

## Rollback

If qualification fails, keep beta.12 as a draft and continue using the current
team workaround (fresh supported database after safely preserving the legacy
file). Do not delete or overwrite the legacy database. Capture a support bundle
before changing user data.
