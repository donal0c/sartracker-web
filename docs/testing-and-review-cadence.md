# Testing and review cadence

Current working approach, recorded at Donal's request on 2026-09-09 after PR6
closeout. Use for new work alongside `CLAUDE.md`, the active issue and the
[two-track workplan](two-track-execution-workplan.md). This replaces the old PR6
one-attempt/stop-and-ask recovery sequencing as the default cadence. It does not
change domain rules, safety thresholds or the beta publication gates.

## Merge and release timing gates (Donal, 2026-09-11)

Ordinary PR CI runs `npm run test:correctness -- --no-file-parallelism`.
Mixed fixtures still execute their workloads and correctness assertions; only
real wall-clock responsiveness assertions belong to the explicit qualification
mode. Six named real-clock probe cases that enforce timing internally are
visibly excluded from correctness mode; their deterministic and error controls
remain active. A green correctness run is not timing qualification.

`npm run test:responsiveness` runs the same affected workloads and unchanged
strict `<200 ms` assertions, serially. `npm test` remains the complete strict
suite. Missing or unknown test mode fails closed. `beta:verify` and the tag-driven
Electron release workflow require the named responsiveness step. The manual
Linux validation workflow additionally runs the unchanged strict 960k replay,
packaged tracking and archive-lifecycle qualification; ordinary PR CI retains package,
native-module and AppImage launch/shutdown correctness checks. The guarded
release matrix requires `Strict responsiveness (<200 ms)` evidence and defaults
to HOLD.

The retained threshold is **200 ms, not 20 ms**. PR22 may merge with all prior
timing failures retained after ordinary exact-head CI/reviews. Release remains
**HOLD** until the high-priority responsiveness repairs and qualification pass.
Do not infer release qualification from PR merge or resume performance diagnosis
merely to make ordinary PR CI green. The ordered follow-on queue is in the
[workplan](two-track-execution-workplan.md#responsiveness-causal-repair--don-254-2026-09-11).

## Choose the checks before changing code

Write a short risk statement: what changes, what must remain true, and which
checks demonstrate that. Reproduce a bug with a failing regression before fixing
it. Test the actual persistence, cancellation, ownership or error boundary rather
than only mocking the happy path. Confirm external-review findings in source;
record fixes, duplicates and deliberate retained behaviour in one ledger.

| Change | Normal verification |
| --- | --- |
| Documentation only, no executable/test/config change | Check facts, links, commands and diff; attest unchanged code/test trees. Reuse their green tests. |
| Pure logic or bounded backend fix | Red/green regression, affected suites, then full source suite, lint and build on the stable change. |
| Renderer/operator workflow | Above plus affected Playwright flows; visual captures/review when rendered presentation matters. |
| SQLite, IPC, workers, credentials, filesystem, restart or native runtime | Above plus the packaged smoke for that boundary and relevant platform CI. Browser mocks alone are insufficient. |
| Scale, long-duration or crash-recovery regression | Same-workload reproduction, causal diagnostics and the affected scale/interruption case; widen when shared behaviour or retained evidence is invalidated. |
| Release to testers | Separate beta verification, exact CI artifact smoke matrix and publication gates in `CLAUDE.md`. |

A small correction does not automatically require every browser scenario, the
multi-GB fixture, all 32 archive interruption cases, all platforms locally, or
another complete review wave. Run those when the changed risk requires them.
New subsystem delivery still needs its agreed coverage; this is not permission
to omit first-time qualification.

## Run from cheap to expensive

1. Inspect current source, issue, existing evidence and environment. Preserve
   unrelated work and original fixtures. Work on disposable copies.
2. Run the failing regression, implement the fix, then run the affected suites.
   Group related fixes before expensive checks. Investigate failures at this
   stage instead of repeatedly rebuilding packages.
3. Once stable, run the full deterministic source suite, lint and production
   build. For this repository, serial source execution avoids unrelated fixture
   contention: `npm run test:correctness -- --no-file-parallelism`.
4. Exercise the changed operator flows and native boundaries. Use the browser
   for shared renderer behaviour; use packaged Electron if it could pass in the
   browser but fail on desktop. Do not run heavyweight suites concurrently on
   the same machine when interpreting performance measurements.
5. Commit/push the verified change through the applicable branch workflow and
   follow normal CI to completion. Inspect failures and downloaded terminal
   evidence; a process exit or green unit suite alone is not packaged proof.
6. Record the result briefly in Linear and the handover, with links to detailed
   evidence. Stop once the agreed checks pass and findings are resolved or
   explicitly dispositioned. Do not manufacture a new review/qualification loop.

Useful commands (select the relevant suite, not every command for every edit):

```sh
npm run test -- tests/unit/<affected>.test.ts --no-file-parallelism
npm run test:correctness -- --no-file-parallelism
npm run lint
npm run build
npx playwright test <affected-specs> --workers=1
npm run visual:review -- --only <captured-test-id>
VITE_SARTRACKER_MISSION_MODEL=1 npm run electron:pack
npm run electron:smoke:archive-lifecycle:ci
```

Use actual repository paths/IDs in the placeholders. Review every newly captured
visual manifest entry; use the normal content cache for unchanged screenshots.
The archive commands are an example for archive work, not a universal smoke.
Run backend tests when that backend is affected or a release gate requires them.

## Handle a failure without restarting everything

Keep the failed run, exact head, workload, platform and measurement. Distinguish
an application defect from a harness defect, an integration-test timeout and an
environment failure. Add bounded diagnostics or a focused reproduction before a
new expensive attempt. Do not rerun blindly until green or claim an unexplained
outlier was fixed.

PR6's final adjustment was three encrypted-fixture tests moving from an accidental
five-second default to their siblings' 60-second integration deadline. Linux
reproduced the timeout and completed those cases in 6.5–6.8 seconds. Cryptographic
settings, workloads and application deadlines did not change. Similarly, the
GPX current-write assertion stayed strictly below 200 ms; CPU and heartbeat
diagnostics were added. Its earlier 353.165 ms rejection remains recorded even
though focused runs and final CI passed.

Do not relax a safety assertion to cure suite contention. A justified fixture
deadline adjustment must preserve the behaviour under test and be documented.
Unresolved reproduced safety failures block completion. An isolated unreplicated
measurement needs transparent investigation and an explicit judgment, not an
invented cause or a blanket claim that all failures are blockers forever.

## Reuse proof honestly

**Pre-merge documentation conflicts (Donal, 2026-09-10):** resolving a handoff,
workplan or other documentation-only conflict must not restart validation.
Check the resolution and diff, confirm executable inputs are unchanged, and
reuse the existing evidence. Do not repeat full tests, lint/build, browser or
packaged smoke, scale runs, or manually dispatched CI merely because a merge
created a new commit or changed its SHA. A conflict itself is not a testing trigger.

Before any expensive repeat, identify the concrete executable change that
invalidates the previous evidence and select only the checks warranted by it.
Executable inputs include application code, dependencies, build/runtime
configuration and test tooling; their changes still require risk-based selection,
not an automatic restart of the whole process. A separately observed failure
may justify targeted diagnosis under the failure policy above, but must not be
attributed to an unrelated documentation merge or used to restart every check.

Record source head/tree, workload and platform for substantial evidence. After a
fix, rerun affected checks; retain unaffected reviews and tests only with a
clear diff showing why they remain applicable. A documentation-only commit does
not invalidate unchanged executable/test evidence. Label the tested ancestor
and later documentation commit separately instead of claiming fresh exact-head
runtime proof or rebuilding solely to update a receipt's commit number.

Packaged tests must bind the tested artifact to its source and validate the final
receipt, including teardown/recovery where relevant. Packaging can update
`src/lib/version.generated.ts`; restore only that run's generated source change
to its committed blob after packaging, without rebuilding, and verify cleanliness.
Never discard unrelated edits to obtain a clean-state claim.

Use existing reviews and targeted rechecks for remediation. Another full review
is warranted when a shared state machine, cross-boundary contract, or repeated
defect invalidates the earlier review assumptions, or Donal requests it. Review
count is not evidence by itself. Merge authority and release acceptance remain
separate decisions.

## Concrete reference

[Complete PR6 ledger](breadcrumb-pr6-complete-review-ledger.md) records the final
fixes and rejected runs. [CI 34324371898](https://github.com/donal0c/sartracker-web/actions/runs/34324371898)
passed 4,137 tests plus Linux packaged checks at `1b1f86ee`; macOS smoke covered
implementation `76ef77c1` and later test/docs-only changes were identified explicitly.
The multi-GB and 32-case interruption results stayed labelled historical.
This is the repeatable pattern: proportionate scope, firm invariants, traceable
evidence and a definite finish.
