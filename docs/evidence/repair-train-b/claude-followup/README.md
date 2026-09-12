# Claude follow-up verification

The supplied review targets `8865c7a6`. The current branch remains based on
master `f4d1f321`. [Disposition](../../../assurance/findings/repair-train-b-claude-followup.md)
separates confirmed defects, corrected claims and deliberate boundaries.

## Retained controls

- `parser-red.log`: seven real failures for malformed geometry and native late names.
- `reasons-red.log`: seven failures in specific matching parser reason assertions.
- `extensions-negative-control.log`: restoring descendant lookup changes undated
  evidence to partially dated; the mutation was restored immediately.
- `runtime-red.log` and `concurrency-review-red.log` retain the initial runtime
  failures. The latter's page case had a setup error; `page-error-causal-red.log`
  proves the corrected target predicate. `runtime-panel-final.log` passes 38 tests.
- `panel-guards-negative-control.log` fails three rendered action checks when
  request/mission guards are removed; the guards were restored.
- `visual-partial-framing-failed.log` retains the cropped-frame rejection;
  all three final `visual-*.log` reviews pass after widening that capture.

## Proof boundaries

Full ordinary correctness passes 438 files / 4,539 tests, with six explicit
qualification exclusions. Lint, TypeScript project build, production build and
bundle budgets pass. `browser-final.log` passes seven flows. The local unsigned
macOS package receipt passes 75,004 points, failed-source exact custody,
undated late names, End Outing during import, restart equality and clean close.
Its precommit dirty metadata is explicit; source-file and ASAR/dist hashes bind
the executable inputs. Final clean-source Linux evidence lives on the PR run.
Previous-head artifacts cannot prove the changed source. The named
`npm run electron:smoke:gpx-fidelity -- <executable> <output>` command is now
required by ordinary Linux CI against its built package; CI artifacts retain
the screenshot and terminal receipt. No new PNGs are added to source history.

No release qualification is claimed. Strict `<200 ms`, large replay, tracking
soak and archive-lifecycle qualification remain separate under DON-254.
