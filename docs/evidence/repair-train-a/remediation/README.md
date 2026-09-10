# External-review remediation evidence

These receipts replace prior-head proof for the changed Train A application.
[Disposition](../../../assurance/findings/repair-train-a-remediation.md) records
all accepted and rejected review claims and the escape analysis.

- `source.log`: 417 files / 4,299 tests before accepted WAR-02A integration.
- `lint.log`, `package.log`: lint and production build/package checks.
- `browser.log`, `stationary-noise-acknowledged.png`: three browser flows,
  including exact 180-minute duration and acknowledgement after noise-return.
- `renderer.json`: five incremental 100×5,000 samples, both clocks and
  post-operation callbacks; maximum 78.5 ms, strict <200 ms.
- `packaged-warning.json` and packaged screenshots: actual unsigned macOS
  Electron/SQLite reconnect with a synthetic loopback provider. Replacement
  publishes before held old response release; old evidence persists, selected
  warning remains and later polls continue.
- `local-source-binding.json`: ASAR SHA-256 and 26 source/test/probe git blobs,
  verified against committed application `ac368fd2`. The package was built
  precommit and its displayed parent SHA is not its complete source identity.
- Red logs retain the specific failure before repair; `custody-green.log`
  records the focused runtime/custody regressions after repair.

The accepted upstream integration changes no application/package inputs; it
adds test infrastructure and TypeScript build inclusion. New Linux CI validates
that integrated source independently. Raw synthetic profiles and longer logs
remain local under `output/repair-train-a` and `/tmp/train-a-*`; profiles are
not committed. No operational profile was used.

Cold hydration, field acceptance, release qualification and universal sub-200 ms
responsiveness are not established by these receipts.
