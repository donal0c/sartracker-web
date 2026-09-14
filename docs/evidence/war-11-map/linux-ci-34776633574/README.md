# Linux CI 34776633574 — FAILED

[The run](https://github.com/donal0c/sartracker-web/actions/runs/34776633574)
tested source `bfc37b747e69267ca48d32b16c9cb48815aaa537` on Linux x64.
Full correctness, bounded property/mutation, controlled rebreak, attribution,
web build/budgets, WAR-06 rendered checks, Linux packaging, SQLite inspection
and llvmpipe attestation passed. The new packaged map smoke failed; later
packaged gates were skipped. Strict responsiveness and 960k release qualification
were not run.

[The failure screenshot](workflow-failure.png) shows the repaired no-coverage
hatch. The captured map had the correct loaded official source and llvmpipe
renderer, but was at the default camera zoom 12. The synthetic fixture has tiles
at z12 and the smoke requested camera zoom 11. All 289 sampled pixels were the
hatch background color. The unchanged 10-second evidence deadline expired.
Electron exited 0/signal null without teardown escalation.

Production preserves the previous camera on a later `styledata` callback after
a style switch. A source-only reproduction using the actual preservation helper
and MapLibre Evented shows that callback can overwrite the smoke's immediate
target jump. A separate local Chromium trace observed the opposite, safe order.
Intermediate event order was not recorded in the failed Linux run, so its exact
chronology remains inferred; the wrong final camera is directly recorded.

[The receipt](receipt.json) preserves the run, artifact IDs/digests, failure hash,
camera/source/GPU evidence, exit and limitations. [Source binding](source-binding.json)
comes byte-for-byte from the CI evidence artifact. The evidence ZIP digest was
verified after download; the larger installer ZIP was not downloaded locally.
Its digest and the package ASAR hashes are reported CI custody evidence.

There were 40 blocked-resource console messages whose request URLs were not
retained, plus the source-attributed file:///sw.js error/warning. None is
allowlisted; the run is not diagnostically clean. This failure is distinct from
the earlier macOS attempt and does not change that attempt's result.
