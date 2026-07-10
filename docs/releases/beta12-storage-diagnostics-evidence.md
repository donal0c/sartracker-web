# Beta.12 Storage Diagnostics Evidence

## Scope

`DON-244` adds bounded, sanitized mission-store evidence before the beta.12 hot-path fix. The
existing rotated Electron runtime log remains the event timeline. A small atomic
`storage-diagnostics.json` checkpoint records only the active/last storage operation and
identity-free numeric counters so a forced kill can be attributed after restart even if older
log lines rotate.

The diagnostics boundary records:

- backup request trigger, queue depth/wait, start, copy, validation start/end, rename,
  completion, and safe failure category;
- database, WAL, rolling-backup, and temporary-snapshot byte sizes;
- aggregate tracking write duration, device counts, inserted positions, and declared telemetry
  event counts;
- configured/observed polling cadence, elapsed mission duration, database growth from the
  earliest checkpoint, and restart count;
- 30-second main-process event-loop maximum and p99 delay summaries;
- schema/runtime/build facts and allow-listed synthetic fixture metadata in validation mode.

It never records mission/device identity, coordinates, provider URLs, credentials, usernames,
home paths, private package paths, or licensed-map details. Diagnostics failures are fail-open
for mission persistence.

## Packaged Ubuntu kill/restart proof

Final evidence: `~/sartracker-beta12-msr/evidence/don244-kill-observed/` on
`donal@192.168.18.31`.

- Candidate AppImage SHA-256:
  `fdaae964ef3a485473c786cb69e55d8a95ce84fe32fa8cb49f1da129b56b9228`
- Field fixture: 3,704,676,352 bytes; SHA-256
  `8bcfa9a3267364389a7e6ab66126f04127cea68181eeca5e5dec1a3a109ed8cc`
- Platform: Ubuntu/Linux kernel 6.17, X11, x64.

The harness waited until both the atomic checkpoint and rotated runtime log had flushed
`storage_backup_validation_started`, then sent `SIGKILL`. On restart, the checkpoint was converted
to `previous interrupted operation: backup validation_started` and the runtime log recorded
`storage_previous_run_interrupted`.

The inspected support bundle also contained:

- schema version 4 and the allow-listed fixture preset/checksum;
- a subsequent successful backup taking 11,439 ms;
- a measured main-event-loop maximum delay of 6,858 ms;
- exact database/WAL/backup/temporary byte sizes;
- restart count 2 and database growth 0 from the earliest available checkpoint;
- explicit `not observed` rather than a misleading numeric zero for unavailable cadence data.

Post-kill verification:

- mission-store `PRAGMA integrity_check`: `ok`;
- one active/paused mission still present;
- broad privacy scan: pass;
- machine verdict: `passed=true`, no failures;
- checkpoint size: 1,046 bytes; runtime log: 9,316 bytes.

The harness and pure verdict logic are available through
`npm run electron:smoke:storage-kill`. It fails closed for a missing pre-kill marker, missing
restart attribution, missing event-loop summary, missing support-bundle section, or forbidden
value leakage.

## Local verification

- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test`: 158 files / 1,121 tests passed.
- `npm run test:e2e`: 163/163 Playwright tests passed.
- `npm run visual:review -- --fail-on high`: 39/39 visual entries passed, with no failures or
  reviewer errors.
- `npm run test:backend`: 47 passed / 1 intentionally ignored.

Ubuntu packaging also exposed a pre-existing release-tooling error path: a failed child command's
exit code could be masked by a temporal-dead-zone `ReferenceError`. A red-to-green regression now
proves the packager preserves the original non-zero exit code while still restoring native
dependencies. Both the final unit suite and local package verification passed after that fix.

`npm run electron:pack` then passed end to end on macOS arm64, including application build,
native `better-sqlite3` rebuild, unsigned Electron packaging, and restoration of the normal native
dependency build.
