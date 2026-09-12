# WAR-02B — bounded property and mutation controls

## Scope and status

WAR-02B adds bounded assurance infrastructure. Its only shipped-code change is
the equivalent timer adapter boundary in the tracking modules: it uses
`globalThis` so browser and Node test type surfaces agree; polling behavior is
unchanged. The approved assurance surface is exactly three safety-critical
seams:

1. coordinate transforms;
2. breadcrumb cursor/window arithmetic;
3. position-ingest identity policy.

The named 2026-08-27 planning inputs
`tmp/agent-mail/whole-application-resilience-coordinator-plan-20260827.md` and
`tmp/agent-mail/fable-whole-application-resilience-correction-20260827.md` are
not present in this checkout or reachable git history. This record therefore
uses the explicit WAR-02B request, the existing WAR-02A contract, the current
DON-228 regression, and the repository assurance rules as its authority; it
does not infer content from the missing files.

## Contract

- `fast-check@4.10.0` is a development-only dependency. Every property uses an
  explicit replayable seed, fast-check shrinking, a 10-second async predicate
  timeout, a 120-second interrupt bound, zero precondition skips, and a hard
  maximum of 250 runs. The failure text contains the seed, shrink path,
  counterexample, error/cause/stack information, and replay tuple. Interrupts
  are failures, not silent passes.
- Coordinate properties call the production WGS84/ITM/TM65 functions and check
  round-trip precision plus ITM displayability across the inclusive Irish
  envelope. A separate property checks both directions against independent
  TM65/WGS84 golden anchors and invokes WGS84-to-ITM and WGS84-to-TM65 rejection
  cases independently, alongside non-finite, global-range, Irish-range,
  projected-range, and formatting rejection branches.
- Cursor properties drive the production `createPollingManager` through its
  public client boundary with fake timers. They check the exact five-minute
  overlap, the two-hour recent-history clamp, completed `now()` bounds, and
  retention of a fix at the inclusive boundary. The red control first proves
  the unmodified manager is green, then mutates the request at the fake client
  boundary; it no longer rewrites an observation after the fact.
- Ingest properties load the exact `electron/position-ingest-policy.cjs` via
  WAR-02A's isolated CommonJS loader. An independent canonical-hash oracle
  covers insert, canonical duplicate, field and tiny-coordinate conflicts,
  optional fields, versioned and unknown-prefix hashes, stored-hash mismatch,
  and equivalent/different timestamp forms.
- The red proof driver runs the named DON-228 control in a child Vitest process
  in both current (green) and deliberately rebroken (red) modes. It rejects
  collection, suite, hook, unhandled-error, timeout, and signal failures as
  proof.
- The generic correctness config excludes WAR-02B so it is not run twice; both
  the Linux validation and Electron release gate workflows invoke the bounded
  property/mutation suite and controlled rebreak proof as separate steps.

## Evidence and limits

The focused checks for this repair pass are:

- `npm run test:war-02b` — 4 files, 19 tests passed.
- `npm run assurance:war-02b` — current control green; controlled DON-228
  rebreak red at the named safety oracle.
- `npm run test:correctness -- --no-file-parallelism` — 438 files, 4,539
  tests passed, 6 qualification-only skips.
- `npm test -- --no-file-parallelism` — 442 files, 4,564 tests passed.
- WAR-02B project type-check — passed without a fabricated `Window` ambient
  declaration.
- root app/node type-check — passed after the timer boundary cleanup.
- ESLint — passed; `npm run build` and bundle-size budgets passed.

The predecessor branch-head Linux validation receipt is recorded on PR #24;
the final independent rejection-path repair requires a fresh exact-head
refresh. The previous receipt passed the full correctness, dedicated WAR-02B
property/mutation, controlled rebreak, build/budget, native inspection, GPX,
and AppImage checks. Strict responsiveness, replay-envelope, tracking-soak,
and archive-lifecycle stages remain explicitly skipped qualification work.

This is local T1/T2 assurance evidence only. It is not package, provider,
soak, power-loss, hosted, field, merge, or release qualification. The mutation
receipt is diagnostic and records the named semantic mutants; it is not a
Stryker line mutation score.
