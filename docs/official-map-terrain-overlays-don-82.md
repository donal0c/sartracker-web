# DON-82 Relief And Slope Raster Classification

Last updated: 2026-06-06

## Result

`relief_byte.tif` and `Slope_30plus.tif` should be treated as **optional terrain overlays**, not basemaps and not part of the first-pass Discovery basemap package.

They should remain behind the core official Discovery offline path until an explicit overlay import/rendering workflow is built. When added, both overlays should be off by default, visually subordinate to Discovery Topo, and labelled as decision-support context rather than authoritative safety guidance.

## Classification

| Raster | Classification | First safe role |
| --- | --- | --- |
| `relief_byte.tif` | Optional overlay | Terrain-shading context beneath operational overlays and above/beside Discovery, useful for visual terrain shape. |
| `Slope_30plus.tif` | Optional hazard overlay | Sparse steep-ground indicator for terrain-awareness planning. |

Neither raster should replace Discovery Topo. Discovery remains the operational basemap because it carries labels, tracks, contours, boundaries, and other map detail operators need.

## Source Facts

Private source assets remain outside the repo under the local SAR Tracker private map asset workspace.

Both rasters cover the same broad Ireland footprint:

| Metric | Value |
| --- | ---: |
| CRS | EPSG:2157 / Irish Transverse Mercator |
| Pixel size | 10 m |
| Raster size | 32,122 x 45,202 px |
| ITM footprint | `413995,515995` to `735215,968015` |
| Approx WGS84 footprint | west ~10.94W, south ~51.37N, east ~5.86W, north ~55.44N |

`relief_byte.tif`:

| Metric | Value |
| --- | ---: |
| File size | 621 MB |
| Bands | 3 x Byte RGB |
| Compression | LZW |
| Valid pixels | 100% |
| Band range | 0-255 |

The private preview shows a light, pre-rendered relief/shaded terrain image. It is visually useful but can obscure labels or create false confidence if shown too strongly.

`Slope_30plus.tif`:

| Metric | Value |
| --- | ---: |
| File size | 53 MB |
| Bands | 1 x Float32 gray |
| Compression | LZW |
| NoData | 0 |
| Valid pixels | ~0.3466% |
| Value range | 30 to ~89.97 |
| Mean valid value | ~38.61 |

This is a sparse mask of slopes at or above 30 degrees. It does not represent all hazardous terrain and should not be interpreted as a safe/unsafe classifier.

## Presentation Decision

### Relief Overlay

Use as a low-opacity visual context layer.

Recommended first presentation:

- Name: `Relief shading`
- Default state: off
- Default opacity: 20-30%
- Operator control: opacity slider, 0-60%
- Blend/order: above the official basemap raster only if MapLibre blending remains readable; otherwise package as an alternate terrain-context overlay style below SAR drawings/markers/tracking.
- Legend: minimal; this is visual terrain shading, not a measured hazard layer.

Warning copy:

> Relief shading is visual terrain context only. Keep Discovery Topo visible for operational map labels, tracks, contours, and boundaries.

### Slope Overlay

Use as a sparse steep-ground warning layer.

Recommended first presentation:

- Name: `Steep ground 30 deg+`
- Default state: off
- Default opacity: 45-60%
- Colour: high-contrast amber/orange/red ramp, with transparent NoData/0 pixels.
- Legend: `30 deg+ steep ground`, with optional buckets if the source values are preserved: `30-40`, `40-50`, `50+`.
- Interaction: no click-derived safety claims in v1; if inspection is later added, show the sampled value and source caveat.

Warning copy:

> Steep-ground overlay highlights source pixels at or above 30 degrees. Absence of highlighting does not mean terrain is safe. Verify with Discovery Topo, local knowledge, weather, ground conditions, and incident judgement.

## Coordinate And Packaging Requirements

Both source rasters are EPSG:2157 / ITM. The app map renderer is Web Mercator through MapLibre, with WGS84 coordinates at the UI boundary. Therefore overlays should be preprocessed into the same app-owned local package approach as official Discovery:

- Reproject to EPSG:3857 before serving to MapLibre.
- Package as local raster MBTiles or an equivalent app-owned tile package.
- Preserve bounds and zoom metadata for readiness/current-view checks.
- Keep source rasters, generated tile packages, and previews out of GitHub/public artifacts.
- Register overlays separately from basemap packages so they can have independent visibility, opacity, legend, and readiness states.
- Hosted web should not expose these private overlays unless a deliberate private hosted-map architecture is designed later.

Do not render the raw GeoTIFF directly in the operator app. Raw GeoTIFF reading/reprojection should stay in an admin/preparation workflow, not runtime map interaction.

## Implementation Notes For Future Work

Suggested follow-up slices:

1. Add an official terrain-overlay package registry that mirrors safe package metadata from official basemap packages but records overlay type, opacity defaults, legend metadata, and warnings.
2. Convert a small standard-area relief overlay and slope overlay to Web Mercator MBTiles outside the repo, then measure file size, tile counts, and readability over the Reeks standard area.
3. Add layer-panel controls for official overlays with explicit legends and warnings.
4. Validate operator readability in browser/Electron with Discovery Topo plus SAR drawings, markers, tracking, and each overlay enabled.

Acceptance guardrails for implementation:

- Relief must not make labels or SAR overlays hard to read.
- Slope must use transparent NoData and must never imply unhighlighted areas are safe.
- Overlay readiness should be independent from Discovery basemap readiness.
- Diagnostics may include safe metadata only: overlay id, status, bounds, zoom range, tile count, format, and verification time. No local source paths or licensed raster contents.

## Decision

Close `DON-82` as a classification/planning issue. Implementation should be tracked separately when the core Discovery package/import path is ready for overlay packages.
