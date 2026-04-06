import { useState, useCallback } from 'react';
import { DEFAULT_BASEMAP, BASEMAP_IDS } from './tile-sources';

const STORAGE_KEY = 'sartracker-basemap';

function getInitialBasemap(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && BASEMAP_IDS.includes(stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_BASEMAP;
}

export function useBasemap() {
  const [basemap, setBasemapState] = useState(getInitialBasemap);

  const setBasemap = useCallback((id: string) => {
    if (!BASEMAP_IDS.includes(id)) return;
    setBasemapState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  return { basemap, setBasemap } as const;
}
