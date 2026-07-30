# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.5 (Tracking stability hotfix)

> **Internal beta draft.** Do not share or use for a live incident until every
> packaged smoke row below is complete and the GitHub prerelease is published.

- **Version:** 0.1.0-beta.12.5
- **Build tag:** `electron-v0.1.0-beta.12.5`
- **Cut date (UTC):** 2026-07-29
- **Linear references:** `DON-261`, `DON-262`, `DON-263`; follow-up `DON-264`
- **Supersedes:** published beta.12.3 and unpublished beta.12.4
- **Tag commit:** `042d77ad615825eb7d9fc618f22bdc1a6f032771`
- **Local verification report:** clean no-skip `npm run beta:verify` passed 8/8;
  `tmp/beta-artifacts/verify-0.1.0-beta.12.5-sha.042d77ad6158-2026-07-29T22-45-48Z.json`
- **CI run:** tag-driven
  [`30497318233`](https://github.com/donal0c/sartracker-web/actions/runs/30497318233)
  passed every job
- **Exact artifact SHA-256:** AppImage
  `41124632ea3e6d209ab5d638f369aaa60dc16315606bfc5b07499cf61cf0ab2b`;
  `.deb` `0c876bf7e80bef226e7a59159dfeb058ed24e3025b0165bb4c9bb1b70dbdce4c`

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
- Clean no-skip beta verification passed 8/8. Tag CI run `30497318233`
  passed the unit/Chromium gates, Linux bundle, native SQLite, private-map
  guard, llvmpipe, packaged soak, AppImage launch, and draft upload jobs.
- The exact CI AppImage and a real installation of the exact CI `.deb` passed
  the complete Ubuntu matrix below. No locally rebuilt substitute was used.

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

The exact draft artifacts completed this matrix on Ubuntu before publication.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.5_linux_x86_64.AppImage` — `41124632ea3e6d209ab5d638f369aaa60dc16315606bfc5b07499cf61cf0ab2b`; exact draft asset and `SHA256SUMS` agree |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.5_linux_amd64.deb` — `0c876bf7e80bef226e7a59159dfeb058ed24e3025b0165bb4c9bb1b70dbdce4c`; exact draft asset and `SHA256SUMS` agree |
| AppImage launch | PASS | CI launch job plus Ubuntu llvmpipe packaged soak: 8,664/8,664 positions, main maximum 6.9 ms |
| .deb install and launch | PASS | real install: `install ok installed 0.1.0~beta.12.5`; `dpkg -V sartracker-web` clean; `/usr/bin/sartracker-web` soak 8,664/8,664, main maximum 6.0 ms |
| Core lifecycle, restart/recovery, finish/finalize/archive | PASS | `ubuntu-evidence/{appimage-lifecycle-qualified,deb-installed-lifecycle}/summary.json` |
| Coordinate rejection | PASS | coarse `V 80 84 -> V 80500 84500`; invalid input rejected on both package paths |
| Diagnostics/support/incident exports sanitized | PASS | both package paths exported all three bundles; allow-list/privacy inspection passed |
| Bad/corrupt stored credential reaches shell | PASS | both package paths reached the normal shell and recoverable Settings state |
| Live Traccar connection and breadcrumb reconciliation | PASS | both package paths connected to 33 devices, completed reconciliation, and showed no warning |
| Official offline Discovery package | NOT APPLICABLE | no official/private map source or package is configured or bundled; full Discovery loading remains explicitly out of scope |
| Duplicate launch | PASS | both package paths retained one primary instance and mission state |
| Five-day and fourteen-day packaged soak | PASS | 691,224/691,224 and 1,935,384/1,935,384 positions, one/two restarts, zero redundant rows |
| Cross-profile exact breadcrumb identity comparison | PASS | five-day digest `93c71e433a7da41c0966bf9a4cad3c1e48a534732bb2ed3e043ff3f66a26c146` exactly equals the fourteen-day prefix digest |
| Empty-history Tracking panel stable for at least ten polls | PASS | AppImage and installed `.deb`: 13 polls, zero post-initial loading/unexpected warnings |
| Open Devices target stationary across status changes | PASS | both exact-package empty-history probes recorded the sole Y coordinate `598`; packaged interaction soak also passed |
| Overlays remain live while basemap is pending/degraded | PASS | AppImage held 21 tiles and installed `.deb` held 22; positions and breadcrumbs rendered and grew in both states |
| Latest marker/helicopter state wins after async icon loading | PASS | strict cancellation/stale-continuation unit regressions plus exact-package pending/degraded overlay probes |

Machine-readable qualification evidence is mirrored under
`tmp/beta-artifacts/ci-30497318233/ubuntu-evidence/`; failed exploratory
display/harness attempts are retained separately and are not counted as passes.

## Rollback / reinstall

1. Quit SAR Tracker.
2. AppImage: remove beta.12.5 and run the qualified beta.12.3 AppImage.
   `.deb`: install the previous package version.
3. Mission databases remain in the per-user application data directory and are
   not removed by uninstalling. Capture diagnostics before changing data.

## Pre-share checklist

- [x] Product commit is clean, pushed, and tagged immutably
- [x] Clean no-skip local `npm run beta:verify` passes every step
- [x] Tag-driven Electron release workflow is green
- [x] Draft assets are AppImage, `.deb`, and `SHA256SUMS` only
- [x] Exact draft bytes match `SHA256SUMS`
- [x] Exact CI AppImage and real installed `.deb` pass the packaged smoke matrix
- [x] Release note contains exact commit, run, checksums, and evidence
- [x] Linear and `handoff/HANDOFF.md` reflect the verified result
- [ ] Release remains an internal prerelease until guarded publication succeeds

---

## CI Provenance

- Build commit: `042d77ad615825eb7d9fc618f22bdc1a6f032771`
- Run:
  [`30497318233`](https://github.com/donal0c/sartracker-web/actions/runs/30497318233)
- Workflow: `.github/workflows/electron-release.yml`
- Release gates: lint, unit tests, web build, standard Chromium E2E, Linux
  packaging, private-map guard, llvmpipe, packaged soak, and AppImage launch
