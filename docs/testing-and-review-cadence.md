# Testing and review cadence

How to choose, run and reuse checks for feature and fix work. This is
development guidance, not a release gate: releases follow
[the release checklist](release-checklist.md). First recorded at Donal's
request on 2026-09-09; rewritten in the 2026-09-28 foundation reset to remove
superseded HOLD and qualification rules.

## Choose the checks before changing code

Write a short risk statement: what changes, what must remain true, and which
checks demonstrate that. Reproduce a bug with a failing regression before fixing
it. Test the actual persistence, cancellation, ownership or error boundary rather
than only mocking the happy path. Confirm external-review findings in source.

| Change | Normal verification |
| --- | --- |
| Documentation only, no executable/test/config change | Check facts, links, commands and diff; confirm code and test trees are unchanged. Reuse their green tests. |
| Pure logic or bounded backend fix | Red/green regression, affected suites, then the full source suite, lint and build on the stable change. |
| Renderer/operator workflow | Above plus affected Playwright flows; visual captures and review when presentation matters. |
| A UI control, label or count removed or renamed | Above plus the **full** Chromium suite (`npm run test:e2e:chromium`) before pushing or tagging: other specs assert on what was removed (the DON-295 retag failed CI on a stale count) [DON-317]. Also search `scripts/` for the old text: packaged probes assert on it and only run in CI (DON-319's "3 shown" failed `electron-gpx-fidelity-smoke`). |
| Mission-store schema or DDL (tables, indexes, triggers, schema version) | Above plus every `tests/unit/electron-archive-*.test.ts` suite: archive custody pins the exact schema version, index/trigger allowlist and tracked tables (DON-322's extra index broke Archive & Lock and only the archive suites caught it). |
| A new or changed `scripts/team-smoke` step | Unit tests for its pure logic, then at least one run against a package (Mac `electron:pack` or the box) before a release relies on it. Browser harnesses cannot see what the packaged app does: on 2 Oct 2026 three new steps first met a package on the release box and all three had tool errors (a stale sidebar tab, a bridge import that bypassed the renderer, a screenshot taken before tiles loaded) [DON-315, DON-319, DON-288]. |
| SQLite, IPC, workers, credentials, filesystem, restart or native runtime | Above plus the packaged check for that boundary (a `scripts/team-smoke` check or an `electron:smoke:*` script) and Linux CI. Browser mocks alone are insufficient. |
| Scale, long-duration or crash-recovery regression | Same-workload reproduction, causal diagnostics and the affected scale or interruption case. |
| Release to testers | [The release checklist](release-checklist.md). |

A small correction does not require every browser scenario, the multi-GB
fixtures, all archive interruption cases or another complete review wave. Run
those when the changed risk requires them.

## Run from cheap to expensive

1. Inspect current source, the issue and existing evidence. Preserve unrelated
   work and original fixtures; work on disposable copies.
2. Run the failing regression, implement the fix, then run the affected suites.
   Investigate failures here instead of repeatedly rebuilding packages.
3. Once stable, run the full source suite, lint and production build, one heavy
   process at a time: `npm run test:correctness -- --no-file-parallelism`.
4. Exercise the changed operator flows and native boundaries: the browser for
   shared renderer behaviour, packaged Electron when it could pass in the browser
   but fail on desktop. Do not run heavy suites concurrently when timing matters.
5. Commit and push the verified change and follow CI to completion. Inspect
   failures and the uploaded evidence; a green unit suite is not packaged proof.
6. Record the result briefly in Linear and the handoff, then stop. Do not
   manufacture a new review or qualification loop.

```sh
npm run test -- tests/unit/<affected>.test.ts --no-file-parallelism
npm run test:correctness -- --no-file-parallelism
npm run test:responsiveness              # strict <200 ms timing cases, serial
npm run lint && npm run build
npx playwright test <affected-specs> --workers=1
npm run electron:pack                    # local unpacked package
node scripts/team-smoke/run.mjs --app <unpacked executable> --only <check> --out tmp/smoke
```

`npm run test:correctness` runs every workload and correctness assertion; the
real wall-clock `<200 ms` assertions run under `npm run test:responsiveness`.
`npm test` runs both. The threshold is 200 ms. Run backend (`npm run test:backend`)
only when the legacy Tauri backend changes.

## What CI runs

`.github/workflows/electron-linux-validation.yml` runs on pushes and pull
requests that change code, tests, build configuration or executable evidence:
lint, the correctness suite, WAR-02B property checks and their rebreak proof,
the production build, Chromium Playwright suites, the Linux package, and
packaged checks (native runtime, maps, GPX fidelity, breadcrumb transport,
mission cache, legacy recovery, support-export privacy, the packaged regression
probes, and AppImage launch). A manual dispatch adds strict responsiveness, the
960k replay envelope, the packaged tracking soak and archive lifecycle.
`.github/workflows/electron-release.yml` runs on `electron-v*` tags and builds
the draft release.

## Visual review

`tests/e2e/visual/` workflows make ordinary DOM assertions, then capture a
screenshot with a manifest entry (`captureAndRegister()` or
`captureElementAndRegister()`) whose numbered checklist a reviewer model checks
independently. Use it when what the operator sees matters.

```sh
npx playwright test --project=visual           # 1440x900, writes test-results/visual-verification/
npm run visual:review                           # one reviewer call per entry, cached
npm run visual:review -- --only <test-id>       # while iterating on one spec
```

Exit codes: 0 pass, 1 a finding at or above `--fail-on`, 2 reviewer error, 3 no
entries. Every checklist item must be verifiable from the captured frame. Mark
operator-safety items `critical`. The browser harness is `?missionHarness=1`;
inject tracking with `window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot()`.

## Handle a failure without restarting everything

Keep the failed run, exact head, workload, platform and measurement. Distinguish
an application defect from a harness defect, an integration-test timeout and an
environment failure. Add bounded diagnostics or a focused reproduction before a
new expensive attempt. Do not rerun blindly until green, and do not claim an
unexplained outlier was fixed.

Do not relax a safety assertion to cure suite contention. A justified fixture
deadline change must preserve the behaviour under test and be documented.
Reproduced safety failures block completion. An isolated, non-reproducing
measurement gets a transparent judgment, not an invented cause.

## Reuse proof honestly

A documentation-only change, including a merge-conflict resolution in docs,
does not invalidate executable evidence: check the diff, confirm executable
inputs are unchanged, and reuse the results. Before any expensive repeat, name
the executable change that invalidates earlier evidence and select only the
checks it warrants. Label a tested ancestor and a later documentation commit
separately rather than rebuilding to refresh a commit number.

Packaging can update `src/lib/version.generated.ts`; restore only that
generated file after packaging and never discard unrelated edits to get a clean
tree. Another full review is warranted when a shared state machine or
cross-boundary contract changes, a defect repeats, or Donal asks; review count
is not evidence by itself.
