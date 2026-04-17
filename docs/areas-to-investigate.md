# Areas To Investigate

## Purpose

This file is the rolling queue for bounded improvements, hardening ideas, and code-quality opportunities.

Use it when:
- you are asked to look for improvements
- you are asked to throw compute at the repo
- you finish one improvement and want to leave the next best options behind

Do not use `handoff/HANDOFF.md` as a dumping ground for these.

## Agent Loop

1. Read `CLAUDE.md`
2. Read `handoff/HANDOFF.md`
3. Read this file
4. If there is a strong queued item here, prefer it over doing a fresh broad scan
5. Otherwise do a fresh scan, choose one bounded improvement, and add the rest here
6. Implement one improvement only
7. Run the appropriate tests, including Playwright when UI/map/runtime behavior is affected
8. Update `handoff/HANDOFF.md`
9. Update this file
10. Create or update a bead if the remaining work is substantial or should persist across sessions

## Fixed Improvement Prompt

Use this exact operating prompt in spirit when running improvement-mode work:

`Deeply analyze the codebase and identify 3 to 5 bounded improvements that would make a real difference to the system. For each, give an impact, complexity, and risk score from 1 to 5. Choose the best improvement by highest impact and lowest complexity/risk. Implement only that one. Verify it deeply with the right mix of unit tests, integration tests, and Playwright when UI, map, or runtime behavior is affected. Then leave a short note in handoff/HANDOFF.md and record the remaining worthwhile candidates in docs/areas-to-investigate.md. If a remaining item is substantial, safety-critical, or spans sessions, create or update a bead for it.`

## Scoring

- Impact:
  - `5` = major safety, correctness, or operator-value gain
  - `3` = worthwhile but local
  - `1` = minor polish
- Complexity:
  - `5` = broad / multi-system
  - `3` = moderate bounded change
  - `1` = small isolated change
- Risk:
  - `5` = high regression risk in safety-critical paths
  - `3` = manageable with tests
  - `1` = low-risk change

## Decision Rule

- Do it now if it is bounded, high-value, and low-risk.
- Log it here if it is real but not the best next move.
- Create/update a bead if it is:
  - safety-critical
  - multi-step
  - likely to span sessions
  - important enough that it should not depend on this file alone

## Active Candidates

### Decompose browser harness store

- Area: `src/features/browser-validation/browser-harness-store.ts`
- Why it matters: At ~1000 lines it is becoming a mixed-responsibility test harness plus mission store implementation, which makes safety review and future parity work harder.
- Evidence: It is currently the largest TypeScript file in the repo and owns mission lifecycle, persistence shaping, browser storage, and test harness plumbing together.
- Impact: 4
- Complexity: 4
- Risk: 3
- Recommended next step: Split the store into a small harness-facing API plus focused mission/device/marker/drawing persistence modules with direct unit coverage.
- Bead needed: Probably, if the split crosses multiple sessions.

### Extract shared runtime bootstrap for app vs browser harness

- Area: `src/features/runtime/start-app-runtime.ts`, `src/features/mission/mission-browser-harness.ts`
- Why it matters: Both files perform very similar runtime/controller wiring, which invites parity drift when new subsystems or safety rules are added.
- Evidence: Mission, governance, marker, drawing, helicopter, GPX, and tracking setup logic is duplicated with only the concrete store/adapters changing.
- Impact: 4
- Complexity: 3
- Risk: 3
- Recommended next step: Extract a small runtime bootstrap helper that accepts the store/adapters and returns the controller bundle, then keep browser-harness-specific behavior as a thin wrapper.
- Bead needed: Not necessarily, but worth one if paired with other browser harness cleanup.

## Entry Template

Use this format:

### Title

- Area:
- Why it matters:
- Evidence:
- Impact:
- Complexity:
- Risk:
- Recommended next step:
- Bead needed:
