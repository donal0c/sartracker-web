# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.10

> **Unpublished internal beta candidate.** Do not give this build to testers
> and do not use it for a live incident until every packaged smoke row below
> is `PASS` and the GitHub draft has been explicitly promoted.

- **Version:** 0.1.0-beta.12.10
- **Build tag:** `electron-v0.1.0-beta.12.10`
- **Cut date (UTC):** 2026-08-11
- **Linear reference:** `DON-260`
- **Supersedes after qualification:** published beta.12.9
- **Tag commit:** TODO
- **Tag workflow:** TODO
- **Draft prerelease:** TODO
- **AppImage SHA-256:** TODO
- **Debian package SHA-256:** TODO
- **`SHA256SUMS` SHA-256:** TODO

## Release purpose

This candidate corrects the meaning of **Breadcrumb dots**. Each dot is now an
authoritative persisted position with its source identity, timestamp, and
coordinates. Dot mode no longer consumes the bounded geometry projection used
to draw the solid route line.

Missions with up to 10,000 in-window fixes display all fixes automatically.
Larger missions use exact chronological pages of at most 10,000 fixes across
the active devices, with a visible count and time range plus **Earlier** and
**Later** controls. A page replaces the previous page; the app never labels
representative or sampled positions as breadcrumbs. If the exact query fails,
Dots shows an explicit unavailable state and renders no representative
fallback.

The solid Line mode remains deliberately bounded and geometry-preserving for
large missions. Its simplification status and route-error bound belong only to
Line mode.

## Regression provenance

- Classification: Regression correction
- Linear issue: [DON-260](https://linear.app/donal-oc/issue/DON-260/deep-breadcrumb-correctness-deterministic-identity-restart-late-fixes)
- Affected release(s): Published beta.12.9 and the rejected beta.12.6-beta.12.8 candidates
- Last known good: Unknown — the release suite had never independently proved that Dots represented source fixes rather than the Line projection
- First known bad: beta.12.6 candidate; the same defect was present in published beta.12.9
- Root cause: Dots rendered `snapshot.breadcrumbs`, which is the bounded per-device Line projection. The selector keeps first/last fixes from spatiotemporal buckets, producing adjacent pairs or short groups followed by long gaps on steady-cadence movement.
- Escape analysis: The packaged dot oracle called the same production selector and compared only selector-derived coordinate digests. The small visual test injected four already-retained points, the live smoke asserted only non-zero tracking, and the fourteen-day soak proved SQLite truth without inspecting Dot identities or cadence.
- Before/after evidence: On the deterministic 36-hour source, beta.12.9 persisted all 279,936 fixes but exposed only 103,616 selector-derived dots. A steady 5-second device trail produced 5-second pairs separated by roughly 60 seconds. The replacement exact query covers all 279,936 fixes over 28 pages, and the fourteen-day proof covers all 1,935,384 fixes over 194 pages with zero gaps or duplicates.
- Regression gate: Independent raw-source oracles now verify exact source IDs, timestamps, coordinates, page order, visible page count/range, recovery, cold restart, MapLibre source/layer evidence, Line restoration, memory, responsiveness, and real-provider source-to-SQLite-to-page-to-map equality.
- Remaining uncertainty: The frozen source has passed the complete macOS deterministic gates. Exact CI AppImage, installed `.deb`, Ubuntu performance, and live Traccar qualification remain release-blocking until recorded below.

## Safety invariants

- Full accepted position truth remains in SQLite.
- Dots never call or fall back to the Line selector.
- Same-time distinct fixes remain distinct; a corrected source identity remains one authoritative fix.
- Exact pages are mission-start bounded, deterministic, gap-free, and duplicate-free.
- Page, mode, mission, stop, renderer-crash, and runtime-replacement cancellation cannot publish stale work or overlap unbounded workers.
- A page is published only after the exact query succeeds; an error is visible and leaves zero representative dots.
- Line mode retains its existing bounded geometry and explicit error-bound contract.

## Local qualification recorded before tagging

- Full unit suite: `195` files / `1,548` tests.
- Full Playwright suite: `179/179`, including all standard and visual capture projects.
- Lint, TypeScript build, bundle budgets, Electron/CJS syntax checks, and diff checks passed on the frozen production boundary.
- Frozen macOS 36-hour packaged proof: exact 279,936-row persistence, independent 28-page Dots oracle, rendered-layer identity/time/coordinate bounds, HTTP 503 retry, SIGKILL checkpoint recovery, complete checkpoints, exact Line total, and three cold Dots+Line restarts.
- Frozen macOS fourteen-day packaged proof: exact 1,935,384-row SQLite/source truth across 194 pages, zero gaps/duplicates, six direct IPC audits, 393 operator/source observations, two restart checkpoints, exact final Line total, and clean operator-input ownership.
- Fourteen-day timing: outward traversal `56.329 s` against `60 s`; Later return `64.832 s` against `120 s`; maximum query `600 ms`, publication `952 ms`, and page action `978 ms`.
- Fourteen-day peak process-tree RSS: `1,737,179,136` bytes, `410,304,512` bytes below the 2 GiB limit. All three launches exited zero; SQLite integrity and WAL checks passed; no orphan process or failure report remained.
- Evidence: `output/electron-breadcrumb-36h-exact-dots-navigation-final-20260811T0132Z/` and `output/electron-tracking-soak-extended-exact-dots-owned-final-20260811T070542Z/` (local, not release assets).

## Required qualification

- [ ] Clean no-skip local `npm run beta:verify`
- [x] Independent visual review passes the critical gate (`43/43`)
- [ ] Annotated tag and green tag-driven workflow
- [ ] Exact AppImage and `.deb` match `SHA256SUMS`
- [ ] Exact CI AppImage 36-hour proof passes all correctness, fault, recovery,
      rendered-layer, checkpoint, and three-restart gates
- [ ] Exact CI AppImage fourteen-day proof passes all exact-page,
      responsiveness, operator-input, Line-total, and 2 GiB RSS gates
- [ ] Installed `.deb` independently passes the 36-hour proof and package
      verification
- [ ] AppImage and installed `.deb` pass lifecycle, recovery/finalize/archive,
      coordinate rejection, duplicate launch, sanitized exports, and corrupt
      credentials
- [ ] Live Traccar proof matches provider GET truth to mission SQLite, exact
      pages, GeoJSON, and rendered MapLibre evidence without retaining private
      route data
- [ ] Release note, handoff, Linear, and regression ledger contain exact evidence
- [ ] Guarded publish succeeds; fresh public bytes and final public-AppImage
      lifecycle smoke re-verify

## Packaged smoke matrix

The GitHub release must stay draft until every applicable row is `PASS`.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | TODO | Exact filename, checksum, CI run, and Ubuntu verification |
| .deb SHA-256 | TODO | Exact filename, checksum, CI run, and Ubuntu verification |
| AppImage launch | TODO | Tag workflow plus native Ubuntu launch |
| .deb install and launch | TODO | Real installation, `dpkg -V`, and installed executable hash |
| Core lifecycle, restart/recovery, finish/finalize/archive | TODO | AppImage and installed `.deb` |
| Coordinate rejection | TODO | AppImage and installed `.deb` |
| Diagnostics/support/incident exports sanitized | TODO | AppImage and installed `.deb` |
| Bad/corrupt stored credential reaches shell | TODO | AppImage and installed `.deb` |
| Live Traccar connection and exact breadcrumb reconciliation | TODO | Provider-to-SQLite-to-exact-page-to-map private proof |
| Official offline Discovery package | TODO | PASS evidence or NOT APPLICABLE with concrete reason |
| Duplicate launch | TODO | AppImage and installed `.deb` |
| 36-hour exact Dots/Line proof | TODO | Exact source/page/render/checkpoint/restart evidence |
| Five-day and fourteen-day packaged soak | TODO | Exact truth, paging, restart, responsiveness, operator, and RSS evidence |
| Cross-profile exact breadcrumb identity comparison | TODO | Exact five-day/full-prefix and terminal digests |

## What the team should test after qualification

- **Critical:** Open a mission containing a known walking/driving trail, select
  Dots, and confirm the individual fixes form the expected temporal trail
  rather than pairs or groups.
- Confirm a mission below 10,000 fixes shows every fix on one page with the
  exact count and time range.
- For larger histories, use Earlier and Later repeatedly and confirm pages move
  in chronological order without blank, repeated, or representative pages.
- Switch repeatedly between Dots and Line. Dots must show exact-fix status;
  only Line may show route-simplification/error-bound language.
- Restart an active and a paused mission and verify the same Dots page returns.
- If exact Dots becomes unavailable, report it immediately; the app must show
  no representative fallback.

## Known limits

Internal Linux x86-64 field-test candidate only; unsigned; no auto-update; not
approved for live incidents. Exact pages cap the active map source at 10,000
fixes to protect responsiveness. No private Discovery package is bundled.

## Rollback

Until beta.12.10 is fully qualified and published, beta.12.9 remains the
published artifact. After publication, quit SAR Tracker before reinstalling an
older beta. Uninstalling does not remove per-user mission databases; capture
diagnostics first and do not delete suspected mission data.

---

## CI provenance

- Build commit: TODO
- Run: TODO
- Workflow: `.github/workflows/electron-release.yml`
- Release gates: lint, unit tests, web build, standard Chromium E2E, Linux
  packaging, private-map guard, llvmpipe packaged soak, and AppImage launch
