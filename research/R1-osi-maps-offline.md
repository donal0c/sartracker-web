# R1: OSI Maps — Offline-First Strategy

## Risk Level: CRITICAL
## Status: ⏳ Waiting on Eamonn for MapGenie access details

## The Problem
The team relies on OSI Discovery Series 1:50,000 maps — contours, mountain peaks, spot heights, townland names, rivers, bog markings. Generic OpenStreetMap/OpenTopoMap is NOT equivalent. If the app can't show these maps offline, it's a non-starter.

## What We Know
- MapGenie migrated from AWS to ArcGIS Online (July 2024)
- Available via WMS, WMTS, ESRI REST API
- Available in Web Mercator (EPSG:3857) — MapLibre compatible
- Access requires National Mapping Agreement credentials or institutional access
- SAR teams likely qualify under public sector/emergency services access
- Kerry coverage = sheets 70, 71, 78, 83, 84, 85 (Discovery Series)

## Questions for Eamonn
1. What are your current MapGenie/OSI tile service connection details?
2. Do you have a username/password or token for MapGenie?
3. What QGIS layers are configured for the OSI maps? (screenshot of QGIS layer properties)
4. Are the maps loaded as local raster files (georeferenced JPGs) or via WMS/WMTS?
5. Would KMRT be open to requesting formal MapGenie access if not already set up?

## Research Needed
- [ ] Exact MapGenie WMTS endpoint URL format (post ArcGIS Online migration)
- [ ] Whether MapGenie tiles can be cached/downloaded for offline use (licensing)
- [ ] MapLibre raster tile source configuration for WMTS
- [ ] MBTiles/PMTiles conversion pipeline for pre-downloaded OSI rasters
- [ ] Quality comparison: MapGenie WMTS vs georeferenced raster at various zoom levels
- [ ] Fallback: OpenTopoMap contour quality for Kerry mountains

## Spike Criteria
✅ MapLibre renders OSI Discovery tiles at quality parity with QGIS
✅ Tiles load from local cache when network is disabled
✅ Kerry mountain area (MacGillycuddy's Reeks) renders with full contour detail
✅ Zoom levels 10-16 cover operational needs
