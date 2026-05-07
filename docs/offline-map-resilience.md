# Offline Map Resilience

SAR Tracker Web currently supports a field-ready viewed-tile workflow. It does not yet ship packaged offline basemap bundles.

## Operator Workflow

Before deployment, while network is available:

1. Open the mission area in the map.
2. Select the basemap expected for field use.
3. Pan and zoom through the expected search area at the working zoom levels.
4. Confirm the map shows `Viewed tiles cache ready`.
5. Repeat for any alternate basemap the team expects to use.

In the field, if network is unavailable:

1. Continue using the same basemap and area that was viewed during preparation.
2. Treat `Offline: viewed tiles only` as a warning that unvisited map tiles may be blank or degraded.
3. If the map reports degraded tile loading, keep coordinate, drawing, marker, tracking, and mission controls available, but do not assume unseen map areas are available offline.

## Failure Modes

- `Offline tiles unavailable`: the current browser/runtime cannot provide viewed-tile caching.
- `Offline tiles arming`: the tile cache worker has not yet taken control of the app.
- `Offline: viewed tiles only`: cached tiles can render, but unviewed tiles may be unavailable.
- Map degraded state: MapLibre reported clustered tile failures or a rendering failure.

## Current Scope

Implemented:

- operator-visible offline map readiness state
- service-worker/cache/browser support detection
- explicit offline viewed-tiles-only warning
- unit coverage for readiness states
- in-app field workflow documentation

Not yet implemented:

- packaged offline basemap bundle import
- offline coverage manifest by area/zoom
- preflight cache coverage report
- signed/distributed regional topo packages

## Manual Validation

1. Start SAR Tracker Web and open `http://127.0.0.1:1420/?missionHarness=1`.
2. Confirm the map chrome shows either `Viewed tiles cache ready` or `Offline tiles arming`.
3. Reload once if the service worker has just installed and still shows `Offline tiles arming`.
4. Use browser or OS network controls to go offline.
5. Confirm the badge changes to `Offline: viewed tiles only`.
6. Pan inside an area already viewed and confirm cached tiles continue rendering.
7. Pan outside the prepared area and confirm missing tiles produce explicit degraded map state rather than silently implying complete coverage.
