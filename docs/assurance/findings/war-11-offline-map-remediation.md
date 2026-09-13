# WAR-11 offline map qualification and freshness

2026-09-13 — DON-7 / DON-76. Work in progress, not merge or release qualification.
Base: `2b2bf8e605e27123c9e454598828d71cb7c062aa` (PR25 merged).

## Scope and invariants

Repairs WAR-04 MAP-01, MAP-02, MAP-03 and AUD-11 only. Train D owns mission truth.
No private licensed tiles, provider credentials, licensed distribution/conversion,
Harvey/EastWest work, or BCP-17 qualification is included. Release remains HOLD;
the strict `<200 ms` gate is unchanged.

- A removed, replaced, changed or unverified package cannot retain readiness.
- Package metadata alone cannot certify any view. A successful Check View must
  bind current package digests to every usable local tile required at that zoom.
- Online fallback and the missing-coverage hatch never count as local coverage.
- Imports and saves close live readers before mutation and reject concurrent
  tile requests; subsequent reads must use the current package generation.
- Native change notifications clear view proof and recreate the raster source;
  camera, mission overlays and unrelated layers are preserved.
- Malformed, unsupported, fully transparent or oversized raster tiles fail
  validation. SQLite integrity/schema/row checks and hashing run in a worker;
  one bounded tile at a time is decoded in Electron. Success requires worker exit 0.

## Baseline evidence

The exact detached baseline and raw red outputs are retained in
[`../../evidence/war-11-map/baseline/`](../../evidence/war-11-map/baseline/).
Four original MAP probes fail. Independent opaque 256px PNG controls reproduce
deletion and same-path replacement failures without relying on the broken hatch.
AUD-11's original 1363-byte image is accepted by Chromium's permissive decoder
but rejected by strict PNG validation. Do not describe it as universally undecodable.
The earlier full audit file is absent from this checkout; the coordinated ledger
and fresh reproduction are the available finding evidence.

## Implementation boundaries

Package validation scans the SQLite database and every tile, records SHA-256 and
filesystem identity (`dev`, `ino`, size, nanosecond mtime/ctime), and rejects sidecars.
Settings load and normal serving verify that identity; Check View additionally
rehashes the full package before checking actual local tiles. Ordinary filesystem
writes, timestamp changes and replacement change the identity. A second digest
read on every tile admission is deliberately not added: no normal filesystem
counterexample to this identity boundary was reproduced, and each view claim
already requires a fresh digest. This does not defend against a hostile filesystem.

External file changes are detected by a one-second monitor while package settings
are cached, plus checks on load/read. In-app mutations invalidate immediately.
Transient renderer notification exceptions retain a pending retry on that same
monitor, with one sanitized warning. Reader invalidation still occurs immediately;
completed saves/imports return their actual result rather than a false failure.
This exercises the existing repair architecture rather than introducing a new
watcher for the smoke test. WAR04-MAP-01 and hazard MAP-001 reject a stale positive
readiness verdict; WAR-04's follow-up requires revalidation at the readiness
boundary. The team Q&A ledger/raw transcript and Sar4 material provide no separate
package-monitor timing rule. The smoke must establish checked readiness with B
resident, then observe external-removal withdrawal before any Save, explicit tile
fetch or Check View can cause cleanup. A subsequent Save checks its separate path.
Moving the map, switching maps, focus return, package change or tile errors clear
view proof. Pitched, invalid or overlarge views fail visibly; the check is bounded
to 4096 required tiles. Other views and zooms remain unqualified.

Raster source zoom uses MapLibre's raster-specific `roundZoom = true` and 256px
tile size: `round(cameraZoom + 1)`, capped at source zoom 19. The review's initial
floor-rule finding was withdrawn after tracing RasterTileSource → TileManager →
coveringZoomLevel. Orphan layer/source invalidation was confirmed, reproduced
with two failing tests, and repaired with independent resource cleanup.

The exported document now describes package validation, includes a content
fingerprint, and explicitly does not certify current-view coverage or field use.
The operator manual makes the same distinction.
The settings extension is backward compatible: older ready records without the
new attestation require Save Settings validation. No mission database migration,
coordinate transform, mission rule or licensed data change is included. Large
licensed package throughput and full-size operating envelopes are not qualified.

## Native harness crash and controlled recovery

Original command:
`npx playwright test tests/e2e/electron/official-map-tile-decoder.spec.ts --project=electron-controls --workers=1`.
At 17:38:55.8126 Irish time, Node worker 80388 launched Electron 80389; Electron
crashed at 17:38:57.5902. The test's bare `require` evaluation failed before decoder
invocation. The preserved macOS report has EXC_BAD_ACCESS/SIGSEGV on CrBrowserMain,
with window-close and inspector frames. Teardown/evaluation overlap is a hypothesis,
not an established cause. This launch is failed native evidence.

The corrected harness preloads the decoder in its main-process fixture, waits for
firstWindow and the ready marker, tests the exact historical fixture, and observes
process exit independently from Playwright's close promise. One controlled recovery
passed: Electron 95071, code 0, signal null, 1/1 test. No new Electron crash report
appeared; the original report's SHA-256 stayed
`e6f1c98027f89950ffd70c8b9233b70cd70f66f14cdac5d5cc2a0d569ba98289`.

Original and recovery raw logs/report remain local under `tmp/war-11/crash/`.
Machine paths and the process inventory must not be published. The recovery shell
wrapper hit zsh's readonly `status` variable, and BSD date did not expand `%3N`;
the complete child-exit/stdout evidence supports the result, not pristine wrapper
metadata or millisecond timing. One clean recovery does not establish repeated
stability or fix an unidentified Electron/product crash cause.

## Verification and remaining work

- Targeted package/worker/decoder/freshness tests pass, including palette PNG and
  bounded decompression controls, malformed WebP lengths and clean worker exit.
- Browser synthetic bridge flow passes: successful checked view, invalidation on
  zoom, successful recheck, removal withdrawing readiness. Rendered captures were
  inspected locally. This is renderer proof, not native SQLite/worker proof.
- The broader map/settings browser run is **24 passed / 3 failed**, not green.
  Existing DON-229, DON-228 and large-hosted-history cases reproduce identically
  on clean detached base `2b2bf8`: durable history request recording is unavailable,
  breadcrumb requests remain zero and expected 14,500 known fixes remain two.
  Raw baseline output SHA-256 is
  `fe6e6d4113f8d81ed7cada2d4d126316ac41eac5f7d4a758b9ad226515dd3636`.
  Both runs are retained under `tmp/war-11/`. These are pre-existing/out-of-scope;
  Train D was notified and no tracking production code was changed here.
- Production build, bundle budgets and lint pass. Full serial deterministic source
  suite passes 456 files / 4,806 tests, with the six existing qualification-only
  skips (482.12 seconds). Do not infer strict timing qualification.
  That cycle preceded final metadata-materialization and notification-retry fixes;
  their four affected package/proxy/freshness/worker suites pass 40 tests. A real
  SQLite 1 MiB metadata fixture first exposed the oversized JS allocation, then
  confirmed the SQL preflight keeps returned payloads within 64 KiB. Notification
  failures were reproduced before containment/retry. Both fixes were independently
  re-reviewed. The final frozen-input cycle then passed **456 files / 4,812 tests**,
  with the same six existing qualification-only skips, in 479.24 seconds. TypeScript,
  lint, workflow YAML parsing and diff checks passed. All 1,173 source/test/config
  hashes matched the frozen manifest before packaging.
- The single native decoder recovery above passes. Combined packaged settings,
  worker/native SQLite, replacement/removal and resident GPU tile proof is pending.
- Independent source review found no remaining demonstrated worker/generation
  defect after correction. Concurrent tile and real SQLite view checks reject old
  results when a mutation overlaps, and fresh requests subsequently succeed;
  23 targeted tests including fractional zoom pass.
- Smoke review corrections are source-reviewed green: disposable profile/provider
  isolation, real operator-view checks, repaired hatch bytes and GPU pixels,
  replacement/removal predicates, and early-failure custody. The whole ASAR hash
  streams; every regular `electron/**`, `shared/**` and `dist/**` entry must match
  the source/build tree exactly, with missing/extra/mismatch/link rejection.
  Package/lock/builder metadata are hashed separately because packaging transforms
  package.json. A real synthetic ASAR regression passes match/stale/missing/extra
  cases, including CSS/manual/service-worker assets; helper suite is 6/6 green.
  Launch rejection retains the raw error/stack/call log and names Playwright as
  cleanup owner, without claiming an independently observed child exit. Installed
  Playwright source awaits its own launch-failure process cleanup; the initial
  launch-leak review concern was withdrawn on that evidence.
  Automatic removal has a 15-second observation bound, with settings readbacks
  that do not invalidate proxy state or notify the renderer. No Save, tile fetch or
  Check View is called before the GPU withdrawal/warning gate. This is reviewed
  smoke logic, not yet executed packaged proof.

Before any broader Electron run, stabilize production and smoke code, resolve
review changes, and coordinate a no-overlap native window with Train D. Then run
the packaged matrix with clean-exit gating and retained failure evidence. Ordinary
exact-head CI, final review and Train D merge/rebase remain required before READY.
No map commit, push, PR, merge, release or field acceptance is claimed here.

## Packaged attempt 1 — retained failure

After Train D yielded the native window, an independent inventory found no SAR
Electron/native harness process and one existing crash report. One macOS ARM64
package build passed with `VITE_SARTRACKER_MISSION_MODEL=1
CSC_IDENTITY_AUTO_DISCOVERY=false npm run electron:pack`. All 1,173 frozen hashes
matched after restoring only the known generated version file. The generated
renderer output was separately compared with the ASAR: all 240 regular native and
renderer entries matched. The ASAR SHA-256 is
`bebfdf95e6c6a2e1a98703c7337a4ccead4c862501b91658057b3cea996a8542`;
the 330-entry app bundle manifest digest is
`789347de06dc5c3ea33d3bc7a67cbf0c0cb186c8306c38740f00879b8c857298`.

The smoke ran from 17:55:45Z to 17:55:48Z, Node 64808 → Electron 64810, with
helpers 64820/64821/64825. It failed at the initial `waitForMapIdle` assertion:
`MapLibre emitted idle before reporting loaded()`. No first-render screenshot or
completed GPU/qualification matrix exists. The failure receipt directly records
Electron exit 0, signal null, no close error and no teardown escalation; the runner
exited 1. Crash inventory stayed unchanged and no SAR process remained. The native
window was released, and no retry was made.

Runtime diagnostics report Discovery Topo ready; initial OpenTopoMap degradation
is expected under the synthetic network block. Installed MapLibre checks loaded()
before emitting idle (`map.ts:3718–3719`), then runs regular listeners before
one-time listeners (`evented.ts:129–139`). Existing app overlay synchronization
listens on idle and can dirty the map before the smoke's one-time listener runs.
The exact wait function plus installed MapLibre Evented reproduced that premature
failure without Electron. The individual overlay callback in the packaged frame
was not traced. The coordinator accepted a harness-only correction: retain the
original 10-second overall deadline, keep listening through an idle/not-loaded
transition, and require loaded idle or fail on timeout with cleanup. All later
source/GPU/tile/operator assertions stay unchanged; production code stays frozen.

Raw attempt evidence and hashes remain local under `tmp/war-11/`, including
`packaged-attempt-1-hashes.json`, `prelaunch-artifact-binding.json`, and
`packaged-map/run-9F75Zx/failure.json`. That failure receipt's hash is
`88ddcff2f76110f45cbf33cb3da4437b4e0f890faac28645d14bce4983cea6b1`.
The earlier decoder-harness crash remains a separate, unconfirmed-cause event.

## Packaged attempt 2 — retained timeout

The wait-only correction changed exactly three smoke/helper/test files. All 1,170
other frozen hashes remained unchanged, and all 330 bundle entries / 240 runtime
entries matched before reuse of the same ASAR. Manifest
`05a1c7f5945177235319d1464d75edc5296d60e910349fb41bc08afe41385cc7`
records parent `aea9f7d58f61c42833cc08a58b2d4518908772aa33aef05b52f16241bf8a435a`.
Independent review, 8/8 helper tests, lint and syntax checks passed before the
new coordinated smoke-only window. No rebuild or ABI mutation occurred.

Attempt 2 ran 18:05:10Z–18:05:22Z, Node 69310 → Electron 69314, helpers
69320/69321/69325. It **failed** on the unchanged 10-second MapLibre loaded-idle
deadline. Child exit was 0/signal null, no close error or teardown escalation;
runner exit was 1. No new/changed crash report or SAR process remained. The window
was released without another native retry. Evidence is separate under
`tmp/war-11/attempt-2/` and `packaged-map/run-rnSWIq/`; no completed GPU matrix or
first-render screenshot is claimed.

Further source-only attribution uses the actual `registerMapStyleSync` together
with installed MapLibre Evented and `Map.setFilter`, `_update`, and `loaded`.
Tracking overlay synchronization unconditionally reapplies filters on idle;
Map.setFilter calls `_update(true)` even for an unchanged filter. Each completed
synthetic frame starts loaded, then regular app idle listeners make global loaded
false while the underlying style stays loaded. This reproduces the timeout on
every cycle. These production paths are unchanged from the base. The actual
packaged official source-loaded state was not captured, so its readiness remains
unproved. No production adjustment is justified by this harness failure alone.

A separate static mismatch was found: production raster refresh adds the known
numeric `revision` query to the canonical tile template, but the smoke accepted
only the query-free literal. The coordinator authorized a second harness-only
correction: exact official-source loaded state plus unchanged viewport/GPU and
operator checks; global loaded remains diagnostic; accept only the canonical URL
or its single numeric revision; capture pixels synchronously after rendering;
retain the original deadline and every fail-visible removal/replacement check.
Red/green controls and independent exact-diff review are required before requesting
another native window. No timeout increase, product map setting or production
change is authorized.

The second correction is not yet review-green. Review found four harness gaps:
an absent raster source must not call MapLibre's error-emitting `isSourceLoaded`;
renderer setup and cleanup must obey the actual shared deadline; tests must
exercise the capture and polling lifecycle used by the smoke rather than an
unused alternative waiter; and a failure before the first window must not claim
a screenshot was captured. These remain harness-only corrections. No third
packaged attempt is authorized until the corrected path passes independent
review and a new native window is coordinated.

### Third packaged attempt: final operator result failed

The four harness gaps were corrected and independently reviewed. All 15 focused
tests, syntax, targeted lint, TypeScript and diff checks passed. Actual renderer
installer tests cover absent-source guarding, render-only pixel reads, listener
and timer cleanup, and expired setup. The original 10-second evidence deadline
is unchanged; a separate maximum one-second cleanup window cannot extend success.
Manifest `e03956eee680af49afc16eb6b76f4a6c94652ba61f9ed89ad86441ab701555bd`
binds the same three changed harness files to the attempt-2 parent. All other
1,170 inputs, all 330 bundle entries and all 240 runtime entries matched before
one explicitly coordinated smoke-only launch; no rebuild occurred.

Attempt 3 ran 18:38:07Z–18:38:27Z, Node 82761 → Electron 82764, helpers
82766/82767/82771. Runner exit was 1. Direct child exit was 0/signal null, with
no close error or teardown escalation. Expanded crash inventory found no new or
changed report and no SAR process remained. The native window was released;
no fourth native attempt is authorized.

Retained `packaged-map/run-S3dTkl/02-synthetic-replacement-map.png` shows variant B,
Current view tiles verified (15/15 local tiles at z12), and Field ready. The next
`03-automatic-removed-map.png`, captured before Save/fetch/check, shows raster
withdrawal, unreadable-package warning and Not field ready. These are successful
stages of a failed overall run, not complete packaged qualification. Script
control flow also passed native missing-tile/hatch, invalid-package and same-path
replacement checks before those screenshots; no success summary was written.

The final removed-package Check View click completed, then the 15-second
result-text assertion timed out. `workflow-failure.png` shows the Maps popover
still mounted, Current view not checked, missing-package warning and Not field
ready. A moved or closed popover is not supported by this image. Whether a
negative result was never published or was later invalidated is not yet proven;
the exact renderer event ordering was not recorded. Source-only diagnosis is
tracing click, result writes and settings/package/tile-failure/focus resets.

The earliest renderer capture contains 40 console entries, all in window-acquired
phase, and no page errors: one script-fetch error, one file:///sw.js service-worker
registration warning and 38 ERR_BLOCKED_BY_CLIENT messages. The registration call
is in unchanged `src/lib/register-service-worker.ts`; source attribution does not
excuse the diagnostics. Request URLs were not retained for the 38 blocked entries,
so all remain unclassified despite the run's explicit HTTP/S cancellation mode.
Main stderr separately contains 30 mutation-guard, 37 unreadable and 37 missing
tile IPC errors, without timestamps; do not infer their order relative to the
final click. No diagnostics are allowlisted.

Separate wrapper/process/crash receipts and evidence hashes are under
`tmp/war-11/attempt-3/`; failure JSON SHA-256 is
`98902cbb60093e12df0a3401b88da057dee9b368da09f575cd725f1052dd2829`.
Original PID 80389 crash remains attributed to our decoder test with root cause
unconfirmed. None of these clean-exit packaged failures resolves that crash.

### Final negative-result transition: source/browser repair

The mounted button calls the hook's `check`; a native result writes missing,
partial, error or complete coverage. `registerOfficialMapProtocol` dispatches
`sartracker:official-map-tile-failed` on rejected tile IPC. The original listener
used the same invalidation callback as movement, settings, package changes and
focus: it incremented the request generation and replaced coverage with unchecked.
The packaged logs do not order those events around the final click, but the
production transition itself is now reproduced independently.

An actual-hook unit regression and Chromium operator flow first published missing
coverage, then dispatched the real tile-failure event and observed unchecked.
The browser red log and trace are preserved under `tmp/war-11/`; the failure was
at the assertion after the negative result had already been observed. This is
a demonstrated production state defect, not a different popover selector.

The minimal repair preserves only an already published, same-active-map negative
status with no positive qualification when a redundant tile failure arrives.
It does not preserve complete, checking or unchecked state. Real movement,
settings/package changes and focus still invalidate; a later successful check
can replace a negative result. No failure event is globally ignored and the
predicate uses state/status rather than message text.

The repaired Chromium flow passed (1 test, 5.0 seconds): positive proof withdraws
on tile failure, a missing result survives a later tile failure, package restoration
clears that result, and a fresh successful check restores readiness. Root inspected
the rendered negative-result screenshot. This is real browser/React/MapLibre
evidence with a mocked native bridge. It is **not** packaged proof: the attempt-3
artifact predates this repair, and no fourth native run or rebuild occurred.

Final focused controls pass 12/12, including active map identity changes, queued
bare failures after package revision reset, stable map references and later
successful requalification. Final Chromium rerun passes 1/1 in 4.7 seconds;
TypeScript, targeted lint and independent final re-review pass. Final source
manifest `40473e68aaa93d56baa2361ed24c09c750b710efb663c98fc06d534a2ea7fb90`
differs from attempt 3 only in the hook and its unit/browser tests. The final
serial correctness cycle passed 456 files / 4,829 tests, six existing qualification
skips, in 477.61 seconds (exit 0). All 1,173 frozen inputs matched afterward.
The [final correctness receipt](../../evidence/war-11-map/negative-result/final-correctness-receipt.json)
binds the command, counts, manifest and raw-log hash.

The protocol emits a bare tile-failure event, so source/package-generation
attribution is unavailable. A queued older failure may preserve a newly current
negative result; this cannot restore positive qualification. Actual map/package
changes still reset state. The limit is recorded rather than silently adding
event identity claims or redesigning the protocol.

Two scoped same-root reviews are clear at committed source head
`bfc37b747e69267ca48d32b16c9cb48815aaa537`: integrated harness/hook/evidence/CI,
and proxy notification plus orphan raster cleanup. These are independent agent
reviews, not external approval. The immutable manifest was created before commit
and therefore records the then-checked-out base in its `head` field. The
[committed-source binding](../../evidence/war-11-map/negative-result/committed-source-binding.json)
independently matches all 1,173 recorded input hashes to the committed blobs;
the original manifest is not relabelled or rewritten.

Curated durable evidence: [packaged attempt 3](../../evidence/war-11-map/attempt-3/README.md)
and [negative-result red/green](../../evidence/war-11-map/negative-result/README.md).

Code and documentation pass staged whitespace checks. Preserved raw test logs
retain their original terminal whitespace and blank final lines; the ordinary
unfiltered diff check reports those archival bytes. They were not rewritten to
make a formatting check appear green. No runtime/test gate was relaxed.

### Linux source-head CI failure

[CI run 34776633574](https://github.com/donal0c/sartracker-web/actions/runs/34776633574)
tested `bfc37b747e69267ca48d32b16c9cb48815aaa537` and failed the packaged map
smoke. Earlier source correctness, assurance, build, packaging, SQLite inspection
and llvmpipe gates passed; later packaged gates were skipped. Strict responsiveness
and 960k release qualification did not run. This is a failed gate, not packaged
qualification of the final negative-result repair.

The captured source was loaded and the software GPU was present, but the camera
was at default zoom 12 instead of the requested synthetic camera zoom 11. All
289 sampled pixels were the no-coverage hatch background. The original 10-second
render evidence deadline expired; Electron exited 0/signal null without teardown
escalation. Forty blocked-resource messages have no retained request URLs and
remain unclassified. The run is not diagnostically clean.

An actual production-helper/MapLibre Evented reproduction demonstrates that the
style-preservation callback can overwrite the harness's immediate target jump.
A local Chromium trace observed the opposite, safe ordering. The failed Linux
run did not record intermediate event order, so its exact chronology remains
inferred. The bounded correction is confined to harness sequencing: await the
style-restoration boundary, move and verify the synthetic camera, then start
the unchanged 10-second readiness/source/GPU evidence window. Production camera
behavior, synthetic fixture extent and qualification assertions remain unchanged.

The [immutable Linux failure receipt](../../evidence/war-11-map/linux-ci-34776633574/README.md)
retains the screenshot, source binding, artifact digests and evidence limits.
No further local Electron launch or rebuild was made.

### Reviewed camera harness correction

The smoke now observes the selected map's `setStyle` return boundary through a
temporary, transparent wrapper. Events inside `setStyle` cannot settle the
observer before production registers its restoration callback; subsequent events
are read after their synchronous listeners finish. The wrapper marks success
only after a normal return and restores the original method only while it still
owns that replacement. Errors and deadlines remove the listener/timer and prevent
late capture.

One absolute 15-second setup budget covers the operator menu, map selection,
observer installation, restoration and finite target-camera verification. The
original 10-second render/source/GPU evidence deadline begins afterward and is
unchanged. Failure cleanup is separately bounded to one second and cannot extend
the success deadline. Failure records now retain style-settlement diagnostics.

Final focused checks pass 39/39 (27 harness and 12 hook), with TypeScript, targeted
lint, syntax and independent exact-diff review green. Only the smoke library,
script and their unit test differ from the prior 1,173-input source manifest;
the other 1,170 inputs, including production behavior and fixture extent, match.
The [source-only camera receipt](../../evidence/war-11-map/camera-harness/README.md)
records two actual source-order red/green controls and the missing pre-fix red
provenance for the initial camera and later selection-coordinator tests. Isolated
post-implementation rebreaks demonstrate cleanup/deadline assertion sensitivity;
they are not relabelled as TDD. Fresh exact-head remote CI remains required.
