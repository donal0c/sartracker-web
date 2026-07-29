# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.1 (breadcrumb safety hotfix)

> **Internal beta only.** Do not use for live incidents until every gate below
> is complete and the exact CI-built artifact has passed Ubuntu qualification.

- **Version:** 0.1.0-beta.12.1
- **Build tag:** `electron-v0.1.0-beta.12.1`
- **Cut date (UTC):** pending
- **Linear reference:** `DON-260`
- **Supersedes:** `electron-v0.1.0-beta.12`
- **Tag commit:** pending
- **Local verification reports:** full no-skip report
  `tmp/beta-artifacts/verify-0.1.0-beta.12.1-sha.54c6abb48f20-2026-07-28T21-32-01Z.json`;
  current harness rerun pending after commit
- **CI run:** first run `30402564688` blocked before release creation; replacement
  run pending
- **Exact CI artifact SHA-256:** pending
- **GitHub release:** remain draft until the packaged smoke matrix is complete

## Why this hotfix exists

Field comparison across two Linux installations showed that apparently identical
team histories could produce different visible breadcrumb representatives. The
earlier dot-render correction removed one display-only omission boundary, but a
full pipeline audit found additional correctness risks in source identity,
poll-batch-dependent retention, restart reconstruction, late fixes, malformed
payload coercion, and stopped/replacement runtime work.

This release is intentionally separate from beta.13. It does not add full
Discovery map loading, destructive retention, database cleanup, or archive
redesign.

## What changed

- Traccar position IDs are preserved separately from local SQLite row IDs.
- Repeated identical fixes are idempotent. A changed payload for the same source
  identity updates one authoritative position and records the previous and
  corrected values in a revision/audit event.
- Same-time distinct fixes remain distinct and use a stable source-identity
  tie-break. Visible whole-route selection is deterministic across response
  order, polling batches, restart, profile, and operating system.
- Long trails remain bounded to 5,000 displayed fixes per device. Selection
  spans the whole route, always includes the latest fix, and the Tracking panel
  explicitly reports the displayed count and a conservative lower bound for
  known fixes. SQLite remains authoritative for the complete stored history.
- Restart reconstruction runs in a read-only worker, keeping O(history) work
  off Electron's main isolate. Current live fixes display before reconstruction
  completes.
- Recent polling uses a bounded live window. Fixed two-hour history chunks run
  separately and repeat across the mission so late or corrected fixes older
  than the normal overlap are eventually reconciled.
- A history failure names the affected device(s) while current fixes remain
  live. Malformed rows are dropped individually with bounded diagnostic detail;
  a wholly malformed device window fails visibly.
- Mission-position persistence and fallback-cache failures are surfaced
  separately. The operator is told whether current fixes are live but restart
  history or the last-known offline view is at risk, and identical snapshots
  retry after recovery.
- Stopped, superseded, cross-mission, and replacement runtimes cannot publish or
  persist stale snapshots. Persistence and cache writes are serialized across
  runtime replacement.
- Device/cache identifiers, timestamps, coordinates, and optional numeric
  fields are parsed strictly. Live fixes become stale after five minutes.
- The Devices inspector shows source fix time and supplied GPS accuracy.

## What the team should test

1. Run the same active mission on two independently installed machines with the
   same mission start and active-device selection.
2. Compare named device trails after both show no history-reconciliation
   warning. Visible source IDs, coordinates, and fix times must match; do not
   compare only screenshots.
3. Leave both installations running through several polling cycles, then
   restart one. Its bounded visible trail must return to the same identities.
4. Confirm current device positions remain live while long history says it is
   reconciling.
5. Open Devices and confirm Fix Time and GPS Accuracy are readable and that a
   fix older than five minutes is visibly stale.
6. On a trail above 5,000 accepted fixes, confirm the informational
   display-summary appears and that Mission Review retains the full stored
   count.

## Verification

Local pre-tag proof is complete:

- lint and production build/bundle budgets passed
- full unit suite passed: 168 files / 1,232 tests
- Rust backend passed: 51 tests plus one expected keychain ignore; formatting
  and strict Clippy checks are clean
- Chromium passed: 132/132
- visual Playwright passed: 36/36; fresh uncached independent review passed
  41/41 at the strict high-severity gate
- full no-skip `npm run beta:verify` passed 8/8
- packaged CI profile passed: 8,664/8,664 exact fixes
- packaged five-day profile passed: 691,224/691,224 exact fixes, one restart,
  exact digest `93c71e43…c146`, zero redundant-event slope, SQLite integrity
  `ok`, clean WAL, main-process maximum 96.3 ms, renderer maximum 143.1 ms, and
  slowest individual operator action 502.8 ms
- packaged fourteen-day profile passed: 1,935,384/1,935,384 exact fixes, two
  restarts, exact digest `e4d50c8d…009e`, exact five-day prefix digest, zero
  redundant-event slope, SQLite/WAL healthy, main-process maximum 193.6 ms,
  renderer maximum 198.8 ms, and slowest individual operator action 808.0 ms
- packaged lifecycle/restart/recovery/finalize/archive, bad-secret startup, and
  sanitized diagnostics/support/incident export smokes passed locally
- same-session Fable review passed the final diff and evidence with no P1/P2
  finding and disposition `PASS_TO_FULL_RELEASE_GATES`

The first tag-driven run (`30402564688`) passed the product truth gates and
persisted all 8,664 expected soak positions with the exact deterministic digest,
restart, SQLite, main-process, renderer, and growth checks. It correctly blocked
publication because all four real operator probes reported `target_missing`.
The captured Linux logs showed both WebGL implementations blocklisted on the
runner, leaving the map/root workspace unavailable. No draft release or assets
were created. A red-to-green harness regression now keeps the packaged soak's
Linux software-rendering switches aligned with the separate launch smoke. The
same package and harness then passed on the Ubuntu validation machine under an
isolated Xvfb display: 8,664/8,664 exact positions, exact digest, 4/4 healthy
operator interactions, 187.5 ms maximum main-process latency, and 971.6 ms
maximum individual action latency. The release thresholds were not weakened.

The remaining release gates are:

- tag-driven `electron-release.yml` green
- checksum verification and deep smoke of the exact CI AppImage and `.deb` on
  Ubuntu, including schema migration/reopen/refusal, real window-faithful
  request load, live Traccar because tracking changed, and exact-artifact
  five-/fourteen-day soaks
- post-qualification publication and fresh-download checksum/launch

## Packaged smoke matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Checksum verified against `SHA256SUMS` | TODO | pending CI artifact |
| CI AppImage launch smoke | TODO | pending |
| Core lifecycle, restart/recovery, finish/finalize/archive | TODO | pending |
| Coordinate rejection | TODO | pending |
| Diagnostics/support/incident exports sanitized | TODO | pending |
| Bad/corrupt stored credential reaches shell | TODO | pending |
| Live Traccar connection and breadcrumb reconciliation | TODO | pending |
| Official offline Discovery package | TODO | pending |
| Duplicate launch | TODO | pending |
| Five-day and fourteen-day packaged soak | LOCAL PASS / CI ARTIFACT PENDING | Local rebuilt package: exact 691,224 and 1,935,384 rows, one/two restarts, zero redundant-event slope, healthy SQLite/WAL, exact full/prefix digests, and bounded main/renderer/operator-action latency. Exact CI Linux artifact must repeat both. |
| Cross-profile exact breadcrumb identity comparison | LOCAL PASS / CI ARTIFACT PENDING | Normal full digest equals the extended run's normal-prefix digest: `93c71e43…c146`; extended full digest `e4d50c8d…009e`. |

## Known limitations

- GPS accuracy is supplied by the tracking device/provider and is not a promise
  of zero physical measurement error.
- The map renders a bounded deterministic representation of very long trails;
  full accepted position truth remains in the mission database.
- Full Discovery map loading remains separate work.
- Multi-gigabyte mission finalization remains owned by `DON-252` for beta.13.
- This release migrates mission stores from schema 4 to schema 5. Beta.12
  deliberately refuses to open a newer schema, so an upgraded profile cannot
  be downgraded in place.
- Linux artifacts are unsigned internal builds; auto-update is not enabled.

## Rollback

Quit the app and preserve the complete profile before doing anything else. Do
not point beta.12 at a profile already opened by beta.12.1: beta.12 will reject
schema 5 rather than risk corrupting it. A rollback must use a separately
preserved pre-upgrade schema-4 profile or a fresh isolated profile, with the
schema-5 profile retained for recovery. Do not delete, rename, copy over, or
manually edit mission data without a specific recovery plan.
