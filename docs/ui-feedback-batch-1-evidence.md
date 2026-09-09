# First Sar_4 UI batch — DON-256

Base: `3cdf555de93459c83198121b31053ff1d53db74e` (`origin/master`, fetched
2026-09-09). Scope and risk contract were recorded in the canonical workplan
and DON-256 before production changes. Source feedback is retained as the
[original ODT and transcript](../team-feedback/sar-4/extracted.md); all ten
embedded images were inspected. SAR-QA-002/008 preserve current-position priority.
The document's other feedback is context, not additional implementation scope.

## Disposition

| Item | Result and acceptance boundary |
| --- | --- |
| 1. Focus tracking health | Persistent text/icon connection status, stale count and last success outside every tab and the collapsible rail. Online means connected feed, not a promise that every position is fresh. Paused/recovery remain explicit. |
| 2. Devices Zoom | Narrower inspector, explicit keyboard-accessible horizontal list scrolling and separate inspector scrolling. Four-size pointer hit-test and screenshot checks cover Zoom and labels. |
| 3. Focus mission minimization | Full card disappears visually; its controller remains mounted so a pending action failure is not discarded. |
| 4. Compact mission | Top strip retains name, phase, active-search clock, Review and Restore. Errors restore controls; paused/recovery/archive governance controls remain expanded. |
| 5. Compact mast | Smaller brand block and 80px minimum mast; minimization no longer adds an extra row inside its mission cell. |
| 6. Whole rail collapse | Full width returns to map; keyboard Restore preserves tab/filter state. Collapse does not change visibility. Safety/governance states disable collapse with an explanation. |
| 7. Coordinates/scale | Existing separate placement verified at all four supported sizes; no positioning-code churn. |
| 8. Map Tools | Existing event containment verified with real header/chevron clicks and preserved Maps behavior. No marker-tool production change. |
| 9. Text labels | Existing rendered long-label drag works and its moved coordinates survive reload/recovery; only regression coverage extended. |
| 10. Readability | Secondary semantic text tokens and muted utility text brightened, visible keyboard outlines retained, meaningful disabled presentation in contrast mode. |
| 11. Theme | Device-local Standard/High contrast control, persisted preference, explicit save-failure message. No mission/settings schema change. |
| 12. Responsive layout | Deliberate sidebar/modal/list scrolling at 1280x720, 1366x768, 1440x900 and 1920x1080; paused dock exemption preserved. |

## Regression and review ledger

- Initial browser regressions failed on Focus resurrecting a minimized card,
  Layer Collapse retaining the rail, and missing theme control. The first two
  now pass through real interactions; theme reload and failed-write tests pass.
- Independent visual review rejected an over-broad `.sar-sidebar` width rule
  that narrowed modal workspaces and overlapped Devices filter labels. Restricted
  it to the two actual sidebars; added filter-label containment assertions.
- Existing sparse-trail browser assertion failed reproducibly after viewport
  height changed. It counted vertices returned from loaded/clipped vector tiles.
  The corrected check retains rendered-line presence and separately checks the
  complete GeoJSON source for six-point continuity; no tracking code changed.
- Operator-safety review found hidden action failures, lost deferred Pause
  rejection after unmount, and hidden idle governance recovery. Red browser
  regressions reproduced them. A shared, stable OperationalSidebar now owns
  MissionControlPanel; late errors restore it and block collapse. Governance,
  paused and recovery states remain expanded.
- Accessibility review requested programmatic workspace selection. Shared
  buttons now expose `aria-pressed`; keyboard Enter selection is tested.
- Both targeted rechecks identified the extracted dock's missing paused-height
  exemption. Restored the exemption for both modes, with a 1280x720 alarm/Resume
  viewport regression. No additional review wave was requested.

## Verification record

Final post-review serial source gate: **398 files / 4,143 tests passed**
(476.86 seconds). Lint and production build/bundle budgets passed.
The final stable mission and UI acceptance run passed **27/27** tests. The
unchanged Devices, drawings, Focus and visual checks passed in the preceding
affected run. All **23 screenshots** passed independent Opus review, including
the stricter medium-severity gate. Manual images use these final captures.

Both focused reviewers confirmed all their findings resolved in the final
executable tree. Exact committed-head attestations and normal CI are tracked
on the batch PR and DON-256 so the repository does not claim CI before it runs.

Verification diagnostics: an earlier archive protocol self-test failed because
its Git workspace snapshot read the old, unstaged sidebar filename (confirmed
ENOENT). Staging the rename resolved the unchanged self-test; the full rerun
above passed. An earlier custody-dialog browser assertion timed out during a
run that overlapped edits; the complete stable mission rerun passed. A separate
overlapping browser invocation lost its shared Vite server; it was discarded
and rerun serially. No archive implementation or safety threshold was changed.

Commands: `npm run test -- --no-file-parallelism`, `npm run lint`, `npm run build`,
affected Playwright specs (UI batch, Devices, mission, Focus, drawings and
mission/responsive visual specs), and `npm run visual:review -- --fail-on medium`.
Visual captures are browser exercises, including unavailable/loading tiles.

## Limits and deferred work

No database, mission/archive schema, ingestion, native transport, packaging or
release code changed. This is shared-renderer engineering proof, not a beta,
live Traccar test, field acceptance, platform qualification or operational safety
claim. The PR does not merge/deploy/publish anything. Donal owns merge.

Other Sar_4 requests remain outside this batch: mapping/providers and grid,
per-person breadcrumb display semantics, search-area label placement, mission
renaming, privileged settings, preview scope, groups/logbooks/gear, multi-day
domain rules and map sharing. Existing Linear ownership and programme decisions
remain authoritative; no speculative product answers were introduced.
