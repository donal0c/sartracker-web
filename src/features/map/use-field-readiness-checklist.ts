import { useCallback, useEffect, useMemo, useReducer, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { isOfficialMapId, type RenderableMapId } from '../../lib/map-config'
import { loadAppSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../settings/settings-types'
import {
  buildFieldReadinessChecklist,
  type FieldReadinessChecklist,
} from './field-readiness-checklist'

type ChecklistState = {
  readonly settings: AppSettings
  readonly moveSeq: number
}

type ChecklistAction =
  | { readonly type: 'settings'; readonly settings: AppSettings }
  | { readonly type: 'move' }

function reducer(state: ChecklistState, action: ChecklistAction): ChecklistState {
  switch (action.type) {
    case 'settings':
      return { ...state, settings: action.settings }
    case 'move':
      return { ...state, moveSeq: state.moveSeq + 1 }
  }
}

/**
 * Provides the consolidated field-readiness checklist for the active official map.
 * Returns null when the active map is a public fallback (checklist is not relevant).
 */
export function useFieldReadinessChecklist(
  activeBasemapId: RenderableMapId,
  mapRef: RefObject<maplibregl.Map | null>,
): FieldReadinessChecklist | null {
  const [state, dispatch] = useReducer(reducer, {
    settings: DEFAULT_APP_SETTINGS,
    moveSeq: 0,
  })

  useEffect(() => {
    let cancelled = false

    const refreshSettings = () => {
      void loadAppSettings()
        .then((nextSettings) => {
          if (!cancelled) dispatch({ type: 'settings', settings: nextSettings })
        })
        .catch(() => {
          if (!cancelled) dispatch({ type: 'settings', settings: DEFAULT_APP_SETTINGS })
        })
    }

    refreshSettings()
    window.addEventListener('sartracker:settings-updated', refreshSettings)
    return () => {
      cancelled = true
      window.removeEventListener('sartracker:settings-updated', refreshSettings)
    }
  }, [])

  const handleMoveEnd = useCallback(() => {
    dispatch({ type: 'move' })
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map === null) return

    map.on('moveend', handleMoveEnd)
    return () => {
      map.off('moveend', handleMoveEnd)
    }
  }, [handleMoveEnd, mapRef])

  const checklist = useMemo(() => {
    if (!isOfficialMapId(activeBasemapId)) {
      return null
    }

    const map = mapRef.current
    let viewBounds: { west: number; south: number; east: number; north: number } | null = null

    if (map !== null) {
      try {
        const bounds = map.getBounds()
        viewBounds = {
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        }
      } catch {
        viewBounds = null
      }
    }

    return buildFieldReadinessChecklist({
      activeMapId: activeBasemapId,
      officialMaps: state.settings.officialMaps,
      viewBounds,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBasemapId, state.settings, state.moveSeq, mapRef])

  return checklist
}
