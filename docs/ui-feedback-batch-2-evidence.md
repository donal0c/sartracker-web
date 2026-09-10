# Team Feedback Batch 2 — verification record

Review candidate on `codex/team-ui-feedback-batch-2`, base
`c51e4b3537c4b026f7079dd40193a894cedcdd9f`. DON-215 owns the Preview
implementation; DON-256 is the team-feedback parent. No merge or release is authorized.

Delivery: [PR #15](https://github.com/donal0c/sartracker-web/pull/15).
The PR checks/body and DON-215 record final-head CI and review attestations after
this local evidence snapshot; this document does not predeclare their outcome.

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

## Hosted rejection retained

Final head `2386e7db6254792952242947f7d9ed2d07291a81` has both focused review
attestations. CI `34398992302` attempts 1 and 2 passed source/lint/build, Linux
packaging, 960k replay and tracking soak, but archive restore continuity failed
at 242 ms (`review_before_cleanup`) and 210 ms (`interrupt_decrypt`). Frames
remained below 111 ms. Both downloaded failure receipts are retained in this
task's `tmp/batch2-ci-failure-evidence` and `tmp/batch2-ci-failure-evidence-attempt2`.
The direct API smoke does not mount the new replay map or request objectDetails;
the domain reviewer independently confirmed no demonstrated extension cause.
Same-head macOS full archive lifecycle passed both launches, interruption recovery,
cleanup and read-only equivalence: maximum current gap 66 ms and frame 18.4 ms.
That is non-reproduction on macOS, not an explanation or waiver of Linux failure.
The final-head geometry-specific package check also passed, frame maximum 32.9 ms,
app.asar SHA-256 `d880cfbfaf075f9be254c16f5f62933c930866587289139e6362c38488c72c70`.
An isolated four-CPU Debian Linux ARM64 run at the same clean head passed the full
4096-row lifecycle, both launches, interruption and cleanup with the CI smoke
flags and a fresh Mesa cache: maximum current gap 173 ms, frame 131.9 ms.
Receipt: `tmp/batch2-linux-source/tmp/linux-head-1/electron-archive-lifecycle-smoke-report.json`.
This is another platform non-reproduction, not hosted x64 or base/head causal proof.
The owned `sar-batch2-linux` container is stopped. No threshold, workload or
release-control change; PR remains draft.

The next bounded investigation should capture source-request cadence, harness
event-loop scheduling and Electron polling timings around restore/decryption on
hosted x64, then compare the same instrumented workload at base and batch head.
Keep diagnostics separate from authoritative timing and retain every rejection.
Any harness/workflow repair is outside the accepted UI/native-detail batch scope
and needs an explicit scope decision before implementation.
# PR15 review remediation — locally verified

The user review supersedes the earlier local all-clear. Remediation is verified
locally and on the new-head Linux run; PR15 remains draft. Earlier hosted x64
archive failures remain unexplained, and the new pass has limited headroom.

- Replay projection now isolates invalid records with per-record limitations and
  retains valid breadcrumbs, last-known positions and objects. Worker bounds,
  empty output and transport error responses have direct tests.
- Loader regressions exercise successful paginated loads, matching/mismatched
  whole-state hashes, split emoji surrogates and genuinely deferred cancellation.
- AUD14 now uses the durable reconciliation frontier in the native coverage claim.
  Recovery wording, pause/idle, deselection and runtime restart do not remove the
  blocker; only advancing the saved checkpoint clears the tested gap. Saved counts
  remain intact. The blocker survives worker-envelope projection.
- Hit-test visibility is required, and hidden-marker proximity prevents duplicate
  creation. Browser LPV-242 passes with overlapping fixture drawings hidden so it
  actually exercises that path. The initial strengthened browser assertion exposed
  those overlapping drawings; they correctly won selection before the empty-map
  protection could be reached.
- Optimistic cascades maintain a projected set instead of rereading a stale store
  snapshot. Tracking category checkboxes expose mixed visibility. Catalog refresh
  no longer publishes an old mission tree under a new mission ID.
- Replay source warnings recover on matching successful source content, not idle
  events or unrelated tile activity. Dead helicopter object-detail allowance is
  removed and the TypeScript input/output types are narrowed.

Local receipts: `/tmp/pr15-review-affected.log` (22 files,175 tests),
`/tmp/pr15-focused-followup.log` (44 tests),
`/tmp/pr15-hidden-marker-browser-isolated.log` (one browser flow).
Final source, browser, packaged verification and review results are recorded below.
Donal approved independent live-Breadcrumbs/Mission-History controls on 2026-09-10.

Focused re-review found a remaining AUD14 blocker: the newest retained fix is
not an independent endpoint. A later failed request can deliver no newer fix,
leaving the saved frontier apparently complete. The current checkpoint-only
implementation is not a complete fix and must not merge.

Donal approved the required schema/write extension on 2026-09-10. Nullable
`requested_from`/`requested_until` columns use the existing idempotent schema-13
additive migration; old checkpoints remain unknown until a real request establishes
their bounds. Request admission persists those bounds before network dispatch.
Failures and cancellation retain the unmet target, including an empty failed response
with no newer fix. Successful intervals advance only contiguous reconciliation;
an earlier prefix conservatively replaces the certified interval until caught up.
Admission-write failures use mission/device/range-owned structured blockers.
Recovery cannot clear a newer failure while waiting for coverage refresh.
These columns are operational checkpoint metadata excluded from archived rows;
archive format/schema version are unchanged. An older binary may structurally open
the additive database but ignores the new completeness semantics, so rollback is
not safety-equivalent. Migration, restart and archived review require separate proof.

Intermediate focused verification: 274 tests across native store, polling, runtime and
coverage regression suites pass (`/tmp/pr15-final-focused.log`). The stopped-runtime
admission regression subsequently exposed a silently skipped persistence operation;
the callback now rejects it and all 80 runtime tests pass
(`/tmp/pr15-stopped-admission-green2.log`). Independent controls and structured
warning recovery passed two browser flows (`/tmp/pr15-history-browser.log`). Final
stable verification was still pending then; these are local synthetic results, not hosted proof.
Packaging/release gate wiring remains deferred under the unchanged scope exclusion:
the packaged geometry script and new E2E specs are not newly added to CI/beta gates.

Final remediation verification (2026-09-10): the stable serial source run passes
409 files / 4,209 tests (`/tmp/pr15-final-stable-source.log`); lint and production
build pass. The preceding run had 4,207 passes and one stale deterministic fixture
hash after the approved additive migration. Its new nullable columns were checked,
the hash updated, and all ten fixture tests passed before the final complete run.
All 31 affected Chromium flows pass (`/tmp/pr15-final-browser.log`).

Packaged macOS target admission/restart proof retains an unmet request without any
new fix. Shutdown correctly adds a later pause boundary: acknowledging only the
earlier request remains incomplete; acknowledging the saved pause boundary clears
the native claim. Receipt: `tmp/pr15-history-packaged-proof/receipt.json`.
Final live/encrypted-archive geometry proof passes five fragments per source with
equal reconstructed state; actual map selection and a single offline warning pass,
frame maximum 50 ms (`tmp/pr15-replay-packaged-final/report.json`). Visual inspection
caught repeated identical tile warnings in the preceding capture; a red/green
regression now deduplicates displayed messages while retaining per-tile recovery.

The packaged CI-profile tracking soak passed both launches, 6/6 batches and all
8,664 expected positions, with zero redundant telemetry slope and main-process
maximum 42.4 ms (`tmp/pr15-tracking-soak/electron-tracking-soak-report.json`). That
receipt predates only the replay warning deduplication and whitespace formatting;
tracking/native behavior is unchanged. These are synthetic local package results,
not exact-head hosted x64 or release proof. The cause of the earlier hosted archive
failures remains unresolved and the 200 ms gate is unchanged.

New-head hosted closeout: runtime commit `42f9f30577040c2cfab943d6897cfe2082b8b9e8`
passed [Linux CI 34447132522](https://github.com/donal0c/sartracker-web/actions/runs/34447132522)
on its first run. Source/lint/build, Linux packaging, normal 960k replay, native
inspection, Mesa attestation, tracking, archive lifecycle, terminal evidence and
AppImage launch all passed. The downloaded validation artifact is retained under
`tmp/pr15-ci-42f9f305`. `validateArchiveLifecycleSmokeEvidence` independently returns
valid/passed with no failure reasons; source binding and receipt both match clean
head `42f9f305` and tree `691e3873d82b8cd3847c492d728ddae0dffe19bf`.
Packaged app.asar SHA256: `77b01cce3a48115ecbe64c5556633c1e4e51b9da2e4ea507dfa3ef505d13b025`.
Archive phase current-fix maxima: create 158 ms, verify 143 ms, restore 169 ms,
cleanup 192 ms. Frame maximum 93.1 ms. The unchanged 200 ms gate passes, but the
8 ms current-fix headroom is narrow. This is a new-head pass, not a causal fix or
explanation for the preceding head's 242/210 ms failures. No unchanged-head rerun
was made. PR remains draft, with no merge/release/field acceptance claimed.
The final documentation-only closeout reuses the verified executable/test/workflow
tree; it does not claim a new packaged or hosted run.

The operator recheck also found stale metadata-read rejection and mixed tile
recovery cases. Three additional red/green regressions now cover them (13 tests
passed in `/tmp/pr15-reviewer-followup-green.log`). Basemap warnings are keyed to
the failing tile; stale rejected reads cannot publish into a replacement mission.

Earlier remediation checkpoint: lint and build pass; 25 Mission Review/visibility browser
flows pass (`/tmp/pr15-review-browser.log`), plus explicit mixed-checkbox assertions
(`/tmp/pr15-mixed-browser.log`). Inspected capture: `tmp/pr15-remediation-visibility.png`.
The full source attempt recorded 4,199 passes and two failures across 408 files.
Both failing suites subsequently pass in focused checks: participant admission
backfill alone cannot attest the tracking-history frontier; protocol capture could
not hash a deleted tracked legacy test file. That file now tests durable paused/
finished-window warnings. Receipts: `/tmp/pr15-source-failures-focused.log`
(participant passes; protocol still failed there), then `/tmp/pr15-protocol-recheck.log`
(32 tests pass). At that checkpoint, further AUD14 changes, a stable full run and
packaged remediation proof were still required. The final results above supersede it.
