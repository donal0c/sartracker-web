# Beta.12 Mission-Store Baseline

## Purpose

`DON-243` establishes a numeric packaged-Electron baseline before the beta.12
mission-store hot path changes. It uses the exact CI-built beta.11 AppImage and
an isolated copy of the deterministic `field-v2` fixture on the Ubuntu validation
machine.

## Inputs

- App: `sartracker-electron-validation_0.1.0-beta.11_linux_x86_64.AppImage`
- App SHA-256: `c528e192afc7c6507e6167df26b217054e1824eacd62ecbcd1fca6be1c89cba6`
- Fixture: `field-v2/mission-store.sqlite` (3,704,676,352 bytes)
- Fixture SHA-256: `8bcfa9a3267364389a7e6ab66126f04127cea68181eeca5e5dec1a3a109ed8cc`
- Ubuntu host: kernel 6.17, X11, AppImage launched with `--ozone-platform=x11`
- Autosave interval: five seconds; three completed periodic cycles per run
- Freeze threshold: direct Electron main-process response of at least 1,000 ms

The cached fixture was never opened in place. Every run copied it into a new
throwaway Electron user-data directory.

## Result

All three independent packaged runs produced a valid `frozen=true`,
`offender=main` verdict.

| Run | Main-process maximum | Backup copy phases | Stable snapshot validation phases |
| --- | ---: | --- | --- |
| 1 | 5,758 ms | 2,738 / 2,579 / 2,447 ms | 6,259 / 6,111 / 6,291 ms |
| 2 | 5,701 ms | 3,963 / 2,955 / 3,662 ms | 6,116 / 6,246 / 6,139 ms |
| 3 | 5,818 ms | 3,718 / 3,899 / 2,862 ms | 6,291 / 6,185 / 6,364 ms |

Across the nine cycles, copying took 2.45-3.96 seconds and the full-size
temporary snapshot then remained in validation for 6.11-6.36 seconds. The main
process stalled for 5.70-5.82 seconds in every app run. Normal main-process IPC
responses had a sub-millisecond median, making the multi-second tail distinct.

This attributes the release-blocking beta.11 freeze to synchronous validation
of the completed multi-gigabyte backup in the Electron main process. Copying is
material I/O but does not explain the measured main-isolate stall. Renderer rAF
was background-throttled by Ubuntu/X11 and is therefore reported separately; it
does not determine the storage verdict.

## Probe design

`npm run electron:smoke:mission-store-freeze`:

1. copies a pristine fixture into an isolated profile;
2. launches the packaged app with both renderer CDP and a loopback-only Electron
   main-process Node inspector;
3. measures main-isolate response externally, avoiding background renderer
   timer throttling;
4. watches the rolling backup database from outside Electron;
5. separates temporary-file growth from the stable full-size interval before
   atomic rename;
6. records screenshots, sanitized app logs, checksums, memory high-water,
   per-cycle timings, responsiveness distributions, and a fail-closed JSON
   verdict.

The watcher deliberately excludes SQLite `-wal` and `-shm` sidecars when
identifying the active temporary database. This was verified by a regression
test after an early shakedown exposed persistent sidecars.

## Evidence locations

On `donal@192.168.18.31`:

- `~/sartracker-beta12-msr/evidence/beta11-field-run-1/`
- `~/sartracker-beta12-msr/evidence/beta11-field-run-2/`
- `~/sartracker-beta12-msr/evidence/beta11-field-run-3/`

Each directory contains `mission-store-freeze-probe-report.json`, the isolated
profile, before/after screenshots, and `electron-app.log`.

## Gate opened

The reproduce-before-fix gate is satisfied. `DON-244` is next. Candidate builds
must use the same fixture, X11 arguments, cycle count, threshold, and finalized
probe. A beta.12 candidate is not healthy unless the probe is valid and reports
`frozen=false`; incomplete cycles or heartbeat errors are failures, not passes.
