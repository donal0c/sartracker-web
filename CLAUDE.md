# CLAUDE.md — SAR Tracker Web

## ⚠️ LIFE-SAFETY CRITICAL APPLICATION

This application is used by Mountain Rescue teams during real search and rescue operations. Incorrect coordinates, broken tracking, or data loss could endanger lives. Treat every change with the seriousness that demands.

This repo should feel like mission software, not a prototype. The standard is not merely "works on my machine" or "passes the tests." The target is software that is calm, explicit, trustworthy, and unusually well-structured under pressure.

The quality bar here is intentionally very high:
- operator-facing behavior should feel reliable and unsurprising
- safety-critical logic should be easy to inspect and hard to misuse
- tests should give real confidence, not just coverage numbers
- architecture should get cleaner as the project grows, not noisier
- every meaningful change should leave the codebase in a better state than it found it

Aim for work that feels closer to a 9.5-10/10 engineering result than a fast acceptable patch. Favor clarity, explicitness, and durable structure over cleverness or speed.

## Before You Start

1. **Read this file completely**
2. **Read `handoff/HANDOFF.md` immediately after this file**
3. **Read `docs/two-track-execution-workplan.md`** unless the user has explicitly named a different Linear issue/task
4. **Read the relevant Linear issue(s)** for whatever you're working on (project board, linear issue views, and comments)

## Branch Discipline

Work directly on `master` unless the user explicitly asks for another branch. Do not create feature branches for ordinary local work, fixes, validation, deployment, or cleanup in this repo.

## Project Intent

This project exists to replace a legacy QGIS SAR workflow with a standalone application that operators can trust during real incidents.

That means a fresh agent should assume:
- correctness matters more than speed
- maintainability matters because many future Linear issues will build on today's boundaries
- ambiguity in safety-critical behavior should be surfaced, not silently coded through
- "good enough for now" is usually the wrong tradeoff here

When in doubt, prefer the option that makes the system more understandable, more testable, and more resilient for the next person who has to extend it.

### Handoff Protocol (required)

`AGENTS.md` is a symlink to this file. There is only one instruction file.

`handoff/HANDOFF.md` is the single continuity document for this repo.

That means:
- do not rely on agent-to-agent packet files
- do not create new Codex/Claude baton-passing files
- do not keep separate status notes elsewhere when the information belongs in `handoff/HANDOFF.md`
- if an older planning doc disagrees with `handoff/HANDOFF.md`, treat the handoff file as the current operating truth until the docs are reconciled

Every agent must be able to resume the project by reading only:
1. `CLAUDE.md`
2. `handoff/HANDOFF.md`
3. `docs/two-track-execution-workplan.md`
4. the relevant Linear issue(s)

When you finish a chunk of work, update `handoff/HANDOFF.md` so the next agent can continue without reconstructing context from commit history, old chat context, or deleted packet files.

### Handoff Etiquette (required)

`handoff/HANDOFF.md` must stay short and operational.

It should contain only:
- current state
- active work
- open Linear issues that matter now
- known parity gaps
- next actions
- a short verification snapshot
- a pointer to archived history when needed

Do not use `handoff/HANDOFF.md` for:
- long chronological diaries
- speculative improvement lists
- duplicate copies of Linear issue details
- duplicate copies of parity matrices

Use these locations instead:
- Linear issues: tracked feature / bug / hardening work
- `docs/two-track-execution-workplan.md`: the single active planning path and next-task queue
- `docs/areas-to-investigate.md`: improvement-mode guardrail only; any real task must be folded into the two-track workplan before implementation
- parity docs: row-level parity evidence
- `handoff/archive/`: older detailed history

If you make `HANDOFF.md` materially longer, compress it before finishing.

### When We Involve Claude (optional)

Claude review is no longer required for every batch. Do not start agent-chat threads,
Claude review loops, heartbeats, or inter-agent automations as a routine finish step.

Use Claude only when the user explicitly asks, or when a deliberately chosen high-risk
change would benefit from an intermittent second pass. Good candidates are broad
architecture changes, large safety-critical rewrites, or ambiguous legacy-plugin
behaviour that cannot be resolved from the repo and tests alone.

For ordinary chunks, finish with local verification, browser-backed validation where
relevant, Linear issue updates, handoff updates, and the normal commit/push protocol.

There is no separate packet layer. The handoff file must contain the current baton state.

## After Every Chunk of Work

1. **Verify the changed behavior first** — do not write closeout docs or mark Linear issues done from unverified assumptions
2. **Update handoff/HANDOFF.md** — what you did, what's next, any blockers, and exactly what was verified
3. **Update the Linear issue** — close it, add comments, update status
4. **Update the operator manual** — if the app changed in any user-visible way, keep `public/manual/index.html` and any screenshots in `public/manual/assets/` current
5. **Commit with a descriptive message** referencing the Linear issue ID
6. **Run the full test suite** — nothing ships without green tests

### Finish Protocol (required)

At the end of a work cycle, do not stop at "the code is written."

Before finishing, the agent should:
1. run the relevant verification for the slice that changed
2. run browser-backed UI verification whenever UI, map, workflow, runtime, deployment, or operator-facing behavior was affected
3. update `public/manual/index.html` when operator-facing behaviour, UI, settings, workflow, screenshots, or known gaps changed
4. confirm the result meets the repo's quality bar, aiming for roughly 9.5-10/10 quality rather than "probably fine"
5. update `handoff/HANDOFF.md` with a short baton-ready summary
6. update the relevant Linear issue(s)

### Linear Issue Execution Protocol (required)

When working through team requirements or any Linear issue, match the workflow to the issue type:

- **Bugs:** reproduce the bug first, ideally with a failing automated regression or a clearly recorded UI reproduction. Do not start by guessing at a fix. After the fix, confirm the original reproduction no longer fails and validate the affected operator-facing behavior in the UI.
- **Features and changes:** define the expected visible behavior before implementation, then validate that behavior through the UI wherever the requirement has an operator-facing surface.
- **UI validation:** use the strongest practical browser-backed path for the risk level. The inbuilt browser is fine for quick manual checks; Playwright should be used for repeatable UI, map, workflow, hosted-mode, deployment, or regression checks when the change can be validated that way.

### Browser Verification Policy (required)

The user should not need to remember to ask for browser validation. For any behavior-bearing change, choose the strongest appropriate verification tool and record what was checked.

- Use `$browser:browser` / the inbuilt browser for quick manual sanity checks when that is enough.
- Use `$playwright` automatically for repeatable UI, map, workflow, hosted-mode, deployment, or regression checks.
- Use `$chrome:Chrome` when validation depends on the user's real Chrome profile, existing tabs, cookies, extensions, or a browser state the inbuilt browser cannot see.
- Use `$chrome-devtools-cli` when the job needs DevTools-grade network, console, performance, storage, or screenshot evidence.
- For UI/layout changes, capture visual evidence where practical and check the actual rendered surface, not only DOM or unit assertions.
- For hosted/Vercel changes, validate the deployed URL after deployment, not only the local build.
- Verification must happen before closing the Linear issue or writing final handoff claims. Handoff and Linear issue comments must say exactly which commands and browser flows passed, and any parts that were not verified.

If, and only if, the agent is highly confident that:
- the change is complete for this chunk
- the tests are green
- the behavior is well verified
- the code quality is genuinely high

then the agent should also:
7. `git add` the intended files
8. create a descriptive commit referencing the Linear issue ID
9. `git push`

The default desired end state is a clean worktree on the remote branch so the next agent can begin from a stable baseline.

Do not commit or push:
- when tests are failing
- when verification is incomplete for a behavior-bearing change
- when the handoff or Linear issue state is stale
- when confidence is still low and the right next step is another validation/fix pass

## Development Rules

### Strict TDD — No Exceptions
1. Write the test FIRST
2. Run it — it must FAIL (red)
3. Write the minimum code to pass
4. Run it — it must PASS (green)
5. Refactor if needed
6. Every module gets unit tests + integration tests
7. Every user-facing flow gets Playwright E2E tests

### Feature Delivery Workflow
For every feature Linear issue after scaffolding:
1. Do a short design pass before implementation
2. Write down the safety invariants and failure modes
3. Define the test plan before writing production code
4. Start with failing tests for the core behaviour
5. Only then implement the feature
6. Stop for a refactor pass before calling the Linear issue complete
7. Re-evaluate whether the resulting structure is still the one we want future Linear issues to build on

For scaffold and tooling Linear issues, be pragmatic. For behaviour-bearing features, tests-first is the default and should only be skipped with an explicit reason recorded in `handoff/HANDOFF.md`.

### Code Quality
- TypeScript strict mode — no `any` types
- All functions must have JSDoc comments
- All coordinate functions must validate inputs (NaN, Infinity, out-of-range)
- Error messages must be clear and actionable — volunteers will see them
- No silent failures — log and surface errors
- Prefer deterministic tests over brittle snapshots
- Prefer simple, boring infrastructure choices over clever abstractions
- If a safety-critical path fails, fail loudly and visibly rather than silently falling back

### Near-Perfect Code Standard
This repo should be biased toward code that is unusually clean, explicit, and resilient. Avoid “good enough for now” decisions that create drag for later Linear issues.

- Prefer forward-looking structure over quick local convenience
- Every new module should have a single, obvious responsibility
- If a component or module starts accumulating unrelated concerns, stop and split it before adding more
- Favour explicit names and explicit boundaries over clever reuse
- A small amount of deliberate structure now is cheaper than broad cleanup later
- Before adding new code, check whether the right move is to extract, rename, or simplify existing code first
- Do not leave behind “we can clean this up later” structure in safety-critical or high-churn areas
- If a warning, rough edge, or weak boundary is discovered during a Linear issue, either fix it in that Linear issue or record a specific reason it is being deferred

Think in terms of craft, not just delivery:
- the next agent should be able to understand the change quickly
- the next Linear issue should be easier because of this Linear issue, not harder
- the safest design is usually the one with the clearest boundaries and the least hidden behavior

### Anti-Sprawl Rules
- Do not let React components become orchestration blobs
- Do not bury domain rules, coordinate logic, persistence logic, or tracking logic inside UI code
- Do not create generic dumping-ground files such as `utils.ts`, `helpers.ts`, `misc.ts`, or `common.ts`
- Do not introduce abstractions unless they remove real duplication or clarify a stable boundary
- Do not copy data-shaping logic across features; extract it into a named module with tests
- Prefer deleting or replacing weak structure early rather than building around it
- Do not accept accidental build, state, or persistence complexity just because the feature still “works”

### Refactor Triggers
Stop and refactor before continuing when any of these happen:
- A file is taking on more than one clear responsibility
- A React component owns lifecycle orchestration plus rendering plus data shaping
- A function becomes hard to name precisely
- The same rule appears in more than one place
- A boundary between UI, application logic, and infrastructure starts to blur
- A new feature would be faster to add by “just putting it here” in the wrong layer
- A build warning or runtime warning reflects app-owned structure rather than an intentional dependency constraint
- Tests can only be made to pass by coupling unrelated concerns together

Record meaningful refactors in `handoff/HANDOFF.md` so the next agent understands why the structure changed.

### Ambiguity Protocol
Do not code through ambiguity in life-safety or architecture-bearing areas.

- If a Linear issue contains contradictory rules, stop and record the contradiction before implementation
- If a key operator behaviour, persistence rule, or state transition is unclear, add it to the Linear issue as an open question instead of inventing the answer in code
- Prefer a short research follow-up over embedding speculative behaviour into the application
- When a Linear issue is implementation-ready except for minor UI polish, proceed and record the assumption
- When a Linear issue is missing a core domain decision, do not start implementation until that decision is locked

### Definition Of Done
A Linear issue is not done just because tests pass.

- The code must be clean enough that the next Linear issue can extend it without workaround structure
- The main risks and failure modes must be covered by tests
- Shared docs (`CLAUDE.md`, Linear issue comments, `handoff/HANDOFF.md`) must reflect any decisions made during the work
- The operator manual (`public/manual/index.html`) must reflect any user-visible app change, including changed controls, workflows, settings, screenshots, or known gaps
- Remaining debt, if any, must be explicit, small, and intentional

### Coordinate Safety
- ITM (EPSG:2157) is the working CRS
- TM65 is display-only (Irish Grid references)
- WGS84 (EPSG:4326) for GPS input and map display
- All coordinate transforms must be validated against the golden dataset in spikes/S2-irish-grid/
- Magnetic declination for Ireland: -4.5° (true → magnetic: subtract, magnetic → true: add)

### Commits
- Reference Linear issue IDs in commit messages: `feat(tracking): add device polling [sartracker-web-xyz]`
- Atomic commits — one logical change per commit
- Never commit failing tests

### Linear issue Planning Checklist
Before implementing a feature Linear issue, capture these explicitly in the Linear issue notes, handoff, or working notes:
- Goal and non-goals
- Safety invariants
- Failure modes
- Persistence impact
- Coordinate impact
- What must never regress
- Test plan

If an architectural decision is made during execution, record it in `handoff/HANDOFF.md` so the next coding agent inherits the same assumptions.

### Linear issue Readiness Rubric
Use a readiness pass before implementation so the planning/research team can work ahead on ambiguous Linear issues while coding continues on the current one.

#### Research Required Rating
- `Low` — Ready to implement. Only minor product or UX choices remain.
- `Medium` — Implementable, but targeted research or a short design note would materially reduce risk.
- `High` — Not ready. Core behaviour, data flow, or architecture is still too ambiguous.

#### Implementation Readiness Score
- `5/5` — Ready now. No meaningful blockers.
- `4/5` — Ready with a few minor clarifications.
- `3/5` — Probably implementable, but should not start without targeted decisions.
- `2/5` — Needs structured research/spec work first.
- `1/5` — Not ready for implementation.

#### Readiness Template
For each upcoming Linear issue, capture:
- Research required
- Implementation readiness score
- Recommended action: implement now, implement after short design pass, or research before implementation
- Why
- Locked decisions
- Open questions
- Evidence / references
- Ready-to-start checklist

The project’s current working version of this rubric lives in `docs/bead-readiness.md`. Update that file as Linear issues become clearer.

## Architecture

### Stack
- **Tauri 2** — desktop wrapper
- **Vite + React + TypeScript** — UI
- **MapLibre GL JS** — map rendering
- **Terra Draw** — drawing interactions (polygons, lines)
- **Turf.js** — geospatial calculations
- **proj4js** — coordinate conversion
- **SQLite mission store behind Tauri commands** — mission persistence (WAL mode)

### Layer Architecture (from S6 spike)
- **Hybrid approach**: 3 sources (tracking, markers, drawings) + ~15 style layers
- Filter-based visibility toggling per item
- NOT one-layer-per-feature like QGIS

### Persistence (from S5 spike)
- SQLite with WAL mode — crash-safe by default
- Atomic operations — no partial writes
- Schema versioned with migrations
- Backup mirror — keep one atomic mirror copy via temp+rename
- Every state-changing persistence operation should append an audit event
- Renderer does not access the database directly; persistence is mediated by a backend mission store

### Domain Boundaries
- The renderer stays thin
- Safety-critical logic lives in testable modules behind clear interfaces
- Domain logic, persistence, and coordinate transformation code must not be buried inside React components
- Spike code is evidence and reference material, not production code to import directly

### Dependency Direction
- UI depends on application-facing modules, not infrastructure details
- Infrastructure modules implement ports/interfaces; they should not drive UI structure
- Persistence, tracking, and time/external integrations should be introduced behind explicit boundaries
- Prefer one-way dependencies; avoid circular knowledge between features

### Structure First
When adding a new subsystem, prefer a layout that makes future growth obvious. A good default is:
- `src/features/<feature>/` for feature-specific UI/application wiring
- `src/lib/` for stable shared libraries with strong tests
- `src/domain/` for mission rules and safety-critical business logic when that layer starts to emerge
- `src/infrastructure/` for external systems such as persistence, Traccar, filesystem, or clocks when those adapters appear

It is acceptable for the repo to grow into this structure gradually, but new work should move it toward cleaner boundaries, not away from them.

### Testing Strategy
- Unit tests for pure logic, transforms, validators, and domain rules
- Integration tests for module boundaries such as MissionStore, Traccar polling, and layer-state shaping
- Playwright E2E tests for genuine operator workflows
- **Visual verification E2E tests** for independent AI-reviewed screenshot verification (see below)
- New features should normally add or update tests at the lowest meaningful level first, then add higher-level coverage where warranted

### Visual Verification E2E Tests

The `tests/e2e/visual/` suite provides a second layer of verification beyond standard Playwright assertions. Each test:

1. Performs an operator workflow (start mission, place marker, etc.)
2. Makes standard Playwright DOM assertions (element visible, text correct, etc.)
3. Captures a screenshot with a verification manifest entry describing what to check
4. After tests run, an Opus-class AI subagent independently reads each screenshot and verifies visual correctness

This two-layer approach is required because this is a life-safety application. DOM assertions confirm the code is correct; visual verification confirms the operator would actually see the right thing.

**Running visual tests:**
```bash
# Visual tests only (27 tests, ~55s)
npx playwright test --project=visual

# Standard E2E tests only (~30s, visual tests excluded)
npx playwright test --project=chromium

# Both projects
npx playwright test
```

**After running visual tests**, screenshots and `.entry.json` manifest files are written to `test-results/visual-verification/`. Run the visual review automation to complete verification:

```bash
# Full review (every entry), with caching
npm run visual:review

# Single entry while iterating on a spec
npm run visual:review -- --only shell-idle-state

# Bypass the cache (forces a fresh model call per entry)
npm run visual:review -- --no-cache

# Dry run (no model calls; exercise the runner end-to-end)
npm run visual:review -- --dry-run

# Stricter gating
npm run visual:review -- --fail-on critical
```

The runner spawns one `claude --print` subprocess per entry, hands it the screenshot path and the manifest's `verificationPrompt`, and parses a structured pass/fail reply. Per-entry results land in `test-results/visual-verification/results/<testId>.review.json`; an aggregate report lands under `test-results/visual-verification/reports/visual-review-<timestamp>.json`. Successful runs are cached under `test-results/visual-verification/.cache/` so unchanged screenshots are not re-billed.

Exit codes: `0` all entries passed gating, `1` at least one entry failed at or above `--fail-on` severity, `2` reviewer errored (always blocks), `3` manifest had zero entries (visual project did not run).

Each manifest entry includes:
- `screenshotPath` — absolute path to the PNG
- `verificationPrompt` — detailed checklist for the visual reviewer
- `severity` — `critical` | `high` | `medium`
- `playwrightAssertions` — what the automated layer already confirmed

**Structure:**
```
tests/e2e/visual/
├── helpers/
│   ├── test-setup.ts            — shared harness setup, mission, tracking injection
│   └── verification-manifest.ts — parallel-safe manifest (per-entry JSON files)
├── visual-app-shell.spec.ts     — layout, toolbar, basemaps, coordinates, focus mode
├── visual-mission-lifecycle.spec.ts — active, backdated, paused, finish, governance, recovery
├── visual-tracking.spec.ts      — status panel, map devices, layer panel, full operational
├── visual-markers.spec.ts       — IPP/LKP, Clue, Hazard, Casualty dialogs
├── visual-drawings.spec.ts      — search area, LPB rings, bearing conversion, multi-drawing
└── visual-runtime-safety.spec.ts — booting shell, fault shell, autosave warnings

scripts/visual-review.mjs        — runner; spawns claude subprocesses per entry
build/visual-review-lib.js       — pure helpers (CLI parsing, manifest loading,
                                    reply parsing, severity gating, cache key)
```

**Adding new visual tests:** Use `captureAndRegister()` for full-page screenshots or `captureElementAndRegister()` for element-scoped screenshots. Write verification prompts as numbered checklists — each item must be independently verifiable from the screenshot frame the test actually captures. If a checklist item asks for text or chrome that lives outside the captured element, either widen the capture or rewrite the item. Set `severity: 'critical'` for anything that affects operator safety. Validate new prompts by running `npm run visual:review -- --only <new-test-id>` and reading the model's failedItems before merging.

**Key design decisions:**
- The `visual` Playwright project uses `1440x900` viewport for consistent screenshot dimensions
- Manifest entries are written as individual `.entry.json` files (parallel-safe across Playwright workers)
- The `?missionHarness=1` URL parameter enables browser validation mode (mock Tauri backend via sessionStorage)
- Map clicks use `{ force: true }` to bypass the drawing toolbar overlay
- Tracking data is injected via `window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot()`

### Traccar Integration (from S7 spike)
- HTTP polling for v1 (proven, reliable)
- WebSocket enhancement for v2
- Retry with exponential backoff
- Last-good cache when server unreachable
- Stale device detection (>5 min no update)

## Project Structure
```
sartracker-web/
├── CLAUDE.md              ← you are here
├── AGENTS.md              ← project context and architecture
├── README.md              ← project overview and risk table
├── OVERVIEW.md            ← detailed project description
├── handoff/
│   └── HANDOFF.md         ← current state, last work done, next steps
├── src/
│   ├── features/          ← feature-specific controllers, views, and adapters
│   ├── lib/               ← stable shared libraries (coordinates, config, validation)
│   ├── components/        ← React components
│   ├── domain/            ← mission rules and safety-critical business logic (emerge as needed)
│   ├── infrastructure/    ← Tauri-facing adapters: mission-store, settings-store, tracking-cache, gpx-import-source, marker-attachment-store, layer-catalog-store, support-report, file-launcher
│   └── types/             ← TypeScript type definitions
├── tests/
│   ├── unit/              ← vitest unit tests
│   ├── e2e/               ← Playwright E2E tests (55 standard + 22 visual)
│   │   └── visual/        ← AI-verified visual E2E tests (screenshot + Opus subagent)
│   └── fixtures/          ← test data (golden datasets, mock responses)
├── spikes/                ← ARCHIVED spike code (reference only, do not modify)
├── specs/                 ← architecture specs
└── docs/                  ← reference docs; `two-track-execution-workplan.md` is the single active planning queue
```

Avoid introducing `src/utils/` unless there is a very strong reason and the file has one precise responsibility.

## Spike Reference (read-only)
All spikes passed. Use them as reference implementations and test fixtures:
- `spikes/S1-osi-maps/` — MapLibre basemap switcher, offline caching, coordinate display
- `spikes/S2-irish-grid/` — proj4js coordinate conversion, golden dataset, grid reference formatting
- `spikes/S3-drawing-tools/` — all 8 drawing tools with UI, geodesic math, LPB data
- `spikes/S4-tauri-distribution/` — distribution research, updater config, signing analysis
- `spikes/S5-persistence/` — SQLite mission store, schema, migrations, crash recovery
- `spikes/S6-layer-architecture/` — hybrid layer approach, synthetic data, filter panel
- `spikes/S7-traccar-integration/` — Traccar HTTP client, polling manager, connection test

## Testing
```bash
# Unit tests
npm run test

# E2E tests (all configured Playwright projects)
npm run test:e2e

# Visual verification E2E tests
npx playwright test --project=visual

# Backend/Tauri tests
npm run test:backend

# All tests (unit + all Playwright projects + backend)
npm run test:all
```

## Key Files in the QGIS Plugin (reference)
The original Python plugin is at ~/Documents/Qgis/sartracker/
- `utils/coordinates.py` — coordinate conversion (port reference)
- `utils/drawing_math.py` — geodesic math (port reference)
- `utils/mission_storage.py` — persistence approach (port reference)
- `providers/traccar_http.py` — Traccar integration (port reference)
- `controllers/layer_managers/drawing_manager.py` — drawing tools (port reference)
- `layers/schema.py` — layer structure (port reference)
