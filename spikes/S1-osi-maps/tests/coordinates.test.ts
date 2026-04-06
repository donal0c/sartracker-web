import { describe, it, expect } from 'vitest';
import { wgs84ToTM65, formatIrishGridReference, formatWGS84 } from '../src/coordinates';

describe('wgs84ToTM65', () => {
  it('converts MacGillycuddy Reeks area correctly', () => {
    // Carrauntoohil summit: approximately 51.9992°N, 9.7442°W
    const [easting, northing] = wgs84ToTM65(51.9992, -9.7442);
    // Should be near V 80 84 in Irish Grid
    expect(easting).toBeGreaterThan(70000);
    expect(easting).toBeLessThan(90000);
    expect(northing).toBeGreaterThan(80000);
    expect(northing).toBeLessThan(90000);
  });
});

describe('formatIrishGridReference', () => {
  it('formats coordinates as grid reference', () => {
    // V square is roughly the Kerry mountains area
    const ref = formatIrishGridReference(80000, 84000);
    expect(ref).toMatch(/^V \d{5} \d{5}$/);
  });

  it('returns dash for out-of-range coordinates', () => {
    const ref = formatIrishGridReference(-1, -1);
    expect(ref).toBe('—');
  });
});

describe('formatWGS84', () => {
  it('formats positive lat/lon with N/E', () => {
    expect(formatWGS84(51.97, 1.5)).toBe('51.970000\u00b0N, 1.500000\u00b0E');
  });

  it('formats negative lon with W', () => {
    expect(formatWGS84(51.97, -9.7)).toBe('51.970000\u00b0N, 9.700000\u00b0W');
  });
});
