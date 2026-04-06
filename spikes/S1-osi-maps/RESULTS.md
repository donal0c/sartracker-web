# S1: OSI Maps — Spike Results

## Status: PASS

All pass criteria met. MapLibre GL JS renders multiple basemaps, basemap switching is smooth, coordinate display works in both WGS84 and Irish Grid, and offline tile caching works via the Cache API + Service Worker.

---

## Basemap Quality Assessment

### OpenTopoMap (default, recommended for SAR)
- **Contour lines**: Yes — clear contour lines on MacGillycuddy's Reeks, Carrauntoohil visible
- **Detail**: Shows spot heights, peak names, rivers, bog markings
- **Max zoom**: 17 (sufficient for SAR operations at 1:25k equivalent)
- **Verdict**: Best free topo option for mountain rescue. Missing OSI-specific features (townland boundaries, trigpoints) but contour quality is good

### ESRI World Topo
- **Contour lines**: Yes, but sparser than OpenTopoMap at zoom 12-14
- **Detail**: Good road/settlement detail, but mountain detail is weaker
- **Max zoom**: 19
- **Verdict**: Useful as secondary layer for urban/road context

### OpenStreetMap
- **Contour lines**: None
- **Detail**: Good trail/road data, place names, POIs
- **Max zoom**: 19
- **Verdict**: Not suitable as primary SAR basemap — no terrain detail. Useful for access roads/trailheads

### ESRI Satellite
- **Contour lines**: None (photographic)
- **Detail**: High-res aerial imagery — excellent for terrain texture, cliff identification
- **Max zoom**: 19
- **Verdict**: Essential secondary layer for terrain assessment

## Tile Source Comparison Summary

| Source | Contours | Mountain Detail | Max Zoom | SAR Suitability |
|--------|----------|----------------|----------|----------------|
| OpenTopoMap | Excellent | Good | 17 | Primary |
| ESRI Topo | Moderate | Fair | 19 | Secondary |
| OSM | None | N/A | 19 | Access routes only |
| ESRI Satellite | N/A | Photographic | 19 | Terrain assessment |

## Offline Caching Results

### Architecture
- **Service Worker** (`public/sw.js`): Network-first strategy for tile requests
- **Cache API**: Uses `caches.open('sartracker-tiles-v1')` for persistent storage
- **Pre-cache**: Batch downloads tiles for Kerry bounding box at zoom 10-15

### Test Results
- Online → tiles load from network, copies stored in Cache API
- Service worker intercepts tile requests matching known tile URL patterns
- Pre-cache button generates ~850 tile requests for Kerry area (zoom 10-15)
- When offline, cached tiles served from Cache API; uncached tiles show transparent placeholder

### Limitations
- Service Worker requires HTTPS in production (works on localhost for dev)
- Cache API storage varies by browser (~50MB default, up to 1GB with permission)
- Pre-cache covers ~850 tiles for zoom 10-15 — roughly 10-20MB for Kerry area
- No tile expiry logic yet — tiles remain cached indefinitely

## GeoPackage Conversion Pipeline

When the KMRT_package.gpkg file is available (1.25GB, EPSG:2157 ITM, raster tiles, 9 zoom levels):

```bash
# Step 1: Reproject from ITM to Web Mercator (MapLibre requirement)
gdalwarp -t_srs EPSG:3857 KMRT_package.gpkg kmrt_3857.gpkg

# Step 2: Convert to MBTiles (SQLite-backed tile store)
gdal_translate -of MBTILES kmrt_3857.gpkg kmrt.mbtiles

# Step 3: Generate overview tiles
gdaladdo kmrt.mbtiles 2 4 8 16
```

In the Tauri desktop app:
1. Register a `mbtiles://` custom protocol handler
2. Read tile bytes from MBTiles SQLite: `SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?`
3. Add as MapLibre raster source: `tiles: ['mbtiles://kmrt/{z}/{x}/{y}']`

Note: The reprojection step (EPSG:2157 → EPSG:3857) is critical — MapLibre only renders Web Mercator tiles.

## Coordinate Display

- WGS84 decimal degrees with directional suffixes (e.g., `51.970000°N, 9.700000°W`)
- Irish Grid (TM65) references using proj4js (e.g., `V 82345 84123`)
- Updates in real-time as cursor moves over the map
- proj4js conversion verified against S2 spike reference implementation

## Recommendation: Production Basemap Strategy

1. **Primary (offline)**: OSI Discovery Series via KMRT GeoPackage → MBTiles → Tauri custom protocol
2. **Primary (online fallback)**: OpenTopoMap — best free contour detail
3. **Secondary (online)**: ESRI Satellite — terrain assessment overlay
4. **Tertiary (online)**: ESRI World Topo / OSM — road/settlement context

The layer switcher architecture supports adding/removing sources at runtime, so the OSI tiles can slot in as a new basemap option once the GeoPackage is available.

## Test Results

### Vitest (23 tests)
- `tile-sources.test.ts` — 9 passed (URL construction, source definitions, cache keys)
- `coordinates.test.ts` — 5 passed (WGS84 ↔ TM65 conversion, grid formatting)
- `basemap-state.test.ts` — 5 passed (state management, localStorage persistence)
- `cache-tiles.test.ts` — 4 passed (tile generation for bounding box)

### Playwright E2E (6 tests)
- Map loads canvas — passed
- Basemap switcher visible with all options — passed
- Basemap switching works — passed
- Coordinate display updates on mouse move — passed
- Pre-cache button visible — passed
- Online status indicator visible — passed

## Pass Criteria Checklist

- [x] MapLibre renders at least 3 different basemaps (4 implemented)
- [x] Basemap switching works smoothly (preserves center/zoom)
- [x] OpenTopoMap shows contour lines on Kerry mountains
- [x] Coordinate display shows both WGS84 and Irish Grid
- [x] Offline cache serves tiles when network is disabled
- [x] All tests pass (23 unit + 6 E2E)
