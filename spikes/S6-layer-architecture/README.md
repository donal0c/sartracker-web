# S6: Layer/Filter Architecture — Performance + Toggle Granularity

## The Problem
QGIS uses ~100 vector layers for SAR Tracker. MapLibre has a fundamentally different model. We need to determine the right architecture for managing visibility of devices, breadcrumbs, markers, and drawings — at scale, with good performance.

## Scale Requirements
- 30+ devices tracked simultaneously
- 8-hour mission at 30s intervals = ~28,800 breadcrumb points
- Multiple marker types (IPP, clues, hazards, casualties)
- Multiple drawing types (lines, polygons, range rings, bearing lines, sectors)
- All toggleable individually or by category

## Three Approaches

### Option A: Many MapLibre layers (QGIS-like)
One layer per device, one per drawing. Simple mental model, but potentially 100+ layers.
- Pro: Familiar to anyone who knows QGIS
- Con: MapLibre performance degrades with many layers (many draw calls)

### Option B: Few sources, filter-based visibility
3-4 GeoJSON sources (tracking, markers, drawings). Use MapLibre `filter` expressions.
- Pro: Best WebGL performance (fewer draw calls, batched rendering)
- Pro: Simpler to manage programmatically
- Con: Slightly more complex initial implementation

### Option C: Hybrid
Source per category (tracking, markers, drawings), filter per item.
- Pro: Balance of performance and granularity
- Pro: Natural grouping for the UI panel

## Performance Targets
- [ ] 30K breadcrumb points render at >30 FPS
- [ ] Toggle individual device: <100ms
- [ ] Toggle category (all clues): <50ms
- [ ] Smooth pan/zoom with all data visible

## UI Design
Instead of a QGIS-style layer tree, build a filter panel:
- **People**: toggle each team member (shows/hides their position + trail)
- **Markers**: toggle by type (IPP/LKP, Clues, Hazards, Casualties)
- **Drawings**: toggle by type or individual (search areas, rings, lines)
- **All On / All Off** buttons per category
