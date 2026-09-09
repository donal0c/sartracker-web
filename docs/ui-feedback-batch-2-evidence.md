# Team Feedback Batch 2 — verification record

Review candidate on `codex/team-ui-feedback-batch-2`, base
`c51e4b3537c4b026f7079dd40193a894cedcdd9f`. DON-215 owns the Preview
implementation; DON-256 is the team-feedback parent. No merge or release is authorized.

## Accepted behavior

- Current Location and Breadcrumbs retain independent global defaults and
  per-device exceptions in existing mission catalog metadata. Global actions
  reset that category; new devices inherit its default. Coverage uses the same
  selection for rendering and the selected-history claim; outing omissions remain.
- Replay reconstructs a separate read-only map from selected-time retained
  evidence. Exact dated points, last-known selected-time Traccar positions,
  retained marker symbols and drawing geometry remain distinct from the live map.
  Undated GPX is explicitly excluded from the precise timeline.
- Donal approved the bounded native detail extension on 2026-09-09. Existing
  replay object calls stream at most 16,384 characters per response, retain
  generation/version binding and verify complete reconstruction. No schema,
  archive format, message ceiling, dependencies or release controls changed.

## Central audit additions

Only AUD-07 and AUD-14 were authorized for this batch. The old audit report is
background; current-code red/green tests provide the regression evidence.

**AUD-07:** `map-click-target-resolver.test.ts` failed because a hidden clue
still won fallback selection with zero rendered hits. Fallback candidates now
use the same category, group and individual visibility as rendering. Text-label
dragging also filters hidden drawings. The 15 resolver tests pass. The real
browser LPV-242 control passes: hide the clue, confirm zero rendered hitboxes,
click without reopening its editor, show it and successfully reopen Boot Print.
Saved records are retained. The resolver regression also excludes the hidden
search-area fallback. Breadcrumbs have no nearest stored-feature fallback;
their existing rendered-layer filters remain the map interaction boundary.

**AUD-14:** `coverage-status-panel.test.ts` failed because a delivered saved
snapshot and known history warning still produced “All mission history shown.”
The view now withholds that claim while an existing history/breadcrumb warning
is present and displays the warning. Source arithmetic is unchanged. A joined
real poller + SQLite query + coverage controller + component regression passes:
failed provider history, successful current fix, saved coverage still complete,
unqualified operator claim withheld. Idle configuration and connection-recovered
messages are not misclassified as history failures. The browser failure/recovery
control passes and retains the current-position count.

## Evidence collected so far

- Initial affected browser suite: 25 passed (mission review and visibility).
- Replay-map visual test passed; independent Opus review of `batch-2-replay-map`
  passed at medium-or-higher gating. This capture uses the browser harness and
  explicitly shows its missing historical-object provenance limitation.
- Native replay query/IPC focused tests: 38 passed before subsequent loader guards.
- Native large-geometry encrypted archive integration passes, including byte/hash
  equality across live and archive-backed reads. This is integration evidence,
  not packaged proof.
- Worker cancellation and prematurely terminated geometry each reproduced red;
  their focused tests now pass. Superseded workers settle and terminate.
- Latest focused view/visibility/loader tests: 50 passed; history warning adapter
  and tracking panel: 18 passed. Typecheck and lint passed before final additions.

## Review remediation and final local gates

The focused domain and operator reviews found shared map/table request ownership,
overwritten text/LPB labels, and a hidden-device count implying nonexistent fixes.
Each was repaired with red/green regressions. Map reads now own a separate request
ID; lifecycle exit cancels both owners. Canonical annotations and 25%/50% LPB labels
remain intact. Display-disabled wording describes choices, including no-fix devices.
Both reviewers cleared these findings on targeted source recheck.

Native visual inspection found light text on the white popup. Its computed-color
regression reproduced red; explicit dark text repaired both text and close control,
and the independent repaired-capture review passed. Visual automation then found
counts below the viewport after the map was added. Counts now appear beside map
status; both affected replay screenshots passed the targeted independent recheck.
The other three search-operation screenshots passed without changes.

Packaged macOS public preload proof passes: a 2,000-vertex retained search area
reassembles in five fragments from live SQLite and five from the independently
verified encrypted archive, with identical full state and hash. The actual native
map renders and selects it. Maximum observed animation-frame gap while opening
and populating the review map: 34.6 ms, below the unchanged 200 ms gate. This uses
synthetic evidence and blocked network; it is not a live-provider or field claim.
Runner: `scripts/replay-map-packaged-proof.mjs`; local receipt:
`tmp/batch2-packaged-proof/report.json`. The precommit package's app.asar SHA-256:
`54c7fd89a6cdffe6cc4fd7259e0c5af2d269c483c14f614b3aee5e806ac5cee9`.

Final affected review/coverage/visibility/marker browser suite: 37 passed, including
reload/recovery, new no-position device defaults and new-mission isolation.
Drawing regression suite: 14 passed. Final visibility framing recheck: 1 passed,
with independent visual review clearing both category controls and warning text.
The final stable serial source suite passed all 407 files and 4,179 tests.
Final lint and production build, including bundle budgets, passed.
Exact-head CI and final-SHA review attestations are pending. The first broad source pass had two outdated call-signature
assertions and one concurrently introduced red projection test; all passed focused
rechecks, but that broad run is not counted as a green stable-source gate.
No release or field acceptance is claimed.
