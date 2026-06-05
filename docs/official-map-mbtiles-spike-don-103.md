# DON-103 Official Map MBTiles Conversion Spike

Last updated: 2026-06-05

## Result

MBTiles is viable for the first local official-map package implementation.

A standard MacGillycuddy Reeks / west Kerry operating-area package was generated from the licensed local Discovery GeoTIFF, outside the repo, as a Web Mercator PNG MBTiles package with zooms 9 through 16. GDAL can read it back as EPSG:3857, random tile reads are fast, and a generated preview visually confirms the package contains the expected Discovery mountain-map detail.

The generated package is private licensed map data and must not be committed, attached to public releases, or copied into repo fixtures.

## Source

Local private source, outside the repo:

`/Users/donalocallaghan/SARTracker-private-map-assets/team-usb-2026-06-03/Discovery_RGB_95pct_C70_high30.1953.tif`

Source facts from GDAL:

- CRS: EPSG:2157 / Irish Transverse Mercator
- Size: 152555 x 215370 pixels
- Bands: RGB byte
- Pixel size: about 2.228 m
- Internal overviews: present
- Source footprint: ITM `399993,500072` to `739928,979975`

## Candidate Region

The first standard-region package used a broad Reeks / west Kerry box around Carrauntoohil:

- WGS84 candidate bounds: west `-10.15`, south `51.73`, east `-9.35`, north `52.27`
- ITM crop window used for conversion: upper-left `451490,614004`, lower-right `507862,555260`
- MBTiles metadata bounds after reprojection: `-10.1754606234432643,51.7300171392163719,-9.33421258801235609,52.2700205977708876`

This is a little under a 60 km by 60 km operating box and includes the Reeks/Killarney/Dingle/Kenmare area.

## Toolchain

The machine does not currently have standalone Homebrew GDAL installed, but QGIS LTR provides GDAL 3.3.2:

`/Applications/QGIS-LTR.app/Contents/MacOS/bin/gdal_translate`

`/Applications/QGIS-LTR.app/Contents/MacOS/bin/gdaladdo`

For repeatable team/admin tooling, do not depend on QGIS being installed. `DON-104`/`DON-105` should assume packages are already prepared or should introduce an explicit bundled/admin preparation tool later.

## Conversion Commands

Generated outside the repo:

```bash
mkdir -p /Users/donalocallaghan/SARTracker-private-map-assets/don-103-mbtiles-spike/{scratch,packages,reports}

SRC=/Users/donalocallaghan/SARTracker-private-map-assets/team-usb-2026-06-03/Discovery_RGB_95pct_C70_high30.1953.tif
OUT=/Users/donalocallaghan/SARTracker-private-map-assets/don-103-mbtiles-spike/packages/reeks-standard-60km-z16.mbtiles

/Applications/QGIS-LTR.app/Contents/MacOS/bin/gdal_translate \
  -of MBTILES \
  -projwin_srs EPSG:2157 \
  -projwin 451490 614004 507862 555260 \
  -co TILE_FORMAT=PNG \
  -co ZOOM_LEVEL_STRATEGY=UPPER \
  -co NAME='SAR Tracker Discovery Reeks standard 60km z16' \
  "$SRC" "$OUT"

/Applications/QGIS-LTR.app/Contents/MacOS/bin/gdaladdo -r average "$OUT" 2 4 8 16 32 64 128
```

## Measurements

Output package:

`/Users/donalocallaghan/SARTracker-private-map-assets/don-103-mbtiles-spike/packages/reeks-standard-60km-z16.mbtiles`

| Metric | Result |
| --- | ---: |
| Final package size | 1.1 GB |
| Max zoom | 16 |
| Min zoom in metadata table | 9 |
| Total tile rows | 31,729 |
| z16 tile rows | 23,645 |
| Initial z16 conversion time | 447.83 s |
| Overview generation time | 450.93 s |
| Peak resident memory reported by `time` | about 3.0 GB |

Tile counts by zoom:

| Zoom | Tiles |
| ---: | ---: |
| 9 | 4 |
| 10 | 11 |
| 11 | 27 |
| 12 | 103 |
| 13 | 404 |
| 14 | 1,537 |
| 15 | 5,998 |
| 16 | 23,645 |

## Read Validation

Validation artifacts are outside the repo:

- Preview: `/Users/donalocallaghan/SARTracker-private-map-assets/don-103-mbtiles-spike/reports/reeks-standard-60km-z16-preview.png`
- Sample tile: `/Users/donalocallaghan/SARTracker-private-map-assets/don-103-mbtiles-spike/reports/sample-z16-tile.png`
- Conversion log: `/Users/donalocallaghan/SARTracker-private-map-assets/don-103-mbtiles-spike/reports/reeks-standard-60km-z16-conversion.log`

Checks performed:

- `gdalinfo` opens the MBTiles package as EPSG:3857 / Web Mercator.
- Metadata includes WGS84 bounds, min/max zoom, PNG format, and package name.
- Python `sqlite3` extracted a z16 `tile_data` PNG and Pillow verified it as 256 x 256 RGBA.
- 200 random tile blobs were read through SQLite and verified with Pillow in about 0.015 s total on this Mac.
- `gdal_translate -outsize 1200 0` generated a 1200 x 1251 PNG preview from the MBTiles package.

## Recommendation

Proceed with MBTiles for the first official offline package path.

Use z16 PNG for the first implementation unless package size becomes a problem on team laptops. The 1.1 GB standard-region package is large but practical for post-install/admin import, and it preserves the Discovery map linework and labels. This should be treated as a prepared package workflow, not an operator-in-the-field conversion step.

`DON-104` should add a cross-platform Electron package registry that records safe metadata and can validate:

- package path exists
- SQLite/MBTiles metadata can be read
- bounds and zoom range are available
- one or more sample tiles can be read
- no credentials or licensed tile bytes are copied into diagnostics, settings exports, GitHub, or hosted web

`DON-105` should serve package tiles through the Electron official-map proxy using the MBTiles `tiles` table. The renderer should still see only app-owned tile URLs, not private file paths.

## Follow-Up Questions

- Should the shipped/admin package use PNG only, or should a controlled JPEG/PNG8 size comparison be run before the first team package?
- Should the package preparation workflow be a separate admin script/tool rather than in-app conversion?
- What exact official standard-region bounds should the team lock for their first shared package?
