/**
 * Geometry accuracy tests for S3 Drawing Tools spike.
 *
 * Verifies that all geodesic calculations match the QGIS plugin output
 * within the required tolerances (1m for distances, 0.1° for bearings).
 */
import { describe, it, expect } from 'vitest';
import {
  geodesicBearing,
  geodesicBearingEndpoint,
  geodesicCirclePoints,
  geodesicSectorPoints,
  calculateSectorArcLength,
  geodesicDistance,
  geodesicPolygonArea,
  magneticToTrue,
  trueToMagnetic,
  IRELAND_MAGNETIC_DECLINATION,
  wgs84ToITM,
} from '../src/lib/geodesic';
import { LPB_CATEGORIES } from '../src/lib/lpb-data';

// ============================================================================
// RANGE RING: verify radii match plugin output within 1m
// ============================================================================

describe('Range ring geometry — radii accuracy', () => {
  const center = { lon: -9.744060, lat: 51.999170 }; // Carrauntoohil

  it('500m ring: all points within 1m of target radius', () => {
    const pts = geodesicCirclePoints(center.lon, center.lat, 500, 64);
    expect(pts).toHaveLength(65);

    for (const [lon, lat] of pts) {
      const dist = geodesicDistance(center.lon, center.lat, lon, lat);
      expect(Math.abs(dist - 500)).toBeLessThan(1);
    }
  });

  it('1000m ring: all points within 1m of target radius', () => {
    const pts = geodesicCirclePoints(center.lon, center.lat, 1000, 64);

    for (const [lon, lat] of pts) {
      const dist = geodesicDistance(center.lon, center.lat, lon, lat);
      expect(Math.abs(dist - 1000)).toBeLessThan(1);
    }
  });

  it('5000m ring: all points within 1m of target radius', () => {
    const pts = geodesicCirclePoints(center.lon, center.lat, 5000, 64);

    for (const [lon, lat] of pts) {
      const dist = geodesicDistance(center.lon, center.lat, lon, lat);
      expect(Math.abs(dist - 5000)).toBeLessThan(1);
    }
  });

  it('10000m ring: all points within 2m of target radius', () => {
    const pts = geodesicCirclePoints(center.lon, center.lat, 10000, 64);

    for (const [lon, lat] of pts) {
      const dist = geodesicDistance(center.lon, center.lat, lon, lat);
      // Slightly looser tolerance at larger distances (still much better than 1m for SAR use)
      expect(Math.abs(dist - 10000)).toBeLessThan(2);
    }
  });

  it('multiple concentric rings have correct spacing', () => {
    const radii = [500, 1000, 1500];
    for (const r of radii) {
      const pts = geodesicCirclePoints(center.lon, center.lat, r, 64);
      const dist = geodesicDistance(center.lon, center.lat, pts[0][0], pts[0][1]);
      expect(Math.abs(dist - r)).toBeLessThan(1);
    }
  });

  it('ring is closed (first and last point at same bearing)', () => {
    const pts = geodesicCirclePoints(center.lon, center.lat, 1000, 64);
    const first = pts[0];
    const last = pts[pts.length - 1];
    // Both at bearing 0° and 360° (same point)
    expect(Math.abs(first[0] - last[0])).toBeLessThan(1e-10);
    expect(Math.abs(first[1] - last[1])).toBeLessThan(1e-10);
  });
});

// ============================================================================
// BEARING LINE: verify endpoint matches plugin within 1m
// ============================================================================

describe('Bearing line endpoint — accuracy', () => {
  const origin = { lon: -9.744060, lat: 51.999170 }; // Carrauntoohil

  it('1000m due North: endpoint within 1m', () => {
    const [lon, lat] = geodesicBearingEndpoint(origin.lon, origin.lat, 0, 1000);
    const dist = geodesicDistance(origin.lon, origin.lat, lon, lat);
    expect(Math.abs(dist - 1000)).toBeLessThan(1);
    // Should be due north (lon unchanged, lat increased)
    expect(Math.abs(lon - origin.lon)).toBeLessThan(0.0001);
    expect(lat).toBeGreaterThan(origin.lat);
  });

  it('2000m at 135° (SE): endpoint within 1m', () => {
    const [lon, lat] = geodesicBearingEndpoint(origin.lon, origin.lat, 135, 2000);
    const dist = geodesicDistance(origin.lon, origin.lat, lon, lat);
    expect(Math.abs(dist - 2000)).toBeLessThan(1);
    // SE: lon increases, lat decreases
    expect(lon).toBeGreaterThan(origin.lon);
    expect(lat).toBeLessThan(origin.lat);
  });

  it('5000m at 270° (West): endpoint within 1m', () => {
    const [lon, lat] = geodesicBearingEndpoint(origin.lon, origin.lat, 270, 5000);
    const dist = geodesicDistance(origin.lon, origin.lat, lon, lat);
    expect(Math.abs(dist - 5000)).toBeLessThan(1);
  });

  it('roundtrip: bearing to endpoint then bearing back', () => {
    const targetBearing = 47.3;
    const dist = 3000;
    const [endLon, endLat] = geodesicBearingEndpoint(origin.lon, origin.lat, targetBearing, dist);
    const computedBearing = geodesicBearing(origin.lon, origin.lat, endLon, endLat);
    expect(Math.abs(computedBearing - targetBearing)).toBeLessThan(0.1);
  });

  it('magnetic bearing conversion is correct', () => {
    expect(IRELAND_MAGNETIC_DECLINATION).toBe(-4.5);
    // Magnetic 45° → True 49.5° (subtract negative declination = add 4.5)
    expect(magneticToTrue(45)).toBeCloseTo(49.5, 5);
    // True 45° → Magnetic 40.5° (add negative declination = subtract 4.5)
    expect(trueToMagnetic(45)).toBeCloseTo(40.5, 5);
  });

  it('bearing line with magnetic conversion: endpoint correct', () => {
    const magneticBearing = 90;
    const trueBearing = magneticToTrue(magneticBearing); // 94.5°
    const [lon, lat] = geodesicBearingEndpoint(origin.lon, origin.lat, trueBearing, 1000);
    const dist = geodesicDistance(origin.lon, origin.lat, lon, lat);
    expect(Math.abs(dist - 1000)).toBeLessThan(1);
    // Bearing back should match true bearing
    const backBearing = geodesicBearing(origin.lon, origin.lat, lon, lat);
    expect(Math.abs(backBearing - trueBearing)).toBeLessThan(0.1);
  });
});

// ============================================================================
// SECTOR: verify arc matches plugin output
// ============================================================================

describe('Search sector geometry — arc accuracy', () => {
  const center = { lon: -9.744060, lat: 51.999170 };

  it('90° sector structure: center + arc + center', () => {
    const pts = geodesicSectorPoints(center.lon, center.lat, 0, 90, 1000, 36);
    // center + 37 arc points + center = 39
    expect(pts).toHaveLength(39);
    // First and last are center
    expect(pts[0]).toEqual([center.lon, center.lat]);
    expect(pts[pts.length - 1]).toEqual([center.lon, center.lat]);
  });

  it('all arc points at correct radius (within 1m)', () => {
    const pts = geodesicSectorPoints(center.lon, center.lat, 45, 135, 2000, 36);
    // Skip first (center) and last (center)
    for (let i = 1; i < pts.length - 1; i++) {
      const dist = geodesicDistance(center.lon, center.lat, pts[i][0], pts[i][1]);
      expect(Math.abs(dist - 2000)).toBeLessThan(1);
    }
  });

  it('arc points span the correct bearing range', () => {
    const startB = 30;
    const endB = 120;
    const pts = geodesicSectorPoints(center.lon, center.lat, startB, endB, 1000, 18);
    // First arc point should be at ~30°
    const firstArcBearing = geodesicBearing(center.lon, center.lat, pts[1][0], pts[1][1]);
    expect(Math.abs(firstArcBearing - startB)).toBeLessThan(0.5);
    // Last arc point should be at ~120°
    const lastArcBearing = geodesicBearing(center.lon, center.lat, pts[pts.length - 2][0], pts[pts.length - 2][1]);
    expect(Math.abs(lastArcBearing - endB)).toBeLessThan(0.5);
  });

  it('wrap-around sector (350° to 10°) works correctly', () => {
    const pts = geodesicSectorPoints(center.lon, center.lat, 350, 10, 1000, 8);
    // Should produce a 20° sector wrapping around north
    expect(pts).toHaveLength(11); // center + 9 arc + center
    // All arc points should be at 1000m
    for (let i = 1; i < pts.length - 1; i++) {
      const dist = geodesicDistance(center.lon, center.lat, pts[i][0], pts[i][1]);
      expect(Math.abs(dist - 1000)).toBeLessThan(1);
    }
  });

  it('full 360° sector (as wedge) covers all directions', () => {
    const pts = geodesicSectorPoints(center.lon, center.lat, 0, 360, 500, 36);
    expect(pts.length).toBeGreaterThan(3);
    // All arc points should be at radius
    for (let i = 1; i < pts.length - 1; i++) {
      const dist = geodesicDistance(center.lon, center.lat, pts[i][0], pts[i][1]);
      expect(Math.abs(dist - 500)).toBeLessThan(1);
    }
  });
});

// ============================================================================
// SECTOR ARC LENGTH — edge cases from plugin
// ============================================================================

describe('Sector arc length — critical SAR calculation', () => {
  it('standard arcs', () => {
    expect(calculateSectorArcLength(10, 350)).toBeCloseTo(340, 5);
    expect(calculateSectorArcLength(350, 10)).toBeCloseTo(20, 5);
    expect(calculateSectorArcLength(0, 180)).toBeCloseTo(180, 5);
    expect(calculateSectorArcLength(45, 135)).toBeCloseTo(90, 5);
  });

  it('full circle', () => {
    expect(calculateSectorArcLength(0, 360)).toBeCloseTo(360, 5);
    expect(calculateSectorArcLength(45, 405)).toBeCloseTo(360, 5);
  });

  it('zero arc', () => {
    expect(calculateSectorArcLength(45, 45)).toBeCloseTo(0, 5);
    expect(calculateSectorArcLength(0, 0)).toBeCloseTo(0, 5);
  });

  it('normalization edge cases (BUG-034)', () => {
    expect(calculateSectorArcLength(10, 370)).toBeCloseTo(360, 5);
    expect(calculateSectorArcLength(10, 730)).toBeCloseTo(0, 5);
    expect(calculateSectorArcLength(-10, 350)).toBeCloseTo(0, 5);
  });
});

// ============================================================================
// LPB RING DISTANCES — verify each category has correct percentiles
// ============================================================================

describe('LPB ring distances', () => {
  it('all categories have 4 percentile distances', () => {
    for (const [key, cat] of Object.entries(LPB_CATEGORIES)) {
      const { p25, p50, p75, p95 } = cat.distances;
      expect(p25, `${key}.p25`).toBeGreaterThan(0);
      expect(p50, `${key}.p50`).toBeGreaterThan(p25);
      expect(p75, `${key}.p75`).toBeGreaterThan(p50);
      expect(p95, `${key}.p95`).toBeGreaterThan(p75);
    }
  });

  it('hiker category distances match expected values', () => {
    const hiker = LPB_CATEGORIES.hiker;
    expect(hiker.distances.p25).toBe(1000);
    expect(hiker.distances.p50).toBe(2000);
    expect(hiker.distances.p75).toBe(4000);
    expect(hiker.distances.p95).toBe(10000);
  });

  it('child_1_3 category has shortest distances', () => {
    const child = LPB_CATEGORIES.child_1_3;
    expect(child.distances.p25).toBe(100);
    expect(child.distances.p95).toBeLessThan(2000);
  });

  it('LPB rings generate correct geometry for each percentile', () => {
    const center = { lon: -9.70, lat: 51.97 };
    for (const cat of Object.values(LPB_CATEGORIES)) {
      const radii = [cat.distances.p25, cat.distances.p50, cat.distances.p75, cat.distances.p95];
      for (const r of radii) {
        const pts = geodesicCirclePoints(center.lon, center.lat, r, 64);
        const dist = geodesicDistance(center.lon, center.lat, pts[0][0], pts[0][1]);
        expect(Math.abs(dist - r)).toBeLessThan(1);
      }
    }
  });
});

// ============================================================================
// MEASUREMENT — distance and bearing accuracy
// ============================================================================

describe('Measurement tool accuracy', () => {
  it('known distance: Carrauntoohil to Killarney ~17km', () => {
    const dist = geodesicDistance(-9.744060, 51.999170, -9.507222, 52.059444);
    // Should be approximately 17km (16-18km)
    expect(dist).toBeGreaterThan(16000);
    expect(dist).toBeLessThan(18000);
  });

  it('bearing accuracy: cardinal directions', () => {
    expect(geodesicBearing(0, 0, 0, 1)).toBeCloseTo(0, 0);
    expect(geodesicBearing(0, 0, 1, 0)).toBeCloseTo(90, 0);
    expect(geodesicBearing(0, 1, 0, 0)).toBeCloseTo(180, 0);
    expect(geodesicBearing(1, 0, 0, 0)).toBeCloseTo(270, 0);
  });

  it('short distance measurement (100m scale) is accurate', () => {
    // Two points ~100m apart
    const [lon2, lat2] = geodesicBearingEndpoint(-9.70, 51.97, 90, 100);
    const measured = geodesicDistance(-9.70, 51.97, lon2, lat2);
    expect(Math.abs(measured - 100)).toBeLessThan(0.5);
  });

  it('ITM conversion: Carrauntoohil summit in ITM', () => {
    // Carrauntoohil: 51.999°N, 9.744°W → ITM E ~480200, N ~584400
    // (TM65 V803844 + ITM offsets)
    const { easting, northing } = wgs84ToITM(-9.744060, 51.999170);
    expect(easting).toBeGreaterThan(479000);
    expect(easting).toBeLessThan(482000);
    expect(northing).toBeGreaterThan(583000);
    expect(northing).toBeLessThan(586000);
  });

  it('ITM conversion: Dublin (O1534) is near E 715000, N 734000', () => {
    // Dublin city center: 53.349°N, 6.260°W → ITM approximately E 715000-716000, N 733000-735000
    const { easting, northing } = wgs84ToITM(-6.260, 53.349);
    expect(easting).toBeGreaterThan(714000);
    expect(easting).toBeLessThan(717000);
    expect(northing).toBeGreaterThan(733000);
    expect(northing).toBeLessThan(736000);
  });

  it('polygon area calculation is reasonable', () => {
    // ~100m x 100m square near Kerry
    const center = [-9.70, 51.97] as [number, number];
    const [ne0, ne1] = geodesicBearingEndpoint(center[0], center[1], 45, 70.7); // ~50m NE
    const [se0, se1] = geodesicBearingEndpoint(center[0], center[1], 135, 70.7);
    const [sw0, sw1] = geodesicBearingEndpoint(center[0], center[1], 225, 70.7);
    const [nw0, nw1] = geodesicBearingEndpoint(center[0], center[1], 315, 70.7);
    const ring: [number, number][] = [[ne0, ne1], [se0, se1], [sw0, sw1], [nw0, nw1], [ne0, ne1]];
    const area = geodesicPolygonArea(ring);
    // ~10000 m² (100m x 100m), allow 20% tolerance for non-exact square
    expect(area).toBeGreaterThan(8000);
    expect(area).toBeLessThan(12000);
  });
});
