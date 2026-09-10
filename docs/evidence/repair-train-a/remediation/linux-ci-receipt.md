# Linux remediation receipt

[Run 34492149684](https://github.com/donal0c/sartracker-web/actions/runs/34492149684)
passed every normal step on clean head `ac368fd2d68fd088cb80cb69b0d63c4079c75cc3`,
tree `0e4e6dc557a7640e487206e132d88e28276df409`. Downloaded artifact:
`electron-linux-validation-evidence-ac368fd2d68fd088cb80cb69b0d63c4079c75cc3`.
Root and the independent final reviewer inspected the source/package/archive
bindings and timing evidence. Later closeout changes are documentation only;
this is the CI-tested executable head, not a claim of a new test on a docs SHA.

The combined suite passes **426 files / 4,374 tests**, followed by build/bundle
budgets, Electron packaging, 960k replay, native SQLite inspection, Mesa
attestation, tracking soak, archive lifecycle, terminal evidence and AppImage
launch/graceful close. No step was skipped. The actual launch screenshot shows
a rendered map and ready/idle mission shell with explicit unconfigured tracking.

AppImage, deb and unpacked inventories all bind ASAR
`a4227f99dfc54c62ec1ddb92ab4fd0ba58b9ef4c2830f91ca917d4420b974eee`.
Archive/soak executable SHA is
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`.
SQLite integrity is `ok`, Electron ABI 143, x64. Installer hashes:

- AppImage: `5a458dded239cc2ebb1f4cc2296185fa460644775e457115e7382fbfca510374`
- deb: `76da772b194a3739c06b62d9307ef076270261fa8af9680bdf9d75d4db929eff`

All archive phases contain samples and satisfy strict **<200 ms**:
current-fix maximum **166 ms**, main watchdog **87.14 ms**, frames **69.5 ms**.
Both launches exited. Interrupted restore residue was swept on restart;
cleanup moved 5,516 rows with none remaining live. Privacy checks found zero
secret matches and zero terminal plaintext residue. Replay event-loop maximum
was **38.25 ms**.

The soak retained exactly **8,664 positions**, passed restart and graceful
shutdown, and reported no renderer crashes. Main maximum was **47.32 ms**;
external action maximum **181.97 ms** (internal **95.1 ms**). However, renderer
telemetry reached **416.7 ms**, with **seven samples above 250 ms**. The existing
soak freeze gate is 1,000 ms, so this pass is not a universal sub-200 claim.
DON-254 retains this observation alongside the older 466.7/204.68 ms run; no
causal improvement is inferred. Cold hydration and field qualification remain
outside the separate local 78.5 ms incremental renderer proof.

[Parsed inspection](linux-ci-inspection.json) retains the checked measurements
and raw receipt hashes. Raw files remain in the CI artifact and local
`tmp/train-a-remediation-ci-evidence`:

| Receipt | SHA-256 |
| --- | --- |
| source-binding.json | `eb917b3c61878e66df227dfeb4a5e8e7109c49965d7dc16c9b44467296da354e` |
| package-safety.json | `641bff131ee74689b1d16a0c2686abc16fda06c63a0bf1786ae686b62452f505` |
| electron-archive-lifecycle-smoke-report.json | `c30656149d5d9d488f1682b24d0670b6181c413dd70ff2f5687c899db81fdb8e` |
| electron-tracking-soak-report.json | `fecef2b715ca9aeff7610e2eac05acb119e8f3e0d3c4b353ce993c81e5c2f176` |
| bcp-960k.json | `cd026b7cf5ab00c7a1ce04bf3007d7f7b4bb75515e3990122a8bbeea1d5cf1d3` |

The temporary inspection helper initially assumed two inventory entries and
only object-valued responsiveness fields; this receipt includes unpacked as a
third inventory and a boolean desktop-throttling field. Those parsing
assumptions were corrected; all three ASARs agree. No safety gate was changed.
GitHub also emitted an Actions Node-runtime deprecation annotation; it did not
fail a step and no workflow/runtime change was included in this repair.

No release, field acceptance or whole-hazard closure follows from this receipt.
