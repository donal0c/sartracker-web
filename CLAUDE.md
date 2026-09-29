# CLAUDE.md — SAR Tracker

`AGENTS.md` is a symlink to this file; there is one instruction file.

## Life-safety application

Mountain Rescue teams use this app during real search and rescue operations.
Wrong coordinates, broken tracking or lost data can endanger lives. Correctness
beats speed, and a safety-critical failure must be loud and visible, never
silent. When a rule below conflicts with getting something shipped, the rule wins
unless Donal explicitly decides otherwise.

## Start here

Read, in order: this file, [handoff/HANDOFF.md](handoff/HANDOFF.md) (current
state and next action), [docs/two-track-execution-workplan.md](docs/two-track-execution-workplan.md)
(the single ordered queue), and the Linear issue you are working on. Nothing
else is required reading. Older process documents live in `docs/archive/` and
`handoff/archive/` as history, not as rules.

## Releasing a team beta

[docs/release-checklist.md](docs/release-checklist.md) is the **only** release
gate. It runs on the exact CI-built artifact, reports one table, and ends in
Donal's go/no-go. In short:

- **Block** (never publishable): data loss, wrong coordinates or mission state,
  silent failure in a safety path, sustained unresponsiveness, corrupted history.
- **Ship with known issue**: visible, recoverable, written workaround — only with
  Donal's recorded exception for that tag and exact artifact hashes.
- **Backlog**: cosmetic, engineering-scale, or a non-reproducing timing outlier.
- **No rebuild or retag after a failure without Donal's explicit approval.**
  Record it, continue the independent checks, report.
- A test-tool fix never requires rebuilding the app: the product is identified
  by artifact SHA-256; `scripts/team-smoke/` records its own commit separately.
- A tool failure is missing evidence (NOT TESTED), not a product FAIL. If a tool
  fails twice on the same step, stop fixing it during the release.
- One owner operates the Ubuntu box and the release; a second agent reviews.
- A team beta is controlled testing, not operational/live-incident acceptance.

The 205-binding qualification campaign is **not** a release gate (Donal,
2026-09-27). Its remaining packaged probes still run in CI as regression checks.
Keep the intertwined library until a bounded extraction can preserve those probes.

Everything else in this file is guidance for feature work, not a release gate.

## Engineering invariants (non-negotiable)

**Coordinates**
- ITM (EPSG:2157) is the working CRS; WGS84 (EPSG:4326) for GPS input and map
  display; TM65 Irish Grid is display-only.
- Every coordinate function validates input (NaN, Infinity, out of range) and
  rejects with a clear message. Transforms are checked against the production
  golden fixtures. The TM65 datum Y translation is EPSG:1641 `-130.596`; never
  restore the stale positive sign from the old spike.
- Magnetic declination for Ireland: -4.5° (true → magnetic subtract, magnetic →
  true add).

**Persistence**
- SQLite in WAL mode behind the Electron mission store; the renderer never
  touches the database directly.
- Atomic writes, versioned migrations, one atomic backup mirror, and an audit
  event for every state-changing operation.
- Never invent data to fill a gap (for example backfilling provenance columns
  that were never observed). Record the gap truthfully.

**Fail visible**
- No silent failures: log and surface errors in words a volunteer can act on.
- If a safety-critical path fails, stop visibly rather than fall back quietly.
- TypeScript strict mode, no `any`. JSDoc on functions.

## Feature work (guidance, not release gates)

- **Tests first.** Reproduce a bug with a failing regression before fixing it.
  For a feature, write the expected visible behaviour and its failing tests
  first. Test the real persistence, IPC, cancellation or error boundary, not
  only a mocked happy path.
- **Choose checks by risk** using [docs/testing-and-review-cadence.md](docs/testing-and-review-cadence.md):
  documentation-only changes need no runtime reruns; renderer changes need the
  affected Playwright flows; SQLite, IPC, workers, credentials, restart or
  native changes also need the packaged smoke for that boundary.
- **Browser verification** for operator-facing changes: look at the rendered
  surface, not only DOM assertions. Visual review tooling is described in the
  cadence doc.
- **Ambiguity:** do not code through an unclear safety rule, state transition
  or persistence decision. Record the question on the Linear issue.
- **Team answers:** what the SAR team said lives in
  `team-feedback/breadcrumb-question-answers-20260822.md` and the indexed
  [Q&A ledger](docs/breadcrumb-team-question-and-answer-ledger.md). Search it
  before proposing a new team question; never rewrite an earlier answer; never
  send engineering mechanics (retries, idempotency, queueing) as product
  questions.
- **Regressions:** label field regressions `Regression` (and `Performance` when
  relevant) in Linear, with the original report, root cause and the new
  automated check. Release notes carry a short Regression provenance section.
- **Team reports close the testing gap:** every issue the team reports needs an
  escape note, a regression test, and — when they met it through a workflow — a
  team-smoke phase that reproduces it, plus a line in the register in
  [the release checklist](docs/release-checklist.md). Not optional.
- **Operator manual:** keep `public/manual/index.html` current when anything
  user-visible changes.

## Structure

- Renderer stays thin. Domain rules, coordinate logic, persistence and tracking
  live in tested modules, not React components.
- `src/features/<feature>/` feature wiring; `src/lib/` stable shared libraries;
  `src/domain/` mission rules; `src/infrastructure/` desktop/runtime adapters;
  `electron/` main process, mission store and workers; `shared/` code used by
  both sides.
- UI depends on application modules, not infrastructure details; one-way
  dependencies; no `utils.ts`/`helpers.ts`/`common.ts` dumping grounds.
- Split a file when it takes on a second responsibility. Leave the code cleaner
  than you found it; record meaningful refactors in the handoff.

**Stack:** Electron, Vite + React + TypeScript, MapLibre GL JS (three sources,
filter-based layers), Terra Draw, Turf.js, proj4js, better-sqlite3. Traccar via
HTTP polling with backoff, last-good cache and stale detection (>5 min).

## Continuity and git

- `handoff/HANDOFF.md` is the baton: current state, active work, next action,
  a short verification snapshot, pointers to archives. Keep it under about 4 KB;
  move history to `handoff/archive/`. Linear holds issue detail; the workplan
  holds order.
- Work directly on `master` unless Donal asks for a branch. Fetch first and
  compare against `origin/master`. Confirm the branch before any git action.
- Commit atomically with the Linear ID: `fix(tracking): … [DON-123]`. Never
  commit failing tests. Push only verified work. `docs/` and `handoff/` are
  gitignored for local notes, so add new tracked files there with `git add -f`.
- The repository is public: never commit credentials, private map data, raw
  mission data, team members' personal details or machine access details.

## Commands

```sh
npm run test:correctness -- --no-file-parallelism   # full source suite (CI gate)
npm run test:responsiveness                          # strict <200 ms timing suite
npm run lint && npm run build
npm run test:e2e:chromium                            # Chromium Playwright
npx playwright test --project=visual && npm run visual:review
npm run electron:pack                                # local unpacked package
node scripts/team-smoke/run.mjs --help               # release smoke, see its README
npm run electron:release:publish -- --tag <tag> --check-notes <note.md>
```

Heavy suites (full unit, Playwright, packaging) run one at a time on a
developer machine. The QGIS plugin being replaced is at
`~/Documents/Qgis/sartracker/` for port reference.
