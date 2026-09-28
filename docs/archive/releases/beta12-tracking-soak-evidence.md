# Beta.12 Packaged Tracking Soak Evidence (`DON-246`)

## What the gate proves

The packaged soak starts a real Electron mission against a deterministic local Traccar server and
drives the production network proxy, poller, renderer runtime, IPC, SQLite store, rolling backup,
diagnostics, shutdown/recovery, and support-bundle paths. Simulated time is compressed only in the
mock response: one real poll carries 180 five-second production fixes for each of eight moving
devices. The report always states both actual batches and equivalent production polls.

The fail-closed verdict requires exact device/position counts, zero `device_updated` heartbeat rows,
zero `position_recorded` echoes, declared mission-event growth only, successful restart checkpoints,
completed backups, responsive Electron main-isolate heartbeats, zero renderer crashes, process-tree
RSS below 2 GiB, SQLite integrity `ok`, zero busy WAL checkpoint participants, and bounded/redacted
runtime-log and support-bundle evidence.

## Blocker found and fixed

The first Ubuntu fourteen-day run exposed an unbounded restart path. The renderer loaded the entire
retained `positions` table once for breadcrumb/cursor hydration and again for dedupe seeding. At the
two restart points it reached roughly 3 GiB RSS, stopped at batch 1,168/1,344 after 1,494,744 persisted
positions, and crashed with exit code 133. Durable evidence remains under
`~/sartracker-beta12-msr/evidence/don246-extended/`; `runtime.log` records
`render_process_gone` at `2026-07-10T19:08:32.726Z` while main-isolate diagnostics remained healthy.

The corrected Electron store performs indexed per-device lookups capped at 5,000 recent positions.
That fixed-size result seeds both restart rendering/cursors and renderer dedupe state. Full operational
history remains in SQLite; no position retention or deletion behavior changed. A regression proves
the runtime does not call the unbounded query when the Electron bounded method is available.

The full profiles use a calibrated 250 ms validation cadence. A 25 ms trial produced an artificial
57,600-position/second renderer allocation backlog, which is not representative of the 1.6-position/
second production scenario. The 250 ms cadence still compresses fourteen days into about nine
minutes while allowing rendering and garbage collection to keep pace. The CI profile remains 25 ms.

## Ubuntu packaged results

Candidate unpacked Linux x64 executable SHA-256:
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`.

### Normal: five-day equivalent

- Evidence: `~/sartracker-beta12-msr/evidence/don246-normal-fixed-250ms/`
- 480 actual batches; 86,400 equivalent production polls.
- 32 devices; exactly 691,224 retained positions.
- One planned shutdown/recovery checkpoint.
- Zero redundant telemetry rows at both growth checkpoints; interval slope remains exactly zero.
- Position slope: exactly eight rows per equivalent production poll after the fixed initial rows.
- Final database: 200,704,000 bytes; integrity `ok`; WAL busy count zero.
- 40 completed mission backup events; bounded-log backup maximum 396 ms.
- Main isolate: 3,929 samples; max 147.9 ms; p99 22.1 ms; zero >250 ms samples.
- Zero renderer crashes; peak process-tree RSS 1,487,024,128 bytes.
- Rotated runtime logs 1,000,265 bytes; support bundle 266,051 bytes; privacy gate passed.

### Extended: fourteen-day equivalent

- Evidence: `~/sartracker-beta12-msr/evidence/don246-extended-fixed-250ms/`
- 1,344 actual batches; 241,920 equivalent production polls.
- 32 devices; exactly 1,935,384 retained positions.
- Two planned shutdown/recovery checkpoints in the same continuous mission.
- Zero redundant telemetry rows at all three growth checkpoints; both interval slopes remain zero.
- Position slope: exactly eight rows per equivalent production poll.
- Final database: 561,557,504 bytes; integrity `ok`; WAL busy count zero.
- 93 completed mission backup events. One worker-only backup took 122,456 ms while the validation
  stream was writing roughly 5,760 positions/second; main-isolate max latency still stayed 146.9 ms.
  This outlier is retained in the report and will be compared against the exact CI artifact rather
  than hidden or treated as a main-process freeze.
- Main isolate: 10,916 samples; max 146.9 ms; p99 65.0 ms; zero >250 ms samples.
- Zero renderer crashes; peak process-tree RSS 1,638,731,776 bytes.
- Rotated runtime logs 1,727,046 bytes; support bundle 266,688 bytes; privacy gate passed.

Ubuntu/X11 throttled background renderer animation frames to roughly 1 Hz, as in the earlier
beta.11 probes. The report records this separately. Release-blocking responsiveness comes from the
external Electron main-isolate inspector, explicit renderer crash detection, forward progress,
process-memory bounds, exact persisted counts, and successful UI recovery checkpoints.

## CI and release integration

`npm run beta:verify` now runs `tracking-soak-ci` after packaging. The tag-driven Linux bundle job
runs the same CI profile under Xvfb before it uploads artifacts and retains the machine-readable
evidence for fourteen days. Normal and extended profiles remain mandatory Ubuntu prerelease gates;
they are not shortened to daily finish/finalize cycles.
