# PR19 current-master reconciliation proof

Base `f4d1f3214ddc82b0df043c85a340b3872ba90a80`; old PR19
`769669baf5d47ee9aa157c90746f6e406778d554`. Final exact-head review/CI
bindings and readiness are recorded on [PR19](https://github.com/donal0c/sartracker-web/pull/19).

The rebased production delta preserves master foreground-write priority and
all custody/timing gates. It adds only the original GPX fidelity/runtime fixes
and the red-first late-refresh error-retention correction. Original receipts
one directory above remain historical. No CI/test mode machinery was added.

| Proof tier | Result |
| --- | --- |
| Red/green | `refresh-error-red.log` reproduces lost import failure; `focused.log`: 138 passed across parser/runtime/native/worker suites |
| Full ordinary correctness | `full-correctness.log`: 437 files, 4,515 passed, six explicit qualification-only skips; 465.80 seconds |
| Lint/build | `lint.log` and `build.log` pass; bundle budgets pass |
| Browser | `browser.log`: all six GPX flows pass, including exact geometry, End Outing during import, retry notice, recovered failure provenance and pagination |
| Rendered browser | Both fresh screenshot reviews pass; adjacent PNG and `.review.json` files retain the evidence |
| Local package | `package-receipt.json`: unsigned macOS arm64, synthetic network-blocked profile; 75,002 points, two settled receipts, zero issues, integrity OK and exact before/after restart equality |
| Source/package binding | `package-source-binding.json` matches all 159 Electron/shared source files to ASAR; package receipt also matches every built renderer asset |

Package ASAR SHA-256:
`bb0d077132832728972e5cd8b01433872c751d7b1a55ab999a12d28ff1fcaf36`.
Import settlement was 20,932 ms (observational total import duration, not a
responsiveness gate). The screenshot shows completed import controls and two
imports; basemap degradation is expected because this synthetic smoke blocks
network access. This does not prove field basemap availability.

The package was built before the final commit: its version metadata names
`b307c45d`, and `sourceDirty` is true. The raw source hashes bind the corrected
worker/runtime and renderer build; the final PR receipt verifies them against
the committed source. It is not claimed as a clean-build or CI-built artifact.
Generated version metadata was restored after packaging without rebuilding.

Independent review charters use separate contexts in task
`01a09502-e0eb-77d2-939c-284b40f8e987`: `/root/review_broad`,
`/root/review_native`, `/root/review_concurrency`, `/root/review_renderer`.
All returned no introduced P1/P2 on the accumulated source delta. Their final
SHA/base/scope/verdict rebindings are in the PR terminal review receipt; these
are independent source reviews, not GitHub account approvals.

Release remains HOLD. Six strict source cases, strict replay/packaged timing
qualification and field acceptance are not passed by ordinary correctness CI.
Historical 544.165 ms PR19 rejection and every other retained timing failure
remain DON-254 evidence. The separate 316–550 ms IPC/query-transfer and ~239 ms
legacy recovery repairs are not implemented here. No merge, release or deployment.
