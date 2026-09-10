# Repair Train B — GPX evidence fidelity and lifecycle

Starting source: `302bdd040976bd370271cf5866549fa2a7e05ff5`, fetched
`origin/master` on 2026-09-10; clean fresh worktree, branch `codex/repair-train-b`.
Scope: AUD-01, AUD-10, AUD-05; DON-274 with DON-270 outing boundary.

Implementation commit: `a1cf535f4de5bd81b6aaabd4b4f01cf163b21abc`.
The three source hashes in the package receipt match this commit exactly.

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

## Current evidence

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

## Disposition

Local implementation and verification complete; independent reviews and Linux
CI remain pending. No closure or field acceptance.
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
