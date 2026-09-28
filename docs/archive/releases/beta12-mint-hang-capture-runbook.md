# Beta.12 Mint Hang Capture Runbook

## Purpose

Use this procedure when SAR Tracker still displays a moving clock but stops accepting operator
actions. The goal is to preserve the failed process long enough to distinguish:

- a missing or covered UI target;
- Chromium input not reaching the document;
- a received click that does not change React state;
- renderer-to-main IPC timeout or failure;
- a GPU/session-specific process wait state.

Do not close, restart, reinstall, or force-kill SAR Tracker before collecting the evidence.

## Safety and privacy

The collector is report-only. It does not attach a debugger, send a signal, modify the mission
database, read process environments, read credentials, or copy database contents. It captures:

- three bounded process/thread snapshots from `/proc`;
- main, renderer, GPU, and utility process roles and wait channels;
- bounded process resource counters;
- X11/Wayland and graphics metadata;
- journal entries restricted to the captured SAR Tracker PIDs;
- sanitized bounded runtime logs, crash history, and storage diagnostics;
- database/WAL/backup file sizes only.

A screenshot is collected only when `--screenshot` is explicitly supplied. Screenshots can contain
operational map content and must be reviewed before sharing.

## Capture while the app is still hung

Open a terminal without closing SAR Tracker.

### `.deb` installation

```sh
sh "/opt/SAR Tracker Electron Validation/resources/field-tools/sartracker-linux-hang-collector.sh" --screenshot
```

### Running AppImage

```sh
COLLECTOR=$(find /tmp -maxdepth 4 -path '*/resources/field-tools/sartracker-linux-hang-collector.sh' -print -quit)
sh "$COLLECTOR" --screenshot
```

The collector finds the single SAR Tracker main process automatically. If more than one candidate
exists, find the main PID with `pgrep -af sartracker` and rerun with `--pid <PID>`.

The command writes a private evidence directory and, when `tar` is available, a neighbouring
`.tar.gz` archive. Send the archive with:

- approximate incident time;
- Mint version;
- whether the package was AppImage or `.deb`;
- whether the mission clock was still advancing;
- which controls were attempted;
- whether keyboard shortcuts also failed.

Do not reset or delete the app profile until the archive has been preserved.

## Controlled Mint A/B

The existing PCLinuxOS-AppImage versus Mint-`.deb` observation changes too many variables. Use one
Mint machine and one copied pre-test mission profile:

1. Preserve an untouched copy of the profile and mission database.
2. Run the qualified AppImage against one disposable copy.
3. Run the qualified `.deb` against a second identical disposable copy.
4. Never run both packages against the same live profile concurrently.
5. Keep the desktop session type, GPU driver, tracking feed, application flags, and workload fixed.
6. Exercise Devices open/close repeatedly during the run.
7. Capture collector evidence at a healthy checkpoint and immediately on any hang.

Only after an ordinary A/B identifies a package/session correlation should a diagnostic run change
one variable such as `--disable-gpu` or `--ozone-platform=x11`. Those flags are diagnostic
comparisons, not release fixes.

## Automated soak classifications

The packaged tracking soak now records the following stable classifications:

- `target_missing`
- `input_occluded`
- `browser_input_not_delivered`
- `ui_state_not_updated`
- `main_ipc_unresponsive`
- `main_ipc_error`
- `close_input_not_delivered`
- `ui_state_not_dismissed`
- `healthy`

Each sample records only hit-test element type/test ID, trusted click receipt, workspace state,
main-IPC status/timing, and error classes. It does not record mission or device content.
