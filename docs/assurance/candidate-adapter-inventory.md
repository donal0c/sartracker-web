# Beta13 candidate adapter inventory

**Scope:** read-only inventory for DON-254 candidate enablement, refreshed from
`docs/assurance/qualification-campaign-plan.json` and the current scripts/tests.
This file records whether a nominated surface can currently produce an
independently validated contract receipt. A green script exit or an existing
report is not treated as a qualification receipt.

## Current implementation overlay

The original inventory below is retained as the starting-gap record, not current
completion evidence. Source/browser suites, signed C29 ingestion and read-only
C27 draft/C00 public adapters are registered. The plan now names fixed source and
browser inventories rather than broad/stale test commands. Package/runtime
identity, settings, IPC, hostile archive and duplicate-launch producers/validators
exist; producer integration and bounded development calibration are complete,
with stable local correctness checks passed and independent PR review required
before merge readiness. C27 prepublication
and C00 postpublication are separately mandatory under the approved phase rule.
Nothing here qualifies a candidate or implies package execution.

The following integration state supersedes the historical table. A producer
being implemented does not mean it has passed on a future candidate.

| Boundary | Current producer and independent evidence | Remaining boundary |
| --- | --- | --- |
| C00/C27/C29 | Fresh CI/release identities, draft versus public download checks, exact-candidate signatures and named human training ingestion | Future artifacts, safeguards or separately signed REL-004 acceptance, publication decision and actual human session |
| C01/C02/C18 | Startup profile matrix, held I/O and bounded ENOSPC input; public lifecycle interruption and safe refusal; backup fault variants | Held-gate development observed negative product predicates; future Linux fault execution and physical mount remain required |
| C03/C11/C17 | Scoped outing/known-at, 50k search-pass and raw recursive diagnostics probes, with retained ASAR/raw-byte custody | C03/C11 development passed. DON-237 repairs recursive/encoded/compound credential and legacy private/system-path redaction; exact-head packaged Linux run `35537304260` at `d78a0c76a9d1` passed the C17 zero-canary proof. Intentional C17 coverage gaps remain, and no candidate qualification is implied. |
| C04/C24/C25 | Fixed provider faults, earliest source-arrival/current identity, actual cancellation, nine competing operation phases, truth/resource predicates and both package tiers | C24 bounded development completed; missing overlay warning correctly fails; future scale/long-duration execution and product capability holds remain |
| C05/C06/C12/C13/C14 | Canonical ingest, attention, attachment custody, coordinate/UI and map-failure producers | Development mechanics observed; C14 correctly rejects known console-only DON-264 behavior |
| C07/C08/C09/C10 | Independent paging source, GPX custody, replay row streams and 201-outing search | C09 full development interruption passed; future exact candidate and full scale execution required |
| C15/C16/C21/C23/C26 | Map/settings, hostile archive bytes, IPC and duplicate-launch producers | Exact candidate/runtime validation and private map inputs where required |
| C19 | Historical schema fixtures, default-profile 50k migration/kill/restart, large storage and shared startup refusal lanes | DON-249/250/251 product capabilities explicitly block candidate admission; schema6 fixture is synthetic compatibility evidence |
| C20/C22/C28 | Streamed field archive, independent all30-table custody, fixed composite workload/fault families | Small development archive oracle passed; future large/package/cross-machine execution remains unperformed |

The source-controlled product holds in `product-capabilities.mjs` prevent
successful subset receipts from producing a candidate/prepublication PASS.
They do not misclassify missing product behavior as a missing host input.

## Initial controller facts (historical)

The candidate controller registers only the four calibration adapters and one
calibration receipt validator (`scripts/qualification/candidate-control-plane.mjs:51-54,688-708`).
The beta13 plan names `existing.c00.*` through `existing.c28.*` and
`external.c29.*`; none are registered. Therefore all 30 mandatory rows are
currently preflight-blocked before command execution. The plan also declares
no `artifacts`, `candidateId`, or `version` (`docs/assurance/qualification-campaign-plan.json:12-16,22-53`),
so candidate preflight independently blocks exact candidate identity and every
CI-AppImage/installed-deb row (`scripts/qualification/candidate-control-plane.mjs:853-870`).

The checked-in candidate plan is therefore an unresolved map, consistent with
the stated boundary in `docs/assurance/qualification-control-plane-candidate-mode.md:103-111`.

## Initial binding inventory (historical)

| Contract | Nominated command | Actual surface and output | Current judgment |
| --- | --- | --- | --- |
| C00 | `npm run beta:verify` | `scripts/beta-verify.mjs` writes a generic version/build/step report with `pass`/`fail`/`skip`; the smoke row is an interactive checklist. It does not bind exact candidate bytes or produce a controller receipt. | **Partial surface; missing adapter/validator.** |
| C01 | `node scripts/electron-bad-secret-smoke.mjs` | Packaged smoke exists, but requires `--app`/`SMOKE_APP` and an evidence directory. Success writes `summary.json` with `result: "pass"`, screenshots and logs; no fixed schema or source/package identity validator. | **Partial; command is unusable as declared and proof tier is unmet.** |
| C02 | `node scripts/electron-repair-train-d-smoke.mjs` | `scripts/electron-repair-train-d-smoke.mjs` requires positional packaged executable and output directory, then writes `receipt.json`. The plan supplies neither argument; the script is packaged executable proof, not proof of a genuinely installed `.deb` unless the adapter establishes that path. | **Partial; missing invocation and tier binding.** |
| C03 | `npx playwright test tests/e2e/mission.spec.ts` | Browser tests run through the harness and exit with a process status. No contract receipt or independent participant-scope oracle is emitted; participant/outing coverage is in other specs. | **Partial; broad/incorrect surface for the stated oracle.** |
| C04 | `npm run electron:smoke:tracking-soak:ci` | CI wrapper (`scripts/electron-tracking-soak-ci.mjs`) finds `tmp/electron-dist/linux-unpacked`, invokes the `ci` profile, and writes `electron-tracking-soak-report.json` with `schemaVersion: 1` and `verdict.passed`. It is an unpacked executable, not an AppImage; the `ci` profile is six batches and does not enable the extended exact-dot proof. | **Partial; proof mode is stale and no receipt adapter.** |
| C05 | `node scripts/breadcrumb-live-exact-smoke.mjs` | The declared path is missing. The actual surface is `scripts/release-smoke/breadcrumb-live-exact-smoke.mjs`; it requires seven exact/live env inputs (app, evidence, private visual dir, config, selector, version, AppImage SHA) and writes an allowlisted `summary.json`. | **Missing as declared; actual surface requires a dedicated adapter and external/live prerequisites.** |
| C06 | `npx playwright test` | Dedicated `tests/e2e/stationary-attention.spec.ts` exists, but the plan runs the entire suite and captures only exit status. No deterministic receipt or bounded stale/disconnected evidence is emitted. | **Partial; binding is overly broad.** |
| C07 | `npm run breadcrumb-pr6:qualify` | The PR6 supervisor requires exactly ten argument tokens: absolute fixture, evidence, packaged-liveness report, mission id and expected head (`build/breadcrumb-pr6-qualification-lib.js:61-111`). Bare command fails argument validation. | **Missing invocation; no adapter.** |
| C08 | `node scripts/coverage-production-qualification.cjs` | Requires three positional arguments (fixture, run directory, expected HEAD) and writes `production-qualification.json`. It is a direct Node mission-store/fixture probe, not AppImage proof, and the plan supplies neither fixture nor run/head arguments. | **Partial surface; command and proof tier are stale.** |
| C09 | `node scripts/electron-gpx-fidelity-smoke.mjs` | Requires positional packaged executable/output; writes `receipt.json` with `passed`, archive/input hashes and synthetic GPX evidence. It describes local/CI packaged Electron and does not establish installed-deb identity. | **Partial; missing invocation, tier binding and validator.** |
| C10 | `npm run breadcrumb-pr6:qualify` | Same invalid bare PR6 command as C07. The nominated surface does not independently expose a transaction-time Replay receipt for this row. | **Missing; no contract-specific producer/validator.** |
| C11 | `npx playwright test` | `tests/e2e/mission-evidence-search-passes.spec.ts` is the relevant browser surface, but the plan runs all tests and emits no machine-readable immutable-assignment/pass receipt. | **Partial; binding is overly broad.** |
| C12 | `npx playwright test` | `tests/e2e/marker.spec.ts` and visual marker tests cover marker fields; attachment coverage is not a packaged installed-deb proof. The command is broad and has no receipt producer/validator. | **Partial; wrong proof mode and no adapter.** |
| C13 | `npx playwright test tests/e2e/drawings.spec.ts` | `tests/e2e/drawings.spec.ts` does not exist. Current related files are `drawing-tools.spec.ts`, `coordinate-converter.spec.ts` and `measurement.spec.ts`; none are selected by the declared command. | **Missing/stale path.** |
| C14 | `npx playwright test tests/e2e/app-shell.spec.ts` | `tests/e2e/app-shell.spec.ts` does not exist. Current related surfaces include `visual/visual-app-shell.spec.ts`, `map.spec.ts` and `layer-panel.spec.ts`. | **Missing/stale path.** |
| C15 | `npm run electron:smoke:official-map-qualification` | Packaged synthetic offline-map smoke writes `summary.json` with schema `sartracker-war11-official-map-qualification-v1`, but requires `--app`; it uses a packaged executable and synthetic MBTiles, not an installed `.deb`. | **Partial; invocation and proof tier are unmet.** |
| C16 | `node scripts/electron-bad-secret-smoke.mjs` | Reuses C01's bad-secret launch and settings field-fill path. It does not save/reload a complete settings bootstrap and has no installed-deb identity or receipt validator. | **Partial; wrong/insufficient oracle.** |
| C17 | `npx playwright test` | `tests/e2e/diagnostics.spec.ts` exists, but the all-tests command does not isolate sanitized diagnostics or emit a machine-readable privacy receipt. | **Partial; binding is overly broad.** |
| C18 | `node scripts/electron-storage-diagnostics-kill-probe.mjs` | Strong packaged kill/restart surface; parser requires `--app`, `--fixture` and `--evidence` (`build/electron-storage-diagnostics-kill-probe-lib.js:2-55`) and writes `storage-diagnostics-kill-probe-report.json` with `schemaVersion: 1` and `verdict.passed`. The plan supplies none of the required args and does not bind installed-deb bytes. | **Partial; missing invocation, tier binding and validator.** |
| C19 | `npx playwright test` | Browser suite does not prove installed-package migration/retention. A separate packaged legacy-recovery smoke exists but is not bound by this plan. | **Missing contract-specific producer.** |
| C20 | `npm run electron:smoke:archive-lifecycle:ci` | CI wrapper creates exact-head packaged lifecycle evidence and publishes a schema-v2 success report or bounded schema-v1 failure receipt. It resolves an unpacked executable and does not install/attest a `.deb`; no controller adapter/validator is registered. | **Partial; wrong proof tier and no adapter.** |
| C21 | `npx playwright test` | No nominated archive-security command or fixed hostile-byte/key receipt. Browser exit status cannot establish archive authenticity/custody. | **Missing independent oracle.** |
| C22 | `npm run electron:smoke:archive-lifecycle:ci` | Same lifecycle surface as C20 can contain restore/review evidence, but the plan has no independent C22 predicate/receipt validator and still uses unpacked packaged proof. | **Partial; shared surface is insufficient without a C22 validator.** |
| C23 | `npx playwright test` | Browser tests such as `harness-no-tauri-leak.spec.ts` and preload unit tests exist, but the all-tests command does not isolate IPC capability containment or produce a receipt. | **Partial; binding is overly broad.** |
| C24 | `npm run test:responsiveness` | Runs source Vitest files under `vitest.responsiveness.config.ts`; it is a strict source timing gate, not CI AppImage runtime proof and writes no controller receipt. | **Partial; proof mode is wrong.** |
| C25 | `npm run electron:smoke:tracking-soak:ci` | Same six-batch/32-device `ci` soak as C04. It does not establish declared long-duration/field-scale bounds represented by the C25 oracle; no adapter/validator. | **Partial; workload and proof tier are insufficient.** |
| C26 | `node scripts/electron-package.mjs` | Packaging script builds and optionally runs Linux package inspection only when `--linux` is supplied; bare invocation does not install a `.deb`, exercise duplicate launch, or emit a controller receipt. | **Missing installed-package parity proof.** |
| C27 | `npm run beta:verify` | Generic beta report has pass/fail/skip rows and may include manual smoke; it does not prove exact release bytes, draft publication, rollback artifact or publication state. | **Missing release-bytes/publish/rollback oracle.** |
| C28 | `npx playwright test` | `full-mission-flow.spec.ts` and visual mission suites are relevant, but broad suite exit status is not a composite source/rendered-truth receipt and has no exact artifact binding. | **Partial; binding is overly broad.** |
| C29 | `external-team-session` | No repository executable or controller adapter. Donal approved pre-release original-machine training acceptance separately from postpublication WAR-13B on 2026-09-19. The binding now uses `external-human` and explicit training session kind; advisory judge ingestion cannot record human acceptance. | **Missing ingestion/custody integration; domain decision resolved.** |

## Initial cross-cutting gaps (historical)

- The plan's `validatorPaths` are only the controller modules. They are file
  identities for the campaign definition, not per-contract receipt validators.
  A generic `schemaVersion`/`passed` field in a smoke report must not be
  promoted to a contract result without a validator that checks the exact
  predicate, source/artifact identity, proof tier, fixture and evidence set.
- Several commands are missing required arguments or point at paths that do
  not exist. A command declaration is not executable capability until the
  adapter supplies deterministic arguments and captures the resulting report.
- `ci-appimage` and `installed-deb` rows currently point at unpacked packaged
  executables, source Vitest, or package-build scripts. Artifact role and
  installation state must be checked by the adapter; process exit code cannot
  upgrade those proof tiers.
- The controller has proof modes for `synthetic`, `browser`, `ci-appimage` and
  `installed-deb`, but no human/original-machine proof mode. C29 needs a
  separate fail-closed external evidence schema, named tester/session identity,
  exact candidate/package binding, and an explicit human verdict. It must not
  be represented as an advisory judge pass.
- Candidate identity is intentionally unresolved: exact source/artifact
  identities and release version belong to the later exact-candidate freeze
  handoff. The beta13 plan must remain blocked until those inputs and every
  adapter/validator are supplied.
