# Repair Train C — map interaction and rendering

2026-09-14; baseline `cda87aa03f27eb69532ae9506aa9e719cef7e364` (merged PR28).
Scope: AUD-04 / DON-264 and AUD-06 / DON-6. Local repair and independent review
are complete; exact-head CI remains required. No release readiness claim.

## Contract and ownership

Equal overlay filter/paint values must not request another MapLibre redraw.
Real visibility, styling, source changes and replacement styles must still
synchronize. Reads use the current MapLibre style, avoiding stale cached style
identity. Existing overlay retries and style-readiness behavior remain intact.

Every Go To action has a unique process-local request identity. The latest
request remains active while style structure is unavailable, attaches when
available, survives replacement styles and expires after eight seconds from
initial attachment. The pending acknowledgement cannot own the marker lifetime.
Pending basemap camera restoration is cancelled by a newer navigation request;
only the latest style restoration may run. Ordinary camera preservation remains.
Coordinate conversion, persistence and official-map readiness are unchanged.

No Electron coverage IPC, service-worker registration, native mission-store
enumeration or diagnostic custody change. AUD-12 stays in the next UI batch:
this repair needs no layer-catalog files. DON-264's separate persistent-warning
feature and DON-6's wider parity acceptance remain open. Strict `<200 ms`,
official-map distribution and release qualification remain outside this PR.

## Causal evidence and retained failures

- AUD-04: baseline tracking regression makes seven redundant filter calls on
  unchanged synchronization. Coverage also fails the unchanged-filter check.
  MapLibre 5.22 `Map.setFilter` and `Map.setPaintProperty` unconditionally call
  `_update(true)` after the internal setter, even when the value is equal.
  Combined with the existing idle listener, these writes feed further redraws.
- AUD-06: four baseline failures cover ID reuse after clearing, ignored repeat,
  lost marker after style replacement and lost latest loading request. One
  expiry/no-resurrection control already passed. ID derivation traces to
  `3fcee5cb1`; the pending-owned listener and immediate acknowledgement trace
  to `b48e0fa88`. These are source provenance, not a historical packaged bisect.
- Focused repaired tests: tracking/drawing/style helpers 32 pass; coverage 19
  pass; navigation 5 pass. Existing tracking test expected a redundant setter
  call; its first repaired run failed and was corrected to inspect actual
  current filter state. No behavior assertion was removed.
- Navigation browser attempt 1 failed because the test's Close locator matched
  both backdrop and button. Narrowed to the exact Close button. This is a test
  harness failure, not evidence that navigation passed or failed.

Browser attempts 2/3 also failed: delaying a style URL kept the old style usable,
so the target correctly attached there and expired before the delayed response.
The corrected fixture removes the old style first; attempt 4 passes. These
failures are retained rather than counted as application regressions.

The synthetic Chromium idle control passes with **0 writes / 0 render events**
over 350 ms, both quietly and following an explicit idle event. Reverting only
the tracking setter calls in the served browser module gives **24 writes /
43 render events** in the quiet window and fails the same assertion. Real
hide/show changes still update rendered features; a basemap replacement restores
tracking layers and rendering. This is redraw causality, not GPU/frame latency
or strict `<200 ms` qualification.

The actual converter UI submits two targets during an unavailable style held
for 8.2 seconds. On release, `queryRenderedFeatures` proves the latest target's
coordinates and projection within three pixels of the map centre. After expiry,
a new action renders at the new target. Both screenshots were inspected by the
owner: red ring and white-bordered red dot are visible at map centre on a
synthetic background. No licensed imagery is used. Navigation attempt 4 passes
in 22.4 seconds. The final affected unit/integration run passes 11 files / 77 tests.

Local red/green logs are retained under `tmp/train-c/`; current independent
review dispositions follow. Final source/build pass; exact-head CI remains pending.

## Independent review dispositions

1. **Accepted, stale basemap camera restore:** reviewer traced the production
   helper's delayed `jumpTo(oldSnapshot)` overwriting newer Go To. Owner reproduced
   a failing hook/helper integration and real rendered browser test: target
   neither centred nor rendered after the stale restore. Cancellable per-map
   restoration tokens now guard callbacks; Go To cancels the older restoration
   before moving. Overlapping styles also supersede earlier tokens. Helper and
   hook tests pass 8 cases; official-map smoke-library compatibility passes 27.
   Final rendered recheck passes. The initial full source run was
   interrupted for this accepted correction and is **not** a green source cycle.
2. **Accepted, drawing mock:** setter now persists the filter into the layer
   read by the getter. An explicit repeated-drawing-sync assertion passes; the
   full affected drawing suite is 7/7.
3. **Addressed evidence breadth:** five existing Chromium flows pass for marker
   creation, drawing creation, GPX map/panel/review projection, helicopter
   visibility, and coverage reattachment after basemap replacement. This adds
   real browser compatibility evidence across the changed overlay families,
   without claiming every possible interleaving was exercised.
4. **Accepted, fixture assertions:** browser evidence reviewer requested a
   rendered-target assertion both before and after the held restoration, plus
   explicit `isStyleLoaded=false` / zero layers before delayed-style navigation.
   Both assertions are added; the two affected browser tests pass in 27.5 seconds.
5. **Independent final production recheck:** a separate reviewer who authored
   no production changes reports no concrete defect in the current getter,
   overlay, request-lifetime or camera-token scope. This is a same-run Codex
   independent review, not external approval. Exact-commit attestation and CI
   remain pending.

## Verification boundaries

Browser receipts and synthetic screenshots are retained under
[`docs/evidence/repair-train-c/`](../../evidence/repair-train-c/).
The three Train C flows run in ordinary CI on isolated port 1435 and are uploaded
with traces/screenshots. The baseline substitution is an intentionally failing
local causal check; its failure excerpt is retained in the repository.
No local packaged rebuild was selected: this change affects shared renderer
logic, while ordinary CI retains its existing native/package/AppImage and
official-map smoke checks. Those checks must finish before PR readiness.

## Stable local closeout

- `npm run test:correctness -- --no-file-parallelism`: **471 files / 4,970
  passed / six existing qualification skips**, 516.46 seconds, exit 0.
- `npm run lint`: pass. `npm run build`: TypeScript, production Vite build
  and bundle-size budgets pass. Only generated version metadata changed during
  build; restored that file to its committed input afterward.
- `actionlint -shellcheck='' .github/workflows/electron-linux-validation.yml`:
  pass; workflow syntax checked, external ShellCheck not run. `git diff --check`
  passes. Retained text evidence normalizes terminal ANSI/whitespace only;
  original logs remain under `tmp/train-c`.
- Three Train C browser cases pass, with the two later strengthened navigation
  cases rechecked 2/2; five affected overlay flows pass. Synthetic rendered
  screenshots inspected. Source and browser evidence reviews have no remaining
  actionable findings.
- `origin/master` refreshed at `cda87aa0`; branch already contains it. No local
  native build/smoke, strict responsiveness, distribution or field qualification
  was run. Existing ordinary packaged CI remains required before readiness.

## Escape analysis

Earlier overlay tests asserted emitted setters, without checking that equal
values leave a real renderer idle. Earlier Go To browser coverage checked the
target indicator in the DOM, not the rendered target after expiry or style
loading. New regressions exercise these missing boundaries. No field report,
platform regression window or last-known-good packaged artifact is established
by this audit repair.
