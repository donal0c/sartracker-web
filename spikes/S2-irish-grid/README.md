# R2: Irish Grid Coordinate Accuracy (TM65/NTv2)

## Risk Level: CRITICAL
## Status: 🔬 Needs deep research

## The Problem
TM65 (Irish Grid, EPSG:29902) is a historical datum. Converting between TM65 ↔ WGS84 requires more than a basic proj4 string. QGIS uses PROJ with NTv2 grid shift files to achieve sub-meter accuracy. A naive proj4js implementation can be off by 10-50 metres — catastrophic for cliff/ravine rescue.

## What We Know
- QGIS uses PROJ library with full NTv2 grid shift support
- proj4js supports TOWGS84 7-parameter transforms (included in the EPSG:29902 definition)
- The TOWGS84 approach gives ~5m accuracy (acceptable for most SAR use? needs validation)
- NTv2 grid shift files give sub-meter accuracy
- ITM (EPSG:2157) is the modern Irish projection — simpler to convert, no datum shift issues
- The team uses TM65 "Grid Reference 65" format extensively

## Research Needed
- [ ] What accuracy does the TOWGS84 7-param transform actually achieve for Kerry?
- [ ] Does proj4js support NTv2 grid shift files? (check proj4js docs/issues)
- [ ] What accuracy does the current QGIS plugin achieve? (test with known points)
- [ ] Is 5m accuracy acceptable for SAR operations? (ask Eamonn)
- [ ] Are there JavaScript libraries that handle Irish Grid better than proj4js?
- [ ] Can we extract the NTv2 grid for Ireland and bundle it?
- [ ] What does the current plugin's coordinates.py actually do? (read the code)

## Spike Criteria
✅ Convert 20+ known points through TM65→WGS84→TM65 roundtrip
✅ Compare results against QGIS output — max error < 5m (or whatever SAR deems acceptable)
✅ Bearing calculations match QGIS output within 0.1°
✅ Grid reference formatting matches current plugin output exactly
