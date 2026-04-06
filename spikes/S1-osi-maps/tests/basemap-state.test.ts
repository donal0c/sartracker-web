import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBasemap } from '../src/use-basemap';

describe('useBasemap', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to opentopomap', () => {
    const { result } = renderHook(() => useBasemap());
    expect(result.current.basemap).toBe('opentopomap');
  });

  it('switches basemap and persists to localStorage', () => {
    const { result } = renderHook(() => useBasemap());

    act(() => {
      result.current.setBasemap('esri_topo');
    });

    expect(result.current.basemap).toBe('esri_topo');
    expect(localStorage.getItem('sartracker-basemap')).toBe('esri_topo');
  });

  it('restores basemap from localStorage', () => {
    localStorage.setItem('sartracker-basemap', 'openstreetmap');
    const { result } = renderHook(() => useBasemap());
    expect(result.current.basemap).toBe('openstreetmap');
  });

  it('ignores invalid basemap from localStorage', () => {
    localStorage.setItem('sartracker-basemap', 'nonexistent');
    const { result } = renderHook(() => useBasemap());
    expect(result.current.basemap).toBe('opentopomap');
  });

  it('ignores invalid basemap on setBasemap', () => {
    const { result } = renderHook(() => useBasemap());

    act(() => {
      result.current.setBasemap('bogus');
    });

    expect(result.current.basemap).toBe('opentopomap');
  });
});
