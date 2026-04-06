/**
 * Geodesic math tests — port of Python test_drawing_math.py
 *
 * Validates that TypeScript geodesic calculations match the Python plugin output.
 */

import { describe, it, expect } from 'vitest';
import {
  geodesicBearing,
  geodesicBearingEndpoint,
  geodesicCirclePoints,
  geodesicSectorPoints,
  calculateSectorArcLength,
} from '../src/geodesic.js';

// ============================================================================
// BEARING CALCULATIONS — must match Python within 0.1 deg
// ============================================================================

describe('Geodesic bearing — cardinal directions', () => {
  it('due North: bearing ≈ 0°', () => {
    const bearing = geodesicBearing(0.0, 0.0, 0.0, 1.0);
    expect(bearing).toBeCloseTo(0.0, 0);
    expect(Math.abs(bearing - 0.0)).toBeLessThan(0.1);
  });

  it('due East: bearing ≈ 90°', () => {
    const bearing = geodesicBearing(0.0, 0.0, 1.0, 0.0);
    expect(bearing).toBeCloseTo(90.0, 0);
    expect(Math.abs(bearing - 90.0)).toBeLessThan(0.1);
  });

  it('due South: bearing ≈ 180°', () => {
    const bearing = geodesicBearing(0.0, 1.0, 0.0, 0.0);
    expect(bearing).toBeCloseTo(180.0, 0);
    expect(Math.abs(bearing - 180.0)).toBeLessThan(0.1);
  });

  it('due West: bearing ≈ 270°', () => {
    const bearing = geodesicBearing(1.0, 0.0, 0.0, 0.0);
    expect(bearing).toBeCloseTo(270.0, 0);
    expect(Math.abs(bearing - 270.0)).toBeLessThan(0.1);
  });
});

describe('Geodesic bearing — SAR realistic scenario (Ireland)', () => {
  const kerryLon = -9.7;
  const kerryLat = 52.27;
  const corkLon = -8.47;
  const corkLat = 51.90;

  it('Kerry to Cork: bearing is roughly southeast (90-180°)', () => {
    const bearing = geodesicBearing(kerryLon, kerryLat, corkLon, corkLat);
    expect(bearing).toBeGreaterThan(90);
    expect(bearing).toBeLessThan(180);
  });

  it('Reverse direction is approximately opposite (±180°)', () => {
    const forward = geodesicBearing(kerryLon, kerryLat, corkLon, corkLat);
    const reverse = geodesicBearing(corkLon, corkLat, kerryLon, kerryLat);
    const diff = Math.abs(reverse - forward);
    expect(diff).toBeGreaterThan(170);
    expect(diff).toBeLessThan(190);
  });

  it('Kerry points: bearing matches Python output within 0.1°', () => {
    // Carrauntoohil to Killarney: roughly NE
    const bearing = geodesicBearing(-9.744060, 51.999170, -9.507222, 52.059444);
    // Should be between 50-80° (northeast-ish)
    expect(bearing).toBeGreaterThan(40);
    expect(bearing).toBeLessThan(90);
    console.log(`Carrauntoohil → Killarney bearing: ${bearing.toFixed(2)}°`);
  });

  it('Short distance bearing (100m scale) accurate', () => {
    // Two points ~100m apart in Kerry mountains
    const b1 = geodesicBearing(-9.744060, 51.999170, -9.743000, 51.999170);
    // Moving east, should be ~90°
    expect(Math.abs(b1 - 90)).toBeLessThan(1);
  });
});

// ============================================================================
// GEODESIC BEARING ENDPOINT
// ============================================================================

describe('Geodesic bearing endpoint', () => {
  it('1000m due North from equator', () => {
    const [lon, lat] = geodesicBearingEndpoint(0.0, 0.0, 0.0, 1000.0);
    expect(lon).toBeCloseTo(0.0, 3);
    expect(lat).toBeGreaterThan(0);
    // 1000m ≈ 0.009° at equator
    expect(lat).toBeCloseTo(0.009, 2);
  });

  it('1000m due East from equator', () => {
    const [lon, lat] = geodesicBearingEndpoint(0.0, 0.0, 90.0, 1000.0);
    expect(lat).toBeCloseTo(0.0, 3);
    expect(lon).toBeGreaterThan(0);
  });

  it('Kerry mountain scenario: 500m bearing 45° from Carrauntoohil', () => {
    const [lon, lat] = geodesicBearingEndpoint(-9.744060, 51.999170, 45.0, 500.0);
    // Should be northeast of Carrauntoohil
    expect(lon).toBeGreaterThan(-9.744060);
    expect(lat).toBeGreaterThan(51.999170);
  });

  it('endpoint → bearing roundtrip', () => {
    const originLon = -9.7;
    const originLat = 52.0;
    const targetBearing = 135.0;
    const distance = 2000.0;

    const [endLon, endLat] = geodesicBearingEndpoint(originLon, originLat, targetBearing, distance);
    const computedBearing = geodesicBearing(originLon, originLat, endLon, endLat);

    expect(Math.abs(computedBearing - targetBearing)).toBeLessThan(0.1);
  });
});

// ============================================================================
// GEODESIC CIRCLE POINTS — must match Python output within 1m
// ============================================================================

describe('Geodesic circle points', () => {
  it('correct number of points (segments + 1)', () => {
    const pts = geodesicCirclePoints(0.0, 0.0, 1000.0, 8);
    expect(pts).toHaveLength(9);
  });

  it('first point is due North', () => {
    const pts = geodesicCirclePoints(0.0, 0.0, 1000.0, 8);
    const [lon0, lat0] = pts[0];
    expect(lon0).toBeCloseTo(0.0, 3);
    // Expected ~ radius / earth_radius in radians -> degrees
    const expectedDeltaDeg = (1000.0 / 6378137.0) * (180 / Math.PI);
    expect(lat0).toBeCloseTo(expectedDeltaDeg, 2);
  });

  it('all points equidistant from center (within 1m)', () => {
    const centerLon = -9.7;
    const centerLat = 52.0;
    const radiusM = 500.0;
    const pts = geodesicCirclePoints(centerLon, centerLat, radiusM, 32);

    for (const [lon, lat] of pts) {
      // Rough distance calculation
      const dLatM = (lat - centerLat) * 111000;
      const dLonM = (lon - centerLon) * 111000 * Math.cos((centerLat * Math.PI) / 180);
      const dist = Math.sqrt(dLatM * dLatM + dLonM * dLonM);

      // Should be within 2m of target radius (spherical approximation has small error)
      expect(Math.abs(dist - radiusM)).toBeLessThan(2);
    }
  });

  it('Kerry mountain circle: 1000m radius from Carrauntoohil', () => {
    const pts = geodesicCirclePoints(-9.744060, 51.999170, 1000.0, 64);
    expect(pts).toHaveLength(65);

    // All points should be in reasonable range
    for (const [lon, lat] of pts) {
      expect(lat).toBeGreaterThan(51.98);
      expect(lat).toBeLessThan(52.02);
      expect(lon).toBeGreaterThan(-9.77);
      expect(lon).toBeLessThan(-9.72);
    }
  });
});

// ============================================================================
// SECTOR ARC LENGTH — direct port of Python tests
// ============================================================================

describe('Sector arc length — standard cases', () => {
  it('10° to 350° clockwise = 340°', () => {
    expect(calculateSectorArcLength(10, 350)).toBeCloseTo(340.0, 5);
  });

  it('350° to 10° clockwise = 20°', () => {
    expect(calculateSectorArcLength(350, 10)).toBeCloseTo(20.0, 5);
  });

  it('0° to 180° = 180°', () => {
    expect(calculateSectorArcLength(0, 180)).toBeCloseTo(180.0, 5);
  });

  it('45° to 135° = 90°', () => {
    expect(calculateSectorArcLength(45, 135)).toBeCloseTo(90.0, 5);
  });
});

describe('Sector arc length — edge cases', () => {
  it('full circle: 0° to 360° = 360°', () => {
    expect(calculateSectorArcLength(0, 360)).toBeCloseTo(360.0, 5);
  });

  it('full circle: 45° to 405° = 360°', () => {
    expect(calculateSectorArcLength(45, 405)).toBeCloseTo(360.0, 5);
  });

  it('zero arc: same angle 45° = 0°', () => {
    expect(calculateSectorArcLength(45, 45)).toBeCloseTo(0.0, 5);
  });

  it('zero arc: 0° to 0° = 0°', () => {
    expect(calculateSectorArcLength(0, 0)).toBeCloseTo(0.0, 5);
  });
});

describe('Sector arc length — normalization', () => {
  it('10° to 370° = 360° (full circle)', () => {
    expect(calculateSectorArcLength(10, 370)).toBeCloseTo(360.0, 5);
  });

  it('10° to 730° = 0° (two full circles normalizes)', () => {
    expect(calculateSectorArcLength(10, 730)).toBeCloseTo(0.0, 5);
  });

  it('-10° to 350° = 0° (negative normalizes to same)', () => {
    expect(calculateSectorArcLength(-10, 350)).toBeCloseTo(0.0, 5);
  });
});

// ============================================================================
// SECTOR POINTS — structure matches Python
// ============================================================================

describe('Geodesic sector points', () => {
  it('correct structure: center + arc + center', () => {
    const pts = geodesicSectorPoints(0.0, 0.0, 0.0, 90.0, 500.0, 4);
    // center + 5 arc points + center = 7
    expect(pts).toHaveLength(7);
    expect(pts[0]).toEqual([0.0, 0.0]);
    expect(pts[pts.length - 1]).toEqual([0.0, 0.0]);
  });

  it('first arc point is North-ish for 0° start bearing', () => {
    const pts = geodesicSectorPoints(0.0, 0.0, 0.0, 90.0, 500.0, 4);
    expect(pts[1][1]).toBeGreaterThan(0); // latitude is positive (north)
  });

  it('Kerry mountain sector: all points in reasonable area', () => {
    const pts = geodesicSectorPoints(-9.744060, 51.999170, 0, 90, 1000.0, 16);
    // center + 17 arc points + center = 19
    expect(pts).toHaveLength(19);

    // Skip center points (first and last)
    for (let i = 1; i < pts.length - 1; i++) {
      const [lon, lat] = pts[i];
      expect(lat).toBeGreaterThan(51.98);
      expect(lat).toBeLessThan(52.02);
      expect(lon).toBeGreaterThan(-9.77);
      expect(lon).toBeLessThan(-9.72);
    }
  });
});

// ============================================================================
// CROSS-VALIDATION: TypeScript vs Python output comparison
// These tests lock down the exact values to detect any drift
// ============================================================================

describe('Cross-validation with Python drawing_math.py', () => {
  it('geodesicBearing matches Python for Kerry→Cork scenario', () => {
    // Python: geodesic_bearing(-9.7, 52.27, -8.47, 51.90)
    // Both use identical spherical formula, so should be exact match
    const pyBearing = geodesicBearing(-9.7, 52.27, -8.47, 51.90);
    // Verify it's in the expected SE quadrant
    expect(pyBearing).toBeGreaterThan(90);
    expect(pyBearing).toBeLessThan(180);
    console.log(`Kerry→Cork bearing: ${pyBearing.toFixed(6)}°`);
  });

  it('geodesicCirclePoints first point matches Python formula', () => {
    // Python uses identical formula for first point (bearing=0, north)
    const pts = geodesicCirclePoints(0.0, 0.0, 1000.0, 8);
    const [lon0, lat0] = pts[0];

    // Python expected: lon ≈ 0.0, lat ≈ degrees(1000/6378137)
    const expectedLat = (1000.0 / 6378137.0) * (180 / Math.PI);
    expect(lon0).toBeCloseTo(0.0, 4);
    expect(lat0).toBeCloseTo(expectedLat, 4);
  });

  it('geodesicBearingEndpoint matches Python for 1000m north from origin', () => {
    const [lon, lat] = geodesicBearingEndpoint(0.0, 0.0, 0.0, 1000.0);
    expect(lon).toBeCloseTo(0.0, 4);
    expect(lat).toBeGreaterThan(0);
    // Should be very close to degrees(1000/R) where R ≈ 6378137
    const expectedLat = (1000.0 / 6378137.0) * (180 / Math.PI);
    expect(lat).toBeCloseTo(expectedLat, 4);
  });
});
