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

## Original candidate verification (51acca12)

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

## External deep-review remediation

Donal authorized remediation of [the preserved external review](../team-feedback/sar-4/pr11-deep-review.txt).
The rejected UI candidate is `51acca12030ab5cf5b94733bd21f2bc7921bae45`.
The following supersedes its review-completion claim, while retaining its test
and CI history as ancestor evidence.

| Finding | Verified disposition |
| --- | --- |
| 1. Persisted collapsed layer panel | Reproduced in Playwright with version-0 `panelExpanded:false`. The whole-rail presentation now always renders its tree contents, independently of the legacy preference. Stored node/visibility preferences remain intact. |
| 2. Hidden End Mission decision | Reproduced. Every mission decision/busy state prevents minimization and collapse; protection is lifted to the shell in a layout effect before paint. Escape cancels the visible decision, then Collapse becomes available. |
| 3. Hidden-state latch | Reproduced across Pause/Resume. `useWorkspaceVisibility` limits hiding choices to one uninterrupted mission/protection context. Pause, recovery, governance, errors and mission changes clear the choices rather than mask them. Browser tests cover returning to the same mission after recovery/idle; hook tests cover protected and changed identities. |
| 4. Startup contrast | Confirmed early-return defect. Saved theme applies synchronously before runtime bootstrap/render. Browser tests hold boot or inject a startup failure without ever mounting ThemeToggle; both retain high contrast. |
| 5. Devices layout | Wide-screen forced scrolling reproduced and removed by using the actual 57.5rem column minimum plus 2rem padding. The reported `53.34912, -6.26031` coordinate clipping did not reproduce: explicit value/panel bounds and overflow assertions pass at all four supported sizes. Coordinate formatting is unchanged. |
| 6. Tracking trust severity | Offline uses the explicit alert class. A shared existing critical-warning classifier prevents contradictory online/cache text from showing connected status. Unverified fix times are counted and visible, never green. Pure and Focus browser tests cover these states; the contradictory online/cache state is defensive coverage, not a confirmed producer path. |
| 7. Roster loading error | Confirmed error coupling, but loading is dialog-triggered, not unsolicited startup. Separate roster error/retry state clears on success or a fresh load; lifecycle errors remain untouched. Hook tests cover retry, reopen and preserving a Pause failure. The browser exercises Retry, the loaded identity and usable hide controls afterward. |
| 8. Collapse label | Whole-rail action always says Collapse, independently of the legacy panel preference. |
| Medium: automatic focus | Removed remount autofocus. Only explicit Collapse moves focus to Restore; keyboard Restore returns it to the original control. Safety-state changes do not request that focus move. |
| Medium: painted hidden error | Error and decision protection use layout effects rather than passive effects. |
| Medium: old minimized mission ID | Replaced the persistent ID latch with the context-bound presentation state; same-mission recovery/idle regressions pass. |
| Medium: test-ID CSS | Replaced layout selectors with named production classes, including explicit grid, inspector, sidebar, dock, header and content classes. |
| Medium: generated tone class | Replaced string construction with a static tone-to-class mapping that Tailwind can discover independently. |
| Medium: hover override | Lowered the secondary-text override specificity. The real Helicopter control changes to its intended hover colour in a browser regression. |
| Medium: manual | Added the contents entry and clarified access to hidden actions versus automatic safety restoration. Restore-before-Pause advice was not itself a defect. |
| Medium: vacuous filter check | Added an explicit six-button count before label containment checks. |
| Rendered trail completeness | Retained complete source geometry and added independent rendered-layer hit checks at six known fixture vertices and five segment midpoints after fitting the complete trail. This no longer relies on clipped tile vertex counts or presence alone. |

The escape mechanisms were gaps in transition/upgrade coverage: clean storage,
isolated active/paused states, ready-only theme tests, scroll-before-hit-testing,
status text without severity assertions, and always-successful roster loading.
The new regressions exercise those boundaries. No native, archive, ingestion,
coordinate algorithm, storage schema or safety-threshold changes were needed.

### Remediation verification

- Full serial source suite: **400 files / 4,155 tests passed**, 458.73 seconds.
- Lint and production build/bundle budgets passed. Generated build-ID churn was
  restored to the committed blob; no version change is included.
- **89 affected browser/visual tests passed**, plus the added roster-retry
  browser flow passed separately on the same executable source.
- **27 fresh screenshots passed independent Opus review** at medium severity;
  the focused accessibility reviewer also inspected Devices at four sizes,
  constrained Focus, boot and startup-fault captures. Manual screenshots refreshed.
- Both focused reviewers found no remaining remediation blocker. Exact committed
  head attestations and current CI are recorded on PR #11 and DON-256 before
  handoff; source tests do not stand in for those results.

The earlier `51acca12` Linux CI frame rejection (202.9ms against <200ms) remains
recorded in DON-256 and its PR history. Its single unchanged-head repeat passed
all gates with a bound terminal receipt; its cause remains unconfirmed. This
remediation does not claim to fix that historical measurement or qualify a beta.
