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

## Temporary Hardening Board

The deep hardening investigation from 2026-05-13 is the temporary execution board for the current improvement campaign. Use it while the campaign is active, but do not treat it as durable project documentation. When the backlog is worked through, delete the ephemeral board and leave durable outcomes in beads, tests, source docs, and `handoff/HANDOFF.md`.

- Report: `docs/reports/deep-hardening-investigation-2026-05-13.md`
- Task board: `docs/hardening-backlog/INDEX.md`
- Subagent evidence: `tmp/hardening-investigation-2026-05-13/w1-*.md`

Top recommended next three:

1. **T01 — Docs / bead repo-ID reconciliation (Phase 0).** Update OVERVIEW, bead-readiness, parity matrices; run `bd migrate --update-repo-id`; trim this file.
2. **T02 + T03 — Governance atomicity + finished-mission write guard.** Two small Rust changes that close the most direct life-safety correctness gaps (`set_non_operational_status` is non-transactional; `ensure_mission_mutable` allows writes to `finished` missions).
3. **T05 — Unify Tauri + browser-harness boot via `startCoreFeatureRuntimes`.** Single biggest unlock for everything else and removes Tauri leaks from the harness.

## Active Candidates

### Extract shared runtime bootstrap for app vs browser harness

- Area: `src/features/runtime/start-app-runtime.ts`, `src/features/mission/mission-browser-harness.ts`
- Why it matters: Both files perform very similar runtime/controller wiring, which invites parity drift when new subsystems or safety rules are added.
- Evidence: Mission, governance, marker, drawing, helicopter, GPX, and tracking setup logic is duplicated with only the concrete store/adapters changing. See hardening task **T05**.
- Impact: 5
- Complexity: 3
- Risk: 3
- Recommended next step: Extract `startCoreFeatureRuntimes(store, adapters)` that both boot paths call; replace the harness's Tauri `ingestMarkerAttachment` with a no-op adapter; make the layer-catalog and mission-review runtime bridges harness-aware.
- Bead needed: Yes, once `bd` repo-ID is fixed.

### Extract `layer-visibility-service` out of `layer-filter-panel.tsx`

- Area: `src/components/layer-filter-panel.tsx`, `src/features/layers/`
- Why it matters: The authoritative visibility-patch engine (`applyVisibilityForNodes`, ~90 lines of raw catalog-ID prefix matching) lives inside a UI component. Future reorganization cannot safely move or split the layer panel until this is extracted.
- Evidence: See hardening task **T07** and subagent W1.b seams #1, #2.
- Impact: 5
- Complexity: 3
- Risk: 3
- Recommended next step: Move `applyVisibilityForNodes`, `setSubtreeVisibility`, and `reorderNodeRelative` into `src/features/layers/layer-visibility-service.ts`, using `layer-catalog-ids.ts` as the single ID-translation source. Remove the cross-store `hydrateCatalogVisibility` write from inside the Zustand `set` callback in `layer-catalog-store.ts`.
- Bead needed: Yes.

### Decompose browser harness store

- Area: `src/features/browser-validation/browser-harness-store.ts`
- Why it matters: At ~1000 lines it is the largest TypeScript file in the repo and mixes harness API plumbing with mission/device/marker/drawing persistence. Harder to safety-review and easy to drift against production persistence.
- Evidence: Largest file in the repo; also note `getRecoverableMission` has hidden write semantics (pauses the active mission when called).
- Impact: 4
- Complexity: 4
- Risk: 3
- Recommended next step: After T05 lands, split the store into a small harness-facing API plus focused mission/device/marker/drawing modules with direct unit coverage. Remove the write side-effect from `getRecoverableMission`.
- Bead needed: Yes.

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
