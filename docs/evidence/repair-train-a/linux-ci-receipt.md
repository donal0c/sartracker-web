# Linux CI receipt — Repair Train A

[Run 34478455858](https://github.com/donal0c/sartracker-web/actions/runs/34478455858)
passed all steps on clean application head
`cb929bb876615c2ad8a89f00bc09568752385e6a`, tree
`ddb924d1275e221bd5f9ae6db10bf3876c78d655`. The evidence artifact is
`electron-linux-validation-evidence-cb929bb876615c2ad8a89f00bc09568752385e6a`.
Downloaded receipts were independently inspected locally. Later `5cd9acbe`
changes only the standalone renderer probe/evidence; final closeout changes
only documentation. They are not freshly CI-tested heads. Application, source
tests, dependencies, build and workflow inputs remain identical.

Full source, lint, build, Linux packaging, 960k replay, native SQLite inspection,
Mesa renderer attestation, packaged tracking, archive lifecycle and AppImage
launch all passed. Package source was clean before building; only generated
version metadata changed during building, and the workflow restored it.

Both installer inventories bind ASAR
`9a2c603a377523be3269dbf096c5d72742524cacf54055a91986d07062d14f9e`.
Archive and tracking receipts bind the same executable
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`.
Native SQLite integrity is `ok`, Electron ABI 143, x64. Installer hashes:

- AppImage: `615cbcca12b3c13a7d082f4bb38c1d5172b2c4666533fe74f2076c881f8cc276`
- deb: `92547f35a968e6cb85d0362dd8e13569ac910eff4c8cdbd877463476d3759ef5`

Archive create/verify/restore/cleanup had current-fix maximum **135 ms**, main
watchdog maximum **70.97 ms**, and frame maximum **77.9 ms**. Every phase had
samples and every hard-gated timing was strictly below 200 ms. Both launches
exited; interrupted restore left two temporary entries and restart swept both.
Cleanup moved 5,516 rows with none remaining in live storage. Privacy scans
found zero secret matches and zero terminal plaintext residue.

Tracking preserved the exact expected 8,664 positions, passed its restart and
reported no renderer crashes. Its main maximum was 70.39 ms. **Its separate
renderer telemetry reached 466.7 ms with five samples over 250 ms**, and external
operator-action maximum was 204.68 ms (internal action maximum 173.2 ms).
The existing soak gates renderer/action freezes at 1,000 ms; a green soak is
therefore not an all-renderer-below-200-ms result. Those observations remain
unexplained qualification evidence under DON-254, not a relaxed Train A gate.
The separate real 100×5,000 incremental Train A measurement passes at 82.4 ms
(prior conservative run 98.8 ms); neither proves cold-load or field performance.

The 960k replay receipt passes its gates with event-loop maximum 70.37 ms.
The actual AppImage launch screenshot was inspected: rendered map, ready/idle
mission shell and explicit unconfigured tracking; no startup fault dialog.

Downloaded raw receipt SHA-256 values, retained locally in
`tmp/train-a-ci-evidence` and available in the CI artifact:

| Receipt | SHA-256 |
| --- | --- |
| source-binding.json | `a3053bdcd6b96fc8537ea6e762a7930ebd4c0ce0345e46f4b591ffe75f1dfd62` |
| package-safety.json | `63b2822895bce5a8dd3a7f913c75bd10a1f1f228fefacdc0f3f4f30cb0b7cae6` |
| electron-archive-lifecycle-smoke-report.json | `886c949e3978f9aa101fa73210c6e41ae8be87f7063aeb15e3ec64bcb4a013f1` |
| electron-tracking-soak-report.json | `781bd7fab53a8e8307b5b8fcc8394153ee8d4ddcaef1596095721438624a24b3` |
| bcp-960k.json | `885f633ef3beb7eeace7e8251997dffcc08806e0c3eb68c3a39311a41ad2c53f` |

No release, field acceptance or whole-hazard closure follows from this receipt.
