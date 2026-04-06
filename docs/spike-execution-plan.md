# Spike Execution Plan

## S2: Irish Grid Accuracy (Starting NOW)

### What we learned from the plugin code:
1. **ITM (EPSG:2157) is the working CRS** — all internal coordinates stored in ITM
2. **TM65 is display-only** — used for Irish Grid Reference formatting (letter + digits)
3. **TM65 uses a PROJ string with TOWGS84 7-param transform** (not NTv2 grid shift)
4. **The plugin itself uses TOWGS84** — so if proj4js matches the same TOWGS84 string, we get the same accuracy as the plugin
5. **Drawing math is pure Python** — no QGIS imports, already portable
6. **Existing tests require real QGIS runtime** — we need to generate golden dataset first

### Key insight: 
The Gemini/GPT concern about NTv2 grid shifts may be overstated. The PLUGIN ITSELF uses TOWGS84 7-param, not NTv2. So we only need to match the plugin's accuracy, which uses the same approach we'd use in proj4js.

### Execution:
1. Generate golden dataset from QGIS (Kerry reference points through ITM→WGS84, WGS84→ITM, TM65 grid refs)
2. Build TypeScript spike with proj4js using same TOWGS84 params
3. Compare results — measure max error
4. Test Irish Grid reference formatting (letter + 5-digit)
5. Test bearing calculations against drawing_math.py

## S6: Layer Architecture (Starting NOW)

### Execution:
1. Build MapLibre prototype with synthetic SAR data
2. Test three approaches: many-layers vs few-sources vs hybrid
3. Performance benchmark with 30K breadcrumb points
4. Build filter panel prototype

## S3: Drawing Tools (After S2 validates coordinates)
## S5: Persistence (After S6 validates architecture)
## S1: Maps (Waiting on Eamonn)
## S4: Tauri Distribution (Last — least uncertain)
