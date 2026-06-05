# Official Map Offline Strategy

Last updated: 2026-06-05

## Decision

SAR Tracker should treat licensed official maps as a local map library that is installed or imported after the app is installed. The maps must not be committed to GitHub, bundled into public releases, or exposed through the hosted web app.

The first field-ready path should be a prepared offline package for the team's standard operating area, backed by a secondary mission-area package/prefetch workflow for less common locations. Viewed-tile cache remains a convenience only; it is not enough as the operational readiness story.

## Local Source Facts

The copied USB assets live outside the repo at `/Users/donalocallaghan/SARTracker-private-map-assets/team-usb-2026-06-03`.

The primary Discovery sources are:

| Source | Local size | Shape | Notes |
| --- | ---: | --- | --- |
| `Discovery_National.zip` | 995 MB compressed, 22.34 GB uncompressed | 250 GeoTIFF tiles plus world files | 2.116850 m pixels, mostly 9449 x 9449 px, EPSG:2157 / ITM |
| `Discovery_RGB_95pct_C70_high30.1953.tif` | 1.9 GB | single tiled GeoTIFF with internal overviews | 152555 x 215370 px, 2.228 m pixels, EPSG:2157 / ITM |
| `relief_byte.tif` | 621 MB | tiled RGB GeoTIFF | 10 m pixels, EPSG:2157 / ITM |
| `Slope_30plus.tif` | 53 MB | tiled float GeoTIFF | 10 m pixels, EPSG:2157 / ITM |

The national Discovery ZIP footprint is roughly ITM `399993,500073` to `739927,979975`, about 340 km by 480 km. A tight Reeks/Killarney standard region would likely intersect about 16 raw Discovery tiles, roughly 1.33 GB before conversion. A broader west-Kerry operating box would intersect about 44 raw tiles, roughly 3.66 GB before conversion.

## Why Raw Files Are Not The Runtime Format

The app's current MapLibre style consumes Web Mercator raster tiles through URL templates. The Discovery sources are EPSG:2157 / ITM rasters. MapLibre raster sources can render tiled images from `{z}/{x}/{y}` URL templates, but they are not a raw national GeoTIFF/ZIP renderer. The existing official-map path already works by asking MapGenie for Web Mercator export images per tile.

For offline field use, we therefore need a preparation step that converts the licensed ITM rasters into an app-readable Web Mercator tile package. The app should use that prepared package during incidents, not crop/reproject huge raw TIFF files live.

## Format Recommendation

Use an MBTiles-style SQLite raster tile package for the first implementation.

Reasons:

- MBTiles is a SQLite-based format for tiled map data and can contain raster tiles.
- The repo already ships `better-sqlite3` in Electron, so local package reading fits the existing runtime direction.
- The current official-map protocol can be extended to look up local package tiles before falling back to the online MapGenie export path.
- SQLite access is predictable in Electron and does not require exposing private map files through a public web server.

PMTiles remains worth evaluating later. It has strong MapLibre support through a protocol plugin and is attractive as a single-file static archive, but in this app it would still need careful Electron local-file/range access handling. MBTiles is the lower-risk v1 because the app already owns an Electron SQLite boundary.

Relevant references:

- MapLibre raster sources use raster tile URL templates: https://maplibre.org/maplibre-style-spec/sources/
- MapLibre has an example raster tile source using `{z}/{x}/{y}` tiles: https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/
- MBTiles stores tiled map data in SQLite and supports raster tiles: https://github.com/mapbox/mbtiles-spec
- GDAL can create/read raster MBTiles, but GDAL tooling is not currently installed on this machine: https://gdal.org/en/stable/drivers/raster/mbtiles.html
- PMTiles has MapLibre protocol support and can support raster archives: https://docs.protomaps.com/pmtiles/maplibre

## Operator Workflow

1. Admin installs SAR Tracker Electron.
2. Admin points SAR Tracker or a companion preparation tool at the licensed Discovery source files.
3. Admin chooses either the standard operating region or a mission-specific region.
4. The tool creates or registers a local official-map package.
5. SAR Tracker shows the package as ready only after it can read metadata, bounds, zoom levels, and sample tiles.
6. During a mission, the map uses the local package first.
7. If the operator leaves the package bounds, the app clearly says official offline coverage is unavailable for that area and offers online official maps if configured, otherwise public fallback maps.

## Platform Model

Official-map support must be designed across all target runtimes, not only Linux.

| Runtime | Official online maps | Official offline package | Notes |
| --- | --- | --- | --- |
| Electron on Linux | Yes, via local MapGenie source file and Electron proxy | Yes, required for field readiness | Highest immediate validation priority because Linux is the target field hardware risk. |
| Electron on macOS | Yes, same source/proxy model | Yes, same package format should work | Useful for development and admin prep; path handling and packaged file access still need validation. |
| Electron on Windows | Yes, same source/proxy model | Yes, same package format should work | Important for future team laptops; Windows path/dialog/package access must be tested separately. |
| Hosted web app | No private MapGenie credentials or private map files | No private official package import for now | Hosted web remains the fast testing/training lane with public fallback maps only unless a deliberate private server-side design is added later. |

The package format should be platform-neutral. MBTiles/SQLite fits that requirement because the same package file can be read on macOS, Windows, and Linux through the Electron runtime. The app still needs OS-specific validation for file pickers, path persistence, packaged access, diagnostics, and read performance.

## Required Operator States

- `Official offline map ready`: current view is inside a verified local package.
- `Outside official offline area`: map is working, but the current view is outside prepared official coverage.
- `Official map package missing`: a configured package path no longer exists.
- `Official map package unreadable`: file exists but metadata or tile reads fail.
- `Official online source configured`: MapGenie source can be used when network is available.
- `Official maps unavailable`: no local package and no configured online source.
- `Public fallback only`: operator can continue with public maps, but should not assume Discovery detail is available.

## Follow-Up Tasks

1. Spike converting a standard Discovery region to MBTiles.
2. Add an Electron local official-map package registry.
3. Extend the official-map proxy to serve local package tiles before online MapGenie exports.
4. Add operator-facing official offline readiness and area coverage states.
5. Validate a packaged Electron build fully offline against the local map package.
6. Separately measure full-national package size and performance before deciding whether it is a supported install option.

## Open Questions

- What exact mountain range/standard region should be the default package?
- What zoom range is operationally required for Discovery detail?
- Should conversion be an in-app admin workflow, a bundled companion tool, or a prepared package delivered by the team/map owner?
- Should packages be MBTiles only for v1, or should we keep the registry generic enough to add PMTiles later?
- How should package versioning/refresh work when the team's licensed map source changes?
