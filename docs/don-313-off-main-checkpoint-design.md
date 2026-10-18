# DON-313 — Move the WAL checkpoint off the main thread

Status: **approved by Donal, 18 Oct 2026** (recorded on DON-313). Cause confirmed by probe the same day; not a 13.7 gate on its own.

## Problem

The mission store connection opens with the default `wal_autocheckpoint =
1000` pages, so whichever commit pushes the WAL past ~4 MB runs a checkpoint
inline: it copies WAL pages back into the database file and fsyncs it
(`synchronous = FULL`) on the Electron main thread, inside
`responsive-mission-writer`'s `transaction.immediate()`.

## Probe evidence (18 Oct 2026, Mac, normal-profile soak)

Throwaway probe builds timed every writer transaction (body vs commit) and
lined them up with main-loop stalls on the same clock.

- With checkpointing as today: 41 of 44 stalls over 100 ms were one writer
  transaction. Mid-run they were commit-dominated (body 0–15 ms, commit
  60–107 ms). The WAL reached 12 MB and 48 MB, so commits kept attempting
  checkpoints.
- A/B with `wal_autocheckpoint = 0` on main: writes over 30 ms fell from
  579 / 492 to 40 / 102 per launch, stalls over 100 ms from 17 / 27 to 11 / 5,
  median commit from 17–19 ms to 6–12 ms. With no checkpointer at all the WAL
  grew to 2.3 / 2.6 GB, which is why the size bound below is required.
- The startup stall cluster was a different cause: participant backfill wrote
  a whole two-hour window (up to 7,200 fixes) in one transaction. Fixed
  separately by writing it in 256-fix pieces (branch `don-313-backfill-pieces`).
- Still unexplained: one 2.17 s blocked main-thread stall (33 ms CPU) in one
  of three soaks after the backfill fix. Earlier runs had smaller blocked
  stalls (339 ms). It may be an fsync waiting on other disk work. The
  slow-write diagnostic below is there to attribute the next one.

## Proposal

1. **Main connection stops checkpointing.** `electron/mission-store.cjs` sets
   `PRAGMA wal_autocheckpoint = 0` right after `journal_mode = WAL`.
2. **One checkpoint worker** (`electron/wal-checkpoint-worker.cjs`, a
   `worker_threads` worker like `sqlite-backup-worker.cjs`) owns its own
   connection and runs `PRAGMA wal_checkpoint(PASSIVE)` every 2 s. PASSIVE takes no
   writer lock, so main commits never wait on it.
3. **WAL growth is bounded and visible.** Main checks the `-wal` file size
   asynchronously on each tick. Over 64 MB: diagnostic warning. Over 256 MB, or
   after three consecutive worker failures: put `wal_autocheckpoint = 1000` back
   on the main connection (today's behaviour), record a diagnostic event, and
   show it in the support report. Data safety does not depend on the worker.
4. **Slow-write diagnostic.** The writer records any transaction over 100 ms
   with its body and commit time in storage diagnostics, so a blocked or slow
   commit names itself in the support report.
5. **Shutdown.** `prepareClose` stops the worker after its current step. The
   main connection's own close checkpoint runs as it does today.

## Safety invariants

- Durability is unchanged: every commit still fsyncs the WAL
  (`synchronous = FULL`). A checkpoint only moves already-durable pages, and
  SQLite recovers a checkpoint interrupted by a crash or power loss.
- No schema or DDL change, so the archive suites' schema-13 pin is unaffected.
- If the worker dies or stalls, the app falls back to today's behaviour, with a
  visible diagnostic. It never runs with an unbounded WAL.
- Backup mirror and read workers are unaffected: they already use independent
  WAL readers. A long reader can only delay a PASSIVE checkpoint, which the
  size bound covers.

## Rejected alternatives

- **`synchronous = NORMAL`**: removes the stall, but a power cut can lose the
  last commits. Not acceptable for evidence.
- **Smaller `wal_autocheckpoint`** (for example 250 pages): shorter but more
  frequent stalls on main. Kept only as a fallback setting.
- **Move every write off main**: the right long-term shape, but a large
  refactor of the writer and IPC. Out of scope for 13.7.

## Test plan

- Unit: the main connection reports `wal_autocheckpoint = 0`. The scheduler
  ticks, skips a tick while a checkpoint is still running, backs off on failure, and falls back after
  three failures or at the hard size limit.
- Integration (real better-sqlite3): 200k inserted fixes through the writer.
  WAL stays under the soft limit, integrity is ok, and a kill and reopen
  mid-checkpoint keeps every committed row.
- Packaged: the normal-profile soak on Mac (3 runs), main-loop max under 200 ms
  in each, positions exact. Then the box (Linux, PSI counters) when it's free.

## Decision record

Approved by Donal on 18 Oct 2026 with these thresholds: 2 s tick, 64 MB
warning, and fallback at 256 MB or after three failures. One simplification
after the probe: there is no separate "WAL passed 1,000 pages" signal from the
writer. Startup catch-up grew the WAL by up to ~5 MB per 2 s in the probe, so
a 2 s tick keeps it around 10 MB, far below the 64 MB warning, and the writer
stays decoupled from the checkpointer. Lands as one PR after the backfill fix.
