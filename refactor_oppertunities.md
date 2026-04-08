# Refactor Opportunities

These were intentionally skipped during the low-risk hardening pass because they touch behavior-bearing areas and would benefit from a more deliberate follow-up.

## `src/features/map/use-map-controller.ts`

- This hook still owns several responsibilities at once: MapLibre lifecycle setup, basemap switching, hover-coordinate state, and health-event handling.
- A future cleanup could split event wiring and map-health transitions into smaller modules so later tracking and drawing work does not accumulate into one long-lived orchestration hook.
- It was skipped in the hardening pass because this code sits directly on live map behavior, and a structural change here would carry more regression risk than the current boundary cleanup.

## `src/infrastructure/mission-store/tauri-mission-store.ts`

- The adapter is still large and mixes many mission-store type definitions with the command-forwarding implementation.
- A future cleanup could separate the shared data contracts from the invoke-based adapter so mission, device, marker, drawing, and event concerns are easier to extend independently.
- It was skipped in the hardening pass because the safer high-value move was to strengthen command-contract test coverage first rather than reshaping a broad persistence boundary.
