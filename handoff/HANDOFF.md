# HANDOFF.md — Live Baton

> Read this before doing any work. Update it after every meaningful chunk of work.

## How To Use This File

- Keep this file short.
- This is the live baton, not the full project diary.
- Beads are the task tracker.
- `docs/areas-to-investigate.md` is the rolling improvement queue.
- If parity evidence changes, update the parity docs and summarize the outcome here.
- Put older detailed history in `handoff/archive/`, not here.

## Last Updated

- 2026-04-13 01:15 by Codex (layer visibility/runtime parity fix complete, full validation green on stable Playwright concurrency)

## Current State

- UI/UX audit work is present locally on `feat/ui-ux-audit-critical` and has now been revalidated alongside the latest hardening.
- The layer tree/catalog and the live map overlays now share an authoritative visibility path again.
- The specific `Map Tools` failure reported in live use is fixed:
  - group visibility now gates drawing, marker, measurement, helicopter, GPX, and tracking overlay channels correctly
  - stale layer-catalog refreshes can no longer overwrite a just-clicked visibility change
  - layer-catalog runtime now hydrates the visibility store at the store/runtime boundary instead of relying on a fragile React bridge effect
- Playwright concurrency is intentionally reduced to `2` workers for deterministic local validation. This is slower, but it makes the harness reliable under full-suite load.

## Last Work Done

**Layer visibility + parity hardening**

- Root cause fixed: the layer catalog was persisting and rebuilding correctly, but the visibility store was not being hydrated reliably from that runtime. That allowed the layer tree to look right while the map still rendered stale overlay state.
- Hardened files:
  - `src/features/layers/layer-catalog-store.ts`
  - `src/features/layers/layer-visibility-store.ts`
  - `src/features/layers/start-layer-catalog-runtime.ts`
  - `src/features/layers/effective-overlay-visibility.ts`
  - `src/features/map/use-map-overlays.ts`
  - `src/features/map/use-map-drawing-overlays.ts`
  - `src/features/map/use-map-measurement-overlays.ts`
  - `src/features/map/use-map-gpx-overlays.ts`
  - `src/features/map/use-map-helicopter-overlays.ts`
- Test hardening added:
  - new unit coverage for visibility derivation and store hydration
  - new runtime race test for stale layer-catalog refresh suppression
  - expanded Playwright parity assertions for `Map Tools` cascade and map filter propagation
  - multiple E2E helpers hardened to click the real MapLibre canvas instead of the shell container
- UI audit changes from Claude were reviewed and retained:
  - sidebar tabs
  - shared workspace overlay/header
  - mission control visual hierarchy
  - coordinate bar improvements
  - empty-state copy/panel polish

## Active Work

- No active implementation in progress.
- Current branch is `feat/ui-ux-audit-critical`.
- Next recommended implementation bead remains **`sartracker-web-2jk.13` — M24 focus mode parity** once this branch is committed/pushed.

## Open Beads That Matter Now

- `sartracker-web-2jk.14` — offline map resilience parity
- `sartracker-web-2jk.2` — replay / training mode parity
- `sartracker-web-2jk.13` — focus mode parity
- `sartracker-web-2jk.15` — final parity acceptance sweep
- `sartracker-web-bsl` — sections 13-16 not triple-verified in deep UI validation

## Known Parity Gaps

- `LPV-029` — mission metadata/coordinator dialog missing in mission-start flow
- `LPV-061` — layer tree type filter missing
- `LPV-068` — layer tree context menu actions missing
- `LPV-069` — bulk layer actions / tracking protections missing

## Next Actions

1. Commit and push the validated `feat/ui-ux-audit-critical` branch.
2. Start **M24 focus mode parity**.
3. Keep Playwright workers at `2` unless the harness/runtime model changes enough to justify re-raising concurrency.

## Verification Snapshot

- `npm run lint` ✅
- `npm run test` → 69 files / 326 tests ✅
- `npm run build` ✅
- `npm run test:e2e` → 79/79 passing with `workers: 2` ✅
- Verified parity batches:
  - Batch 1 visibility ✅
  - Batch 2 layer tree/console ✅
  - Batch 3 tracking/devices ✅
  - Batch 4 mission lifecycle ✅

## Archive

- Older detailed handoff history: [handoff/archive/HANDOFF-history-2026-04-11.md](/Users/donalocallaghan/workspace/vibes/sartracker-web/handoff/archive/HANDOFF-history-2026-04-11.md)
