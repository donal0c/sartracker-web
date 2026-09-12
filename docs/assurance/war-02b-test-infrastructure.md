# WAR-02B — bounded property and mutation controls

## Scope and status

WAR-02B adds test infrastructure only. It does not change shipped coordinate,
tracking, persistence, or ingest behaviour. The approved mutation surface is
exactly three safety-critical seams:

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
  explicit seed, `endOnFailure`, zero precondition skips, and a hard maximum of
  250 runs. The default failure text contains the seed, shrink path,
  counterexample, error, and replay tuple.
- Coordinate properties call the production WGS84/ITM/TM65 functions and check
  round-trip precision plus ITM displayability across the inclusive Irish
  envelope.
- Cursor properties drive the production `createPollingManager` through its
  public client boundary with fake timers. They check that the next request
  overlaps the prior cursor, stays inside the completed `now()` window, and
  retains a fix at the inclusive boundary.
- Ingest properties load the exact `electron/position-ingest-policy.cjs` via
  WAR-02A's isolated CommonJS loader. They cover insert, canonical duplicate,
  content conflict, versioned hash conflict, and equivalent timestamp forms.
- The red proof driver runs the named DON-228 control in a child Vitest process
  in both current (green) and deliberately rebroken (red) modes. It rejects
  collection, suite, hook, unhandled-error, timeout, and signal failures as
  proof.
- Both the Linux validation and Electron release gate workflows invoke the
  bounded property suite and the controlled rebreak proof as separate steps.

## Evidence and limits

Observed on executable WAR-02B source head `f3a3de4f1be3865dbd6a638c80844512e38f40d2`
after the async runtime predicate-contract coverage; this receipt update is
documentation-only:

- `npm run test:war-02b` — 4 files, 9 tests passed.
- `npm run assurance:war-02b` — current control green; controlled DON-228
  rebreak red at the named safety oracle.
- `npm test -- --no-file-parallelism` — 442 files, 4,554 tests passed.
- focused ESLint for all WAR-02B TypeScript and assurance scripts — passed.
- `npx tsc -b --pretty false` — passed, including the WAR-02B Node test
  project’s minimal timer/window ambient boundary.
- `npm run build` — passed, including bundle-size budgets. Vite reported the
  repository’s existing stale Browserslist database notice; it did not fail the
  build.
- Exact-head Linux validation run
  [`34705813451`](https://github.com/donal0c/sartracker-web/actions/runs/34705813451)
  passed against that executable source head, including the bounded property,
  controlled rebreak, package, GPX and AppImage steps that are enabled in the
  ordinary PR lane. The final continuity tip `73a9b8fe` is documentation-only;
  its exact-head Linux validation run
  [`34708104728`](https://github.com/donal0c/sartracker-web/actions/runs/34708104728)
  also passed the enabled PR lane.

This is local T1/T2 assurance evidence only. It is not package, provider,
soak, power-loss, hosted, field, merge, or release qualification. The mutation
receipt is diagnostic and records survivors honestly; it is not a Stryker line
mutation score.
