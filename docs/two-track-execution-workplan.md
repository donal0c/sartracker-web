# Two-Track Execution Workplan

> **Canonical planning path.** Start here when deciding what to do next. All new planning, hardening, feedback, release, map, UI, verification, and parity work must either fit into this queue or update this queue before implementation starts.

## Planning Rule

There is one active work queue: this file.

Supporting docs may explain a specific area, but they must not become separate task boards. If a task is discovered in a report, chat, test run, review, bug report, or support note, fold it into this file as a chunk before treating it as planned work.

Do not create new planning queues under other names. Do not revive the old hardening backlog as an active board. Historical reports are evidence only; this file decides the next task.

When a chunk is finished:

1. Update this file if the queue changed.
2. Update the relevant Linear issue.
3. Update `handoff/HANDOFF.md` with only the current baton.
4. Update the operator manual if operator-facing behavior changed.
5. Run the relevant verification for the chunk.

Verification is not optional closeout ceremony. For any UI, map, workflow, runtime, hosted deployment, or operator-facing change, Codex should choose and run the appropriate browser-backed verification before recording final docs or closing the Linear issue. The default ladder is:

- Inbuilt browser for quick manual sanity checks.
- Playwright for repeatable UI/workflow/regression checks.
- Chrome or Chrome DevTools MCP when the issue depends on the user's real browser profile, existing tabs, DevTools/network evidence, or browser-specific behavior.

The user should not need to repeat this in every prompt. The available browser tools are all acceptable when they are the right fit: `$browser:browser`, `$chrome:Chrome`, `$chrome-devtools-cli`, and `$playwright`. Each chunk's handoff/Linear issue update must state the exact browser flow or deployed URL that was verified, or explicitly say why UI verification was not relevant.

## Operating Model

Run two delivery tracks in parallel, with shared-foundation work feeding both.

### Verification Cadence

Default to web-first validation for cadence. Building, uploading, installing,
and testing packaged desktop artifacts is intentionally heavier, so every chunk
should make a quick runtime-risk call before choosing its verification path.

Use hosted/web validation as the primary fast loop when the change is ordinary
renderer code: UI layout, wording, panel behaviour, visual styling, layer-list
presentation, non-persistent map interactions, and most React state changes.
These should normally behave the same in the browser and Electron because they
run through the same frontend bundle.

Escalate to a packaged desktop/Electron validation build when the answer to
this question is yes:

> Could this work in the hosted web app but fail in the packaged desktop app?

Examples that require packaged validation:

- desktop shell, preload bridge, IPC, filesystem, SQLite, keyring/secrets, app
  paths, diagnostics export, crash/restart recovery, updater/release packaging,
  AppImage/`.deb`/installer behaviour, native permissions, OS integration, or
  runtime launch paths
- map renderer/runtime changes where GPU, WebGL, Electron/Chromium, WebKitGTK,
  tile cache workers, offline tiles, or black-screen detection are part of the
  risk
- tracking/network changes where desktop and hosted paths differ, such as direct
  Traccar access versus the hosted proxy
- any fix whose failure mode would only appear after packaging, restart, or
  local-machine integration

If the chunk is web-validated only, record that as an explicit confidence call
in the Linear/handoff update. If a packaged build is required, keep the build
focused on that risk rather than turning every UI change into a release cycle.

**Track A: Hosted team testing**

- Runtime: Vercel hosted browser testing mode.
- URL: `https://sartracker-web.vercel.app/?missionHarness=1`
- Purpose: let the team learn the app, find bugs, request UI changes, and test tracking/layers/workflows quickly.
- Release style: small, frequent Vercel deploys.
- Persistence expectation: session storage only; testing/training, not live incidents.

**Track B: Tauri operational readiness**

- Runtime: packaged Tauri desktop app.
- Purpose: prepare the operational release lane without waiting for all UI feedback to finish.
- Release style: quieter background work, then versioned beta packages when a coherent batch is ready.
- Persistence expectation: SQLite, filesystem adapters, recovery, diagnostics, and local map packages.

**Shared foundation**

- Runtime boot, mission lifecycle, tracking, layer visibility, map overlays, and verification hardening that affects both tracks.
- These chunks should be pulled forward when they reduce confusion, unblock UI changes, or lower operational risk.

## Decision Rule

When new work arrives, classify it before implementing:

| Work type | Route |
| --- | --- |
| Confusing UI, wording, control placement, layer visibility, tracking display | Track A |
| Bug visible in hosted browser testing mode | Track A first, then confirm whether Tauri is also affected |
| Runtime boot, startup failure visibility, shared mission/layer/tracking correctness | Shared foundation |
| Mission persistence, recovery, filesystem, GPX watch, diagnostics export, archive | Track B |
| High-definition mountain map integration | Track B / desktop-first |
| Browser IndexedDB, browser backups, browser file workflows | Defer until the browser-hardening decision |
| Security concern about public map hosting | Track B / local map package support; do not host proprietary maps |
| New hardening finding | Add it here as Shared, Track A, Track B, Verification, or Deferred |

Then choose the lightest valid verification route:

| Runtime risk | Verification route |
| --- | --- |
| Same frontend codepath; no native persistence, filesystem, packaging, runtime, GPU, or direct-network difference | Web/hosted validation is normally enough |
| Shared frontend behaviour but safety-critical map/tracking/operator visibility impact | Web/hosted validation plus targeted regression coverage; package only if runtime-specific risk exists |
| Native desktop boundary, Electron/Tauri shell, app paths, secrets, SQLite, filesystem, diagnostics, updater, packaging, OS permissions, GPU/WebGL/runtime, offline tiles, or direct Traccar path | Packaged desktop validation required |

Release diagnostic rule: every tester-facing desktop build must include a
one-click diagnostics export that is broad enough to avoid slow back-and-forth
debugging. The report must be allow-listed and sanitized, but should capture the
runtime facts needed to triage remotely: app/build version, OS/distro/kernel,
Electron/Chromium/Node versions, GPU/WebGL/map probe status, safeStorage
backend, configured provider base/auth mode/secret-present only, tracking
status/cache summary, mission-store path/schema/SQLite/native-module load
status, diagnostics/export paths, and recent app-owned fault messages. Do not
ship or ask testers for whole Electron profile zips.

## Current Priority

1. Keep hosted browser testing smooth enough for the team to give real feedback.
2. Fix the 2026-05-16 team feedback items that affect map trust before returning to broader foundation work.
3. Burn down shared foundation issues that make startup, mission control, tracking, layers, or map behavior ambiguous.
4. Prepare a repeatable Tauri beta release path in the background.
5. Avoid heavy browser hardening unless testing proves browser operational deployment is genuinely needed.
6. Treat licensed Irish/OSI map sources as local/customer-provided assets unless the map provider gives requirements that change this.
7. Continue the official map lane through the team-ready Electron import workflow: `DON-7` is now the active offline-map parent for `DON-109` through `DON-115`, while `DON-76` remains the broader official-provider parent and overlay lane.

## Next Task Order

This is the default order when the user says “work on the next task.”

| Order | Chunk | Track | Linear issue | Status |
| --- | --- | --- | --- | --- |
| Done | S1: Runtime Boot/Fault Guard | Shared | `sartracker-web-3rl` | Done 2026-05-16 |
| Done | A2: Hosted Mode Guardrails | Track A | `sartracker-web-vpz.3` | Done 2026-05-15 |
| Done | Settings Save-Close UX | Track A | `sartracker-web-fnc` | Done 2026-05-15 |
| Done | Hosted Tracking History Quota + 48h Offset | Track A | `sartracker-web-vpz.4` | Done 2026-05-16 |
| Done | A1: Hosted Testing Instructions And Feedback Intake | Track A | `sartracker-web-vpz.1` | Done 2026-05-16 |
| Done | B1: Tauri Beta Packaging Recon | Track B | `sartracker-web-vpz.2` | Done 2026-05-16 |
| Done | S2: Autosave Lifecycle Hardening | Shared / Track B | `sartracker-web-vpz.5` | Done 2026-05-16 |
| Done | R1: Preserve Lifecycle Autosave Failure Visibility | Shared / Track B | `sartracker-web-dfx` | Done 2026-05-16 |
| Done | R2: Replace Autosave Wall-Clock Stale Detection | Shared / Track B | `sartracker-web-5ps` | Done 2026-05-16 |
| Done | R3: Make Hosted Browser System Status Honest | Track A / Shared | `sartracker-web-3dv` | Done 2026-05-16 |
| Done | R4: Surface Lifecycle Backup Failures Non-Dismissably | Shared / Track B | `sartracker-web-57m` | Done 2026-05-16 |
| Done | R5: Make Runtime Controller Swap Exception-Safe | Shared | `sartracker-web-qdh` | Done 2026-05-16 |
| Done | R6: Roll Back Core Runtimes When Initial Settings Reload Fails | Shared | `sartracker-web-10q` | Done 2026-05-16 |
| Done | R7: Harden Runtime Fault Reload Flow | Shared / Track A | `sartracker-web-syi` | Done 2026-05-16 |
| Done | Hosted Verification Follow-up Fixes | Track A / Shared | `sartracker-web-vpz` | Deployed and live-verified 2026-05-16 |
| Done | A3.1: Prevent Accidental Map Placement While Panning | Track A / Shared | `sartracker-web-6y3.1` | Done 2026-05-16 |
| Done | A3.2: Fix Drawing Rendering And Layer Visibility | Track A / Shared | `sartracker-web-6y3.2` | Done 2026-05-16 |
| Done | A3.8: Improve Drawing Labels, Styles, And Delete Flow | Track A | `sartracker-web-6y3.8` | Done 2026-05-16 |
| Done | A3.3: Simplify Map And Drawing Tool Chrome | Track A | `sartracker-web-6y3.3` | Done 2026-05-16 |
| Done | A3.7: Add Marker At Grid Reference Workflow | Track A / Parity | `sartracker-web-6y3.7` | Done 2026-05-16 |
| Done | R8: Add Tauri Beta Gatekeeper Guidance | Track B / Docs | `sartracker-web-977` | Done 2026-05-16 |
| Done | A3.10: Investigate And Fix Irish Grid Conversion Accuracy | Track A / Shared | `sartracker-web-6y3.10` | Done locally 2026-05-16 |
| Done | A3.11: Stabilize Marker Placement From Coordinate Entry | Track A / Shared | `sartracker-web-6y3.11` | Done locally 2026-05-16 |
| Done | A3.12: Fix Roster Name Entry Spacing | Track A | `sartracker-web-6y3.12` | Done locally 2026-05-16 |
| Done | A3.13: Rework Coordinate Converter Formats And Naming | Track A / Coordinates | `sartracker-web-6y3.13` | Done locally 2026-05-16 |
| Done | A3.14: Rename Drawing Tools To Map Tools And Add Measure | Track A / Map Tools | `sartracker-web-6y3.14` | Done locally 2026-05-16 |
| Done | Live Validation: Team Feedback Batch | Verification | A3 batch | Passed on Vercel 2026-05-16, build `0.1.0+SHA.FCE7C9E58607` |
| Done | R9: Add Checked-In Boot/Fault/Autosave UI Regression Coverage | Verification | `sartracker-web-ahp` | Done 2026-05-16 |
| Done | A3.4: Clean Up Mission Mast And Right-Panel Duplication | Track A / Shared | `sartracker-web-6y3.4` | Done locally 2026-05-16 |
| Done | A3.5: Add Operational Contrast/Theme Pass | Track A / UI | `sartracker-web-6y3.5` | Done locally 2026-05-16 |
| Done | A3.6: Move Static Operational Notes Out Of Primary Map Chrome | Track A / UI | `sartracker-web-6y3.6` | Done locally 2026-05-16 |
| Done | A3.9: Add Configurable Weather Links Menu | Track A / UI | `sartracker-web-6y3.9` | Done and deployed 2026-05-16, external links only |
| Done | R10: Compress Handoff And Annotate Historical Docs | Process / Docs | `sartracker-web-419` | Done locally 2026-05-16 |
| Done | R11: Add Browser Harness Storage Non-Goals Note | Track A / Docs | `sartracker-web-mh5` | Done locally 2026-05-16 |
| Done | S3: Layer Visibility Service Extraction | Shared / Track A | `sartracker-web-4a1` | Done 2026-05-17 |
| Done | B2: Tauri Beta Release Template | Track B | `sartracker-web-xhz` | Done 2026-05-17 |
| Done | Z1: keyring crate had no platform features | Track B / Critical | `sartracker-web-el9` | Fixed 2026-05-17 in 000f7d1; cross-platform features added; new Rust + TS regression tests |
| Done | Z2: macOS ATS blocked WKWebView fetch to plain-HTTP Traccar | Track B / Critical | `sartracker-web-el9` | Fixed 2026-05-17 in 603771f; src-tauri/Info.plist NSAllowsArbitraryLoads (internal-beta scope) |
| Done | Z3: zl4 active-mission-finished-on-quit | Track B | `sartracker-web-zl4` | Closed 2026-05-17 as false positive; regression test added in 000f7d1 |
| Done | B3 rerun: First Internal Tauri Smoke Build | Track B | `sartracker-web-ppr` | Done 2026-05-17 on 0.1.0+sha.603771f65431; all 6 smoke items categorically proven incl. live 18-device tracking poll |
| Done | S4: Map Overlay Consolidation And Camera Race Fix | Shared / Track B | `sartracker-web-s5v` | Done locally 2026-05-17 |
| Done | S5: Mission Control View Model Extraction | Shared / Track A | `sartracker-web-cgx` | Done locally 2026-05-17 |
| Done | V1: Regression E2E Coverage | Verification | `sartracker-web-8gw` | Done locally 2026-05-17 |
| Done | Route renderer Traccar fetch via Rust reqwest (remove ATS blanket) | Track B | `sartracker-web-qmr` | Closed 2026-05-17; desktop Traccar polling now uses a Tauri reqwest command, the ATS blanket plist was removed, and packaged-app live Traccar smoke passed |
| Done | V2: Visual Review Automation | Verification | `sartracker-web-n9i` | Done locally 2026-05-17; `npm run visual:review` automates the second-layer Opus review with caching, severity gating, and structured exit codes. Discovery: spec drift in 5 visual prompts filed as `sartracker-web-b3c` |
| Done | B6: GPX And Drawing Hit-Test Hardening | Track B / Shared | `sartracker-web-fy5` | Done locally 2026-05-17; new pure resolver names the priority `marker > drawing > empty`, fixes the marker-stacked-under-polygon swallow bug, adds GPX line-segment hit-testing as a soft signal, +21 unit tests, +2 E2E tests, and an interactive Playwright sanity check |
| Done | QGIS Parity Residual-Gap Sweep | Verification / Parity | `sartracker-web-ag1` | Done 2026-05-17; synthesis at `tmp/parity-sweep/sweep-report.md`. Matrix significantly understates current state (11+ rows mis-stated). Genuine residual blockers C1–C13 captured. No child Linear issues filed; triage walk-through filed as `sartracker-web-l7c`. |
| Done | Visual review prompt drift fixes | Verification | `sartracker-web-wn6` | Done locally 2026-05-17. Rewrote `marker-hazard-dialog` and `shell-idle-state` verificationPrompts to match the actual captured frames; both PASS via `npm run visual:review --only <id> --no-cache`. |
| Done | Mast tracking ratio visual ambiguity | Track A / UI | `sartracker-web-zq9` | Done locally 2026-05-17. Replaced `${positions.length}/${staleCount}` with separate FIX / STALE chips behind a pure selector. New unit + chromium regressions + new visual entry `mast-tracking-cell-active` (visual review PASS). |
| Done | OpenTopoMap "tiles failed to load" badge over-eager | Track A / UI | `sartracker-web-2xp` | Done locally 2026-05-17. Tile-only filter at `src/features/map/is-tile-error-event.ts` and widened defaults (5-in-30s) in `src/lib/tile-health-tracker.ts`. Interactive Playwright proof at `tmp/2xp-verification/`. |
| Done | B4: Set up cross-platform Tauri beta distribution | Track B / Release | `sartracker-web-y6a` | Done 2026-05-17. `.github/workflows/release.yml` builds Linux (AppImage + .deb) and Windows (NSIS) on `v*` tag push, drafts a GitHub release, generates `SHA256SUMS` sidecar. First published release: `v0.1.0-beta.3` at https://github.com/donal0c/sartracker-web/releases/tag/v0.1.0-beta.3. Linux primary, Windows secondary. macOS arm64 deferred from CI per `sartracker-web-590` to stay inside the GitHub Actions free tier (macOS bills at 10x); macOS uses Path B (`npm run beta:verify`) until cadence stabilizes. Windows MSI deferred per `sartracker-web-g1u` because Tauri's MSI bundler rejects alphanumeric pre-release suffixes. NSIS `currentUser` install (no admin), WebView2 `downloadBootstrapper`. Release notes sourced from `docs/releases/sartracker-web-<version>-beta.md`. |
| Done | B8: Team requirements from USB ODT | Track A / Shared / Track B | `DON-60` | Closed in the 2026-06-06 Linear cleanup. Concrete children are done; duplicate multi-day issue `DON-67` now points to canonical `DON-100`. |
| Done | 3-6-26 team feedback intake | Track A / Shared | `DON-83` | Done 2026-06-04. Immediate bugs and non-blocked UI requests are complete; `DON-99`, `DON-101`, and `DON-102` are closed as superseded, and `DON-100` remains the only coordinator-blocked item. |
| Active | Official Irish Map Provider Integration | Track B / Maps, with Track A catalogue UX | `DON-76` | Parent map lane. Licensed map data and credentials are private/customer-provided: do not commit to GitHub, do not bundle into public release artifacts, and do not expose through hosted web. Verified local USB copy lives at `/Users/donalocallaghan/SARTracker-private-map-assets/team-usb-2026-06-03`. |
| Done | Evaluate MapGenie sources and choose operational default | Maps / Product decision | `DON-77` | Done 2026-06-03. Private visual comparison across MacGillycuddy Reeks, Galtymore/Galtees, and Wicklow/Glendalough plus Donal's team-context confirmation locks `discovery` as the default official operational topo map. `basemap_premium` is a secondary clean reference map; `ortho` and `National_High_Resolution_Imagery` are imagery reference layers. |
| Done | Add grouped map catalogue UX for official and public maps | Track A / Shared UX | `DON-78` | Done locally 2026-06-03. Maps menu now groups `Official maps` and `Public fallback maps`; official Discovery/Premium/Imagery entries render as not configured in hosted/browser mode; public fallback maps remain selectable and persisted. Official map naming: `Discovery Topo`, `Premium Basemap`, `Aerial Imagery`, and `High-Resolution Imagery`. |
| Done | Add local official map source import and configuration for Electron | Track B / Maps / Local config | `DON-80` | Done 2026-06-03. Settings and Electron persistence can point at the local MapGenie source file while storing only safe metadata (status, username, available source IDs, service count, message). Credentials/file contents stay out of app settings, diagnostics, source control, and Linear. |
| Done | Prototype local MapGenie rendering via ArcGIS export | Track B / Maps / Rendering | `DON-79` | Done 2026-06-04. Electron/local runtime renders Discovery Topo and Aerial Imagery via ArcGIS export over Carrauntoohil/Reeks from local configured MapGenie source; credentials stay out of URLs/settings/diagnostics/source control. |
| Done | Plan official-map offline package path | Track B / Maps / Offline | `DON-81` / `DON-7` | Done 2026-06-05. Decision: local official-map library after app install, first via prepared MBTiles-style package for the standard operating area; hosted web remains public-map-only. See `docs/official-map-offline-strategy.md`. |
| Done | Spike standard-region Discovery conversion to local MBTiles package | Track B / Maps / Offline | `DON-103` / `DON-7` | Done 2026-06-05. Real Reeks / west Kerry z9-z16 PNG MBTiles package generated outside the repo from the licensed Discovery GeoTIFF: 1.1 GB, 31,729 tiles, 447.83 s initial conversion + 450.93 s overviews, fast SQLite tile-read validation. MBTiles is viable for v1. |
| Done | Fix Linux Electron secret-store launch and diagnostics runtime label | Track B / Electron | `DON-58` / `DON-35` | Done 2026-06-05; Linux safeStorage launch behavior and diagnostics runtime label verified locally and on Dell Ubuntu. |
| Done | Smoke packaged Linux filesystem workflows | Track B / Electron | `DON-59` / `DON-35` | Done 2026-06-05; packaged `.deb` proved GPX file/folder/watch import, marker attachment save/open, SQLite integrity, and diagnostics export. |
| Done | Add cross-platform Electron official map package registry | Track B / Maps / Electron | `DON-104` / `DON-7` | Done 2026-06-05; Electron settings validates local MBTiles packages, records safe package metadata, and diagnostics omit package paths. |
| Done | Serve local official map package tiles through Electron map proxy | Track B / Maps / Electron | `DON-105` / `DON-7` | Done 2026-06-05; the existing official-map protocol now serves local MBTiles tiles before online MapGenie fallback, with visible missing/unreadable package errors. |
| Done | Add official offline map readiness UI and diagnostics | Track B / Maps / UI | `DON-106` / `DON-7` | Done 2026-06-05; map/status UI, Settings, diagnostics, manual, and browser validation cover ready, outside-area, missing, unreadable, online-source, unavailable, and public-fallback states. |
| Done | Validate packaged Electron official maps offline cross-platform | Track B / Maps / Release | `DON-107` / `DON-7` | Done 2026-06-05; macOS and Dell Ubuntu packaged smokes passed with network blocked, official package tiles rendered from local MBTiles, readiness/diagnostics validated, and Windows remains an explicit unverified gap until a Windows machine is available. |
| Done | Measure full-national Discovery package size/performance | Track B / Maps / Offline | `DON-108` / `DON-7` | Done 2026-06-06; full-national Discovery is technically practical but should be supported only with explicit admin warnings, not as the default v1 package. National z14 probe measured 4.2 GB / 103,491 tiles / ~54 min prep, macOS and Dell Ubuntu packaged Electron smokes passed with network blocked, and full z16 is estimated around 56-73 GiB. See `docs/official-map-national-package-measurement-don-108.md`. |
| Done | Classify relief and slope rasters as optional map overlays | Track B / Maps / Overlays | `DON-82` | Done 2026-06-06; `relief_byte.tif` and `Slope_30plus.tif` are optional local terrain overlays, not basemaps and not part of first-pass Discovery. Relief should be low-opacity terrain context; slope should be a transparent steep-ground warning overlay with clear caveats. See `docs/official-map-terrain-overlays-don-82.md`. |
| Done | 6-6-26 team feedback implementation batch | Track A / Shared | `DON-117` | Done 2026-06-06; ODT copied to `team-feedback/6-6-26.odt` and extracted to text/Markdown/assets. Immediate children `DON-118`-`DON-133` are Done. Coordinator-confirmation items `DON-134`-`DON-140` remain Backlog as separate decision-gated work. Existing `DON-100` remains the canonical multi-day mission layer-grouping decision item. |
| Done | Official map setup wizard and package import UI | S1 Maps / S2 Electron | `DON-109` / `DON-7` | Done 2026-06-06. Electron Settings now exposes `Choose MapGenie File` and `Add Discovery Package`, validates selected package paths through the existing official-map registry on save, and keeps browser/hosted mode public-map-only. Validation: focused unit set, full unit suite, lint, build, backend tests, browser Playwright proof, and Electron CDP proof. |
| Next | App-owned official map library copy and package management | S1 Maps / S2 Electron | `DON-110` / `DON-7` | Next S1 implementation task. Copy imported packages into app-owned storage so the team can unplug the USB; add disk preflight, replace/remove, duplicate handling, and safe diagnostics. |
| Then | Official map package coverage manifest and readiness certificate | S1 Maps | `DON-111` / `DON-7` | After `DON-109`. Display/export safe bounds, zooms, tile count, status, and current-view coverage so operators can prove the map covers the search area. |
| Then | Official map package choice guardrails | S1 Maps | `DON-112` / `DON-7` | After `DON-109`/`DON-108`. Make standard Kerry/Reeks the recommended package, mission-area packages the normal away-area prep path, and national packages explicit admin/large-disk options. |
| Parallel | Admin package preparation workflow for standard and mission-area official maps | S1 Maps | `DON-113` / `DON-7` | Can run in parallel with import work once package metadata expectations are clear. Productize the private conversion workflow for standard and mission-area packages. |
| Then | Field-ready official map checklist and operator manual updates | S1 Maps / S2 Electron | `DON-114` / `DON-7` | After `DON-109`-`DON-112`. Make the app/manual answer: official Discovery ready offline, current view covered, fallback status known, diagnostics available. |
| Final gate | Cross-platform official map import release smoke | S1 Maps / S2 Electron | `DON-115` / `DON-7` | Final map release gate. Validate a downloaded packaged Electron app can import/register official maps and render offline on macOS, Windows, and Linux with sanitized evidence. |
| Backlog | Relief and slope overlay package conversion spike | S1 Maps / Overlays | `DON-116` / `DON-76` | Optional terrain overlay lane after basemap workflow. Keep out of the current map queue until Discovery basemap import is field-ready. |
| Next S2 | Linux runtime decision checkpoint | Track B / Runtime | `DON-29` / `DON-25` | Next Electron stream task. `DON-28` and `DON-35` are closed; decide and document the production desktop runtime path before `DON-30`. |
| Backlog S2 | Ongoing desktop runtime support plan | Track B / Release / Support | `DON-30` / `DON-25` | After `DON-29`. Define support matrix, update cadence, release channels, diagnostics, and rollback policy. |
| Backlog S3 | B5: Triage first web and Electron beta feedback | Track A / Track B | `DON-11` | Only when fresh tester feedback exists. Do not use this as current work without new artifacts to triage. |
| Backlog S3 | Multi-day mission layer grouping decision | Track A / Shared | `DON-100` | Coordinator/product decision required before implementation. `DON-67` is duplicate. |
| Backlog | Final QGIS parity acceptance sweep | Parity / Verification | `DON-6` / `DON-5` | Final gate after maps, runtime decision, replay/training, and parity walkthrough are resolved. |
| Backlog | Replay / training mode parity | Shared / Training | `DON-8` / `DON-5` | Valid future parity work, not current map/Electron blocker. |
| Backlog | Parity sweep findings walk-through | Parity / Discussion | `DON-12` | Walk through `tmp/parity-sweep/sweep-report.md` later; create narrow issues only for still-current findings. |
| Backlog | Low-priority release/UI polish | Release / UI | `DON-13`, `DON-14`, `DON-21` | macOS arm64 CI, Windows MSI, and shortcut discoverability are retained as low-priority backlog. |

## Ready Work Chunks

### S8: Linux Runtime Reliability Path

Parent Linear issue: `DON-25`.

This is the active response to the Linux black-map field failure. The release
smoke runner proves `v0.1.0-beta.3` can render OpenTopoMap on GitHub's Ubuntu
runner, but team machines still show tracking over a black map. Research from
Codex subagents and Claude Code converges on the runtime diagnosis: Tauri on
Linux depends on system WebKitGTK, while MapLibre depends on WebGL. The path is
to validate Electron empirically and separately prove a non-WebGL fallback.

Child issues:

- `DON-26` — S8a empirical Electron MapLibre Linux validation. Done.
- `DON-27` — S8b Leaflet raster fallback spike. Done locally 2026-05-31; read-only fallback proved behind `?mapRenderer=leaflet`.
- `DON-28` — S8c Electron shell bridge and Linux packaging PoC. Done; closed during the 2026-06-06 Linear cleanup after bridge, packaging, filesystem, secret-store, diagnostics, and map validation children completed.
- `DON-29` — S8d runtime decision checkpoint. Next S2 Electron task.
- `DON-31` — S8c.1 Electron settings and secret storage parity. Done locally.
- `DON-32` — S8c.2 Electron tracking cache and diagnostics export parity. Done locally.
- `DON-33` — S8c.3 Electron SQLite mission store parity. Done locally.
- `DON-34` — S8c.4 Electron filesystem, GPX, attachments, and file opening parity. Done locally.
- `DON-35` — S8c.5 Electron Linux artifact build and field-validation gate. Done; closed during the 2026-06-06 Linear cleanup. Dell Ubuntu 24.04 native AppImage + `.deb` smoke rendered OpenTopoMap, proved mission SQLite/recovery, live Traccar, tracking cache, diagnostics export, secret-store behavior, filesystem workflows, and official offline maps. `DON-57`, `DON-58`, and `DON-59` are done.

S8a current artifact state:

- GitHub prerelease:
  https://github.com/donal0c/sartracker-web/releases/tag/s8a-electron-map-probe-0.1.0
- The prerelease is explicitly a map-rendering probe, not a SAR Tracker app
  release.
- Spike app: `tmp/s8a-electron-maplibre-validation/`
- Local smoke on macOS passed with Electron `40.10.0`, Chromium
  `144.0.7559.236`, WebGL renderer `ANGLE (Apple, ANGLE Metal Renderer: Apple
  M4 Max, Unspecified Version)`, `S8A_MAP_STATUS=ready`, window mean
  `0.5945162505106207`.
- Linux x64 artifacts built locally:
  - `tmp/s8a-electron-maplibre-validation/release/sartracker-s8a-map-validation_0.1.0_amd64.deb`
    SHA256 `fb65baa21ca7594ca2e276b3c518dc7b54cb49b3eeb92a5aa64edb8ab48b7f5b`
  - `tmp/s8a-electron-maplibre-validation/release/sartracker-s8a-map-validation_0.1.0_x86_64.AppImage`
    SHA256 `4576a28106048231a7db17ff94996db16fd02d21018fa3131399003cc33f41d1`

S8a first Linux evidence:

- Evidence directory: `tmp/s8a-old-ubuntu-lenovo-z580/`
- Machine: Lenovo Z580, Ubuntu 18.04.6 LTS, Intel Core i7-3520M, Intel HD
  Graphics 4000 (`i915`), kernel `4.15.0-208-generic`.
- AppImage rendered OpenTopoMap successfully: WebGL2 enabled, renderer
  `ANGLE (Intel Open Source Technology Center, Mesa DRI Intel(R) HD Graphics 4000 (IVB GT2), OpenGL 4.2)`,
  tile errors `0`, window mean `0.5188348907271214`.
- `.deb` package installed successfully despite the installer UI appearing
  stuck around 67%; `dpkg -s` reports `install ok installed`.
- Installed `.deb` smoke also rendered successfully: `S8A_MAP_STATUS=ready`,
  tile errors `0`, window mean `0.5693155126633966`.

S8a first team-machine Linux evidence:

- Evidence directory: `tmp/s8a-team-pclinuxos-nvidia-p620/`
- Machine class: PCLinuxOS/X11/NVIDIA Quadro P620, Linux `6.18.31-pclos1`,
  NVIDIA driver `580.159.03`.
- Packaging path: AppImage.
- Tester reported that maps displayed.
- Diagnostics: Electron `40.10.0`, Chromium `144.0.7559.236`, WebGL2
  renderer
  `ANGLE (NVIDIA Corporation, Quadro P620/PCIe/SSE2, OpenGL 4.5.0)`,
  Chromium `webgl: enabled`, MapLibre `status: ready`, OpenTopoMap, tile
  errors `0`, window mean `0.6508919909109476`.
- This materially increases confidence that the field black-map failure is tied
  to Tauri/WebKitGTK on Linux rather than MapLibre, the tile providers, or the
  team network.

S8a decision:

- S8a is complete enough to proceed. Donal's old Ubuntu machine rendered, the
  PCLinuxOS/NVIDIA tester rendered, and the PCLinuxOS/AMD tester rendered. The
  Electron direction is no longer only research-backed; it is now backed by
  representative team-machine evidence.
- Keep any additional team diagnostics as useful evidence, but do not block
  DON-28 on more probe runs.

S8b recon note:

- `tmp/s8b-leaflet-fallback-notes.md` records package findings.
- `terra-draw-leaflet-adapter@1.3.0` is available and peers against
  `terra-draw ^1.0.0` and `leaflet ^1.9.4`.
- First fallback implementation should prove read-only field visibility
  (basemap, tracks, markers, drawing GeoJSON) before edit parity.
- 2026-05-31 result: DON-27 now proves the fallback-only/read-only path behind
  `?mapRenderer=leaflet`. It renders raster basemap tiles, tracking
  points/breadcrumbs, markers, and drawing GeoJSON by reusing the existing
  layer/domain stores and GeoJSON builders; MapLibre remains the default
  renderer. Browser-harness seed `?leafletFallbackSeed=1` exists only for
  validation evidence. Do not pursue Leaflet edit parity until DON-29 decides
  degraded-mode editing is actually required.

S8c / DON-28 current state:

- Status: In Progress as of 2026-05-19.
- Electron is pinned to `40.10.0`, matching the successful S8a probe family.
- Added Electron host files: `electron/main.cjs`, `electron/preload.cjs`.
- Added typed preload bridge surfaces for Traccar HTTP, settings/secrets,
  tracking cache, sanitized diagnostics export, SQLite mission store,
  layer-catalog metadata, GPX file/folder dialogs and reads, marker
  attachments, and external file opening.
- Added `createElectronTraccarFetch` / `createElectronTraccarClient`.
- Electron no longer boots through the browser-harness mission store by
  default. The full app runtime uses Electron adapters when the preload bridge
  is present, while preserving the existing Tauri path.
- Settings `Test Connection` uses the Electron bridge when the bridge exists.
  Electron uses direct Traccar access; it does not use the Vercel proxy.
- Added `electron-builder.json` plus scripts:
  `electron:dev`, `electron:preview`, `electron:pack`,
  `electron:dist:linux`.
- Local macOS packaging passed and produced
  `tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app`.
- Linux x64 artifacts built locally from macOS:
  - `tmp/electron-dist/sartracker-electron-validation_0.1.0-beta.3_linux_x86_64.AppImage`
    (142 MB)
  - `tmp/electron-dist/sartracker-electron-validation_0.1.0-beta.3_linux_amd64.deb`
    (94 MB)
- Verified `https://kmrtsar.eu` with `sean` / `sean`: 3 devices and 3
  positions. `https://traccar.kmrtsar.eu` should not be used as the app API
  base; it behaves like a device/listener endpoint and returns bare `400` for
  `/api/server`.
- Remaining DON-28 gap: make Linux-native Electron artifact generation
  repeatable before publishing wider. The old Ubuntu 18.04 machine has GLIBC
  `2.27` and failed before app validation; the Dell Ubuntu 24.04 machine
  rendered OpenTopoMap from native AppImage and `.deb` builds, and the packaged
  `.deb` now has field evidence for mission create, SQLite WAL persistence,
  restart recovery/resume, live Traccar, tracking cache, and diagnostics
  export. MacOS cross-built artifacts are not trustworthy for `better-sqlite3`:
  one package contained a macOS arm64 `better_sqlite3.node` and failed with
  `invalid ELF header`. Use a Linux builder/CI job for Electron Linux artifacts.
- Future DON-35 release candidate must bake or fix Linux secret-store behavior:
  on the Dell, saving Traccar credentials failed until the app was relaunched
  with `--password-store=gnome-libsecret`, after which diagnostics reported
  `safeStorage backend: gnome_libsecret` and save/connect worked. Diagnostics
  also currently labels Electron as `browser validation`; correct that before
  tester release. Packaged Linux still needs GPX import, marker attachment
  save/open, and external file-opening smoke evidence.
- DON-28 is intentionally split into smaller child issues:
  - `DON-31`: persist settings under Electron `userData`, store secrets through
    a safe backend, and refuse or clearly warn when Linux falls back to
    `basic_text`.
  - `DON-32`: persist tracking cache and implement an allow-listed sanitized
    diagnostics export; do not zip the whole Electron/Chromium profile.
  - `DON-33`: port mission SQLite behind the Electron bridge, preserving the
    existing mission-store contract and crash-safety expectations.
  - `DON-34`: port file-system surfaces such as GPX import, attachments, file
    open, and chooser/dialog workflows.
  - `DON-35`: build and validate Linux artifacts, with AppImage first-class for
    PCLinuxOS/RPM-family testers and `.deb` for Ubuntu/Debian where practical.
  - `DON-57`: done 2026-06-01. Electron Linux AppImage/`.deb` artifacts now
    build natively in GitHub Actions via
    `.github/workflows/electron-linux-validation.yml`; run `26746757159` built
    artifacts on `ubuntu-22.04`, wrote SHA256SUMS, checked packaged
    `better_sqlite3.node` as ELF x86-64, rendered OpenTopoMap under Xvfb, and
    rejected the earlier black-window blind spot with a screenshot content
    mean gate.
  - `DON-58`: code fix implemented locally 2026-06-05 for Linux
    `--password-store=gnome-libsecret` startup and Electron diagnostics runtime
    labeling. Local verification is green. Dell Ubuntu 24.04 remote
    package-content smoke from the Linux-built `.deb` contents proved Settings
    save/connect without a manual `--password-store` flag, live Traccar online,
    diagnostics `Electron desktop`, and exported report
    `safeStorage backend: gnome_libsecret`; true `dpkg -i` install also passed
    during DON-59.
  - `DON-59`: done 2026-06-05 on Dell Ubuntu 24.04 installed `.deb`.
    Human-assisted native chooser validation completed `Import Files`,
    `Import Folder`, and `Watch Folder`; the installed app showed
    `3 imported · 1 watched`. Installed Electron filesystem bridge also read
    GPX files and listed `.gpx` directory entries during the remote-only pass,
    SQLite persisted 3 GPX imports, marker attachment ingest stored under
    app `userData`, Mission Review showed and opened the attachment through the
    OS default app, and diagnostics exported safe Electron/app path details.

S8c verification snapshot:

- Passed: focused Electron parity tests across settings/secrets, cache,
  diagnostics, SQLite mission store, layer catalog, GPX, attachments,
  file-opening, runtime selection, and harness gating — 12 files / 38 tests.
- Passed: `npm run test` — 112 files / 587 tests, after restoring the host
  native module with `npm rebuild better-sqlite3` following Linux cross-build.
- Passed: `npm run build`.
- Passed: `npm run lint`.
- Passed: `node --check electron/main.cjs electron/preload.cjs
  electron/settings-store.cjs electron/runtime-files.cjs
  electron/mission-store.cjs electron/file-system.cjs`.
- Passed: `npm run test:backend` — 45 passed / 1 ignored.
- Passed: `npm run electron:pack` on macOS; packaged app stayed running for a
  6-second launch smoke.
- Passed on Dell Ubuntu 24.04: native Linux AppImage and `.deb` build, both
  rendering the SAR Tracker app and OpenTopoMap. AppImage required
  `--no-sandbox` on Ubuntu 24; `.deb` launched without that workaround.
- Passed on Dell Ubuntu 24.04 packaged `.deb`: UI-created mission persisted to
  SQLite WAL, `pragma integrity_check` returned `ok`, process restart exposed
  recovery, Resume returned the mission to active, live Traccar connected to
  `https://kmrtsar.eu`, map markers rendered, SQLite held 33 devices plus live
  positions, `tracking-cache.json` held 33 devices / 5 positions, and
  diagnostics export wrote a sanitized report without credential text.
- Passed for DON-58 on Dell Ubuntu 24.04 from Linux-built `.deb` contents:
  Settings Traccar save/connect worked without manually passing
  `--password-store=gnome-libsecret`, live tracking went online with 33 devices
  / 5 fixes, Diagnostics displayed `Electron desktop`, and the exported report
  included `safeStorage backend: gnome_libsecret` plus
  `runtime: electron desktop`. Artifact hashes: AppImage
  `98a7fcf703e7f20cd8560759551edabd9aa305c8264ff5aef575754e0b716c33`;
  `.deb` `423300dfde7a45bb4c9e49208a845741fc9c54cce23a52bc3ee009d3393c1ac2`.
  True `dpkg -i` install was later proven during DON-59.
- Passed for DON-59 on Dell Ubuntu 24.04 installed `.deb`: package status
  `install ok installed`, installed app launched from
  `/opt/SAR Tracker Electron Validation/sartracker-web` without `--no-sandbox`,
  human-assisted native chooser completion imported `alpha-track.gpx`, imported
  `bravo-track.gpx` plus `charlie-track.gpx` from `gpx-folder`, and registered
  that folder as watched (`3 imported · 1 watched`). Installed bridge also read
  `alpha-track.gpx` and listed `.gpx` files in a watched folder while ignoring
  `not-gpx.txt`; SQLite persisted 3 GPX imports; Mission Review showed 3 GPX
  imports; marker attachment ingest stored `marker-evidence.txt` under app
  `userData`; Mission Review showed the attachment path and launched GNOME Text
  Editor on it; diagnostics exported `runtime: electron desktop`, schema 3,
  database/backup paths, and `safeStorage backend: gnome_libsecret`. Artifact
  hashes: AppImage
  `fa7cd66aad14decd3bac91acd4a00b590fc69f9b59a2e84355a0ef64491f980d`; `.deb`
  `acac5db8fbca5ce36952f48d61c160693132fefc9c9c85d0e3b106539f7842b4`.
- Passed for DON-57: GitHub Actions run `26746757159` on head
  `32cb2e315ad61449270f40f2bee2bb6a71e0fd56` built Electron Linux artifacts
  natively on `ubuntu-22.04`. Artifacts: AppImage SHA256
  `000f7e4d44692476ce5873a5ef0bd8901a22848c1e8179c512628cfd0438acd2`;
  `.deb` SHA256
  `58aee86e305e504a9a419dcb2873c7a7840fa8922b0233c78c32937f58031915`.
  Packaged SQLite native module inspection reported `better_sqlite3.node` as
  ELF 64-bit x86-64. CI AppImage screenshot rendered SAR Tracker and
  OpenTopoMap with content mean `0.499086`, and the exact GitHub-built
  AppImage was copied to the Dell Ubuntu 24.04 machine and visually confirmed
  rendering OpenTopoMap there too. Local verification around the workflow
  passed: `actionlint .github/workflows/*.yml`, focused Vite config regression,
  `npm run lint`, `npm run build`, `npm run test` (115 files / 593 tests),
  `npm run test:backend` (45 passed / 1 ignored), and `git diff --check`.

### B7: Pre-tester smoke + CI launch-smoke for cross-platform Tauri builds

Linear issue: `DON-24`.

Goal: get real launch confidence on the Linux/Windows artifacts the maintainer
cannot run on the macOS build host, before testers see them. CI proves the
bundles build; this chunk proves they boot and that the live beta dependencies
are reachable from the release environment.

2026-05-18 tester feedback changed this from planned hardening into an active
blocker: two Linux testers saw connection failure and no map tiles. Root-cause
evidence so far:

- `http://kmrtsar.eu:5055` returns bare `400 Bad Request` for root,
  `/api/server`, and POST `/api/session`.
- `http://kmrtsar.eu:8082` authenticates with the team test credentials and
  returns the device roster; `http://kmrtsar.ddns.net:8082` also works.
- Representative OpenTopoMap/OpenStreetMap/ESRI tile URLs are reachable from
  the current machine, so the tester map failure still needs packaged-Linux
  evidence rather than assuming a universal tile outage.

Two complementary tiers:

- **Tier 0 (implemented locally 2026-05-18)**: release gates now authenticate
  against the documented Traccar web/API endpoint (`http://kmrtsar.eu:8082`),
  assert the device roster is visible, and check representative
  OpenTopoMap/OpenStreetMap/ESRI tile URLs before any bundle starts.
- **Tier 1 (implemented locally 2026-05-18, partial workflow proof)**: extend
  `.github/workflows/release.yml` with `launch-smoke-linux` and
  `launch-smoke-windows` jobs that boot each bundled artifact on its native
  runner (`xvfb-run` on Linux; silent NSIS install + `Start-Process` on
  Windows), assert the app launches, capture a screenshot/log artifact, and
  fail red on launch failure. First run against existing `v0.1.0-beta.3`
  assets (`26040183978`) proved gates and Linux process/window launch, but the
  screenshot showed a runtime startup fault because the headless runner lacked
  freedesktop Secret Service. The Linux job now provisions a DBus/keyring
  session, OCR-fails on boot/fault shells, and thresholds a cropped map region
  so a black basemap fails the smoke. The Windows failure in that run was a
  workflow PowerShell `Join-Path` comma bug, not app evidence. Follow-up run
  `26041016902` passed gates plus Linux/Windows launch smoke, and its Linux
  screenshot showed OpenTopoMap tiles visible; the map-region threshold was
  added after Donal confirmed team devices track on `:8082` but maps remain
  black on tester machines. Final rerun `26041435928` passed with the
  map-region threshold in place; Linux map-region grayscale mean was `0.556917`
  (`>0.18` required) and the screenshot showed OpenTopoMap tiles visible.
- **Tier 2 (still required)**: smoke `v0.1.0-beta.3` or the next beta
  (`sartracker-web_0.1.0-beta.3_linux_amd64.AppImage`,
  `sartracker-web_0.1.0-beta.3_linux_amd64.deb`,
  `sartracker-web_0.1.0-beta.3_windows_x64.exe`) on real x86_64 hardware.
  Hetzner CX22 (Ubuntu 22.04 desktop, ~€0.01/hr) for Linux, AWS Lightsail
  Windows Server 2022 (~$0.01/hr) for Windows. Walk
  `docs/releases/sartracker-web-0.1.0-beta.3-beta.md` end-to-end. Record
  evidence under `tmp/b7-prerelease-smoke/`. If smoke fails, cut
  `v0.1.0-beta.4` per the immutability rule before sharing with testers.
- **Tier 4 (optional add-on)**: cheap static asserts in the gates/checksums
  job — `dpkg-deb -I`, AppImage `--appimage-extract`, PE structure on the
  `.exe` — that would have caught beta.1/beta.2 packaging defects pre-tag.

Out of scope: driving the UI in CI (no clicks/E2E flows yet — revisit with
`tauri-driver` later if Tier 1 starts being insufficient), code-signing/
notarization, macOS coverage (deferred per `sartracker-web-590` / `DON-13`).

Acceptance:

- Tier 2 smoke complete; either green-and-shareable, or beta.4 cut.
- Tier 0 live dependency preflight and Tier 1 launch-smoke jobs pass in a real
  release workflow run.
- Tier 1 jobs verified red on a runtime fault / intentionally-broken bundle, or
  a documented equivalent failure proof is attached if deliberately breaking a
  release artifact is too costly. Run `26040183978` is the current equivalent
  proof for the Linux blind spot: window launch alone was insufficient because
  the screenshot contained the startup fault shell.
- `docs/tauri-beta-release-plan.md` updated with the new pre-tester smoke
  procedure (Tier 2) and the new automatic protection (Tier 1).
- `handoff/HANDOFF.md` and this workplan updated.

Verification:

- Done: `26041435928` ran with the map-region threshold in place against the
  existing `v0.1.0-beta.3` artifacts and passed gates, live dependency
  preflight, Linux AppImage launch smoke, and Windows NSIS launch smoke.
- Run `26040183978` captured the first failure proof: Linux screenshot showed a
  runtime fault despite a successful window launch, and Windows failed in the
  harness before launching because of a PowerShell array-construction bug.
- Real-hardware smoke evidence committed under `tmp/b7-prerelease-smoke/`.

Current tester-environment investigation:

- Traccar is no longer suspect: team feedback confirms tracking appears when
  using `http://kmrtsar.eu:8082`.
- CI AppImage evidence is not enough to clear the map issue because the same
  artifact renders OpenTopoMap in the runner while tester machines show a black
  map.
- Ask testers to try all three raster providers from the Maps menu:
  OpenTopoMap, ESRI World Topo, and OpenStreetMap.
- Ask for Diagnostics export plus distro, desktop session (Wayland/X11), GPU
  and driver, and whether launching with
  `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./sartracker-web_0.1.0-beta.3_linux_amd64.AppImage`
  changes the map.

Related: `DON-13` (re-add macOS arm64 to CI), `DON-14` (re-add Windows MSI),
`DON-11` (B5 triage — feeds off post-share findings).

### Desktop Beta Distribution Rule

Cross-platform beta distribution is wired up via `.github/workflows/release.yml`
(`sartracker-web-y6a` done 2026-05-17). Tag push (`v*`) triggers a draft GitHub
Release with Linux AppImage + .deb (primary) and Windows NSIS .exe (secondary),
plus a `SHA256SUMS` sidecar. macOS arm64 deferred from CI per
`sartracker-web-590`; Windows MSI deferred per `sartracker-web-g1u`. First
published release: `v0.1.0-beta.3` at
https://github.com/donal0c/sartracker-web/releases/tag/v0.1.0-beta.3. Hosted
web remains the broad team-testing lane in parallel. C1/local-map work is still
deferred until the team can provide concrete map-package facts.

### R0: S1/S2 Review Remediation Gate

Source: multi-agent review of S1 Runtime Boot/Fault Guard, A1 Hosted Testing Instructions, B1 Tauri Beta Packaging Recon, S2 Autosave Lifecycle Hardening, plus adjacent code.

Verdict folded into this plan: R1-R9 are fixed. S3 can start when selected, while R10-R11 remain follow-up docs/verification-adjacent tasks.

Completed remediation:

- `sartracker-web-dfx` — R1: lifecycle autosave failures stay visible after unrelated successful syncs and clear after the matching lifecycle sync succeeds.
- `sartracker-web-5ps` — R2: autosave stale warnings use observed tick time instead of wall-clock subtraction.
- `sartracker-web-3dv` — R3: hosted browser mode reports browser-test/session-storage status, keeps warnings visible in Focus Mode, and fails visibly without the explicit harness.
- `sartracker-web-57m` — R4: lifecycle backup failures render as a persistent non-dismissible alert, and the backend contract confirms `sync_backup()` succeeds after non-active lifecycle transitions while backup audit events remain active-mission-only.
- `sartracker-web-qdh` — R5: app runtime controller replacement logs cleanup failures from the previous controller without blocking the next controller installation, and active disposal clears the registry even if underlying cleanup throws.
- `sartracker-web-10q` — R6: app runtime startup disposes core feature runtimes if initial settings reload fails after those runtimes start.
- `sartracker-web-syi` — R7: Harden runtime fault reload flow.
- `sartracker-web-977` — R8: Tauri beta docs and manual now include unsigned macOS app expectations, Gatekeeper warning language, quarantine removal guidance, and the internal-beta-only caveat.
- `sartracker-web-ahp` — R9: checked-in browser and visual regression coverage now pins runtime booting, startup fault, autosave stale, autosave failure, focus-mode autosave visibility, and autosave warning accessibility.

Completed follow-up remediation:

- `sartracker-web-419` — R10: handoff compressed back to a baton-shaped current state; historical/supporting docs already point back to this workplan as the active queue.
- `sartracker-web-mh5` — R11: browser harness storage now has a module-level non-goals note clarifying session-storage testing scope versus Tauri/SQLite operational persistence.

Review finding files under `tmp/review-s1-a1-b1-s2/` are historical triage evidence only; the durable remediation state is now in the Linear issues and this workplan.

### A1: Hosted Testing Instructions And Feedback Intake

Linear issue: `sartracker-web-vpz.1`

Goal: make it easy for the team to test and report issues consistently.

Tasks:

- Add a concise team testing checklist to the manual or a linked doc.
- Make the URL/base-URL distinction impossible to miss:
  - app URL: `https://sartracker-web.vercel.app/?missionHarness=1`
  - Traccar provider base URL in hosted mode: `https://sartracker-web.vercel.app`
- Add a simple bug report template:
  - what they were trying to do
  - expected result
  - actual result
  - screenshot/video if possible
  - browser and machine
  - mission name/time if relevant
- Add a triage rule for each issue:
  - hosted-only
  - shared app bug
  - desktop-runtime candidate
  - UI/wording preference

Acceptance:

- A tester can find the hosted URL, start a mission, connect tracking, and report a bug without reading chat history.
- The docs clearly say hosted browser mode is for testing only.

Verification:

- Done 2026-05-16: manual and `docs/team-testing-feedback-loop.md` read-through.
- Done 2026-05-16: production hosted app/manual check after Vercel deploy.

### A2: Hosted Mode Guardrails

Linear issue: `sartracker-web-vpz.3`

Goal: reduce avoidable Traccar URL confusion during browser testing.

Tasks:

- Add hosted-mode copy near Settings/Data Sources explaining that direct HTTP Traccar URLs are blocked by browsers from HTTPS pages.
- In hosted mode, detect `http://` provider URLs and show a specific message directing operators to use `https://sartracker-web.vercel.app`.
- Consider a one-click hosted default for the known testing proxy.
- Keep Tauri desktop behavior unchanged; direct HTTP server URLs are valid there.

Acceptance:

- A tester who enters `http://kmrtsar.ddns.net:8082` in hosted mode gets a clear in-app explanation before chasing network failures.
- Desktop settings remain flexible for direct provider URLs.

Verification:

- Done 2026-05-15: unit coverage for hosted-mode URL validation/helper.
- Done 2026-05-15: hosted Settings UI guardrail and hosted-proxy action added.
- Done 2026-05-15: manual hosted settings check with the inbuilt browser.

### A3: Team Feedback Triage Pass

Parent Linear issue: `sartracker-web-6y3`

Goal: convert raw feedback into actionable chunks and Linear issues.

Latest sources:

- Ned/Eamonn email `Sartracker`, received 2026-05-16 12:48. The email screenshots were used for triage only and are not retained as source-of-truth artifacts.
- Ned/Eamonn email `Sartracker`, received 2026-05-16 13:33. Requests: Marker at GR, Weather links menu, line distance/bearing labels, range-ring clean rendering/layer hiding, drawing delete flow, and search-area styling/clean rendering/layer hiding. The email screenshots were used for triage only and are not retained as source-of-truth artifacts.
- Eamonn email pasted into chat on 2026-05-16. Requests: IG/TM65 conversion accuracy discrepancy against DD reference, intermittent marker placement/disappearing after pan, roster name spacing, coordinate converter order/naming (`IG` -> `DD` -> `DMS` -> `W3W`, no UTM), rename Drawing Tools to Map Tools, and move Measure into Map Tools. The pasted screenshots were used for triage only and are not retained as source-of-truth artifacts.

Tasks:

- Group incoming feedback by area:
  - mission start/control
  - tracking/devices
  - layers/map
  - drawings/markers
  - settings/connectivity
  - layout/UI preferences
  - desktop-only/runtime concerns
- Create or update Linear issues for recurring issues.
- Route each item into this file as Track A, Track B, Shared, Verification, or Deferred.
- Mark quick fixes separately from design questions.
- Keep `handoff/HANDOFF.md` short: only current state, blockers, next actions.

Acceptance:

- No feedback remains only in Slack/chat/email.
- Each issue has a route: quick Vercel fix, planned UI/design pass, desktop beta validation, or deferred.

Verification:

- Linear queue view shows new/updated work items.
- This file and the handoff agree on the current next task.

### A3.1: Prevent Accidental Map Placement While Panning

Linear issue: `sartracker-web-6y3.1`

Goal: make map panning and map placement unmistakably separate so testers do not accidentally create markers or drawings while moving the map.

Tasks:

- Distinguish click from drag/pan before map-placement handlers run.
- Prevent point-based drawing or marker placement when the pointer movement was a pan.
- Add crosshair cursor treatment only for intentional placement tools.
- Keep normal hand/pan affordance for navigation.
- Be cautious with double-click placement because double-click already overlaps map zoom and drawing completion behavior.

Acceptance:

- Panning with marker/drawing tools armed does not create or edit map objects.
- Intentional point placement still works.
- Placement mode visibly differs from panning mode.

Verification:

- Done 2026-05-16: unit coverage for click-vs-drag suppression in `tests/unit/map-interaction-guards.test.ts`.
- Done 2026-05-16: inbuilt-browser check at `http://127.0.0.1:1420/?missionHarness=1` confirmed map drag did not open marker/drawing dialogs, intentional clicks still opened them, and armed drawing tools showed a crosshair cursor.

### A3.2: Fix Drawing Rendering And Layer Visibility

Linear issue: `sartracker-web-6y3.2`

Goal: map objects must look like what the operator intended and hide reliably through layers.

Tasks:

- Fix text-label rendering so saved text labels do not appear as ordinary round marker dots.
- Keep text label text, color, size, and rotation visible/editable in a clear way.
- Fix search-sector and search-area rendering so outer arc/outline vertex points and spurious points are not visible unless deliberately part of edit/preview state.
- Fix range-ring rendering so LPB/manual rings can render as simple clean lines without persistent marker dots.
- Confirm text labels, search sectors, search areas, and range rings hide by type and by item through the layer panel.
- Capture before/after browser evidence for the same classes of examples described by Ned/Eamonn.

Acceptance:

- Text labels render as text, not marker dots.
- Search sectors, search areas, and range rings render as clean operational geometry.
- Layer visibility controls hide the affected drawing types predictably.

Verification:

- Done 2026-05-16: unit coverage in `tests/unit/drawing-geojson.test.ts` and `tests/unit/map-layer-filters.test.ts` confirms text labels are label-only, range rings render as line features, and drawing label/geometry filters respect type/item visibility.
- Done 2026-05-16: inbuilt-browser check at `http://127.0.0.1:1420/?missionHarness=1` created range rings and a text label, expanded the Layers workspace, and confirmed range-ring/text-label layer visibility toggles. Evidence screenshot: `test-results/a3-map-drawing-verification/drawing-layer-toggle-hidden.png`.

### A3.3: Simplify Map And Drawing Tool Chrome

Linear issue: `sartracker-web-6y3.3`

Goal: reduce map-surface clutter while preserving fast access to the tools testers need most.

Tasks:

- Replace the always-visible basemap row with a compact `Maps` control/menu.
- Replace the expanded drawing-toolbar mode/collapse pattern with one compact `Drawing Tools` open/close control.
- Remove redundant active-select/collapse controls if the simplified control makes them unnecessary.
- Move routine map-tile cache controls out of the primary map surface where safe.
- Keep operational warnings visible when they matter; do not hide hosted/runtime/autosave/tracking warnings merely to reduce clutter.

Acceptance:

- Map and drawing controls are easier to find and create less visual clutter.
- Tool selection remains explicit and reversible.
- Safety-critical warnings remain visible.

Verification:

- Done 2026-05-16: compact Maps menu replaces the always-visible basemap row, Drawing Tools uses one open/close control with the active mode in the header, and routine offline `Check View` moved into the Maps menu while the offline readiness warning remains visible.
- Done 2026-05-16: Chromium E2E covered desktop map controls, basemap persistence, viewport preservation, and a 900px narrow operator viewport.

### A3.4: Clean Up Mission Mast And Right-Panel Duplication

Linear issue: `sartracker-web-6y3.4`

Goal: make mission identity, phase, and timing scan-friendly without repeating the same information in multiple panels.

Tasks:

- Remove duplicate mission time display from the right panel if the mast remains the authoritative timer location.
- Place mission name/status near the SAR Tracker mast area in a calm, readable layout.
- Preserve mission lifecycle enablement rules.
- Prefer pairing this with `S5: Mission Control View Model Extraction` if implementation would otherwise tangle layout and lifecycle logic.

Acceptance:

- Mission time has one authoritative visible location.
- Mission name/status remain easy to see.
- The right panel gains useful space without changing mission lifecycle behavior.

Verification:

- Done locally 2026-05-16: normal sidebar no longer repeats the active mission name card while the command mast is visible; Focus Mode still keeps current mission context because the mast is hidden there.
- Done locally 2026-05-16: `git diff --check`, `npm run lint`, `npm run build`, and `npm run test:all` passed.

### A3.5: Add Operational Contrast/Theme Pass

Linear issue: `sartracker-web-6y3.5`

Goal: address the team's concern that the current colour scheme is not suitable for all testers without turning this into an open-ended redesign.

Decision: ship one improved high-contrast operational theme rather than a theme toggle. Reasoning: a single theme audited surface-by-surface against the actual operator chrome is cheaper, preserves a single semantic palette, and avoids drift between theme variants. The decision can be revisited if a separate light-environment field theme is later requested.

Tasks:

- Lift body-label contrast above WCAG AA on dark panels by introducing semantic text tokens (`--sar-text-strong` / `--sar-text-muted` / `--sar-text-dim`) and helper utilities (`.sar-helper-text`, `.sar-meta-label`).
- Replace ad-hoc phase/tracking pills with semantic chips (`.sar-status-chip-success/warning/danger/neutral`) so online/offline/active/paused/recovery/idle/critical meanings stay distinct.
- Promote critical alerts (lifecycle backup failure, marker placement errors) to a shared `.sar-inline-critical` chrome.
- Promote the autosave warning chip from text-[9px] to a visible warning chip in the command mast.
- Strengthen panel/module/readout/control-dock/instrument-strip borders for hierarchy and for satellite-tile readability.
- Standardize disabled-button treatment to `opacity 0.4 + saturate 0.6` instead of `opacity 0.2`.
- Add `:focus-visible` outlines on operator buttons.
- Apply tokens through the main shell, mast, sidebar, mission-control, tracking, layers, settings, diagnostics, devices, marker-at-grid, measurement, drawing-toolbar, coordinate-bar, and map-overlay badge components.
- Preserve every existing semantic color contract.

Acceptance:

- The main shell, map overlays, settings, and drawing controls are more readable.
- Status colors remain semantically clear.

Verification:

- Done locally 2026-05-16: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` (88 files / 435 tests), `npm run test:e2e` (80 chromium + 27 visual), and `npm run test:backend` (38 Rust tests) all green.
- Done locally 2026-05-16: browser-backed verification via Playwright at `http://127.0.0.1:1420/?missionHarness=1`. Before/after evidence under `tmp/contrast-audit/{before,after}/` covers main shell, mast (idle and active), sidebar tracking/tools/layers, settings, diagnostics, narrow viewports (1024 + 900), ESRI Satellite basemap, drawing toolbar expanded, Marker At GR error and dialog, and coordinate converter.

### A3.6: Move Static Operational Notes Out Of Primary Map Chrome

Linear issue: `sartracker-web-6y3.6`

Goal: reduce map clutter by moving static reference notes out of the primary map surface while keeping live risk signals visible.

Tasks:

- Move static operational notes to Settings/manual or another non-primary surface.
- Keep hosted browser, persistence, autosave, runtime, tracking, and map-readiness warnings visible when relevant.
- Confirm Focus Mode still surfaces warnings that operators must not miss.

Acceptance:

- Static notes no longer take map/sidebar space during normal operation.
- Safety-critical warnings are still visible and hard to miss.

Verification:

- Done locally 2026-05-16: static Operational Notes were removed from the normal Layers tab while runtime, hosted-mode, autosave, and lifecycle backup warnings remain visible through the mast/banner paths.
- Done locally 2026-05-16: `git diff --check`, `npm run lint`, `npm run build`, and `npm run test:all` passed.

### A3.7: Add Marker At Grid Reference Workflow

Linear issue: `sartracker-web-6y3.7`

Goal: add the QGIS-style marker entry path where an operator can place a marker from a TM65 Irish Grid reference instead of clicking the map.

Tasks:

- Add a `Marker at GR` entry path near the normal marker workflow.
- Let the operator choose marker type before or during the grid-reference entry.
- Validate TM65 Irish Grid references with clear errors.
- Convert the grid reference using the existing coordinate utilities and continue into the normal marker form with coordinates prefilled.
- Keep coordinate semantics explicit: TM65 is display/input support; ITM remains the working CRS and WGS84 remains map display/GPS.

Acceptance:

- A valid TM65 grid reference opens the normal marker form with the converted coordinates prefilled.
- Invalid references fail visibly and do not create a marker.
- The flow is covered by tests at the coordinate/validation seam and browser-backed UI verification.

Verification:

- Done 2026-05-16: unit coverage in `tests/unit/marker-draft.test.ts` covers accepted and rejected TM65 grid-reference inputs.
- Done 2026-05-16: Chromium E2E in `tests/e2e/marker.spec.ts` covers Marker At GR success, prefilled marker form coordinates/type, saved hazard marker persistence, and invalid-input rejection without opening the marker dialog.

### A3.8: Improve Drawing Labels, Styles, And Delete Flow

Linear issue: `sartracker-web-6y3.8`

Goal: make saved drawings more informative and easier to correct when placed in the wrong location.

Tasks:

- Add distance and bearing information to line drawings where useful.
- Show a clear indication of where a line is drawn to.
- Add useful search-area label font-size and fill-colour controls without overloading the form.
- Provide an obvious delete flow for user-created drawings/layer items such as misplaced range rings.
- Keep destructive actions confirmed and auditable where they mutate mission data.

Acceptance:

- Line drawings can show distance and bearing.
- Search areas have useful style controls.
- Misplaced user-created drawings can be deleted through an obvious edit/layer flow.
- Drawing persistence and mission mutability rules remain intact.

Verification:

- Done 2026-05-16: unit coverage in `tests/unit/drawing-builders.test.ts` and `tests/unit/drawing-geojson.test.ts` covers line distance/bearing metadata, search-area fill/label styling persistence, and styled map feature shaping.
- Done 2026-05-16: Chromium E2E in `tests/e2e/drawing-tools.spec.ts` covers line distance/bearing/endpoint readouts, styled search-area persistence, LPB range rings, layer-panel edit entry, and confirmed drawing deletion.

### A3.9: Add Configurable Weather Links Menu

Linear issue: `sartracker-web-6y3.9`

Goal: give operators quick access to external weather resources without pretending the app has a built-in weather integration.

Tasks:

- Add Settings support for a small list of named weather URLs.
- Add a compact `Weather` control in a sensible top-panel location.
- Open selected weather links safely.
- Reject invalid URLs with clear copy.
- Treat this as external links for now; do not fetch/weather-normalize data inside the app unless a later Linear issue expands the requirement.

Acceptance:

- Operators can configure and open named weather links such as `https://www.met.ie/`.
- Empty state is clear when no weather links are configured.
- Invalid URLs are rejected before save/use.

Verification:

- Done locally 2026-05-16: unit coverage in `tests/unit/settings-validation.test.ts` and `tests/unit/browser-settings-store.test.ts` covers weather link validation, normalization, list limit, and browser settings persistence.
- Done locally 2026-05-16: Chromium E2E in `tests/e2e/weather.spec.ts` covers empty Weather menu state, invalid URL rejection in Settings, and configured link opening in a new tab.
- Done locally 2026-05-16: operator manual updated to describe Weather as external links only, not a weather integration.
- Deployed 2026-05-16 via the documented Vercel production prebuilt flow.

### A3.10: Investigate And Fix Irish Grid Conversion Accuracy

Linear issue: `sartracker-web-6y3.10`

Goal: resolve the reported difference between a DD marker and an IG/TM65 marker for the same physical location.

Reported reference:

- DD: `52.179337, -9.464944`
- IG/TM65: `Q 99842 04015`
- Source context: Outdoor Active screenshot from Eamonn; Eamonn says the same discrepancy existed in the QGIS plugin.

Tasks:

- Add the Outdoor Active reference as a golden coordinate test case.
- Compare DD, IG/TM65, ITM/display, and marker placement outputs for the same point.
- Determine whether the discrepancy is caused by parser precision, datum/projection transform, grid-reference semantics, rounding, or a mismatch in the supplied reference data.
- Decide and document the acceptable operational tolerance before closing.
- If the app is wrong, fix conversion/marker placement. If the source/plugin reference is wrong, surface that clearly in docs/Linear issue notes.

Acceptance:

- The reported point has deterministic tests.
- DD and IG/TM65 placement either agree within an explicitly accepted tolerance or the discrepancy is documented as unsafe/unresolved.
- Marker At GR and coordinate converter behavior are verified against the reference point.

Verification:

- Done locally 2026-05-16: `tests/unit/coordinates.test.ts` includes Eamonn's Outdoor Active reference. Root cause was the TM65 Helmert `towgs84` Y translation sign; fixing it aligns DD `52.179337, -9.464944` with `Q 99842 04015`.
- Done locally 2026-05-16: focused coordinate, converter, marker, build, and browser verification passed; final `git diff --check`, `npm run lint`, `npm run build`, and `npm run test:all` passed.

### A3.11: Stabilize Marker Placement From Coordinate Entry

Linear issue: `sartracker-web-6y3.11`

Goal: coordinate-created markers must never appear intermittently or disappear after map movement.

Tasks:

- Reproduce marker placement from lat/long and converted coordinates repeatedly.
- Check create/save ordering, overlay source updates, layer visibility filters, basemap/style reload behavior, and map pan/zoom refresh behavior.
- Make success/failure explicit: no ghost marker, no disappearing saved marker, and no silent failure.

Acceptance:

- Markers created from lat/long or converted coordinates persist before the dialog closes.
- Saved markers remain visible after pan, zoom, and basemap/style changes.
- Failed placement shows an actionable error and does not leave a temporary marker behind.

Verification:

- Done locally 2026-05-16: `tests/unit/marker-at-grid-panel.test.ts` covers refreshing marker runtime to the active mission before opening the coordinate-created marker draft.
- Done locally 2026-05-16: Marker At GR E2E passed at `Q 99842 04015`.

### A3.12: Fix Roster Name Entry Spacing

Linear issue: `sartracker-web-6y3.12`

Goal: coordinator/admin roster entry should support normal person names while typing.

Tasks:

- Fix roster input/tokenization so internal spaces are allowed.
- Preserve comma/newline-separated roster entries.
- Trim accidental boundary whitespace without removing intended internal spaces.
- Confirm coordinator and admin rosters persist and reload correctly.

Acceptance:

- Names such as `Cathal Cudden, Tim Murphy, John Cronin` can be entered naturally.
- Spaces are not stripped while typing.
- Saved rosters reload without mangling names.

Verification:

- Done locally 2026-05-16: `tests/unit/settings-validation.test.ts` covers comma/newline roster parsing with internal spaces.
- Done locally 2026-05-16: `tests/unit/settings-workspace.test.ts` covers preserving spaces while an operator types roster names.

### A3.13: Rework Coordinate Converter Formats And Naming

Linear issue: `sartracker-web-6y3.13`

Goal: align the converter with the formats the coordinators actually use.

Tasks:

- Rename/reorder converter modes as `IG`, `DD`, `DMS`, `W3W`.
- Remove UTM from the primary operator converter.
- Keep DD and IG as the most prominent workflows.
- Treat W3W as decision-gated unless API, licensing, offline behavior, and operational accuracy requirements are settled.

Acceptance:

- The converter presents `IG`, `DD`, `DMS`, `W3W` in that order.
- UTM is not part of the primary operator converter flow.
- DD/IG/DMS work with deterministic tests.
- W3W is either implemented behind a documented integration decision or clearly marked unavailable/deferred.

Verification:

- Done locally 2026-05-16: `tests/unit/coordinate-tool.test.ts` covers IG, DD, DMS, W3W gated behavior, and clipboard formatting.
- Done locally 2026-05-16: Chromium coordinate converter E2E passed for DD, IG, DMS, W3W gated copy/go-to flows.

### A3.14: Rename Drawing Tools To Map Tools And Add Measure

Linear issue: `sartracker-web-6y3.14`

Goal: make measurement easier to find and align tool naming with the team's language.

Tasks:

- Rename the primary `Drawing Tools` chrome to `Map Tools`.
- Keep drawing tools available under that grouping.
- Move or duplicate Measure into Map Tools.
- Keep the measure output simple: distance and map bearing only, e.g. `1.3 km 230°`.

Acceptance:

- Operators can open Map Tools and find Measure there.
- Measurement mode outputs distance and map bearing clearly.
- Exiting Measure returns to the normal pan/select behavior without accidental drawing placement.

Verification:

- Done locally 2026-05-16: Chromium measurement E2E passed for Map Tools Measure, drawing/measurement handoff, simplified measurement labels, and mission-finish cleanup.

### B1: Tauri Beta Packaging Recon

Linear issue: `sartracker-web-vpz.2`

Goal: find the shortest reliable path to a first desktop beta artifact.

Tasks:

- Identify current Tauri build command and output artifacts.
- Run a local package build if prerequisites are present.
- Record artifact paths and package formats.
- Note signing/notarization warnings without solving them yet.
- Write down the expected install path for macOS/Windows.

Acceptance:

- We know exactly how to build a local beta package on the current machine.
- Unknowns are explicit, especially target OS and signing.

Verification:

- Done 2026-05-16: `npm run tauri build` compiled the release binary and `.app`, then failed reproducibly during DMG bundling at `bundle_dmg.sh`.
- Done 2026-05-16: `npm run tauri build -- --bundles app` succeeded and produced `src-tauri/target/release/bundle/macos/sartracker-web.app`.
- Done 2026-05-16: zipped the `.app` locally with `ditto` to prove a first-shareable macOS artifact path.
- Done 2026-05-16: results recorded in `docs/tauri-beta-release-plan.md`.

### B2: Tauri Beta Release Template

Status: done 2026-05-17 (`sartracker-web-xhz`).

Delivered:

- `docs/releases/TEMPLATE.md` — canonical release-note template covering
  install, what changed, what to test, known limitations, rollback, and the
  pre-share verification checklist.
- `docs/releases/README.md` — authoring workflow, distribution channel, and
  storage rules.
- `docs/releases/sartracker-web-0.1.0-beta-DRAFT.md` — first dry-run release
  note kept in the repo as the worked example.
- `scripts/beta-verify.mjs` and `build/beta-verify-lib.js` — the
  `npm run beta:verify` gate that runs lint, build, test, test:backend,
  package (`npm run tauri build -- --bundles app`), and the manual smoke
  checklist, then writes a JSON evidence report to `tmp/beta-artifacts/`.
- `tests/unit/beta-verify-lib.test.ts` — unit coverage for the gate's pure
  helpers.
- Locked the beta artifact distribution decision in
  `docs/tauri-beta-release-plan.md` and `docs/releases/README.md`: GitHub
  Releases draft/prerelease for the shared zip, `tmp/beta-artifacts/` for
  local working copies, release notes in `docs/releases/` as the source of
  truth.

Acceptance met: a future agent can copy the template, run
`npm run beta:verify`, attach the JSON report, and produce a Tauri beta
without inventing process.

### B3: First Internal Tauri Smoke Build

Goal: prove the desktop runtime can launch and execute the core path before involving the team.

Tasks:

- Build the app.
- Install/open locally.
- Start a mission.
- Configure Traccar directly or through the appropriate desktop settings path.
- Confirm mission persistence across app restart.
- Confirm diagnostics/version visibility.
- Confirm post-finish `sync_backup` writes the backup mirror without logging a misleading backup audit row when no active mission remains.
- Note the teardown edge case: forced lifecycle sync requests that arrive after autosave has stopped currently no-op; treat as acceptable unless desktop smoke testing shows operator-visible loss.

Acceptance:

- Desktop beta is either smoke-tested locally or blocked by a specific packaging/runtime issue.

Verification:

- Screenshot or notes in handoff.
- Build artifact path recorded.
- Backend/audit note confirming post-finish backup behavior.

### B6: GPX And Drawing Hit-Test Hardening — Done 2026-05-17

Linear issue: `sartracker-web-fy5`. Closed locally on 2026-05-17.

Outcome: documented click priority `marker > drawing > empty` in a single pure resolver (`src/features/map/map-click-target-resolver.ts`); fixed the headline marker-stacked-under-polygon swallow bug; added GPX line-segment hit-testing as a soft signal for future GPX UI surface work; refactored `useMapMarkerInteractions` and `useMapDrawingInteractions` to consult the resolver instead of racing via `event.stopImmediatePropagation`. Coverage: 21 new unit tests across 2 new files, 2 new Playwright E2E specs (one pinning the marker-wins case, one pinning the polygon-fallthrough case), and an interactive Playwright sanity check captured under `tmp/b6-verification/` showing both behaviors against a live `npm run dev` server.

Former hardening item: T11.

Goal: reduce map-interaction ambiguity around GPX and drawing hit-testing before field-oriented map work.

Tasks:

- Review GPX and drawing hit-test boundaries.
- Make hit-test decisions explicit and testable.
- Avoid silent ambiguity when overlapping map features are selectable.
- Keep operator behavior calm and predictable under dense map state.

Acceptance:

- GPX/drawing selection rules are explicit in code and covered by tests.
- Ambiguous interactions fail visibly or choose the documented priority order.

Verification:

- Unit tests for the hit-test rules.
- Targeted map interaction check with the inbuilt browser.

### B4: Cross-Platform Tauri Beta Distribution — Done 2026-05-17

Linear issue: `sartracker-web-y6a`. Closed 2026-05-17.

Outcome: release pipeline at `.github/workflows/release.yml` builds Linux
(AppImage + .deb) and Windows (NSIS, current-user install with WebView2
download-bootstrapper) artifacts on `v*` tag push or `workflow_dispatch`.
Splits into a `gates` job (Linux, runs lint/test/build/version-trio
assertion/release-notes existence check), a parallel `bundle` matrix using
`tauri-apps/tauri-action@v0.6.2`, a `checksums` job that generates a
SHA256SUMS sidecar, and a `summary` job. Releases land in DRAFT + prerelease
state for human review before publish.

First published release: **v0.1.0-beta.3** at
https://github.com/donal0c/sartracker-web/releases/tag/v0.1.0-beta.3 with
4 assets (Linux AppImage, Linux .deb, Windows NSIS .exe, SHA256SUMS).

Failure history before success (per immutability rule, retained on remote):

- `v0.1.0-beta.1`: gates failed (Linux GTK/WebKit apt deps not installed in
  the gates job; `cargo test` could not link `gdk-sys`). Fix: add the same
  apt step to the gates job.
- `v0.1.0-beta.2`: Linux bundle succeeded (assets uploaded to a draft
  release that was never promoted); Windows MSI bundler rejected the
  `-beta.N` pre-release suffix as non-numeric. Fix: drop MSI from beta lane
  (`sartracker-web-g1u`); also rename `tauri-action` inputs to v0.6.2 names
  (`assetNamePattern`, `includeUpdaterJson`; drop `uploadUpdaterSignatures`).

Locked decisions: Linux primary (most operators are on Linux), Windows
secondary. macOS arm64 deferred from CI per `sartracker-web-590` to keep
billed minutes inside the GitHub Actions free tier (macOS bills at 10x);
macOS continues to be built locally via Path B (`npm run beta:verify`) and
uploaded manually when needed. Windows MSI deferred per `sartracker-web-g1u`
until the version scheme supports MSI's numeric-only-suffix constraint.
Linux runner pinned to `ubuntu-22.04` (NOT `latest`) for glibc forward-compat.
Windows runner pinned to `windows-2022` (NOT `latest`, which is now
`windows-2025`). NSIS install mode is `currentUser` (no admin/UAC). WebView2
strategy is `downloadBootstrapper` with `silent: true` (0 MB bundle
overhead). x86_64 only — Linux ARM and Windows ARM deliberately out of
scope. No code signing. Release notes sourced from
`docs/releases/sartracker-web-<version>-beta.md`, required to exist before
the bundle matrix runs.

Tauri config update: `src-tauri/tauri.conf.json` Windows section configured
for unsigned-tester ergonomics (`installMode: currentUser`, WebView2
`downloadBootstrapper`, LZMA compression).

Docs updates: `docs/releases/TEMPLATE.md` rewritten with per-OS install
sections (AppImage, .deb, NSIS-with-SmartScreen, MSI, macOS Gatekeeper);
`docs/releases/README.md` documents Path A (CI-driven cross-platform) vs
Path B (local macOS-only smoke); `docs/tauri-beta-release-plan.md` records
B4 outcome and preconditions for wider/signed distribution; operator manual
Desktop Beta section rewritten to cover Linux primary / Windows secondary /
macOS parity.

End-to-end CI verification: succeeded on `v0.1.0-beta.3` (run
`26002563213`, ~24m wall-clock; gates 7m7s, bundle linux-x86_64 11m9s,
bundle windows-x86_64 16m5s, checksums 18s, summary 4s). Two failures
preceded the green run: `v0.1.0-beta.1` (gates apt deps missing) and
`v0.1.0-beta.2` (Windows MSI rejected pre-release suffix). Local
pre-tag verification covered: workflow YAML parses cleanly, actionlint
passes, tauri.conf.json validates against the schema, lint/test/build
all green.

Preconditions for wider/signed distribution captured in
`docs/tauri-beta-release-plan.md` § Preconditions for Wider / Signed
Distribution: macOS Developer ID + notarization, Windows code signing
(Azure Trusted Signing recommended), `reqwest` CA roots strategy for
self-hosted Traccar HTTPS, Tauri updater signing keys.

### Official Irish Map Provider Integration

Parent Linear issue: `DON-76`.

Goal: support the team's licensed Irish map sources without turning private map data into public GitHub, Vercel, or release-artifact content.

Locked decisions:

- Licensed map files and credentials are private/customer-provided assets.
- Do not commit licensed map files to GitHub.
- Do not bundle licensed map files into public release artifacts.
- Do not make the hosted web app fetch private MapGenie sources.
- Electron/local users or admins add licensed map access/packages after installing the app.
- Public fallback maps stay available until official map rendering is proven and accepted.

Current evidence:

- Verified local USB copy: `/Users/donalocallaghan/SARTracker-private-map-assets/team-usb-2026-06-03`.
- Local copy manifest: `/Users/donalocallaghan/SARTracker-private-map-assets/team-usb-2026-06-03-COPY-MANIFEST.txt`.
- Private visual comparison evidence: `/Users/donalocallaghan/SARTracker-private-map-assets/map-source-evaluation-2026-06-03/mapgenie-source-comparison.png`.
- `DON-77` generated 12 successful MapGenie ArcGIS export samples: 4 sources across MacGillycuddy Reeks, Galtymore/Galtees, and Wicklow/Glendalough.
- Discovery is the locked default official operational topo map from the visual evidence and Donal's team-context confirmation.
- `basemap_premium` is a secondary clean reference basemap.
- `ortho` and `National_High_Resolution_Imagery` are imagery/reference layers.
- `relief_byte.tif` and `Slope_30plus.tif` are overlay candidates, not primary basemaps.
- `DON-79` proved Electron/local rendering via ArcGIS export for Discovery Topo and Aerial Imagery over Carrauntoohil/Reeks with `loaded=true` / `areTilesLoaded=true`.
- `DON-81` produced `docs/official-map-offline-strategy.md`: official offline maps should be a local post-install map library, first via an MBTiles-style package for the team's standard operating area, with mission-specific package/prefetch secondary and hosted web public-map-only.

Work sequence:

- `DON-77` — evaluate MapGenie sources and choose operational default. Done 2026-06-03.
- `DON-78` — grouped map catalogue UX for official/private and public fallback maps. Done locally 2026-06-03.
- `DON-80` — local official map source import/configuration for Electron. Done 2026-06-03.
- `DON-79` — local MapGenie rendering via ArcGIS export. Done 2026-06-04.
- `DON-81` / `DON-7` — official-map offline package strategy. Done 2026-06-05.
- `DON-103` — standard-region Discovery conversion to local MBTiles package. Done 2026-06-05; MBTiles is viable for v1. See `docs/official-map-mbtiles-spike-don-103.md`.
- `DON-58` — fixed Linux Electron secret-store launch and diagnostics runtime label; remote Dell Ubuntu package-content and true `.deb` install smoke passed.
- `DON-59` — packaged Linux filesystem workflows done on Dell Ubuntu installed `.deb`; native chooser completion, GPX file/folder/watch import, marker attachment store/open, diagnostics, paths, and permissions smoke passed.
- `DON-104` — cross-platform Electron official map package registry after `DON-58`/`DON-59`.
- `DON-105` — local official map package tile serving through Electron proxy.
- `DON-106` — official offline map readiness UI and diagnostics.
- `DON-107` — packaged Electron official offline map validation done for macOS and Dell Ubuntu Linux; Windows is the documented unverified gap until a Windows machine is available.
- `DON-108` — full-national Discovery package size/performance measurement done 2026-06-06; support as optional/admin-prepared with warnings, keep standard-region package as v1 default. See `docs/official-map-national-package-measurement-don-108.md`.
- `DON-82` — relief/slope overlay classification done 2026-06-06; implementation should be separate overlay package/import/rendering work. See `docs/official-map-terrain-overlays-don-82.md`.
- `DON-109` — official map setup wizard and package import UI. Next map implementation task.
- `DON-110` — app-owned official map library copy and package management.
- `DON-111` — official map package coverage manifest and readiness certificate.
- `DON-112` — package choice guardrails for standard Kerry/Reeks, mission-area, and national packages.
- `DON-113` — admin package preparation workflow for standard and mission-area official maps.
- `DON-114` — field-ready official map checklist and operator manual updates.
- `DON-115` — cross-platform official map import release smoke on macOS, Windows, and Linux.
- `DON-116` — optional relief/slope overlay package conversion spike.

Acceptance:

- Discovery remains the default official operational topo map unless later map-owner feedback explicitly contradicts it.
- Operators see official map options grouped separately from public fallback maps.
- Electron/local can configure private map access/assets without committing or bundling licensed map data.
- Offline planning is based on the selected operational source and real local asset formats, not speculation.
- The map stream is not complete until a fresh packaged Electron install can import/register a licensed package through the UI, keep it local after USB removal, prove current-area offline readiness, export sanitized diagnostics, and pass macOS/Windows/Linux packaged validation.

Verification:

- Research-only `DON-77` verification is the generated private comparison sheet and successful MapGenie export responses.
- `DON-80` verification: parser/settings tests, Electron settings/runtime-file tests, diagnostics tests, Settings E2E, `npm run test:all` (unit + 121 Playwright including visual + backend), plus `npm run lint` and `npm run build`.
- UI/runtime children require targeted tests and browser/Electron validation according to the verification cadence above.

## Shared Foundation Chunks

### S1: Runtime Boot/Fault Guard

Former hardening item: T06.

Goal: startup must be observable. The app should never render a broken console with disabled controls and no explanation.

Tasks:

- Add a small runtime boot-state store with phases `booting`, `ready`, and `failed`.
- Transition to `ready` only after app or browser-harness runtime startup succeeds.
- Transition to `failed` with a clear error string if startup fails.
- Gate the app shell:
  - booting: show a minimal preparing message
  - failed: show a clear fault banner and Reload action
  - ready: show the normal app
- Make `applyAppRuntimeController` dispose the previous controller before replacing it.
- Ensure runtime controller disposal is idempotent and releases autosave/tracking resources.

Acceptance:

- Startup failure is visible to the operator.
- Double runtime initialization cannot leak the previous controller.
- Normal hosted and Tauri startup behavior remains unchanged apart from the brief boot state.

Verification:

- Done 2026-05-16: unit tests for boot-state transitions, boot/fault shell rendering, startup orchestration, dispose-before-replace, and idempotent disposal.
- Done 2026-05-16: `npm run lint`, `npm run test -- --run`, `npm run build`, and `npm run test:backend` passed.
- Done 2026-05-16: targeted app-start check with the inbuilt browser at `http://127.0.0.1:5173/?missionHarness=1` showed the normal app shell and hosted-testing banner with no boot/fault gate left visible.

### S2: Autosave Lifecycle Hardening

Linear issue: `sartracker-web-vpz.5`

Former hardening item: T10.

Goal: mission lifecycle transitions should request an immediate durable sync, and autosave failures should not be invisible.

Tasks:

- Add or expose an autosave `requestSync()` path.
- Trigger autosave on important mission lifecycle transitions such as start, pause, resume, finish/finalize, and unlock where appropriate.
- Track autosave status and last failure.
- Surface a subtle but visible command-mast warning when autosave is stale or failing.
- Preserve known backup-audit behavior: backup sync events only exist when an active mission exists.

Acceptance:

- Lifecycle transitions no longer wait only for interval/visibility/pagehide autosave.
- Operators get a visible signal when autosave is failing or stale.
- Finished/finalized mission semantics remain intact.

Verification:

- Done 2026-05-16: unit coverage added for forced `requestSync()`, queued lifecycle sync behind in-flight interval sync, stale/failing autosave status, mission lifecycle sync calls, and finalize/unlock sync calls.
- Done 2026-05-16: command mast warning rendering covered by unit test and inbuilt-browser validation at `http://127.0.0.1:1420/?missionHarness=1`.
- Done 2026-05-16: `npm run lint`, `npm run test -- --run`, `npm run build`, `npm run test:backend`, and `npm run test:e2e -- --project=chromium` passed.

### S3: Layer Visibility Service Extraction

Former hardening item: T07.

Goal: make layer visibility rules independent of the React layer panel before UI relocation or redesign work.

Tasks:

- Extract visibility patch logic from `src/components/layer-filter-panel.tsx` into `src/features/layers/layer-visibility-service.ts`.
- Use `src/features/layers/layer-catalog-ids.ts` as the single node-ID/entity translator.
- Keep the service pure; apply Zustand/store updates through a thin adapter.
- Remove duplicate layer-catalog visibility hydration so there is one authoritative call site.
- Preserve existing layer panel behavior and visual output.

Acceptance:

- The layer panel no longer owns domain visibility logic.
- New entity types cannot silently no-op visibility updates.
- Future UI movement can reuse the service without copying logic.

Verification:

- Done 2026-05-17: extracted visibility patching to `src/features/layers/layer-visibility-service.ts` and switched `layer-filter-panel` to a thin adapter.
- Done 2026-05-17: added `tests/unit/layer-visibility-service.test.ts` covering device/marker/drawing features, tracking devices branch, measurements/breadcrumbs layers, and unknown node behavior.
- Done 2026-05-17: `npm run test -- tests/unit/layer-visibility-service.test.ts tests/unit/layer-catalog-store.test.ts tests/unit/layer-visibility-store.test.ts`.
- Done 2026-05-17: `npm run test:e2e -- tests/e2e/layer-panel.spec.ts tests/e2e/parity-visibility.spec.ts --project=chromium`.
- Done 2026-05-17: full verification passed (`npm run lint`, `npm run build`, `npm run test:all`).
- Follow-up 2026-05-17: review found helicopter/GPX/group nodes still relied on async hydration for immediate overlay patching; service/store now handle group visibility, helicopter slots/items, and GPX import layer/items directly. Full verification passed again.

### S4: Map Overlay Consolidation And Camera Race Fix

Former hardening item: T12.

Goal: reduce duplicated MapLibre overlay primitives and fix the basemap camera-preservation race.

Tasks:

- Create shared overlay helpers for:
  - ensure GeoJSON source
  - ensure layer
  - combine map filters
  - load SVG icon
- Refactor drawing, marker, measurement, GPX, helicopter, and tracking sync modules to use the shared helpers.
- Fix basemap style switching so camera restoration is applied exactly once at the safe style event point, not immediately and again later.
- Prefer doing this after S3 so layer visibility and overlay changes do not collide.

Acceptance:

- Overlay modules share primitives without losing per-feature clarity.
- Basemap switching does not fight operator camera movement.

Verification:

- Done 2026-05-17: added `src/features/map/map-overlay-primitives.ts` with shared GeoJSON source, style layer, filter-combination, and SVG icon loading helpers.
- Done 2026-05-17: refactored drawing, marker, measurement, GPX, helicopter, and tracking overlay sync modules to use the shared primitives while preserving their feature-specific layer specs.
- Done 2026-05-17: changed basemap style camera preservation to restore once on `styledata`, removing the immediate restore plus later `idle` restore that could fight operator camera movement.
- Done 2026-05-17: red-then-green coverage added in `tests/unit/map-overlay-primitives.test.ts` and `tests/unit/apply-map-style-preserving-camera.test.ts`.
- Passed 2026-05-17: focused unit suite for overlay primitives, camera preservation, tracking overlay, layer filters, and overlay GeoJSON builders.
- Passed 2026-05-17: `npm run lint`, `npm run test` (91 files / 465 tests), `npm run build`, and `npm run test:backend` (41 passed / 1 ignored).
- Not run: Playwright E2E, because local repo instructions say not to use Playwright unless explicitly requested.

### S5: Mission Control View Model Extraction

Former hardening item: T08.

Goal: make mission-control behavior easier to change once team UI feedback starts landing.

Tasks:

- Extract mission timer logic into `useMissionTimer`.
- Extract mission-control state/actions into `useMissionControlViewModel`.
- Keep rendering components thin and predictable.
- Preserve current control enablement rules.
- Do this after S1 where practical, and after S3 if layer/mast UI changes are happening nearby.

Acceptance:

- Mission control rendering is separated from lifecycle/timer orchestration.
- Future UI repositioning does not require reworking mission rules.

Verification:

- Done 2026-05-17: added `src/features/mission/use-mission-timer.ts` and moved the mast plus Mission Control timer displays onto it.
- Done 2026-05-17: added `src/features/mission/use-mission-control-view-model.ts` for mission lifecycle, recovery, governance, duplicate-name warning, admin roster, busy/error state, and control enablement.
- Done 2026-05-17: `MissionControlPanel` now delegates lifecycle/timer orchestration to the view model and remains focused on rendering, focus trapping, and accessible dialogs.
- Passed 2026-05-17: red-then-green hook tests in `tests/unit/use-mission-timer.test.ts` and `tests/unit/use-mission-control-view-model.test.ts`.
- Passed 2026-05-17: focused mission tests, `npx tsc --noEmit`, `npm run lint`, `npm run test` (93 files / 470 tests), `npm run build`, and `npm run test:backend` (41 passed / 1 ignored).
- Not run: Playwright E2E/browser automation because local instructions require explicit user approval before using Playwright.

## Verification Chunks

### V1: Regression E2E Coverage

Status: done 2026-05-17 (`sartracker-web-8gw`).

Former hardening item: T13.

Delivered:

- `tests/unit/start-tracking-runtime.test.ts` pins cold-start-offline status:
  the runtime now publishes
  `OFFLINE MODE — showing last known positions from cache.` (mode `offline`,
  `lastSuccessAt: cached_at`) after hydrating a usable cache, and publishes no
  status when no usable cache exists. Implemented in
  `src/features/tracking/start-tracking-runtime.ts`.
- `tests/unit/polling-manager.test.ts` pins that a single healthy poll cycle
  never publishes an `offline` status (guards against transient transport-flip
  regressions).
- `tests/unit/layer-stale-refresh-integration.test.ts` wires the real layer
  catalog runtime + catalog store + visibility store + panel adapter helper
  together and pins that a stale refresh resolving after a click does not
  clobber the just-applied visibility. Confirmed to fail red if the
  invalidation guard in `start-layer-catalog-runtime.ts` is reverted.
- `tests/e2e/v1-regression.spec.ts` adds two operator-facing regressions:
  a per-device tracking visibility toggle flips the MapLibre device-circle
  filter, and a cold-start-from-cache snapshot+status renders an explicit
  "showing last known positions" warning in the tracking status panel.
- `tests/e2e/parity-visibility.spec.ts` no longer uses fixed `waitForTimeout`.
  The 200ms read-state nap and four 500ms cascade naps were replaced with
  `expect.poll` against the actual conditions (group flag flipped, hidden
  device IDs, breadcrumbs visibility). The `beforeEach` now polls the catalog
  feature IDs before opening the Layers tab.

Acceptance met:

- Known regressions fail red if their fixes are reverted (verified by
  temporarily disabling the catalog invalidation guard).
- Cold-start-offline is covered at the runtime seam (unit) and at the
  operator surface (E2E).
- Visibility specs no longer rely on fixed propagation waits.

Verification:

- Passed: `npm run test` (94 files / 474 tests).
- Passed: `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- Passed: `npx playwright test --project=chromium` (85 tests).
- Passed: `npx playwright test --project=visual` (27 tests).
- Passed: `npm run test:backend` (41 passed / 1 ignored).
- Browser-backed verification ran via Playwright at
  `http://127.0.0.1:1420/?missionHarness=1`. No Vercel redeploy was needed
  because the only operator-facing runtime change is the cold-start-offline
  status copy, which is exercised by the new E2E.

### V2: Visual Review Automation — Done 2026-05-17

Former hardening item: T09. Linear issue: `sartracker-web-n9i`.

Goal: make the existing visual verification workflow less manual and easier to repeat.

Outcome:

- `npm run visual:review` reads every `*.entry.json` under `test-results/visual-verification/`, spawns one `claude --print` reviewer subprocess per entry, parses a structured pass/fail reply, and writes a per-entry `<testId>.review.json` plus an aggregate `visual-review-<timestamp>.json` report.
- Pure shaping/parsing logic lives in `build/visual-review-lib.js`; runner in `scripts/visual-review.mjs`. 44 unit tests cover CLI parsing, manifest loading, reply parsing, severity gating, cache key stability, and summary formatting.
- Severity gating is configurable via `--fail-on critical|high|medium`; default is `high`. Reviewer process errors always block (exit 2).
- Caching: each (screenshot bytes + verification prompt + model) tuple is content-hashed and cached under `test-results/visual-verification/.cache/`. Repeat runs return in <2s with no model calls. `--no-cache` forces a fresh review.
- `--dry-run` exercises the runner end-to-end without spawning reviewers, useful while iterating on the script itself.
- `--only <testId>` runs a single entry, useful while iterating on a visual spec.
- Live verification: full 27-entry review on the current visual manifest produced 22 PASS / 5 FAIL / 0 ERROR with deterministic per-entry verdicts. The 5 FAIL entries are real findings — visual prompts that drifted from the captured frame — filed as `sartracker-web-b3c` for follow-up.
- CLAUDE.md visual-tests section updated to point at `npm run visual:review` instead of the old "spawn Opus subagents" manual workflow.

Exit codes (also documented in CLAUDE.md):

- `0` every entry passed gating
- `1` at least one entry failed at or above `--fail-on` severity
- `2` reviewer errored on at least one entry (always blocks)
- `3` manifest had zero entries (visual project did not run)

### B5: Triage First Web And Tauri Beta Feedback

Linear issue: `sartracker-web-s8m`

Goal: classify real tester feedback before starting another fix loop, so hosted-web issues, desktop/Tauri issues, shared app bugs, docs/training problems, and product preferences do not collapse into one foggy backlog.

Entry gate:

- Hosted web app has been tested from the production URL, not a local dev server.
- Tauri app has been tested from the distributed artifact, not only from a local developer build.
- Evidence is captured before triage starts: version/build ID, OS/browser, tester path, screenshots or notes, diagnostics export when relevant, and clear pass/fail observations.
- Feedback is classified before implementation starts.

Tasks:

- Review feedback from hosted web testing and the first Tauri beta distribution.
- Classify each item as hosted-only, desktop/Tauri-only, shared app bug, docs/training issue, or product/UI preference.
- Create or update Linear issues for actionable items.
- Decide whether to widen Tauri beta, repeat blocker fixes, or keep desktop paused while hosted testing continues.
- Update this workplan and `handoff/HANDOFF.md` with the decision.

Acceptance:

- No tester finding remains only in chat, email, or memory.
- Each actionable finding has a lane and Linear issue.
- The plan clearly says whether Tauri beta can expand, needs another blocker-fix loop, or should pause.

## Deferred / Decision-Gated Work

### Browser Operational Hardening

Do not start this until the team has tested the hosted app and we decide the browser should be more than a testing/training lane.

Possible future work:

- IndexedDB-backed mission store.
- Browser mission export/import.
- Browser-compatible diagnostics export.
- Browser file import and attachment handling.
- Browser secret handling design.
- Browser offline map strategy.

### Stable Desktop Release

Do not start this until at least one beta path is repeatable and tested.

Possible future work:

- Signing/notarization.
- Auto-update.
- Release promotion checklist.
- Team install/update guide.

## Supporting Docs

These docs support this queue but do not define a separate queue:

- `docs/hosted-browser-testing-plan.md` — deployment/product strategy.
- `docs/team-testing-feedback-loop.md` — tester instructions and feedback template.
- `docs/tauri-beta-release-plan.md` — beta packaging/release details.
- `docs/reports/deep-hardening-investigation-2026-05-13.md` — historical evidence for the former T01-T13 hardening items.
- `docs/plugin-parity-matrix.md` — canonical parity evidence.
- `docs/bead-readiness.md` — readiness notes for larger Linear issues.
