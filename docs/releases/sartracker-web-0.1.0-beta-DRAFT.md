# SAR Tracker Desktop Beta 0.1.0 (sha.e7ead2eb093a)

> **DRAFT — DO NOT PROMOTE.** B3 smoke testing on 2026-05-17 surfaced two
> blockers: a P0 lifecycle regression where active missions transition to
> `finished` on app quit (`sartracker-web-zl4`), and a P1 tracking-runtime
> warning that fires while the provider is saved and auto-connect is on
> (`sartracker-web-el9`). This release note is kept in the repo as the
> worked example of how a smoke-found-blocker beta should be documented.
> Do not drop the `-DRAFT` suffix and do not upload the artifact. The
> 0.1.0 beta is replaced by the next packaged build that lands after the
> two blockers above are fixed and the smoke checklist is fully green.

> **Internal beta only.** Not a production release. Do not use for live
> incidents under any circumstances; this draft did not pass smoke
> testing.

- **Version:** 0.1.0
- **Build tag:** sha.e7ead2eb093a
- **Cut date (UTC):** 2026-05-17
- **Cut by:** Claude Opus 4.7 (B3 first internal smoke build)
- **Bead reference:** sartracker-web-ppr (B3); blocked by
  sartracker-web-zl4 (P0) and sartracker-web-el9 (P1)
- **Verification report:** tmp/beta-artifacts/verify-0.1.0-sha.e7ead2eb093a-2026-05-17T06-55-19Z.json
- **Smoke evidence directory:** tmp/beta-artifacts/smoke/

## Install

- **Artifact:** `tmp/beta-artifacts/sartracker-web_0.1.0_aarch64.app.zip`
- **Artifact size:** 15.3 MB (extracted `.app` is ~25 MB)
- **Artifact SHA-256:**
  `a809e9865cba89561058dd32677749b24859805118b79aae8c63ac5da30753c3`
- **Build host:** macOS arm64 development machine; Tauri CLI 2.10.1; Rust
  1.94.1; Node 22.17.1
- **Platform:** macOS 13+, Apple Silicon (arm64)
- **Distribution channel:** GitHub Releases draft/prerelease on
  `donal0c/sartracker-web` with the "internal beta" tag in the title
  (artifact NOT uploaded — draft is blocked by P0/P1 above)
- **Install / open steps:** kept here for the template's sake; do not run
  this artifact in any operational context.

## What Changed

This was the first internal Tauri beta candidate cut. It bundles every
hosted-deployed change since the start of the project on the desktop
runtime for the first time:

- B2: Tauri Beta Release Template — repeatable beta release process,
  `npm run beta:verify` gate, and release-note workflow
  [sartracker-web-xhz].
- S3: Layer Visibility Service Extraction with helicopter and GPX
  overlay-store coverage [sartracker-web-4a1].
- A3 batch (A3.1–A3.14): map placement guardrails, drawing
  rendering/visibility, compact Maps and Map Tools chrome, mission mast
  cleanup, contrast/theme pass, static notes relocation, Marker At Grid
  Reference, drawing labels/styles/delete, configurable Weather links
  (external links only), Irish Grid conversion accuracy, marker placement
  stability from coordinate entry, roster spacing, coordinate converter
  formats, drawing tools renamed to Map Tools with Measure
  [sartracker-web-6y3 and children].
- R-series shared/runtime hardening (R1–R11): visible autosave failure
  reporting, observed-tick stale detection, honest hosted browser system
  status, persistent lifecycle backup failure alert, exception-safe
  runtime controller swap, runtime fault reload hardening, regression E2E
  coverage, browser harness storage non-goals note.
- R8: macOS Gatekeeper guidance and unsigned-app expectations are now in
  the operator manual under Desktop Beta [sartracker-web-977].

## What To Test

Documented for a future, post-fix beta. This draft did not pass the
smoke-time validation of these items.

## Smoke Result (2026-05-17)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Packaged app launches | PASS | `tmp/beta-artifacts/smoke/01-initial-launch.png` (PID 60348 alive after `open`) |
| 2 | Build/version visible in mast | PASS | `tmp/beta-artifacts/smoke/01d-mast-full.png` shows `0.1.0+SHA.E7EAD2EB093A` |
| 3 | Start a mission | PASS | Diagnostics report shows `phase: active`, `current mission: Fdsfdsf` |
| 4 | Mission persists across restart | **FAIL** | After `osascript ... quit` and relaunch the mast read `No active mission`. Direct SQLite query against `mission-store.sqlite` shows mission `a0a0eb32-...` set to `finished` at `2026-05-17T07:06:50` with no preceding user lifecycle event in `mission_events`. Filed as P0 `sartracker-web-zl4`. |
| 5 | Tracking settings save | PARTIAL FAIL | Provider, URL, auth, and auto-connect persist correctly; runtime tracking does not bootstrap. System Status shows `Tracking is not configured` and `Tracking provider is configured but runtime tracking is not connected` simultaneously. Diagnostics confirms `runtime tracking configured: no`, `last success: never`. Filed as P1 `sartracker-web-el9`. |
| 6 | Diagnostics export | PASS | Report at `tmp/beta-artifacts/smoke/diagnostics-report-2026-05-17T07-05-55-676Z.txt`; version line matches the mast; warnings rendered correctly. |

Raw evidence kept under `tmp/beta-artifacts/smoke/`:
`01-initial-launch.png`, `01d-mast-full.png`,
`02-mission-started-tracking-warnings.png`, `03-before-quit.png`,
`04b-after-restart.png`, `04c-after-restart-front.png`,
`diagnostics-report-2026-05-17T07-05-55-676Z.txt`,
`mission-events-fdsfdsf.tsv`.

## Known Limitations

- macOS arm64 only; no Windows/Linux artifacts in this drop.
- Ad-hoc signed only; expect Gatekeeper warnings on macOS.
- DMG packaging is not currently produced; a zipped `.app` is the only
  shareable artifact.
- High-definition mountain map packages are not bundled with this build.
- Browser hosted-mode persistence is testing-only and not part of this
  desktop beta.
- **Critical limitation found at smoke time:** active missions transition
  to `finished` on app quit (`sartracker-web-zl4`). Do not run this
  build for any incident, training, or testing where mission lifecycle
  fidelity matters.

## Rollback / Reinstall

- This is the first internal beta and must not be promoted. There is
  nothing to roll back to and nothing to reinstall. The next packaged
  build replaces this draft entirely.

## Verification Before Sharing

`npm run beta:verify -- --no-smoke` ran end-to-end on
`commit e7ead2eb093a`:

- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm run test` (460/460)
- [x] `npm run test:backend` (39/39)
- [x] `npm run tauri build -- --bundles app` produced
      `src-tauri/target/release/bundle/macos/sartracker-web.app`
- [x] Artifact zipped via `ditto` to
      `tmp/beta-artifacts/sartracker-web_0.1.0_aarch64.app.zip`
- [x] Release note includes the unsigned/Gatekeeper warning
- [x] Verification report from `tmp/beta-artifacts/` referenced above
- [x] Packaged app launches
- [x] Build/version is visible in the mast
- [x] A new mission can be started
- [ ] Mission persists after closing and reopening the app — **FAIL,
      sartracker-web-zl4**
- [ ] Tracking settings can be opened and saved — **partial fail,
      sartracker-web-el9**
- [x] Diagnostics export/open works
