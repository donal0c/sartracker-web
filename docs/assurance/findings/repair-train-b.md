# Repair Train B — GPX evidence fidelity and lifecycle

**Current:** Claude follow-up supersedes the readiness below. See the
[disposition and current verification](repair-train-b-claude-followup.md).

## Reconciliation on current master — 2026-09-12

Base: `f4d1f3214ddc82b0df043c85a340b3872ba90a80`, containing merged PRs
#22/#20/#21. Existing PR19 branch is rebased; master foreground-write priority,
native custody fences and correctness/strict-timing routing are retained.
This earlier reconciliation added no CI machinery. Earlier receipts below remain historical
and are not relabelled as this integrated package or exact-head review.

One additional AUD-05 interleaving reproduced: an older outing refresh failing
after an import failure erased the settled import error. The runtime now keeps
both errors visible; the focused regression fails before the correction.
Source bytes/digests, canonical coordinates/times, revisions, outings and
worker transactions are unchanged by this correction.

Current validation is in the [reconciliation receipt](../../evidence/repair-train-b/reconciliation/README.md):
138 focused tests; 437 files / 4,515 correctness tests with six qualification
skips; lint/build/budgets; six browser flows and fresh rendered review; native
75,002-point import/End Outing/restart and source/hash equality. Four independent
source charters are clear. Exact final-head review/CI bindings and readiness
are recorded in the PR19 terminal comment. PR19 leaves draft only after both
ordinary CI and all four independent charters clear the final head.
Historical CI `34515489481` failed at 544.165 ms and missed a post-restart
Devices click; downstream archive/AppImage checks skipped. The failure is
retained, not fixed by this GPX change. Under merged PR22 policy strict timing
is a mandatory pre-release blocker, not an ordinary PR merge blocker.
DON-254 remains open and release remains HOLD. After Donal merges PR19, the
locked queue is bounded 316–550 ms breadcrumb IPC/query transfer repair,
separate ~239 ms legacy recovery repair, then unchanged strict `<200 ms`
qualification. No performance repair, merge, release or field acceptance here.

## Historical implementation and proof — 2026-09-10

Starting source: `302bdd040976bd370271cf5866549fa2a7e05ff5`, fetched
`origin/master` on 2026-09-10; clean fresh worktree, branch `codex/repair-train-b`.
Scope: AUD-01, AUD-10, AUD-05; DON-274 with DON-270 outing boundary.

Implementation commit: `a1cf535f4de5bd81b6aaabd4b4f01cf163b21abc`.
The three source hashes in the package receipt match this commit exactly.
Review remediation: `f4b4875e1657e6dd61b400500872cdfeab4fb68b`; all three
source hashes in `package-review-receipt.json` match that commit exactly.

## Contract and verification plan

Canonical meaning: SAR-QA-004/006/007/013/014/017/019 and the raw transcript.
Only direct GPX ancestry in the document's supported namespace defines track
evidence. Vendor extensions remain in exact retained bytes, never coordinates
or scalar overrides. CDATA and ordinary XML character data are equivalent.
Legacy namespace-free GPX and GPX 1.0/1.1 remain supported. Malformed XML and
ambiguous repeated/nested scalar values must fail visibly. Missing timestamps
remain null; undated evidence is static, explicitly outing-assigned, and excluded
from precise replay. No operator rewriting of canonical tracking evidence.

Import operations belong to a mission generation, not an outing/list refresh.
Same-mission refreshes must settle success/failure honestly; actual mission
switches must fence stale publications, including A→B→A. Persistence schema,
WAL, source hashes, atomic publication/audit and rollback remain unchanged.

First run narrow red/green parser and lifecycle regressions, then affected
native persistence/replay/recovery and renderer-boundary suites, one stable
serial full source/lint/build cycle, affected browser flows and packaged native
GPX smoke. Preserve the strict <200 ms safety assertions. Four independent
review charters apply at the final head. No merge, release, or deployment.

## Historical evidence at the named 2026-09-10 sources

All three claims reproduced before production edits in
`tmp/repair-train-b/red.log`: native extension time 08:00→19:00, elevation
100→999, third point 51,-8; browser third point; native CDATA values lost;
same-mission refresh returns an empty import receipt. Four expected-behavior
assertions fail across three test files. An initial fixture-path test error was
corrected before this product reproduction and is not defect evidence.

Original audit: `output/deep-codebase-audit-2026-09-07/report.md` in the primary
checkout; original audit source `0ca331ff816800e83134142cb109903e5d2c2992`.
Current regressions retrace those claims rather than reusing old-head proof.

| Proof | Result and limits |
| --- | --- |
| [Current-head red](../../evidence/repair-train-b/current-head-red.log) | Four failing expected-behavior assertions before production changes, covering all three audit IDs. |
| [Older refresh red](../../evidence/repair-train-b/refresh-publication-red.log) | Same-mission stale read overwrites completed list; separate publication generation fixes this AUD-05 interleaving. |
| [Focused source](../../evidence/repair-train-b/focused-source.log) | 7 files / 138 tests pass, including real native SQLite and forced-kill recovery; current-write maximum 27.872 ms, unchanged <200 ms gate. |
| [Replay/restart](../../evidence/repair-train-b/replay-restart.log) | Extension and CDATA fixtures retain exact SHA/bytes, alias identity, two canonical coordinates, and source-time replay after reopening SQLite. |
| [Browser](../../evidence/repair-train-b/browser.log) | Five GPX flows pass with the real renderer/browser harness. Mock persistence is not native proof. |
| Schema | `xmllint --noout --schema <original-audit>/evidence/persistence-gpx-official-1.1.xsd tests/fixtures/gpx-extension-fidelity.gpx` validates the retained legal-extension fixture. |
| [Full source](../../evidence/repair-train-b/full-source.log) | 427 files / 4,407 tests pass in 509.22 s; GPX current writes maximum 28.080 ms. Lint and production build/bundle budgets pass. |
| [Rendered check](../../evidence/repair-train-b/browser-visual-review.json) | Opus visual review passes the [settled panel](../../evidence/repair-train-b/browser-settled.png). The initial element-only capture clipped the panel and was replaced with this viewport capture. |

The first packaged smoke stopped after truthful UI settlement because its
case-sensitive `2 shown` assertion did not match rendered `2 SHOWN`. The
[rejected harness receipt](../../evidence/repair-train-b/package-rejected-harness.json)
is retained. The assertion is corrected to case-insensitive matching; the
application archive is unchanged and is not rebuilt for this harness correction.
The second attempt reached SQLite inspection but Playwright's main-process
evaluation rejected dynamic `import()`. The [inspection failure receipt](../../evidence/repair-train-b/package-rejected-inspection.json)
is retained; the harness now obtains `createRequire` through Node's built-in
module accessor. This is a harness evaluation correction, not a parser or
application failure; the same archive is reused.

## Historical independent review remediation

Four independent charters reviewed `1ef5a13f`: broad safety, native persistence,
import concurrency and renderer/input containment. Native persistence was clean
(21 selected tests). Three findings were reproduced before remediation:

| Finding | Disposition |
| --- | --- |
| B-BROAD-01 / B-CONC-01 | Duplicate finding: busy admission rejected outside error publication. Requests now resolve without dispatch and retain an explicit retry notice through active-import settlement and same-mission refresh; mission switch or next admitted import clears it. |
| B-BROAD-02 | Pre-existing adjacent page-read race within the owned publication boundary, fixed here: old success/error page replies cannot replace newer import settlement, and settlement clears page loading. |
| B-RENDER-01 | Validate canonical names even on empty tracks and point scalars before coordinate rejection; browser and native whole-document rejection now agree on both shared regression cases. |

Review regressions recorded [two runtime reds](../../evidence/repair-train-b/review-red.log)
and [two browser-parser reds](../../evidence/repair-train-b/renderer-review-red.log).
[Remediation focused verification](../../evidence/repair-train-b/review-focused-green.log) passes 3 files / 128 tests (74.46 s), including
real native persistence; current writes max 79.761 ms, unchanged <200 ms gate.
All [six GPX browser flows](../../evidence/repair-train-b/review-browser.log) pass.
The initial new notice screenshot clipped the track row; its [visual failure](../../evidence/repair-train-b/review-visual.log)
is retained. A [taller capture](../../evidence/repair-train-b/admission-notice.png)
passes [independent visual review](../../evidence/repair-train-b/admission-visual-review.json).
The first taller-capture attempt overlapped packaging and timed out awaiting a
second import; build-generated source changes can reset the Vite runtime. This
[rejected run](../../evidence/repair-train-b/review-browser-notice.log) is retained;
the [isolated unchanged-source repeat](../../evidence/repair-train-b/review-browser-notice-isolated.log)
passes. This is a test-environment interference explanation, not a claimed application fix.
Lint/build pass. The [rebuilt package receipt](../../evidence/repair-train-b/package-review-receipt.json)
passes the same 75,002-point import/End Outing/restart workload (18,882 ms import
settlement), exact evidence and integrity unchanged after restart. ASAR SHA-256:
`2a6123d44c579816d2ff74cb6a0f3c5355339328c7898e863285f0024934e0df`.
Its raw source hashes bind the reviewed remediation; sourceHead is the precommit
ancestor and sourceDirty is explicit. All four independent charters attest clean
at `f4b4875e1657e6dd61b400500872cdfeab4fb68b`: broad B-BROAD-01/02 and
concurrency B-CONC-01 resolved, renderer B-RENDER-01 resolved, persistence no
findings (21 unchanged native checks carried forward). Remediation rechecks are
targeted source/evidence review, not four repeated package executions.
Linux qualification is tracked in [PR #19 checks](https://github.com/donal0c/sartracker-web/pull/19/checks)
and its final CI evidence comment. The old timing-as-merge-gate rule is
superseded by the current reconciliation policy above.
Superseded run `34514075105` was cancelled after the remediation push; it is
not counted as passing. Earlier full-source proof remains attributed to the original implementation;
the remediation changes two renderer modules and their tests, not native worker,
schema, storage or publication transactions.

## Historical delivery state before reconciliation

Local remediation verification and four exact-head reviews are complete.
[PR #19](https://github.com/donal0c/sartracker-web/pull/19) carries Linux gate
status and terminal evidence. This is a scoped repair, not field acceptance.
WAR-06 remains investigation-only and does not own these repairs.

The [packaged receipt](../../evidence/repair-train-b/package-receipt.json) passes
on unsigned macOS arm64 Electron 40.10.0. Actual UI/IPC/worker/SQLite imports
75,002 points (two fidelity points plus the 75,000-point outing-race workload).
End Outing completes during import; import settles in 18,555 ms, both receipts
are settled, no import issues exist, and integrity is `ok`. Exact source hashes,
CDATA/name/elevation/times and counts remain identical after a clean restart.
The [rendered state](../../evidence/repair-train-b/package-settled.png) shows two
imports and a truthful completed result. Basemap failure is expected because
the synthetic package test blocks network access.

Archive SHA-256:
`0e7f133a687c7458834b1bc60aab49da92faa03dc684ad830f2dd5c643d7927c`.
The precommit package records `sourceDirty: true`, exact changed-source hashes
and equality of every built renderer file to its ASAR entry. Its displayed base
SHA is not claimed as the fix SHA. The generated version file was restored to
its committed blob after packaging, without rebuilding. This is local package
proof, not a CI-built release, Linux/Windows proof, field acceptance, or a full
scale/performance qualification. Existing <200 ms gates remain unchanged.

## Provenance and escape analysis

Source history identifies the mechanisms' introduction: browser descendant
matching in `0539bebad3ace4f435304d7d236a22e7e5e6a6d9`; native local-name
matching and missing CDATA subscription in
`f36759f5f71405ce7e884d5379fc9d2727c69fd2`; outing-triggered GPX refresh in
`c5cb5c2e0c94ceccf5c6bd081c19947de0f5185e`. These are source-history
attributions, not separately qualified historical artifacts. Last-known-good
field build, exporter prevalence and affected distributed artifact hashes are
unknown. The earliest retained executable audit proof is `0ca331ff`.

Existing tests used plain GPX scalar text and ordinary source structure. They
did not compare legal extension collisions through native SQLite/replay, nor
join a pending import to a same-mission outing refresh. The renderer and native
failures differ: browser preserved the original direct scalar values in the
audit fixture but accepted the phantom point. Raw source bytes were never lost;
AUD-05 is a completion/list presentation failure, not proven point loss.

## Adjacent findings and retained boundaries

- **B-ADJ-01 — historical parsed imports:** this repair changes future parsing.
  Same-byte re-import remains idempotent and cannot rewrite a previously stored
  interpretation. Existing affected imports need a separately designed audited
  remediation after inspection of retained original bytes; no automatic rewrite,
  migration, deletion or backdated revision is included. Field prevalence unknown.
- Existing broader map hit-test cost and WAR-06 concerns remain in their original
  audit/WAR ownership; this train does not rename or absorb them.
