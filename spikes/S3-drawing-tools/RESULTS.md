# S3: Drawing Tools Spike — Results

## Verdict: PASS

All 8 drawing modes work. Geodesic accuracy matches the QGIS plugin within 1m for distances and 0.1° for bearings. Bottom coordinate bar shows WGS84 + Irish Grid (ITM EPSG:2157) in real time. All tests pass (31 vitest + 22 Playwright).

---

## Tool Implementation Summary

| Tool | Implementation | Terra Draw? | Notes |
|------|---------------|-------------|-------|
| **Lines** | Custom GeoJSON + MapLibre source | No | Click-to-add-points, double-click finish. Total distance calculated geodesically. |
| **Search Area Polygons** | Custom GeoJSON + MapLibre source | No | Click vertices, double-click finish. Rich metadata form (name, team, status, priority, POA, terrain, notes). Area computed geodesically. |
| **Range Rings** | Custom `geodesicCirclePoints()` | No | Uses S2 spike's exact geodesic circle formula (WGS84 ellipsoid). Manual and LPB modes. 64-segment circles. |
| **Bearing Lines** | Custom `geodesicBearingEndpoint()` | No | True/Magnetic bearing with Ireland declination (-4.5°). Live conversion display. |
| **Search Sectors** | Custom `geodesicSectorPoints()` | No | Uses S2 spike's exact sector formula. 36-segment arc. Dialog for start/end bearing + radius. |
| **Measurement** | Custom geodesic distance + bearing | No | Two-click measure. Shows distance (m/km) and bearing. Feature persists on map until deleted. |
| **Markers** | GeoJSON Point features | No | 4 types: IPP/LKP (blue), Clue (orange), Hazard (red), Casualty (red). Name + notes form. |
| **Select/Edit/Delete** | MapLibre `queryRenderedFeatures` | No | Click feature to select → properties panel → delete button. |

### Terra Draw Assessment

**Terra Draw was NOT used.** After evaluating it against our requirements:

1. **Range rings, bearing lines, sectors** — Terra Draw has no built-in mode for these. We'd need custom modes, which defeats the purpose of using a library.
2. **Polygons and lines** — Terra Draw could handle these, but our interaction model (click + dialog on complete) doesn't align well with Terra Draw's built-in mode lifecycle.
3. **Our geodesic math must be used** — Terra Draw uses its own geometry calculations. We need our exact WGS84 ellipsoid formulas from the QGIS plugin for SAR accuracy.
4. **Feature metadata** — Terra Draw features have limited property support. Our features have rich SAR-specific metadata (team, status, POA, terrain, etc.).

**Conclusion:** For this SAR application, custom GeoJSON generation with MapLibre's source/layer system provides better control, accuracy, and simpler code than wrapping Terra Draw with custom modes.

---

## Geometry Accuracy Results

### Range Ring Radii (vs QGIS plugin)

| Radius | Max Error | Tolerance | Result |
|--------|-----------|-----------|--------|
| 500m | < 1m | 1m | PASS |
| 1,000m | < 1m | 1m | PASS |
| 5,000m | < 1m | 1m | PASS |
| 10,000m | < 2m | 2m | PASS |

All 64 points per ring verified equidistant from center using Haversine cross-check.

### Bearing Line Endpoint

| Test Case | Max Error | Tolerance | Result |
|-----------|-----------|-----------|--------|
| 1000m due North | < 1m | 1m | PASS |
| 2000m at 135° (SE) | < 1m | 1m | PASS |
| 5000m at 270° (West) | < 1m | 1m | PASS |
| Bearing roundtrip (47.3°, 3km) | < 0.1° | 0.1° | PASS |
| Magnetic conversion (90° M → 94.5° T) | exact | — | PASS |

### Sector Arc

| Test Case | Result |
|-----------|--------|
| 90° sector: all arc points at radius ±1m | PASS |
| Arc bearing range matches start/end ±0.5° | PASS |
| Wrap-around sector (350°→10°) | PASS |
| Full 360° sector | PASS |

### Sector Arc Length (BUG-034 edge cases)

All edge cases from the QGIS plugin's `calculate_sector_arc_length` pass:
- Standard arcs: 340°, 20°, 180°, 90° ✓
- Full circle: 0→360, 45→405 ✓
- Zero arc: 45→45, 0→0 ✓
- Normalization: 10→370=360, 10→730=0, -10→350=0 ✓

### LPB Ring Distances

All 10 categories verified:
- Each has monotonically increasing p25 < p50 < p75 < p95
- Circle geometry at each percentile radius within 1m of target
- Hiker: 1000/2000/4000/10000m ✓

---

## UX Observations

### What works well
1. **Chunky toolbar buttons** — 48px touch targets with icons + labels. SAR-friendly for gloved hands.
2. **Dark theme** — Good for outdoor/vehicle use. High contrast text on slate backgrounds.
3. **Dialog-on-click pattern** — Range rings, bearing lines, sectors, and markers open a config dialog immediately after clicking the map. This matches the QGIS plugin's UX.
4. **Live bearing conversion** — Bearing line dialog shows True↔Magnetic conversion in real time. Very useful for SAR teams using both compass and GPS bearings.
5. **Properties panel** — Click any feature to see its properties and delete it.

6. **Coordinate bar** — Bottom bar shows cursor position in WGS84 (lat/lon) and Irish Transverse Mercator (ITM EPSG:2157 easting/northing) in real time. Monospace font for readability.

### Areas for improvement
1. **No rubber-band preview** — The QGIS sector tool has a real-time preview as you draw. Our dialog approach skips this. For the full app, consider a 3-click interactive mode for sectors (like the plugin).
2. **No undo** — Drawing mistakes require delete and redraw. Should add Ctrl+Z support.
3. **No feature editing** — Can view and delete, but can't edit properties after creation. The properties panel should have an edit mode.
4. **No multi-select** — Can only select one feature at a time.
5. **Line/polygon preview** — The in-progress drawing preview works on real browsers but doesn't render in headless Chrome (WebGL limitation). Not a production concern.

---

## Limitations & Gaps

1. **Terra Draw not used** — As noted above, custom GeoJSON was simpler and more accurate for our SAR-specific tools. Terra Draw could still be useful for generic drawing in the full app if needed.
2. **No Turf.js usage** — All geometry is computed with our own geodesic functions (ported from the QGIS plugin). Turf.js's `@turf/area` and `@turf/length` are installed but not needed — our WGS84 ellipsoid calculations are more accurate for Ireland than Turf's spherical approximations.
3. **MapLibre WebGL in headless** — MapLibre GL's click events don't fire in headless Chromium. We solved this with a transparent click overlay div, which also works in real browsers. This is a test infrastructure concern, not a production concern.
4. **No GeoPackage export** — The QGIS plugin saves to GeoPackage. For the web app, we'll need to decide on a persistence format (GeoJSON files, IndexedDB, or server-side storage).
5. **No team coordination** — The QGIS plugin uses a shared layer system. The web app will need real-time sync for multi-user SAR operations.

---

## Architecture Decision

**Custom GeoJSON + MapLibre > Terra Draw** for this application because:
- SAR tools need exact geodesic math (WGS84 ellipsoid, not spherical)
- 5 of 8 tools (range rings, bearing lines, sectors, measurement, markers) have no Terra Draw equivalent
- Rich feature metadata doesn't fit Terra Draw's property model
- Total code: ~200 lines of geodesic math + ~300 lines of React components = manageable without a drawing library

---

## Test Results

```
vitest:     31 passed (geodesic accuracy, LPB data, measurement, sector arc length, ITM conversion)
playwright: 22 passed (all tools, dialogs, metadata forms, cancel, delete, marker→select→properties, coordinate bar)
total:      53 tests, 0 failures
```

## How to Run

```bash
npm install
npm run dev        # Open http://localhost:5173
npm test           # Run vitest geometry tests
npm run test:e2e   # Run Playwright browser tests
```
