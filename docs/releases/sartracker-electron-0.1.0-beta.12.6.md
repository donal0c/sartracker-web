# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.6 (abandoned candidate)

> **Abandoned and never published.** Ubuntu qualification rejected this
> candidate at the unchanged 60-second 36-hour reconciliation gate. The app
> remained correct and crash-safe but persisted only `268,275/279,936` rows by
> the deadline because each history chunk performed a separate FULL SQLite
> transaction. Beta.12.7 replaces it with atomic wave persistence. Do not share
> beta.12.6 with the team.

- **Version:** 0.1.0-beta.12.6
- **Build tag:** `electron-v0.1.0-beta.12.6`
- **Cut date (UTC):** 2026-08-10
- **Linear reference:** `DON-260`
- **Supersedes:** published `electron-v0.1.0-beta.12.5`
- **Tag commit:** pending release-preparation commit
- **Local verification report:** pending clean no-skip `npm run beta:verify`
- **CI run:** pending tag-driven `.github/workflows/electron-release.yml`
- **Exact artifact SHA-256:** pending draft-release qualification

## Why this hotfix exists

Team evidence from beta.12.5 showed that creating a mission with a 36-hour
lookback could leave breadcrumb history arriving in visible blocks for about
nine minutes. Further evidence showed slow-speed clusters and larger visible
gaps when a vehicle moved at roughly 120–145 km/h. This prevented operators
from treating the route as timely and dependable.

The defect was not MapLibre drawing latency. Initial history reconciliation
was coupled to the normal live-poll interval: only bounded two-hour chunks for
at most eight devices advanced on each poll. Restart also lost the in-memory
frontier and replayed completed history. The earlier bounded display selector
could preserve time coverage without a truthful geometry-error contract.

## What changed

- Current positions publish immediately, independently of historical catch-up.
- Initial mission history drains continuously through bounded two-hour requests
  with at most eight concurrent history calls. It no longer waits for the
  operator's live refresh interval between chunks.
- Each completed history frontier is committed atomically with its positions,
  including empty windows. Restart resumes from durable per-device progress
  rather than replaying the completed prefix.
- Mission change, pause, finish, runtime replacement, and renderer crash cancel
  stale history/query work before a successor mission can publish.
- Active mission devices are prioritized and removed devices are pruned from
  the initial queue.
- Late corrections use a separately paced anti-entropy pass instead of an
  immediate endless full-mission rescan.
- Complete accepted source truth remains in SQLite. The bounded map display is
  selected deterministically with a truthful maximum geometry error and exact
  restart parity.
- Renderer and query memory stay bounded during long catch-up and restart.
- Redundant persistence and canonical-query work that stalled reconciliation
  and raised long-soak memory have been removed.
- Autosave intervals are scheduled after the preceding backup completes, so a
  slow backup cannot build an unbounded periodic queue.
- Diagnostics now expose bounded identity-free initial/anti-entropy progress.

## What the team should test

1. Start a mission with **Start Offset = 36 hours** while connected to Traccar.
2. Confirm current device locations appear immediately and breadcrumbs begin
   appearing without waiting for the normal poll interval.
3. Leave the mission open until the reconciliation warning clears. The route
   must fill continuously, without a long missing middle section.
4. Restart during reconciliation. Existing breadcrumbs must return and the
   remaining history must resume without starting again from the oldest block.
5. Compare a slow section and a 120–145 km/h section with Traccar. Neither may
   show systematic missing dots or route gaps that are absent from the source.
6. Restart after completion and confirm the same visible route returns.
7. Pause, resume, finish, and start a replacement mission while history work is
   active. No breadcrumbs from the previous mission may appear.
8. Export an incident bundle with the approximate time if reconciliation
   stalls, warnings clear early, or the displayed route differs from Traccar.

## Verification before tagging

- Strict regressions cover continuous 36-hour reconciliation, bounded request
  concurrency, durable checkpoints, persistence failure retry, mission switch,
  pause/finish/reload/crash cancellation, anti-entropy corrections, and
  restart parity.
- A deterministic 33-device 36-hour Traccar server contains `279,936` exact
  mission-window fixes with inclusive boundaries, one transient 503, a
  SIGKILL/restart checkpoint, sparse/offline devices, out-of-order rows, gaps,
  and same-identity correction behavior.
- Frozen packaged proof passed: current fix `99 ms`, first breadcrumb `345 ms`,
  full reconciliation `36.340 s`, exact persistence `37.148 s`, SQLite
  `279,936/279,936`, integrity `ok`, history concurrency `8`, one exact retry,
  partial progress surviving SIGKILL, and exact completion after restart.
- Independent production-selector/MapLibre oracles matched `103,614` line and
  `103,614` dot coordinates after completion and restart.
- Variable-speed proof retained `720/720` fixes at 12 km/h and `720/720` fixes
  across 120–145 km/h with zero additional source-gap inflation.
- Frozen fourteen-day packaged soak passed `1,935,384/1,935,384` exact rows,
  two restarts, exact five-day prefix, SQLite/WAL health, zero crashes, bounded
  responsiveness, and peak process-tree RSS `1,533,214,720` bytes —
  `614,268,928` below the unchanged 2 GiB gate.
- Full unit suite: 178 files / 1,391 tests.
- Standard Chromium Playwright: 142/142.
- Visual Playwright: 37/37; independent review: 43/43.
- Backend: 51 passed / 1 ignored OS-keychain test.
- Clean no-skip beta verification, tag CI, and exact CI-built Linux artifact
  results remain release blockers until recorded below.

## Known limitations and non-goals

- This is an internal Linux x86-64 field-test build, not final operational
  acceptance and not approved for live incidents.
- Linux artifacts are unsigned and do not auto-update.
- Windows and macOS packages are not produced by this release lane.
- Private Discovery map packages are not bundled.
- Full Discovery loading and beta.13 storage/archive work remain separately
  scoped.
- The 5,000-position per-device display budget is a deterministic bounded
  representation. Full accepted source truth remains in mission SQLite.
- GPS accuracy is supplied by the tracking device/provider and is not a claim
  that physical measurements have zero error.

## Packaged smoke matrix

The draft release must not be published until every required row is complete.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | TODO | exact filename, full digest, and Ubuntu evidence path |
| .deb SHA-256 | TODO | exact filename, full digest, and Ubuntu evidence path |
| AppImage launch | TODO | CI and real Ubuntu launch evidence |
| .deb install and launch | TODO | real Ubuntu install, package status, and installed-binary evidence |
| Core lifecycle, restart/recovery, finish/finalize/archive | TODO | exact AppImage and installed `.deb` |
| Coordinate rejection | TODO | exact AppImage and installed `.deb` |
| Diagnostics/support/incident exports sanitized | TODO | exact AppImage and installed `.deb` |
| Bad/corrupt stored credential reaches shell | TODO | exact AppImage and installed `.deb` |
| Live Traccar connection and breadcrumb reconciliation | TODO | exact CI artifact with 36-hour lookback |
| Official offline Discovery package | NOT APPLICABLE | no private Discovery package is bundled or changed by this breadcrumb-only hotfix |
| Duplicate launch | TODO | exact AppImage and installed `.deb` |
| Five-day and fourteen-day packaged soak | TODO | exact CI AppImage; exact counts, restarts, memory, integrity, and responsiveness |
| Cross-profile exact breadcrumb identity comparison | TODO | exact five-day digest equals fourteen-day prefix digest |
| 36-hour fault, kill, checkpoint-resume, and restart proof | TODO | exact CI AppImage with independent SQLite/render oracles |
| Slow and 120–145 km/h dot fidelity | TODO | exact source and rendered identity counts by phase |

## Rollback / reinstall

1. Quit SAR Tracker.
2. AppImage: remove beta.12.6 and run the qualified beta.12.5 AppImage. `.deb`:
   install the previous package version.
3. Mission databases remain in the per-user application data directory and are
   not removed by uninstalling. Capture diagnostics before changing data.

## Pre-share checklist

- [ ] Product and release-preparation commits are clean and pushed
- [ ] Clean no-skip local `npm run beta:verify` passes every step
- [ ] Annotated tag resolves immutably to the recorded commit
- [ ] Tag-driven Electron release workflow is green
- [ ] Draft assets are AppImage, `.deb`, and `SHA256SUMS` only
- [ ] Exact draft bytes match `SHA256SUMS`
- [ ] Exact CI AppImage and real installed `.deb` pass the packaged smoke matrix
- [ ] Release note contains exact commit, run, checksums, and evidence
- [ ] Linear and `handoff/HANDOFF.md` reflect the verified result
- [ ] Guarded publication succeeds and fresh public bytes re-verify
