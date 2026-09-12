# PR19 Claude follow-up — DON-274 / DON-270

The review of `8865c7a6` supersedes its merge-readiness receipt. PR19 returned to
draft on 2026-09-12. This is GPX correctness remediation; release remains HOLD
and the separate responsiveness queue and strict `<200 ms` gates are unchanged.
The [supplied review](../../evidence/repair-train-b/claude-followup/review.txt)
and original failing parser controls are retained alongside this disposition.

## Safety and verification plan

Malformed track geometry must never publish a truncated clean import. Exact
source bytes/digests, immutable revisions, finalized fences and static undated
evidence remain unchanged. Browser batches must attempt each selected file and
publish persisted successes. Refused/stale requests must never say an empty scan
completed. Same-mission reads must not resurrect deleted projections.

Reproduce narrowly before fixing; run affected parser/native/runtime/panel tests,
one stable correctness/lint/build cycle, affected browser flows and the actual
packaged GPX smoke. Final merge readiness requires ordinary exact-head Linux CI
and independent affected reviews. Historical evidence remains historical.

## Disposition

| Finding | Disposition |
| --- | --- |
| 1: silent malformed geometry | Confirmed red in both parsers. Reject the whole source with `namespace_mismatch` or `non_canonical_structure` instead of inventing rejection indices or publishing partial geometry. Native per-file failure retains exact bytes; valid extension subtrees remain opaque vendor data. |
| 2: browser batch abort/partial projection | Per-file failures no longer stop later files or hide prior successes. Browser failure details explicitly do not claim durable retention. Desktop durable failure provenance remains in the worker. |
| 3–5: admission/watch/rescan | Explicit outcomes distinguish refused/stale/failed from empty. Re-selecting a watched folder scans it again. Temporary busy errors clear on settlement; latest-action retry status cannot be overwritten by an older handler. |
| Native late track name | Confirmed red against real SQLite points. Resolve the owning track name at track close. |
| Divergent parser reasons | Seven red assertions confirm divergence. Shared invalid corpus now asserts specific matching reasons. |
| Delete/page publication | Deletion invalidates old projections even across same-mission refresh. Failed/empty imports do not invalidate a pending page. A separate error generation protects newer failures from older successful refreshes; rejected refresh/page reads append rather than erase newer errors. |
| Extension-only timestamp coverage | Added exact static-evidence case. Reinstating descendant scalar lookup makes it fail `undated` → `partially_dated`; mutation restored immediately. |
| Native admission queue | Preserve backend bounded queue. UI serialization/admission policy is distinct; do not change native transaction ordering to cure message bugs. |
| Packaged smoke freshness | Named `electron:smoke:gpx-fidelity` entry point and ordinary CI step use the built package and assert source/ASAR/dist binding; prior manual package evidence remains explicitly local. |
| PNG duplication | Historical evidence is retained; do not rewrite published history. New screenshots belong in CI artifacts, with links/receipts in the repository. |
| Routine refresh failure-banner claim | Scope correction: absent persisted issue listing affects the browser fallback. Electron worker failure rows normally restore the issue banner. The distinct older refresh failure interleaving is tested separately. |
| Worker untested claim in parser subreport | Not current: the shared corpus already ran through native worker/SQLite integration. Extended that existing integration instead of adding a mock-only parser claim. |

Structural source failures have an explicit failed-file record and reason, with
no accepted geometry. They are not represented as an invented rejected point or
segment with made-up source indices. A zero point-rejection count on a clearly
failed source therefore does not mean a clean successful import. The native
regressions assert the failure reason, exact bytes and zero persisted points.

Other parser-subreport notes: XML comments/processing instructions legitimately
do not contribute text; concatenating the surrounding text is XML semantics,
not invented elevation. Saxes still throws immediately on malformed XML, so
the suggested recovering-handler/frame-underflow scenario is not enabled.
Worker/browser metadata identifies different import paths and is not a promise
of byte-identical presentation metadata. The pre-existing namespace-blind
`parsererror` lookup is outside this repair; it can refuse a specially named
vendor payload, but cannot publish corrupted geometry or a clean partial import.

The independent remediation recheck found two further races: directory-enumeration
failure releasing another import's admission, and a rejected old page erasing a
new import error. Both are corrected with held-promise regressions. The first
page-error attempt failed in test setup (`No page`); the retained corrected
`page-error-causal-red.log` proves the actual error-loss predicate before green.
Rendered panel tests also cover latest-action status and mission changes during
picker/directory reads; removing those guards fails all three controls.

## Current verification

Local ordinary correctness passes **438 files / 4,539 tests**, with six explicit
qualification-only skips. Lint, TypeScript project build, production build and
bundle budgets pass. Focused native/parser checks pass 118 tests; runtime/panel
checks pass 38. Seven browser flows and three independent screenshot reviews
pass. The first partial-batch screenshot was cropped; its failed review remains
retained, and the wider frame passes without changing application code.

GitHub review `discussion_r3995959727` identified that the visual project excluded
the GPX spec, despite its locally reviewed captures. Its test-match list now
includes that spec alongside the existing visual directory. The original visual
listing found zero GPX tests; the corrected listing finds seven, all seven pass
under `--project=visual`, and all three screenshot reviews pass. Chromium and
Electron routing are unchanged; running all projects intentionally runs GPX in
both browser projects. The independent broad reviewer cleared this routing fix.

The unsigned local macOS package passes **75,004 retained points**, explicit
malformed-source failure with exact bytes/digest, late track name and undated
extension-only time, End Outing during import, identical evidence after restart
and clean shutdown. [Receipt](../../evidence/repair-train-b/claude-followup/package-receipt.json)
binds the precommit dirty source through file hashes and ASAR/dist equality;
it is not misrepresented as a clean final-head CI artifact. ASAR SHA-256 is
`db928ec16bb0d32717d85d23359bfb117f9faaa54ae99d6f8bcbba10d30d7dda`.

All four independent affected charters are clear after targeted rechecks.
Exact final-head bindings and terminal Linux CI readiness are recorded on
[PR19](https://github.com/donal0c/sartracker-web/pull/19). No merge/release is
performed here; release remains HOLD.

## Linux smoke diagnosis

Run `34691543650` at `61c5f551` passed ordinary correctness, Electron controls,
build, source binding and native package inspection. The new GPX smoke failed
before importing: `outing-label-input` did not appear within 30 seconds after
the mission-start click. AppImage launch was consequently skipped. The original
failure is retained; it is not a GPX fidelity pass or a confirmed application
defect. The same package smoke passed again on macOS. Added failure diagnostics
capture the rendered state, native mission/outings rows and bounded logs without
changing assertions, deadlines or application code. Cause and Linux readiness
remain pending the diagnostic run; PR19 stays draft.
