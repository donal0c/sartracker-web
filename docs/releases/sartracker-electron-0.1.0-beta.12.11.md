# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.11

> **Unpublished internal beta candidate.** Do not give this build to testers
> and do not use it for a live incident until every packaged smoke row below
> is `PASS` and the GitHub draft has been explicitly promoted.

- **Version:** 0.1.0-beta.12.11
- **Build tag:** `electron-v0.1.0-beta.12.11`
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

This candidate corrects the meaning of **Breadcrumb dots**. Each dot is an
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

Beta.12.11 also removes a release-blocking large-mission query regression found
by the Ubuntu fourteen-day gate. The all-devices page query previously grouped
the complete positions table on every page solely to rediscover the mission
device roster. It now reads the authoritative mission-scoped `devices` table;
the count, page, navigation, and mission-start filters remain unchanged.

The clean packaged verifier also exposed and closes a diagnostics privacy gap:
an app profile placed outside a conventional home directory could appear
verbatim in an exported diagnostics or support bundle. The export boundary now
redacts the exact app-owned profile path in raw, normalized, and JSON-escaped
forms while keeping the internal save destination functional.

## Regression provenance

- Classification: Regression correction and performance correction
- Linear issue: [DON-260](https://linear.app/donal-oc/issue/DON-260/deep-breadcrumb-correctness-deterministic-identity-restart-late-fixes)
- Affected release(s): Published beta.12.9 and rejected beta.12.6-beta.12.10 candidates; exact non-home diagnostics paths affected earlier desktop bundles
- Last known good: Unknown for source-exact Dots; the release suite had never independently proved this contract
- First known bad: beta.12.6 candidate; the same semantic defect was present in published beta.12.9
- Root cause: Dots rendered the bounded Line projection, whose spatiotemporal selection creates adjacent pairs/groups and long gaps. After source-exact paging was introduced, an empty active-device filter resolved the mission roster with a full positions-table `GROUP BY` on every page. Separately, the generic diagnostics sanitizer redacted conventional `/Users` and `/home` usernames but not the exact configured app profile when it lived elsewhere.
- Escape analysis: The beta.12.9 dot oracle called the production Line selector and compared selector-derived coordinates. The small visual test injected four already-retained points, the live smoke checked only non-zero tracking, and the old fourteen-day soak never traversed exact Dots. The beta.12.10 Ubuntu soak then correctly caught the new page-query cost at field scale. Home-based verifier profiles accidentally masked the path leak until the clean exact-commit verifier ran from `/private/tmp` and failed its support-bundle privacy assertion.
- Before/after evidence: Beta.12.9 persisted 279,936 deterministic fixes but exposed 103,616 selector-derived dots. Beta.12.10 made all 279,936 source fixes exact, but its Ubuntu 1,935,384-fix outward traversal took 81.096 seconds against the unchanged 60-second limit. On that preserved database, the positions roster scan cost about 24.1 seconds; the corrected production query reduced the complete 194-page SQLite traversal from 46.406 seconds to 22.335 seconds with the identical 1,935,384-row union.
- Regression gate: Independent source oracles now verify identities, timestamps, coordinates, page order, visible count/range, recovery, cold restart, MapLibre source/layer evidence, Line restoration, process-tree memory, and real-provider equality. The exact Ubuntu 194-page outward gate remains 60 seconds and is not relaxed.
- Remaining uncertainty: The source boundary and preserved-database benchmark are green. A newly built exact CI AppImage, installed `.deb`, Ubuntu 36-hour/fourteen-day proofs, and live Traccar provider-to-map proof remain release-blocking.

## Safety invariants

- Full accepted position truth remains in SQLite.
- Dots never calls or falls back to the Line selector.
- Same-time distinct fixes remain distinct; a corrected source identity remains one authoritative fix.
- Exact pages are mission-start bounded, deterministic, gap-free, and duplicate-free.
- Empty active-device selection means the complete mission roster; devices with no in-window fixes contribute no rows and do not change totals.
- Page, mode, mission, stop, renderer-crash, and runtime-replacement cancellation cannot publish stale work or overlap unbounded workers.
- Exact-query errors are visible and leave zero representative dots.
- Line mode retains its bounded geometry and explicit error-bound contract.

## Local qualification recorded before tagging

- Full unit suite: `195` files / `1,559` tests.
- Full Playwright suite inherited from the exact-Dots boundary: `179/179`; independent visual review `43/43`.
- TypeScript, lint, production build/bundle budgets, Electron/CJS syntax checks, and diff checks passed.
- Frozen macOS 36-hour packaged proof: exact 279,936-row persistence, independent 28-page Dots oracle, rendered-layer identity/time/coordinate bounds, HTTP 503 retry, SIGKILL recovery, complete checkpoints, exact Line total, and three cold Dots+Line restarts.
- Frozen macOS fourteen-day packaged proof: exact 1,935,384-row source/SQLite truth over 194 pages, zero gaps/duplicates, six direct IPC audits, 393 operator/source observations, two restart checkpoints, exact Line total, clean operator-input ownership, `56.329 s` outward, `64.832 s` return, and `1,737,179,136` byte peak process-tree RSS.
- Beta.12.10 exact Ubuntu 36-hour proof passed 279,936 fixes over 28 pages, all rendered/source/checkpoint/fault/restart gates, and the unchanged timing limits.
- Beta.12.10 Ubuntu fourteen-day proof was correctly rejected only by the 81.096-second outward limit; both retained databases have `ok` integrity and exactly 1,935,384 unique fixes. This evidence is diagnostic, not qualification for beta.12.11.
- Preserved Ubuntu database benchmark after the beta.12.11 query fix: 194 pages / 1,935,384 exact fixes in 22.335 seconds versus 46.406 seconds before, with identical union and no query-contract change.
- Diagnostics privacy regression proves non-home POSIX paths plus raw, slash-normalized, and JSON-escaped Windows profile paths cannot appear in diagnostics/support content; the internal export path remains real.

## Required qualification

- [ ] Clean no-skip local `npm run beta:verify`
- [x] Independent visual review passes the critical gate (`43/43`)
- [ ] Annotated tag and green tag-driven workflow
- [ ] Exact AppImage and `.deb` match `SHA256SUMS`
- [ ] Exact CI AppImage 36-hour correctness/fault/recovery/render/checkpoint/restart proof
- [ ] Exact CI AppImage fourteen-day page/responsiveness/operator/Line/RSS proof
- [ ] Installed `.deb` independent 36-hour proof and package verification
- [ ] AppImage and installed `.deb` lifecycle, recovery/finalize/archive, coordinate rejection, duplicate launch, sanitized exports, and corrupt-credential gates
- [ ] Live Traccar provider GET truth matches mission SQLite, exact pages, GeoJSON, and rendered MapLibre evidence
- [ ] Release note, handoff, Linear, and regression ledger contain exact evidence
- [ ] Guarded publish and fresh-public-byte verification pass

## Packaged smoke matrix

The GitHub release must stay draft until every applicable row is `PASS`.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage and `.deb` checksums | TODO | Exact filenames, `SHA256SUMS`, CI run, and Ubuntu verification |
| AppImage launch | TODO | Tag workflow plus native Ubuntu launch |
| `.deb` installation and launch | TODO | Real installation, `dpkg -V`, and installed executable hash |
| Mission lifecycle/recovery/finalize/archive | TODO | AppImage and installed `.deb` |
| Coordinate rejection and duplicate launch | TODO | AppImage and installed `.deb` |
| Diagnostics/support/incident exports sanitized | TODO | AppImage and installed `.deb` |
| Corrupt stored credential reaches safe shell | TODO | AppImage and installed `.deb` |
| Live Traccar exact reconciliation | TODO | Provider-to-SQLite-to-page-to-source-to-rendered private proof |
| 36-hour exact Dots/Line proof | TODO | Exact source/page/render/checkpoint/restart evidence |
| Fourteen-day packaged soak | TODO | 1,935,384 exact fixes, 194 pages, timing, restarts, Line total, operator ownership, and RSS |
| Cross-platform exact identity parity | TODO | Mac and Ubuntu terminal/page digests |

## What the team should test after qualification

- **Critical:** Open a known walking/driving trail, select Dots, and confirm
  individual fixes form the expected temporal trail rather than pairs/groups.
- Confirm a mission below 10,000 fixes shows every fix on one page with the
  exact count and time range.
- For larger histories, traverse Earlier/Later and confirm chronological pages
  without blank, repeated, or representative pages.
- Switch repeatedly between Dots and Line. Only Line may show route
  simplification/error-bound language.
- Restart active and paused missions and verify the same exact Dots page returns.
- Report any exact-Dots unavailable state immediately; it must never show a
  representative fallback.

## Known limits

Internal Linux x86-64 field-test candidate only; unsigned; no auto-update; not
approved for live incidents. Exact pages cap the active map source at 10,000
fixes to protect responsiveness. No private Discovery package is bundled.

## Rollback

Until beta.12.11 is fully qualified and published, beta.12.9 remains the
published artifact. Quit SAR Tracker before reinstalling an older beta.
Uninstalling does not remove per-user mission databases; capture diagnostics
first and do not delete suspected mission data.

---

## CI provenance

- Build commit: TODO
- Run: TODO
- Workflow: `.github/workflows/electron-release.yml`
- Release gates: lint, unit tests, web build, standard Chromium E2E, Linux
  packaging, private-map guard, packaged soak, and AppImage launch
