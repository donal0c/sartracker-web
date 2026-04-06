import { describe, it, expect } from 'vitest';
import { getTilesForBounds } from '../src/CacheStatus';

describe('getTilesForBounds', () => {
  const kerryBounds = {
    latMin: 51.8,
    latMax: 52.1,
    lonMin: -10.1,
    lonMax: -9.5,
  };

  it('generates tiles for a single zoom level', () => {
    const tiles = getTilesForBounds(kerryBounds, [10]);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.z === 10)).toBe(true);
  });

  it('generates more tiles at higher zoom levels', () => {
    const z10 = getTilesForBounds(kerryBounds, [10]);
    const z12 = getTilesForBounds(kerryBounds, [12]);
    expect(z12.length).toBeGreaterThan(z10.length);
  });

  it('generates tiles for multiple zoom levels', () => {
    const tiles = getTilesForBounds(kerryBounds, [10, 11, 12]);
    const z10 = tiles.filter((t) => t.z === 10);
    const z11 = tiles.filter((t) => t.z === 11);
    const z12 = tiles.filter((t) => t.z === 12);
    expect(z10.length).toBeGreaterThan(0);
    expect(z11.length).toBeGreaterThan(0);
    expect(z12.length).toBeGreaterThan(0);
  });

  it('all tile coordinates are non-negative integers', () => {
    const tiles = getTilesForBounds(kerryBounds, [10, 12, 14]);
    for (const t of tiles) {
      expect(Number.isInteger(t.z)).toBe(true);
      expect(Number.isInteger(t.x)).toBe(true);
      expect(Number.isInteger(t.y)).toBe(true);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });
});
