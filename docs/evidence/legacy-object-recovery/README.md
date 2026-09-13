# Legacy recovery evidence

`manifest.json` recursively binds every file in this directory except itself.
Check it with `node scripts/verify-legacy-recovery-evidence.mjs`; regenerate only
after intentional evidence updates with `--write`. CI checks it before running.

- Root baseline/observer logs are historical. `baseline-binding.json` identifies
  the original source; `final-source-binding.json` identifies implementation
  `09710eba`, whose inspector files were intentionally removed later.
- `claude-remediation/` records implementation `c93b6925`, including its actual
  native custody probe and controlled rejections. `baseHead` is its development
  parent; `implementationHead` is the commit against which hashes verify.
- `review-followup/` records the later provenance, real-store audit contract,
  GPX observer and report-gate follow-up. Its inputs are content-hashed; the
  final PR receipt binds the committed head and exact CI artifact without a
  self-referential commit hash embedded in its own source tree.

Do not compare historical input hashes with today's checkout or relabel old
measurements as current. The original 239.509 ms cause and the concurrent
204.046 ms SQLite read remain unresolved; operator-read and release qualification
are separate. Current disposition: `docs/assurance/findings/legacy-recovery-review-followup.md`.
