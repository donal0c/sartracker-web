# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.7

> **Internal beta draft.** Do not share or use for a live incident until every
> required packaged gate below is recorded green and the guarded prerelease is
> published.

- **Version:** 0.1.0-beta.12.7
- **Build tag:** `electron-v0.1.0-beta.12.7`
- **Cut date (UTC):** 2026-08-10
- **Linear reference:** `DON-260`
- **Supersedes:** published `electron-v0.1.0-beta.12.5`
- **Replaces:** unpublished beta.12.6 candidate rejected by Ubuntu qualification
- **Tag commit:** pending release-preparation commit
- **Local verification:** pending clean no-skip `npm run beta:verify`
- **CI run and artifact checksums:** pending tag workflow

## Why this candidate exists

Beta.12.5 could take roughly nine minutes to fill a 36-hour breadcrumb window
and could show slow-speed clusters or larger route gaps at motorway speeds.
The initial correction fixed the poll-cadence coupling, durable resume, route
selection, lifecycle cancellation, and long-soak memory behavior.

The first Ubuntu qualification then caught one remaining platform-sensitive
throughput defect before release: each two-hour/device chunk still crossed IPC
and committed as its own `synchronous=FULL` SQLite transaction. The exact
36-hour proof remained correct and crash-safe but missed its unchanged
60-second deadline with `268,275/279,936` rows persisted. That beta.12.6
candidate was not published.

Beta.12.7 persists each fetched wave of up to eight chunks and every associated
device checkpoint in one atomic transaction. The request limit remains two
hours per device and network concurrency remains at most eight. A fetch failure
does not discard healthy siblings; a rejected batch falls back to bounded,
idempotent per-device isolation; no cursor or rendered breadcrumb advances
before durable acknowledgement; empty windows are checkpointed; and stale
mission work is discarded.

## Operator-visible behavior to verify

1. Start a mission with **Start Offset = 36 hours**.
2. Current fixes must appear immediately; breadcrumb history must begin without
   waiting for the normal poll interval.
3. History must fill continuously and the reconciliation warning must not clear
   until durable coverage is complete.
4. Kill/restart during catch-up. Stored breadcrumbs must return and unfinished
   history must resume from durable checkpoints.
5. Compare slow sections and 120–145 km/h sections with Traccar; the app must
   neither invent nor systematically omit fixes.
6. Pause, resume, finish, and replace a mission during catch-up; old mission
   breadcrumbs must never publish into the successor.
7. Restart after completion and verify the same bounded route returns.

## Locked release gates

- [ ] Clean no-skip `npm run beta:verify`
- [ ] Annotated tag and green tag-driven Electron workflow
- [ ] Exact CI AppImage and `.deb` checksums match `SHA256SUMS`
- [ ] Exact CI AppImage 36-hour fault/SIGKILL/checkpoint/restart proof completes
      within the unchanged 60-second controlled deadline
- [ ] Exact SQLite source count/digest, integrity, checkpoints, bounded request
      concurrency, and independent line/dot render oracles match
- [ ] Exact CI AppImage extended fourteen-day soak and five-day prefix match,
      including restart, responsiveness, WAL, and 2 GiB memory gate
- [ ] Real Ubuntu AppImage launch, lifecycle, coordinate rejection, sanitized
      diagnostics, corrupt credential, duplicate-launch, and live Traccar checks
- [ ] Real Ubuntu `.deb` install plus the same installed-binary safety checks
- [ ] Linear, handoff, and this release note contain the exact evidence
- [ ] Guarded publish succeeds; freshly downloaded public bytes re-verify and
      the public AppImage passes a final Ubuntu lifecycle smoke

## Known limits

- This is an internal Linux x86-64 field-test build, not final operational
  acceptance and not approved for live incidents.
- Linux artifacts are unsigned and do not auto-update.
- Windows and macOS packages are not produced by this lane.
- Private Discovery packages are not bundled or changed.
- Full accepted breadcrumb truth remains in mission SQLite. The map uses a
  deterministic bounded representation with an explicit geometry-error bound.

## Rollback

Quit SAR Tracker, remove the AppImage or uninstall the `.deb`, and return to the
qualified beta.12.5 artifact. Mission databases remain in the per-user data
directory and are not removed by uninstalling; capture diagnostics first.
