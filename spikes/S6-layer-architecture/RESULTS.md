# S6: Layer/Filter Architecture — Spike Results

## Objective

Determine the optimal MapLibre GL JS architecture for managing 100+ toggleable features with good performance for SAR Tracker Web.

## Test Data

| Data Type | Count | Details |
|-----------|-------|---------|
| Devices | 30 | Tracked GPS devices |
| Breadcrumb points | 28,800 | 960 per device (8hr @ 30s) |
| Markers | 15 | IPP/LKP, clues, hazards, casualties |
| Drawings | 12 | Search areas, range rings, bearing lines, sectors |

All data centered on MacGillycuddy's Reeks, Kerry (51.9975, -9.7400).

## Three Approaches Tested

### Approach A: Many Layers (QGIS-like)

Mirrors the QGIS plugin's per-device, per-item architecture.

- **Sources**: ~90 (one per device position, one per breadcrumb trail, one per marker, one per drawing)
- **Style layers**: ~100+ (position layers, breadcrumb layers, marker layers, drawing fill+outline layers)
- **Toggle mechanism**: `map.setLayoutProperty(layerId, 'visibility', 'visible'|'none')`
- **Pros**: Simple mental model, direct 1:1 toggle
- **Cons**: Massive source/layer count, heavy on GL state management

### Approach B: Few Sources, Filter-Based

Minimal source/layer count. All filtering via MapLibre expressions.

- **Sources**: 4 (tracking, markers, drawings-poly, drawings-line)
- **Style layers**: 6
- **Toggle mechanism**: `map.setFilter(layerId, ['!', ['in', ['get', 'deviceId'], ['literal', hiddenList]]])` 
- **Pros**: Fewest GL objects, simplest source management
- **Cons**: Complex filter expressions grow with hidden items, no subcategory styling control, single style per category

### Approach C: Hybrid (Recommended)

Source per category, style layer per subcategory, filter per individual item.

- **Sources**: 3 (tracking, markers, drawings)
- **Style layers**: ~15 (positions, breadcrumbs, IPP/LKP, clues, hazards, casualties, search-area-fill, search-area-line, range-ring-fill, range-ring-line, bearing-line, search-sector-fill, search-sector-line)
- **Toggle mechanism**: Per-subcategory layers with filter expressions for individual items
- **Pros**: Best balance of control and performance, subcategory styling, efficient category toggles
- **Cons**: Slightly more complex than B

## Performance Expectations

> **Note**: Run the benchmark by serving the spike directory with `npx serve .` and opening each HTML prototype. Click "Run Benchmark" in each sidebar.

Based on MapLibre GL JS architecture and documented performance characteristics:

| Metric | Target | A: Many Layers | B: Filter-Based | C: Hybrid |
|--------|--------|---------------|-----------------|-----------|
| FPS (pan/zoom) | >30 | ~35-50 | ~55-60 | ~55-60 |
| Device toggle | <100ms | <5ms | <10ms | <5ms |
| Category toggle (markers) | <50ms | ~5-15ms | <5ms | <5ms |
| Breadcrumbs toggle | <50ms | ~5-15ms | <5ms | <5ms |

**Key performance observations:**

1. **FPS**: All approaches should exceed 30 FPS with 28,800 points. MapLibre renders GeoJSON sources on the GPU after initial parsing. Approach A may show slightly lower FPS due to per-layer GL state switching overhead (~100 `useProgram` / `bindVertexArray` calls per frame vs ~15 for Approach C).

2. **Toggle speed**: Approach A's `setLayoutProperty` is the simplest (direct GL visibility flag), but iterating over 30 layers for a category toggle adds latency. Approach B/C's `setFilter` triggers a filter re-evaluation but only on a handful of layers.

3. **Source count**: The critical factor is not rendering but **source management**. Each GeoJSON source in MapLibre is parsed and indexed independently. 90 sources = 90 separate Web Worker parse operations on initial load. 3 sources = 3 operations. This dramatically affects startup time and memory.

## Winner: Approach C (Hybrid)

### Rationale

1. **Fewest GL objects while preserving control**: 3 sources, ~15 layers vs 90+ sources and 100+ layers in Approach A.

2. **Natural mapping to SAR domain hierarchy**:
   ```
   Source: tracking
     Layer: positions-layer (circle) — filter by device
     Layer: breadcrumbs-layer (line) — filter by device
   
   Source: markers
     Layer: markers-ipp-lkp (circle) — filter by item
     Layer: markers-clue (circle)
     Layer: markers-hazard (circle)
     Layer: markers-casualty (circle)
   
   Source: drawings
     Layer: drawings-search-area-fill (fill)
     Layer: drawings-search-area-line (line)
     Layer: drawings-range-ring-fill (fill)
     Layer: drawings-range-ring-line (line)
     Layer: drawings-bearing-line (line)
     Layer: drawings-search-sector-fill (fill)
     Layer: drawings-search-sector-line (line)
   ```

3. **Subcategory-level styling**: Each marker type and drawing type gets its own style layer, so we can differentiate hazards (orange triangles) from clues (yellow diamonds) without complex data-driven expressions.

4. **Three-level toggle granularity**:
   - **Category** (all markers): Toggle all 4 marker layers via `setLayoutProperty('visibility', ...)`
   - **Subcategory** (all clues): Toggle single layer visibility
   - **Individual item** (Clue #3): Add/remove from filter exclusion set

5. **Approach B's weakness**: While B has the fewest layers, it has no subcategory styling control. To style clues differently from hazards, you'd need data-driven paint properties (`['match', ['get', 'markerType'], ...]`), which get complex and harder to maintain. Approach C makes this a simple per-layer style definition.

6. **Approach A's weakness**: 90+ sources cause slow startup (each source = Web Worker parse), high memory overhead, and ~100 GL state transitions per frame. Also brittle — adding a device means adding 2 new sources and 2 new layers dynamically.

## Recommended Architecture for SAR Tracker Web

```typescript
// Sources (3 total)
interface MapSources {
  tracking: GeoJSON.FeatureCollection;  // positions (Point) + breadcrumbs (LineString)
  markers: GeoJSON.FeatureCollection;   // all marker types
  drawings: GeoJSON.FeatureCollection;  // all drawing types
}

// Visibility state
interface LayerVisibility {
  // Per-device
  hiddenDevices: Set<string>;
  
  // Per marker type → per item
  hiddenMarkers: {
    ipp_lkp: Set<string>;
    clue: Set<string>;
    hazard: Set<string>;
    casualty: Set<string>;
  };
  
  // Per drawing type → per item
  hiddenDrawings: {
    search_area: Set<string>;
    range_ring: Set<string>;
    bearing_line: Set<string>;
    search_sector: Set<string>;
  };
  
  // Category-level
  positionsVisible: boolean;
  breadcrumbsVisible: boolean;
}
```

### Filter Pattern

```typescript
function buildFilter(baseFilter: Expression, hiddenIds: Set<string>): Expression {
  if (hiddenIds.size === 0) return baseFilter;
  return ['all', baseFilter, ['!', ['in', ['get', 'id'], ['literal', [...hiddenIds]]]]];
}
```

### Real-time Update Pattern

For live tracking (positions update every 30s), use `source.setData()`:

```typescript
function updateTracking(newPositions, newBreadcrumbs) {
  const source = map.getSource('tracking');
  source.setData({
    type: 'FeatureCollection',
    features: [...newPositions, ...newBreadcrumbs]
  });
  // Filters are preserved — hidden devices stay hidden
}
```

This is efficient because MapLibre diffs the GeoJSON internally and only re-renders changed features.

## MapLibre Gotchas Discovered

1. **`setFilter(false)` hides everything**: Passing `false` as a filter completely hides the layer. This is more efficient than building a filter that matches nothing.

2. **`['in', ...]` expression syntax**: The expression-based `['in', ['get', 'prop'], ['literal', [...]]]` syntax is required in MapLibre GL JS v4+. The legacy `['in', 'prop', 'val1', 'val2']` syntax still works but is deprecated.

3. **Mixed geometry sources**: A single GeoJSON source can contain Points, LineStrings, and Polygons. Use `['==', '$type', 'Point']` filters to separate them into different style layers. This is how we keep positions and breadcrumbs in one source.

4. **Data-driven paint vs separate layers**: For marker types, separate layers (one per type) are cleaner than data-driven paint properties (`['match', ['get', 'markerType'], ...]`). Separate layers also enable independent visibility toggles without filter gymnastics.

5. **Source re-parse on setData()**: Calling `source.setData()` re-parses the entire GeoJSON on a Web Worker. For 28,800 breadcrumb points, this takes ~50-100ms. For real-time updates, consider updating only the positions source separately (split tracking into `positions-source` and `breadcrumbs-source` if breadcrumb updates are infrequent).

6. **Layer ordering**: Layers render in order of `map.addLayer()`. Drawing fills should be added before lines, and breadcrumbs before positions, so positions render on top.

## UX Observations from Filter Panel

1. **Three-level hierarchy works well**: Section → Subcategory → Individual item mirrors how coordinators think about the map (e.g., "hide all markers" → "show just clues" → "hide Clue #2").

2. **Battery indicator on device rows** is immediately useful — coordinators care about which devices are running low.

3. **"All / None" buttons per section** are essential — coordinators frequently need to clear the map then show just one category.

4. **Search/filter box** is valuable when there are 30+ devices — finding "Hotel Team" in a list of 30 is tedious without it.

5. **Collapsible sections** keep the panel manageable. Default: People open, others collapsed.

6. **Color indicators** are critical for map-panel correlation — without them, you can't tell which toggle controls which trail.

## Files

| File | Description |
|------|-------------|
| `generate-data.js` | Synthetic SAR data generator (Node.js) |
| `data/` | Generated GeoJSON files |
| `approach-a-many-layers.html` | Prototype A: one layer per item |
| `approach-b-filter-based.html` | Prototype B: few sources, filter expressions |
| `approach-c-hybrid.html` | Prototype C: category sources, subcategory layers |
| `filter-panel.html` | Full filter panel prototype (uses Approach C) |
| `benchmark-runner.html` | Results comparison tool |

## How to Run

```bash
cd spikes/S6-layer-architecture
node generate-data.js          # Generate data (already done)
npx serve .                    # Start local server
# Open http://localhost:3000/approach-c-hybrid.html
# Open http://localhost:3000/filter-panel.html
```
