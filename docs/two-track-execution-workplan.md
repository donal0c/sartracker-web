# Two-Track Execution Workplan

> Start here when deciding what to do next while team testing is active.

## Operating Model

Run two tracks in parallel.

**Track A: Team feedback and fast browser iteration**

- Primary runtime: Vercel hosted browser testing mode.
- URL: `https://sartracker-web.vercel.app/?missionHarness=1`
- Purpose: let the team learn the app, find bugs, request UI changes, and test tracking/layers/workflows quickly.
- Release style: small, frequent Vercel deploys.
- Persistence expectation: session storage only; testing/training, not live incidents.

**Track B: Phase 1 Tauri beta readiness**

- Primary runtime: packaged Tauri desktop app.
- Purpose: prepare the operational release lane without waiting for all UI feedback to finish.
- Release style: quieter background work, then versioned beta packages when the surface has settled enough to be worth desktop testing.
- Persistence expectation: SQLite, filesystem adapters, recovery, diagnostics, and local map packages.

## Decision Rule

When new work arrives, classify it before implementing:

| Work type | Route |
| --- | --- |
| Confusing UI, wording, control placement, layer visibility, tracking display | Track A |
| Bug visible in hosted browser testing mode | Track A first, then confirm whether Tauri is also affected |
| Mission persistence, recovery, filesystem, GPX watch, diagnostics export, archive | Track B |
| High-definition mountain map integration | Track B / Phase 3, desktop-first |
| Browser IndexedDB, browser backups, browser file workflows | Defer until the Phase 4 browser hardening decision |
| Security concern about public map hosting | Track B / local map package support; do not host proprietary maps |

## Current Priority

1. Keep hosted browser testing smooth enough for the team to give real feedback.
2. Prepare a repeatable Tauri beta release path in the background.
3. Do not start heavy browser hardening unless testing proves browser operational deployment is genuinely needed.
4. Treat high-definition mountain maps as local desktop map packages unless the map provider gives requirements that change this.

## Ready Work Chunks

### Chunk A1: Hosted Testing Instructions And Feedback Intake

Bead: `sartracker-web-vpz.1`

Goal: make it easy for the team to test and report issues consistently.

Inputs:

- Current hosted URL.
- Current Traccar credentials.
- Current operator manual.

Tasks:

- Add a concise team testing checklist to the manual or a linked doc.
- Make the URL/base-URL distinction impossible to miss:
  - app URL: `https://sartracker-web.vercel.app/?missionHarness=1`
  - Traccar provider base URL in hosted mode: `https://sartracker-web.vercel.app`
- Add a simple bug report template:
  - what they were trying to do
  - expected result
  - actual result
  - screenshot/video if possible
  - browser and machine
  - mission name/time if relevant
- Add a triage rule for each issue:
  - hosted-only
  - shared app bug
  - desktop-runtime candidate
  - UI/wording preference

Acceptance:

- A tester can find the hosted URL, start a mission, connect tracking, and report a bug without reading chat history.
- The docs clearly say hosted browser mode is for testing only.

Verification:

- Manual doc read-through.
- Optional Chrome validation of the hosted flow when explicitly allowed.

### Chunk A2: Hosted Mode Guardrails

Bead: `sartracker-web-vpz.3`

Goal: reduce avoidable confusion during browser testing.

Tasks:

- Add hosted-mode copy near Settings/Data Sources explaining that direct HTTP Traccar URLs are blocked by browsers from HTTPS pages.
- In hosted mode, detect `http://` provider URLs and show a specific message directing operators to use `https://sartracker-web.vercel.app`.
- Consider a one-click hosted default for the known testing proxy.
- Keep Tauri desktop behavior unchanged; direct HTTP server URLs are valid there.

Acceptance:

- A tester who enters `http://kmrtsar.ddns.net:8082` in hosted mode gets a clear in-app explanation before chasing DevTools/network failures.
- Desktop settings remain flexible for direct provider URLs.

Verification:

- Unit coverage for hosted-mode URL validation/helper.
- Manual hosted settings check.

### Chunk A3: Team Feedback Triage Pass

Goal: convert raw feedback into actionable beads.

Tasks:

- Group incoming feedback by area:
  - mission start/control
  - tracking/devices
  - layers/map
  - drawings/markers
  - settings/connectivity
  - layout/UI preferences
  - desktop-only/runtime concerns
- Create or update beads for recurring issues.
- Mark quick fixes separately from design questions.
- Keep `handoff/HANDOFF.md` short: only current state, blockers, next actions.

Acceptance:

- No feedback remains only in Slack/chat/email.
- Each issue has a route: quick Vercel fix, planned UI/design pass, desktop beta validation, or deferred.

Verification:

- `bd list` shows new/updated work items.
- Handoff has the current baton without becoming a diary.

### Chunk B1: Tauri Beta Packaging Recon

Bead: `sartracker-web-vpz.2`

Goal: find the shortest reliable path to a first desktop beta artifact.

Inputs:

- `src-tauri/`
- existing npm scripts
- target team machine information, if available

Tasks:

- Identify current Tauri build command and output artifacts.
- Run a local package build if prerequisites are present.
- Record artifact paths and package formats.
- Note signing/notarization warnings without solving them yet.
- Write down the expected install path for macOS/Windows.

Acceptance:

- We know exactly how to build a local beta package on the current machine.
- Unknowns are explicit, especially target OS and signing.

Verification:

- Build command either succeeds, or the blocker is concrete and reproducible.
- Results are recorded in `docs/tauri-beta-release-plan.md`.

### Chunk B2: Tauri Beta Release Template

Goal: make desktop beta drops repeatable.

Tasks:

- Create a release note template with:
  - build/version
  - install instructions
  - what changed
  - what to test
  - known limitations
  - rollback/reinstall guidance
- Define minimum verification before sharing a beta:
  - `npm run lint`
  - `npm run build`
  - `npm run test`
  - `npm run test:backend`
  - packaged app smoke test
- Decide where beta artifacts will live initially.

Acceptance:

- A future agent can create a Tauri beta with release notes without inventing the process.

Verification:

- Dry-run release notes from the current version.

### Chunk B3: First Internal Tauri Smoke Build

Goal: prove the desktop runtime can launch and execute the core path before involving the team.

Tasks:

- Build the app.
- Install/open locally.
- Start a mission.
- Configure Traccar directly or through whatever desktop settings path is appropriate.
- Confirm mission persistence across app restart.
- Confirm diagnostics/version visibility.

Acceptance:

- Desktop beta is either smoke-tested locally or blocked by a specific packaging/runtime issue.

Verification:

- Screenshot or notes in handoff.
- Build artifact path recorded.

### Chunk C1: Local Proprietary Map Package Requirements

Goal: prepare for the team-provided high-definition mountain maps without creating a hosting/security problem.

Tasks:

- Ask/record map package facts:
  - format
  - file/folder structure
  - size
  - CRS/projection
  - raster vs vector
  - tile scheme
  - expected update cadence
  - sample/test file availability
- Confirm the plan:
  - app is distributed separately
  - map is installed locally by trusted team members
  - map is never hosted by Vercel/GitHub
- Draft the app workflow:
  - Settings -> Maps -> Add Local Map Package
  - validate map
  - store local path/checksum/version
  - show map readiness

Acceptance:

- We know enough about the map format to design the local map adapter.
- The security model is clear: local side-load, no public hosting.

Verification:

- Requirements captured in `docs/local-map-package-plan.md` when enough details exist.
