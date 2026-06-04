import { useEffect, useState } from 'react'

import {
  convertCoordinates,
  createCoordinateConverterDraft,
  formatCoordinateClipboardValue,
  type CoordinateClipboardKind,
  type CoordinateConversionResult,
  type CoordinateConverterMode,
} from '../features/coordinates/coordinate-tool'
import { useCoordinateToolStore } from '../features/coordinates/coordinate-tool-store'
import { useMapTargetStore } from '../features/map/map-target-store'
import { useMarkerStore } from '../features/markers/marker-store'
import { useMissionStore } from '../features/mission/mission-store'
import { DialogOverlay } from './dialog-overlay'

const COORDINATE_CONVERTER_TITLE_ID = 'coordinate-converter-title'

/**
 * Renders the coordinate conversion utility with copy and go-to actions.
 */
export function CoordinateConverterDialog() {
  const open = useCoordinateToolStore((state) => state.open)
  const closeDialog = useCoordinateToolStore((state) => state.closeDialog)
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const markerController = useMarkerStore((state) => state.controller)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)
  const [draft, setDraft] = useState(createCoordinateConverterDraft)
  const [result, setResult] = useState<CoordinateConversionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedKind, setCopiedKind] = useState<CoordinateClipboardKind | null>(null)
  const markerCreationDisabled =
    result === null || markerController === null || missionId === null || missionPhase === 'recovery'

  useEffect(() => {
    if (!open) {
      return
    }

    setDraft(createCoordinateConverterDraft())
    setResult(null)
    setError(null)
    setCopiedKind(null)
  }, [open])

  return (
    <DialogOverlay
      labelledBy={COORDINATE_CONVERTER_TITLE_ID}
      open={open}
      onClose={closeDialog}
      testId="coordinate-converter-dialog"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="sar-section-label text-amber-300">Coordinate Converter</p>
          <h2
            className="mt-2 text-xl font-semibold text-stone-50"
            id={COORDINATE_CONVERTER_TITLE_ID}
          >
            Convert IG, DD, DMS, and W3W
          </h2>
        </div>
        <button
          className="sar-button px-3 py-2 text-sm font-semibold"
          onClick={() => closeDialog()}
          type="button"
        >
          Close
        </button>
      </div>

      <div className="mt-6 space-y-6">
          <section>
            <p className="sar-section-label">Input Mode</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {(['ig', 'dd', 'dms', 'w3w'] as const).map((mode) => (
                <label
                  className={`sar-segment-option px-3 py-2 text-sm font-semibold ${
                    draft.mode === mode ? 'sar-segment-option-active' : ''
                  }`}
                  data-testid={`coordinate-mode-${mode}`}
                  key={mode}
                >
                  <input
                    checked={draft.mode === mode}
                    className="sr-only"
                    name="coordinate-mode"
                    onChange={() => {
                      setDraft((current) => ({ ...current, mode }))
                      setError(null)
                    }}
                    type="radio"
                    value={mode}
                  />
                  {renderModeLabel(mode)}
                </label>
              ))}
            </div>
          </section>

          {draft.mode === 'ig' ? (
            <Field
              label="Irish Grid"
              onChange={(value) => setDraft((current) => ({ ...current, irishGridRef: value }))}
              testId="coordinate-input-irish-grid-ref"
              value={draft.irishGridRef}
            />
          ) : null}

          {draft.mode === 'dd' ? (
            <section className="grid gap-4 md:grid-cols-2">
              <Field
                label="Latitude"
                onChange={(value) => setDraft((current) => ({ ...current, latitude: value }))}
                testId="coordinate-input-latitude"
                value={draft.latitude}
              />
              <Field
                label="Longitude"
                onChange={(value) => setDraft((current) => ({ ...current, longitude: value }))}
                testId="coordinate-input-longitude"
                value={draft.longitude}
              />
            </section>
          ) : null}

          {draft.mode === 'dms' ? (
            <section className="grid gap-4 md:grid-cols-2">
              <Field
                label="Latitude DMS"
                onChange={(value) => setDraft((current) => ({ ...current, dmsLatitude: value }))}
                testId="coordinate-input-dms-latitude"
                value={draft.dmsLatitude}
              />
              <Field
                label="Longitude DMS"
                onChange={(value) => setDraft((current) => ({ ...current, dmsLongitude: value }))}
                testId="coordinate-input-dms-longitude"
                value={draft.dmsLongitude}
              />
            </section>
          ) : null}

          {draft.mode === 'w3w' ? (
            <Field
              label="What3Words"
              onChange={(value) => setDraft((current) => ({ ...current, w3wWords: value }))}
              testId="coordinate-input-w3w"
              value={draft.w3wWords}
            />
          ) : null}

          <div className="flex gap-3">
            <button
              className="border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
              data-testid="coordinate-convert-btn"
              onClick={() => {
                try {
                  const nextResult = convertCoordinates(draft)
                  setResult(nextResult)
                  setError(null)
                } catch (conversionError) {
                  setResult(null)
                  setError(
                    conversionError instanceof Error
                      ? conversionError.message
                      : 'Coordinate conversion failed.',
                  )
                }
              }}
              type="button"
            >
              Convert
            </button>
            <button
              className="sar-button px-4 py-2 text-sm font-semibold"
              onClick={() => {
                setDraft(createCoordinateConverterDraft())
                setResult(null)
                setError(null)
                setCopiedKind(null)
              }}
              type="button"
            >
              Reset
            </button>
          </div>

          {error !== null ? <p className="text-sm text-rose-300">{error}</p> : null}

          {result !== null ? (
            <section className="grid gap-4 md:grid-cols-3">
              <ResultCard
                copied={copiedKind === 'ig'}
                label="IG"
                onCopy={() => void copyValue('ig')}
                testId="coordinate-result-ig"
                value={result.irishGridRef}
              />
              <ResultCard
                copied={copiedKind === 'dd'}
                label="DD"
                onCopy={() => void copyValue('dd')}
                testId="coordinate-result-dd"
                value={result.ddDisplay}
              />
              <ResultCard
                copied={copiedKind === 'dms'}
                label="DMS"
                onCopy={() => void copyValue('dms')}
                testId="coordinate-result-dms"
                value={result.dmsDisplay}
              />
              <StaticResultCard
                label="W3W"
                testId="coordinate-result-w3w"
                value={result.w3wDisplay}
              />

              <div className="md:col-span-3 flex flex-wrap justify-end gap-3">
                <button
                  className="sar-button-focus px-4 py-2 text-sm font-semibold"
                  data-testid="coordinate-go-to-btn"
                  onClick={() => {
                    queueTarget(result.latitude, result.longitude, 'Coordinate Target')
                  }}
                  type="button"
                >
                  Go To Location
                </button>
                <button
                  className="sar-action-primary px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="coordinate-create-marker-btn"
                  disabled={markerCreationDisabled}
                  onClick={() => void createMarkerFromResult()}
                  type="button"
                >
                  Create Marker Here
                </button>
              </div>
            </section>
          ) : null}
        </div>
    </DialogOverlay>
  )

  async function copyValue(kind: CoordinateClipboardKind): Promise<void> {
    if (result === null || typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      return
    }

    await navigator.clipboard.writeText(formatCoordinateClipboardValue(result, kind))
    setCopiedKind(kind)
  }

  async function createMarkerFromResult(): Promise<void> {
    if (
      result === null ||
      markerController === null ||
      missionId === null ||
      missionPhase === 'recovery'
    ) {
      return
    }

    try {
      await markerController.refreshMission(missionId)
      markerController.beginCreateAt(result.latitude, result.longitude)
      setError(null)
      closeDialog()
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : 'Marker mission refresh failed.',
      )
    }
  }
}

function renderModeLabel(mode: CoordinateConverterMode): string {
  switch (mode) {
    case 'ig':
      return 'IG'
    case 'dd':
      return 'DD'
    case 'dms':
      return 'DMS'
    case 'w3w':
      return 'W3W'
  }
}

function Field(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId: string
}) {
  return (
    <label className="block text-sm text-stone-200">
      <span className="sar-section-label">{props.label}</span>
      <input
        className="sar-input mt-2 w-full px-3 py-2 text-sm"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

function ResultCard(props: {
  readonly label: string
  readonly value: string
  readonly copied: boolean
  readonly onCopy: () => void
  readonly testId: string
}) {
  return (
    <div className="sar-module p-4" data-testid={props.testId}>
      <div className="flex items-center justify-between gap-3">
        <p className="sar-section-label">{props.label}</p>
        <button
          className="sar-button px-2 py-1 text-[11px]"
          data-testid={`${props.testId}-copy`}
          onClick={props.onCopy}
          type="button"
        >
          {props.copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 font-mono text-sm text-stone-100">{props.value}</p>
    </div>
  )
}

function StaticResultCard(props: {
  readonly label: string
  readonly value: string
  readonly testId: string
}) {
  return (
    <div className="sar-module p-4" data-testid={props.testId}>
      <p className="sar-section-label">{props.label}</p>
      <p className="mt-2 font-mono text-sm text-stone-100">{props.value}</p>
    </div>
  )
}
