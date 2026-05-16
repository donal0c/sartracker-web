import { useState } from 'react'

import type { MarkerType } from '../infrastructure/mission-store/tauri-mission-store'
import { createMarkerDraftFromIrishGridReference } from '../features/markers/marker-draft'
import { useMarkerStore } from '../features/markers/marker-store'
import { useMissionStore } from '../features/mission/mission-store'

const MARKER_TYPE_OPTIONS: readonly { readonly value: MarkerType; readonly label: string }[] = [
  { value: 'ipp_lkp', label: 'IPP/LKP' },
  { value: 'clue', label: 'Clue' },
  { value: 'hazard', label: 'Hazard' },
  { value: 'casualty', label: 'Casualty' },
]

/**
 * Opens the normal marker form from an operator-entered TM65 grid reference.
 */
export function MarkerAtGridPanel() {
  const markerController = useMarkerStore((state) => state.controller)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)
  const [markerType, setMarkerType] = useState<MarkerType>('ipp_lkp')
  const [gridReference, setGridReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const disabled = markerController === null || missionId === null || missionPhase === 'recovery'

  return (
    <section className="sar-module p-4" data-testid="marker-at-grid-panel">
      <div>
        <h3 className="sar-section-label text-amber-300">
          Marker At GR
        </h3>
        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-stone-300">
          TM65 entry into marker form
        </p>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block text-sm text-stone-200">
          <span className="text-xs uppercase tracking-[0.2em] text-stone-300">
            Marker Type
          </span>
          <select
            className="sar-input mt-2 w-full px-3 py-2 text-sm"
            data-testid="marker-at-grid-type-input"
            disabled={disabled}
            onChange={(event) => setMarkerType(event.target.value as MarkerType)}
            value={markerType}
          >
            {MARKER_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-stone-200">
          <span className="text-xs uppercase tracking-[0.2em] text-stone-300">
            TM65 Grid Reference
          </span>
          <input
            className="sar-input mt-2 w-full px-3 py-2 font-mono text-sm"
            data-testid="marker-at-grid-reference-input"
            disabled={disabled}
            onChange={(event) => {
              setGridReference(event.target.value.toUpperCase())
              setError(null)
            }}
            placeholder="Q 99842 04015"
            value={gridReference}
          />
        </label>

        {error !== null ? (
          <p
            className="sar-inline-critical px-3 py-2 text-xs"
            data-testid="marker-at-grid-error"
          >
            {error}
          </p>
        ) : null}

        <button
          className="sar-button px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="marker-at-grid-create-btn"
          disabled={disabled}
          onClick={() => {
            try {
              const draft = createMarkerDraftFromIrishGridReference(gridReference, markerType)
              void markerController?.refreshMission(missionId).then(() => {
                markerController.beginCreateAt(draft.coordinates.lat, draft.coordinates.lon, markerType)
                setError(null)
              }).catch((runtimeError: unknown) => {
                setError(
                  runtimeError instanceof Error
                    ? runtimeError.message
                    : 'Marker mission refresh failed.',
                )
              })
            } catch (runtimeError) {
              setError(runtimeError instanceof Error ? runtimeError.message : 'Invalid grid reference.')
            }
          }}
          type="button"
        >
          Create Marker
        </button>
      </div>
    </section>
  )
}
