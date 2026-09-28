# Beta.12 Autosave Freeze Fix

## Scope and safety boundary

`DON-240` removes size-dependent work from the Electron main isolate during recurring mission
backup while preserving serialized coordination, SQLite online backup, temporary-file cleanup,
atomic rename, durable phase evidence, and operator-visible autosave failure.

The periodic path now:

1. starts an independent worker-thread SQLite connection against the live WAL database;
2. writes the online backup to a unique temporary file;
3. reads exactly the 100-byte SQLite header and O(1) file metadata to verify signature, page size,
   journal format, and page-count/file-size consistency;
4. atomically renames the snapshot into the rolling backup path;
5. records the existing backup audit event and completion diagnostics.

It does not run `integrity_check`, `quick_check`, a schema query, or any page/table scan during
autosave. Full `integrity_check` remains on the explicit finalization archive path. Safe background
integrity assurance is separately owned by `DON-249`.

## Tests-first evidence

Red regressions first proved that the old code still emitted `validation_started` / `validated`,
accepted a deliberately corrupted temporary header, and had no bounded snapshot validator or
worker boundary. The green implementation adds:

- a sparse 3,704,676,352-byte snapshot test that can pass only through the fixed 100-byte read;
- corrupt signature and truncated page-set rejection;
- a real WAL database worker-copy integration proving a non-main worker thread and error
  propagation;
- rolling-backup atomicity, cleanup, diagnostics-phase, archive-integrity, and visible failure
  regressions.

## Packaged Ubuntu A/B

Inputs:

- Candidate AppImage SHA-256:
  `147ec92bb1ceb7a8873edf89f2ac9a6220599f3367f02352c78c86505b67e5f5`
- Field fixture: 3,704,676,352 bytes; SHA-256
  `8bcfa9a3267364389a7e6ab66126f04127cea68181eeca5e5dec1a3a109ed8cc`
- Ubuntu kernel 6.17, X11, x64; three cycles per run; direct main-isolate heartbeat; 1,000 ms
  freeze threshold.

Deleting only the full integrity scan was not sufficient: an intermediate packaged run produced a
4,673 ms main-isolate tail while `better-sqlite3` backup finished under sustained field-size I/O.
Durable timings showed sanity at 1-6 ms, rename at about 230-255 ms, and the stall inside the backup
phase. That evidence drove the worker boundary rather than accepting a partial fix.

Final worker-backed result:

| Run | Main max | Main p99 | Backup cycles | Verdict |
| --- | ---: | ---: | --- | --- |
| 1 | 10.9 ms | 2.7 ms | 2,692 / 2,766 / 2,735 ms | healthy, valid |
| 2 | 6.5 ms | 2.4 ms | 966 / 2,761 / 2,667 ms | healthy, valid |
| 3 | 2.5 ms | 2.3 ms | 883 / 2,722 / 2,733 ms | healthy, valid |

All nine autosaves completed. Runtime diagnostics measured the bounded sanity phase at 1-5 ms.
Ubuntu/X11 renderer timers were background-throttled, as in earlier beta validation; the external
main-isolate measurement is the release gate for this bug. Evidence:
`~/sartracker-beta12-msr/evidence/don240-worker-run-{1,2,3}/`.

The updated kill harness also passed against this artifact: it killed the packaged app after both
durable channels flushed `backup started`, restarted the same isolated profile, recovered
`backup:started`, exported the support bundle, observed event-loop evidence, and passed all privacy
checks. Evidence: `~/sartracker-beta12-msr/evidence/don240-worker-kill/`.

## Lifecycle and integrity

- The field fixture completed repeated backups, forced process restart, paused recovery, resume,
  finish, and post-finish backup. External full integrity checks returned `ok` for both the main and
  rolling-backup databases.
- Field-scale finalization then exposed a separate pre-existing boundary:
  `ERR_FS_FILE_TOO_LARGE` when `createMissionArchive` calls `fs.readFile` on the 3.704 GB shared
  snapshot. The exact packaged reproduction is recorded on `DON-252`, which owns mission-scoped
  streamed archives. It is not hidden or folded into this urgent hot-path change.
- A fresh-store packaged critical lifecycle smoke passed launch, mission start, restart recovery,
  finish, finalization, standalone archive creation, and post-run main/backup integrity. Evidence:
  `~/sartracker-beta12-msr/evidence/don240-small-lifecycle/`.

## Full local gates

- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test`: 160 files / 1,126 tests passed.
- `npm run test:e2e`: 163/163 passed.
- `npm run visual:review -- --fail-on high`: 39/39 passed, zero failures/errors.
- `npm run test:backend`: 47 passed / 1 intentionally ignored.
- `npm run electron:pack`: passed, including native dependency rebuild/restoration.
- `npm run beta:verify -- --no-smoke`: overall pass for lint, build, unit, backend, Chromium
  129/129, and local package. The manual release smoke was intentionally skipped because this is
  not a publishable CI artifact; report:
  `tmp/beta-artifacts/verify-0.1.0-beta.11-sha.74cbdea26ae6-2026-07-10T17-37-35Z.json`.

The implementation is locally complete. Promotion of the exact CI-built beta.12 artifact and
confirmation on the original team machine remain release gates under `DON-247`; `DON-240` is not
closed in Linear before those external gates.
