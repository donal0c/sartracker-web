# S3: Drawing Tools — Terra Draw Feature Parity

## Goal
Validate that Terra Draw + Turf.js can replicate all SAR-specific drawing tools from the QGIS plugin.

## Tools to validate
- [ ] Lines (routes, boundaries) with distance display
- [ ] Search Area polygons with metadata (team, status, POA, terrain)
- [ ] Range Rings: manual (n rings at custom radii) + LPB probability rings (25/50/75/95%)
- [ ] Bearing Lines: true + magnetic (with Ireland declination)
- [ ] Search Sectors: pie-slice shaped areas
- [ ] Measurement tool: distance + bearing between two points
- [ ] Select + edit drawn features
- [ ] Delete features

## Source Reference
`~/Documents/Qgis/sartracker/controllers/layer_managers/drawing_manager.py`
`~/Documents/Qgis/sartracker/utils/drawing_math.py`
`~/Documents/Qgis/sartracker/maptools/`

## Pass Criteria
- [ ] All 8 drawing modes work in MapLibre + Terra Draw
- [ ] Range ring geometry matches plugin output (verify radii in metres)
- [ ] Bearing line endpoint matches plugin output within 1m
- [ ] SAR metadata (POA, team, status) can be attached to drawn features
- [ ] Select/edit/delete works for all feature types
