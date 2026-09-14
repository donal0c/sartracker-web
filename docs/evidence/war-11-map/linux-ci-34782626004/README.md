# Linux CI 34782626004 — workflow text contract

[Run](https://github.com/donal0c/sartracker-web/actions/runs/34782626004) at
`9134a353ebb04377818ac96d2e0171cbc6856e18` FAILED the full correctness gate:
455 files passed / one failed; 4,848 tests passed / one failed / six existing
qualification skips (1,042.30s). Browser and packaged checks were not reached.

The CI-only actionlint correction quoted `HEAD^{tree}` but the existing workflow
text-contract assertion still expected the unquoted spelling. The checked Git
reference and workflow semantics did not change. Local reproduction failed that
one assertion with seven controls passing. Updating only that expected literal
to the quoted command passes all eight controls; actionlint and focused lint pass.

Escape analysis: the full local cycle preceded the separately bound CI-only
delta. Actionlint, the exact browser command and focused review covered that
delta, but the existing workflow contract suite was missed. The durable contract
remains enforced; future workflow changes must run their relevant contract tests.
This is not a map runtime failure or a green CI run. No runtime/workflow change
or local Electron launch accompanies the assertion correction. Fresh exact-head
full CI is required. Earlier failure artifacts remain unchanged.

Raw logs are retained byte-for-byte in this directory.
