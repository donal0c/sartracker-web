# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.11

> **Published qualified internal beta.** Every packaged smoke row, the guarded
> publisher, fresh-public-byte checksum proof, and public AppImage lifecycle
> gate below are `PASS`.

- **Version:** 0.1.0-beta.12.11
- **Build tag:** `electron-v0.1.0-beta.12.11`
- **Cut date (UTC):** 2026-08-11
- **Linear reference:** `DON-260`
- **Published (UTC):** 2026-08-11T12:11:10Z
- **Supersedes:** beta.12.9
- **Tag commit:** `bced8052b85c110792a7af5ccb7122a94b2fafad`
- **Tag workflow:** [run 31482052296](https://github.com/donal0c/sartracker-web/actions/runs/31482052296) — green
- **Published prerelease:** [electron-v0.1.0-beta.12.11](https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.12.11)
- **AppImage SHA-256:** `2844b75fe9fc2fff7623f4a5db7c360804787b4a4d278153659cc8c9ce1c295b`
- **Debian package SHA-256:** `d5e33b41417e444ea524e73c9e25e21d526b70289d68d0ef7c37cf1726fc2954`
- **`SHA256SUMS` SHA-256:** `965110afec47a638951dc16a97f203e5a5106ab5897c2d7723da4b17fbb4cfc1`

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

- Classification: Regression correction
- Linear issue: [DON-260](https://linear.app/donal-oc/issue/DON-260/deep-breadcrumb-correctness-deterministic-identity-restart-late-fixes)
- Affected release(s): Published beta.12.9 and rejected beta.12.6-beta.12.10 candidates; exact non-home diagnostics paths affected earlier desktop bundles
- Last known good: Unknown for source-exact Dots; the release suite had never independently proved this contract
- First known bad: beta.12.6 candidate; the same semantic defect was present in published beta.12.9
- Root cause: Dots rendered the bounded Line projection, whose spatiotemporal selection creates adjacent pairs/groups and long gaps. After source-exact paging was introduced, an empty active-device filter resolved the mission roster with a full positions-table `GROUP BY` on every page. Separately, the generic diagnostics sanitizer redacted conventional `/Users` and `/home` usernames but not the exact configured app profile when it lived elsewhere.
- Escape analysis: The beta.12.9 dot oracle called the production Line selector and compared selector-derived coordinates. The small visual test injected four already-retained points, the live smoke checked only non-zero tracking, and the old fourteen-day soak never traversed exact Dots. The beta.12.10 Ubuntu soak then correctly caught the new page-query cost at field scale. Home-based verifier profiles accidentally masked the path leak until the clean exact-commit verifier ran from `/private/tmp` and failed its support-bundle privacy assertion.
- Before/after evidence: Beta.12.9 persisted 279,936 deterministic fixes but exposed 103,616 selector-derived dots. Beta.12.10 made all 279,936 source fixes exact, but its Ubuntu 1,935,384-fix outward traversal took 81.096 seconds against the unchanged 60-second limit. On that preserved database, the positions roster scan cost about 24.1 seconds; the corrected production query reduced the complete 194-page SQLite traversal from 46.406 seconds to 22.335 seconds with the identical 1,935,384-row union.
- Regression gate: Independent source oracles now verify identities, timestamps, coordinates, page order, visible count/range, recovery, cold restart, MapLibre source/layer evidence, Line restoration, process-tree memory, and real-provider equality. The exact Ubuntu 194-page outward gate remains 60 seconds and is not relaxed.
- Remaining uncertainty: The exact CI AppImage and genuinely installed `.deb` have completed the Ubuntu synthetic and real-provider matrices. The closest retained margins are the theory-backed 8 m rendered-coordinate bound (worst 7.404 m in the 36-hour proof), the fourteen-day 60 s outward traversal (54.632 s), and the 2 GiB process-tree bound (1.597 GB). These are measured residual margins, not waived gates. A private Discovery package remains explicitly out of scope and is not bundled.

## Safety invariants

- Full accepted position truth remains in SQLite.
- Dots never calls or falls back to the Line selector.
- Same-time distinct fixes remain distinct; a corrected source identity remains one authoritative fix.
- Exact pages are mission-start bounded, deterministic, gap-free, and duplicate-free.
- Empty active-device selection means the complete mission roster; devices with no in-window fixes contribute no rows and do not change totals.
- Page, mode, mission, stop, renderer-crash, and runtime-replacement cancellation cannot publish stale work or overlap unbounded workers.
- Exact-query errors are visible and leave zero representative dots.
- Line mode retains its bounded geometry and explicit error-bound contract.

## Qualification evidence

- Clean no-skip macOS `npm run beta:verify`: `8/8` gates PASS; report `verify-0.1.0-beta.12.11-sha.bced8052b85c-2026-08-11T10-23-05Z.json`, SHA-256 `fefbbbff43f4774da78b17c9d04f704024467b16e5ff2e2667198d775003c8e7`.
- Final proof-harness suite after packaged findings: `195` files / `1,565` tests; full lint and TypeScript green.
- Full Playwright suite inherited from the exact-Dots boundary: `179/179`; independent visual review `43/43`.
- TypeScript, lint, production build/bundle budgets, Electron/CJS syntax checks, and diff checks passed.
- Frozen macOS 36-hour packaged proof: exact 279,936-row persistence, independent 28-page Dots oracle, rendered-layer identity/time/coordinate bounds, HTTP 503 retry, SIGKILL recovery, complete checkpoints, exact Line total, and three cold Dots+Line restarts.
- Frozen macOS fourteen-day packaged proof: exact 1,935,384-row source/SQLite truth over 194 pages, zero gaps/duplicates, six direct IPC audits, 393 operator/source observations, two restart checkpoints, exact Line total, clean operator-input ownership, `56.329 s` outward, `64.832 s` return, and `1,737,179,136` byte peak process-tree RSS.
- Beta.12.10 exact Ubuntu 36-hour proof passed 279,936 fixes over 28 pages, all rendered/source/checkpoint/fault/restart gates, and the unchanged timing limits.
- Beta.12.10 Ubuntu fourteen-day proof was correctly rejected only by the 81.096-second outward limit; both retained databases have `ok` integrity and exactly 1,935,384 unique fixes. This evidence is diagnostic, not qualification for beta.12.11.
- Preserved Ubuntu database benchmark after the beta.12.11 query fix: 194 pages / 1,935,384 exact fixes in 22.335 seconds versus 46.406 seconds before, with identical union and no query-contract change.
- Diagnostics privacy regression proves non-home POSIX paths plus raw, slash-normalized, and JSON-escaped Windows profile paths cannot appear in diagnostics/support content; the internal export path remains real.
- Exact beta.12.11 Ubuntu AppImage 36-hour proof: `279,936/279,936` source/SQLite fixes, 28 exact pages, complete checkpoints, one HTTP 503 retry, forced SIGKILL recovery, exact Line total, rendered-layer bounds, and three cold Dots+Line restarts; report SHA-256 `e120470cc7f93fcc19a1bf2965af179d7b97eda96b00d143b27ef3e1e9c557ee`.
- Exact beta.12.11 Ubuntu fourteen-day proof: `1,935,384/1,935,384` fixes over 194 pages, no gaps/duplicates, outward `54.632 s`, return `67.597 s`, exact Line total, three clean launches, and peak process-tree RSS `1.597 GB`; report SHA-256 `399891e3c5dcbf3c033c19992fc0a97a17bc22ed7e1e50518235fbebcdee1fbb`.
- Private live-provider AppImage proof: `10,371` target fixes over exact `10,000 -> 371 -> 10,000` UI pages, provider/SQLite/page/GeoJSON/rendered equality, zero representative fallback, and rendered maximum `4.129 m`; allowlisted mode-0600 report SHA-256 `1540277ae9dbd81b285cb65745ee012757320c89f85200ebf1bcc3f8dc0e518a`.
- Real installed `.deb`: `sartracker-web 0.1.0~beta.12.11` is `install ok installed`; `dpkg -V` is clean; installed executable SHA-256 `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8` exactly matches the independently extracted payload. Its 36-hour proof independently passed `279,936/279,936` with report SHA-256 `c37fe334f6b8c72681469b1af21980e5de48488829bca1d544ea0430a631a41c`.
- Private live-provider installed-`.deb` proof: `10,184` target fixes over exact `10,000 -> 184 -> 10,000` pages with the same complete equality and rendered bounds; allowlisted report SHA-256 `bdc7cf321067def4875eaedb2e730c553d3d6530975c67663cbf686d0e691409`.
- Newer-schema refusal: schema 8 was rejected by the schema-7 package with the exact native operator message, exit code 1, zero renderer processes, no unhandled rejection, and byte-identical database/backup files; report SHA-256 `7a22a8c23b2da4d40bb34ee89e919fb718d9826ec72b752cde3d7c2dbcdfe984`.
- Guarded publication freshly downloaded the draft AppImage and `.deb`, revalidated their manifest and asset metadata, re-peeled the immutable tag, and published without bypass. A second independent public download matched both installer hashes and `SHA256SUMS`; the public AppImage then passed settings persistence, same-mission recovery, finish/finalize, and non-empty archive creation on Ubuntu. Public lifecycle report SHA-256: `dfc8e39b1ebfa596e7fcc3e33afe373018cb7cb5c9f5f12f32b46fe09250b48e`.

## Required qualification

- [x] Clean no-skip local `npm run beta:verify`
- [x] Independent visual review passes the critical gate (`43/43`)
- [x] Annotated tag and green tag-driven workflow
- [x] Exact AppImage and `.deb` match `SHA256SUMS`
- [x] Exact CI AppImage 36-hour correctness/fault/recovery/render/checkpoint/restart proof
- [x] Exact CI AppImage fourteen-day page/responsiveness/operator/Line/RSS proof
- [x] Installed `.deb` independent 36-hour proof and package verification
- [x] AppImage and installed `.deb` lifecycle, recovery/finalize/archive, coordinate rejection, duplicate launch, sanitized exports, and corrupt-credential gates
- [x] Live Traccar provider GET truth matches mission SQLite, exact pages, GeoJSON, and rendered MapLibre evidence
- [x] Release note, handoff, Linear, and regression ledger contain exact evidence
- [x] Guarded publish and fresh-public-byte verification pass

## Packaged smoke matrix

The GitHub release must stay draft until every applicable row is `PASS`.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.11_linux_x86_64.AppImage` — `2844b75fe9fc2fff7623f4a5db7c360804787b4a4d278153659cc8c9ce1c295b`; CI asset, draft/public asset metadata, `SHA256SUMS`, macOS download, and Ubuntu public bytes agree |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.11_linux_amd64.deb` — `d5e33b41417e444ea524e73c9e25e21d526b70289d68d0ef7c37cf1726fc2954`; CI asset, draft/public asset metadata, `SHA256SUMS`, macOS download, and Ubuntu public bytes agree |
| AppImage launch | PASS | Tag workflow launch smoke plus native Ubuntu lifecycle, 36-hour, fourteen-day, and live-provider proofs |
| .deb install and launch | PASS | `sartracker-web 0.1.0~beta.12.11` is `install ok installed`; `dpkg -V` is clean; installed executable hash matches the extracted `.deb` payload and completed native Ubuntu proofs |
| Core lifecycle, restart/recovery, finish/finalize/archive | PASS | AppImage report `21c07590...ebf63`; installed `.deb` report `1110ec6e...d8405`; both persisted settings, resumed the same mission, finalized, and produced a non-empty archive |
| Coordinate rejection | PASS | AppImage and installed `.deb` both resolved `V 80 84` to `V 80500 84500` and rejected invalid grid input without opening a marker dialog; shared report SHA-256 `640c845c...43c5` |
| Diagnostics/support/incident exports sanitized | PASS | Both package paths exported all three bounded reports; exact profile-path, credential, and allowlist privacy inspection passed (`666ab4d1...3cf` AppImage; `6bc37188...08b2` installed `.deb`) |
| Bad/corrupt stored credential reaches shell | PASS | Both package paths reached the normal shell with the explicit recoverable warning and editable Settings (`1c30a83e...0456` AppImage; `e5171805...fe7a` installed `.deb`) |
| Live Traccar connection and breadcrumb reconciliation | PASS | AppImage `10,371` and installed `.deb` `10,184` target fixes each matched independent GET-only provider truth through SQLite, exact pages, literal GeoJSON source, rendered MapLibre identities/times and bounded coordinates, with zero representative fallback and exact return-to-latest |
| Official offline Discovery package | NOT APPLICABLE | No private Discovery package is configured or bundled; full Discovery loading remains explicitly out of scope |
| Duplicate launch | PASS | AppImage and installed `.deb` retained one primary instance and intact mission state while the second process exited normally; coordinate/duplicate gate SHA-256 `640c845c...43c5` |
| Five-day and fourteen-day packaged soak | PASS | Exact CI AppImage completed the 1,935,384-fix fourteen-day proof over 194 pages with restart checkpoints at 645,144 and 1,290,264 fixes, no gaps/duplicates, outward `54.632 s`, return `67.597 s`, exact Line total, operator ownership and `1.597 GB` peak RSS; independent 36-hour AppImage and installed-`.deb` proofs each covered 279,936 fixes/28 pages |
| Cross-profile exact breadcrumb identity comparison | PASS | Mac frozen proofs plus Ubuntu AppImage and genuinely installed `.deb` profiles independently matched every source identity, fix time and coordinate to their formula/provider oracle; both Ubuntu 36-hour profiles produced 279,936 exact rows/28 pages and both private provider profiles traversed target-only multi-page Dots with zero omissions or representatives |

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

Beta.12.11 supersedes beta.12.9 for internal field testing. Quit SAR Tracker
before reinstalling an older beta if rollback is required.
Uninstalling does not remove per-user mission databases; capture diagnostics
first and do not delete suspected mission data.

---

## CI provenance

- Build commit: `bced8052b85c110792a7af5ccb7122a94b2fafad`
- Run: [31482052296](https://github.com/donal0c/sartracker-web/actions/runs/31482052296)
- Workflow: `.github/workflows/electron-release.yml`
- Release gates: lint, unit tests, web build, standard Chromium E2E, Linux
  packaging, private-map guard, packaged soak, and AppImage launch

## WAR-04B record amendment (2026-08-30)

The original release record above uses “immutable” for the project's
procedural write-once tag policy. Read-only GitHub inspection on 2026-08-30
found `immutable:false` for this public prerelease and no `electron-v*` tag
ruleset, so technical tag or asset immutability was not enforced. The original
wording is preserved rather than rewritten; this amendment does not change the
point-in-time tag, run, asset, or checksum evidence and did not mutate the live
GitHub release. See `docs/releases/README.md` and
`docs/assurance/findings/WAR-04B.md`.
