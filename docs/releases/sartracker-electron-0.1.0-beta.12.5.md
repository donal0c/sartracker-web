# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.5 (Tracking stability hotfix)

> **Internal beta draft.** Do not share or use for a live incident until every
> packaged smoke row below is complete and the GitHub prerelease is published.

- **Version:** 0.1.0-beta.12.5
- **Build tag:** `electron-v0.1.0-beta.12.5`
- **Cut date (UTC):** 2026-07-29
- **Linear references:** `DON-261`, `DON-262`, `DON-263`; follow-up `DON-264`
- **Supersedes:** published beta.12.3 and unpublished beta.12.4
- **Tag commit:** pending
- **Local verification report:** pending clean no-skip `npm run beta:verify`
- **CI run:** pending tag-driven `.github/workflows/electron-release.yml`
- **Exact artifact SHA-256:** pending draft-release qualification

## Why this hotfix exists

The team reported that beta.12.3 flashed the Tracking panel yellow whenever
tracking updated. Their PCLinuxOS evidence proved this was a deterministic
warning-state oscillation, not a crash: on 109 successful poll cycles the
renderer set `hasWarning:true` and cleared it 77-99 ms later while tracking,
storage, and crash history remained healthy.

Qualification also found that app-owned overlays waited for visible basemap
tiles to settle before synchronizing. Slow or unavailable raster tiles could
therefore delay current positions and breadcrumbs even though authoritative
tracking data was already available.

Beta.12.4 corrected those visible behaviours but was not published. A final
release review found two further blockers:

- asynchronous marker and helicopter icon-loading failures escaped the shared
  overlay retry boundary, and a disposed synchronization could later write
  stale data over newer state;
- the browser-validation bulk path persisted a large breadcrumb injection one
  position at a time, causing the 2,000-position CI test to time out on its
  first attempt before passing on retry.

Beta.12.5 fixes those blockers without changing coordinates, accepted
breadcrumb identity, Traccar request semantics, or Electron SQLite persistence.

## What changed

- The initial breadcrumb-history loading message appears only while the first
  request for the current mission history key is genuinely unresolved.
- A successful empty history result stays healthy instead of flashing amber on
  every poll.
- Genuine reconciliation, per-device failure, storage-seed failure, offline,
  pause, and recovery states remain visible and stable.
- **Open Devices** remains stationary while Tracking status text changes.
- Current positions, breadcrumbs, markers, drawings, GPX tracks, measurements,
  and helicopters synchronize as soon as the MapLibre style structure exists;
  basemap tile completion is not a prerequisite.
- The shared style synchronizer awaits asynchronous work, coalesces style
  events while it is in flight, reports failures, and retries indefinitely with
  bounded exponential backoff.
- Disposing a marker or helicopter synchronization aborts its pending icon-load
  continuation. Old state cannot wake later and overwrite a newer overlay.
- Browser-validation tracking injection builds the whole batch and performs one
  bounded session-storage write. This fixes the release-test flake; production
  Electron already uses SQLite bulk persistence and is semantically unchanged.
- The packaged interaction soak fails closed on missing, duplicate, untrusted,
  misdirected, or geometrically unstable operator input.

## What the team should test

1. Start a new mission while connected to Traccar and open **Tracking**.
2. Watch at least ten update cycles on both the AppImage and installed `.deb`.
3. The initial history-loading message may appear once. It must not flash again
   after the first result completes.
4. A long mission may show **Breadcrumb history is reconciling**; current fixes
   must continue updating while that stable message remains.
5. Confirm **Open Devices** stays fixed in place and opens on the first click.
6. While the basemap is loading or degraded, confirm current positions and
   breadcrumb trails remain visible and continue updating.
7. Add or edit markers and helicopter slots during a basemap change. The latest
   state must remain visible; an earlier state must not reappear.
8. Export an incident bundle with the approximate time if any yellow/red flash,
   missing overlay, or stale overlay is observed.

## Verification before tagging

- Strict red-to-green regressions cover asynchronous rejection/retry,
  in-flight event coalescing, cleanup, cancellation after icon loading, and
  one-write bulk browser persistence.
- Focused remediation tests: 21/21.
- Previously flaky CI-form large-history test: 10/10 repeated passes.
- Full unit suite: 173 files / 1,296 tests.
- ESLint, TypeScript production build, bundle budgets, and diff checks: pass.
- Standard Chromium Playwright: 142/142 with zero retry or flake; the
  2,000-position history workflow passed first attempt in 1.9 seconds.
- Visual Playwright: 37/37.
- Independent uncached visual review: 43/43, including every critical Tracking
  surface; report:
  `test-results/visual-verification/reports/visual-review-2026-07-29T22-28-19Z.json`.
- Backend: 51 passed / 1 ignored OS-keychain test.
- Independent code review: no P1/P2/P3 findings and `RELEASE` for the
  remediation diff; packaged qualification remains required.
- Fable 5 exact-diff review: `RELEASE`, no P1/P2 findings. It confirmed the
  retry/coalescing state machine, stale-write cancellation, hook call sites,
  and bulk-persistence semantics.
- Clean no-skip beta verification, tag CI, and exact CI-built Linux artifact
  results remain pending and are release blockers.

## Known limitations and non-goals

- This is an internal Linux x86-64 field-test build, not final operational
  acceptance and not approved for live incidents.
- Linux artifacts are unsigned and do not auto-update.
- Windows and macOS packages are not produced by this release lane.
- Private Discovery map packages are not bundled.
- Full Discovery map loading, beta.13 bounded-storage migration/retention,
  streamed archives, and archive-backed review remain separate work.
- Persistent overlay-sync exceptions retry with capped backoff and are visible
  in the developer console. Durable sanitized diagnostics/map-health elevation
  is tracked in `DON-264` and is non-blocking for this hotfix.
- This hotfix does not claim GPS hardware has zero physical measurement error.

## Packaged smoke matrix

The draft release must not be published until every row is complete.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | TODO | exact filename, full digest, and evidence path |
| .deb SHA-256 | TODO | exact filename, full digest, and evidence path |
| AppImage launch | TODO | TODO |
| Real .deb install and installed-binary launch | TODO | TODO |
| Core lifecycle, restart/recovery, finish/finalize/archive | TODO | TODO |
| Coordinate rejection | TODO | TODO |
| Diagnostics/support/incident exports sanitized | TODO | TODO |
| Bad/corrupt stored credential reaches shell | TODO | TODO |
| Live Traccar connection and breadcrumb reconciliation | TODO | TODO |
| Official offline Discovery package | TODO | PASS or NOT APPLICABLE with reason |
| Duplicate launch | TODO | TODO |
| Five-day and fourteen-day packaged soak | TODO | TODO |
| Cross-profile exact breadcrumb identity comparison | TODO | TODO |
| Empty-history Tracking panel stable for at least ten polls | TODO | AppImage and installed `.deb` |
| Open Devices target stationary across status changes | TODO | exact packaged interaction evidence |
| Overlays remain live while basemap is pending/degraded | TODO | AppImage and installed `.deb` |
| Latest marker/helicopter state wins after async icon loading | TODO | exact packaged observation/regression |

## Rollback / reinstall

1. Quit SAR Tracker.
2. AppImage: remove beta.12.5 and run the qualified beta.12.3 AppImage.
   `.deb`: install the previous package version.
3. Mission databases remain in the per-user application data directory and are
   not removed by uninstalling. Capture diagnostics before changing data.

## Pre-share checklist

- [ ] Product commit is clean, pushed, and tagged immutably
- [ ] Clean no-skip local `npm run beta:verify` passes every step
- [ ] Tag-driven Electron release workflow is green
- [ ] Draft assets are AppImage, `.deb`, and `SHA256SUMS` only
- [ ] Exact draft bytes match `SHA256SUMS`
- [ ] Exact CI AppImage and real installed `.deb` pass the packaged smoke matrix
- [ ] Release note contains exact commit, run, checksums, and evidence
- [ ] Linear and `handoff/HANDOFF.md` reflect the verified result
- [ ] Release remains an internal prerelease until guarded publication succeeds
