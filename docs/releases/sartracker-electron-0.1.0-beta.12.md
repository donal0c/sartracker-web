# SAR Tracker Electron Desktop Beta 0.1.0-beta.12 (mission-store freeze remediation)

> **Internal beta only.** Not a production release. This prerelease is published
> so the team can download the exact Ubuntu-qualified artifact. Original-machine
> confirmation remains required before `DON-247` can close.

- **Version:** 0.1.0-beta.12
- **Build tag:** `electron-v0.1.0-beta.12`
- **Cut date (UTC):** 2026-07-10
- **Cut by:** Codex agent (Donal supervising)
- **Supersedes:** `electron-v0.1.0-beta.11` (**field freeze still present**)
- **Linear references:** `DON-240`, `DON-241`, `DON-242`-`DON-247`
- **Tag commit:** `0c05cf97935b49c67616df68cd2fbec622846fa3`
- **Local verification report:** `tmp/beta-artifacts/verify-0.1.0-beta.12-sha.4f2b3d71f9b8-2026-07-10T22-23-28Z.json`
- **CI run:** `29127625505` — all gates, Linux bundle, packaged tracking soak,
  AppImage launch smoke, draft release creation, and checksum publication green
- **Exact CI artifact SHA-256:** AppImage
  `fb6c49226b8108de0a75ddc022be8b8abf513f697b9baddc55d3e4ad9e772346`;
  `.deb` `c401b9ca07588cd4aa01e5df5bd92eb7f89ecfb00eee20cbfaac4ffc58ab8d0d`
- **GitHub release:** published as an internal prerelease for team validation;
  field confirmation remains pending under `DON-247`

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
- Linux startup no longer calls synchronous keyring decryption for legacy
  beta.5 credentials. Tracking fails safe with the existing re-entry warning,
  preventing a locked GNOME keyring from blanking/freezing the whole app.

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

## Exact CI artifact qualification — Ubuntu complete; original team machine pending

The exact replacement CI artifact has completed the local Ubuntu portion of
`DON-247`:

1. **Passed:** tag-driven workflow, packaged CI soak, and AppImage launch.
2. **Passed:** AppImage/`.deb` checksums; the tested AppImage is the release
   artifact byte-for-byte.
3. **Passed:** three consecutive field-fixture runs, three autosaves each, with
   healthy verdicts and main maxima of 9, 19, and 2 ms.
4. **Passed:** corrected five-day and fourteen-day packaged soaks. They stored
   exactly 691,224 and 1,935,384 positions, passed one/two restarts, retained a
   zero redundant-event slope, and kept main maxima below 177 ms.
5. **Passed:** lifecycle/restart/recovery/finish/finalize/archive, coarse Irish
   Grid rejection/normalization, official offline map, sanitized diagnostics
   and support/incident bundles, locked-keyring bad-secret startup, live
   Traccar (33 devices / 8 current positions), and duplicate launch.
6. **Passed:** support evidence is bounded and sanitized and includes backup
   timings. Live-tracking main responsiveness stayed healthy (17.3 ms maximum);
   the Ubuntu X11 renderer cadence remains a known non-discriminating throttled
   signal and is not being treated as proof of a freeze.
7. **Pending post-publication validation gate:** short representative
   confirmation on the original team machine/profile with 30+ devices, followed
   by support bundle collection even on success. Publication is required to
   deliver the bundle to the team and does not itself close `DON-247`.

## Post-publication Ubuntu download smoke — passed

After publication, the AppImage was downloaded afresh from the team-facing
GitHub release URL onto the Ubuntu validation machine. Its SHA-256 was
`fb6c49226b8108de0a75ddc022be8b8abf513f697b9baddc55d3e4ad9e772346`,
exactly matching the qualified release asset. The downloaded bytes passed:

- packaged launch, mission start, marker save, full restart/recovery, finish,
  finalize, and standalone archive creation
- coarse Irish Grid normalization and duplicate-launch handling
- diagnostics report, support bundle, and time-framed incident bundle export,
  with all three privacy scans passing
- locked-keyring/bad-secret startup, visible re-entry warning, and Settings
  credential-replacement path
- official offline Discovery package registration, local tile read, blocked-
  network operation, inside/outside coverage guidance, and sanitized diagnostics

Evidence is retained on Ubuntu under
`~/sartracker-beta12-msr/evidence/beta12-released-download-smoke/`. This clears
beta.12 for the team to download and begin the original-machine/profile test.

Any unexplained flake, renderer crash, heartbeat failure, missing evidence, or
field-machine recurrence keeps this release on hold.

The first exact CI artifact (`3113d01b…`) passed the three field-fixture runs
and both multi-day soaks, then failed the required bad-secret startup smoke by
blocking in synchronous legacy Linux keyring decryption. It is rejected; a
replacement artifact had to repeat qualification after the fail-safe startup
fix. The replacement artifact listed above has now passed that qualification.

## Known limitation deferred to beta.13

Finalizing a shared mission database larger than Node's single-buffer limit can
hit `ERR_FS_FILE_TOO_LARGE` because the current archive path reads the whole
database at once. `DON-252` owns mission-scoped streamed archives for beta.13.
Beta.12 does not claim multi-gigabyte legacy finalization support; fresh-store
packaged finalization/archive remains green.

## Rollback

If original-machine qualification fails, stop beta.12 rollout and continue using
the current team workaround (fresh supported database after safely preserving
the legacy file). Do not delete or overwrite the legacy database. Capture a
support bundle before changing user data.
