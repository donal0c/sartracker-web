import { useEffect, useState } from 'react'

import {
  convertCoordinates,
  createCoordinateConverterDraft,
  formatCoordinateClipboardValue,
  type CoordinateConversionResult,
  type CoordinateConverterMode,
} from '../features/coordinates/coordinate-tool'
import { useCoordinateToolStore } from '../features/coordinates/coordinate-tool-store'
import { useMapTargetStore } from '../features/map/map-target-store'
import { DialogOverlay } from './dialog-overlay'

const COORDINATE_CONVERTER_TITLE_ID = 'coordinate-converter-title'

/**
 * Renders the coordinate conversion utility with copy and go-to actions.
 */
export function CoordinateConverterDialog() {
  const open = useCoordinateToolStore((state) => state.open)
  const closeDialog = useCoordinateToolStore((state) => state.closeDialog)
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const [draft, setDraft] = useState(createCoordinateConverterDraft)
  const [result, setResult] = useState<CoordinateConversionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedKind, setCopiedKind] = useState<'wgs84' | 'itm' | 'tm65' | null>(null)

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
            Convert WGS84, ITM, and TM65
          </h2>
        </div>
        <button
          className="sar-button rounded-lg px-3 py-2 text-sm font-semibold"
          onClick={() => closeDialog()}
          type="button"
        >
          Close
        </button>
      </div>

      <div className="mt-6 space-y-6">
          <section>
            <p className="sar-section-label">Input Mode</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(['wgs84', 'itm', 'tm65'] as const).map((mode) => (
                <label
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    draft.mode === mode
                      ? 'sar-tab-active'
                      : 'sar-button'
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

          {draft.mode === 'wgs84' ? (
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

          {draft.mode === 'itm' ? (
            <section className="grid gap-4 md:grid-cols-2">
              <Field
                label="ITM Easting"
                onChange={(value) => setDraft((current) => ({ ...current, itmEasting: value }))}
                testId="coordinate-input-itm-easting"
                value={draft.itmEasting}
              />
              <Field
                label="ITM Northing"
                onChange={(value) => setDraft((current) => ({ ...current, itmNorthing: value }))}
                testId="coordinate-input-itm-northing"
                value={draft.itmNorthing}
              />
            </section>
          ) : null}

          {draft.mode === 'tm65' ? (
            <Field
              label="TM65 Grid Ref"
              onChange={(value) => setDraft((current) => ({ ...current, tm65GridRef: value }))}
              testId="coordinate-input-tm65-grid-ref"
              value={draft.tm65GridRef}
            />
          ) : null}

          <div className="flex gap-3">
            <button
              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
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
              className="sar-button rounded-lg px-4 py-2 text-sm font-semibold"
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
                copied={copiedKind === 'wgs84'}
                label="WGS84"
                onCopy={() => void copyValue('wgs84')}
                testId="coordinate-result-wgs84"
                value={result.wgs84Display}
              />
              <ResultCard
                copied={copiedKind === 'itm'}
                label="ITM"
                onCopy={() => void copyValue('itm')}
                testId="coordinate-result-itm"
                value={result.itmDisplay}
              />
              <ResultCard
                copied={copiedKind === 'tm65'}
                label="TM65"
                onCopy={() => void copyValue('tm65')}
                testId="coordinate-result-tm65"
                value={result.tm65GridRef}
              />

              <div className="md:col-span-3 flex justify-end">
                <button
                  className="sar-button-focus rounded-lg px-4 py-2 text-sm font-semibold"
                  data-testid="coordinate-go-to-btn"
                  onClick={() => {
                    queueTarget(result.latitude, result.longitude, 'Coordinate Target')
                    closeDialog()
                  }}
                  type="button"
                >
                  Go To Location
                </button>
              </div>
            </section>
          ) : null}
        </div>
    </DialogOverlay>
  )

  async function copyValue(kind: 'wgs84' | 'itm' | 'tm65'): Promise<void> {
    if (result === null || typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      return
    }

    await navigator.clipboard.writeText(formatCoordinateClipboardValue(result, kind))
    setCopiedKind(kind)
  }
}

function renderModeLabel(mode: CoordinateConverterMode): string {
  switch (mode) {
    case 'wgs84':
      return 'WGS84'
    case 'itm':
      return 'ITM'
    case 'tm65':
      return 'TM65'
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
        className="sar-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
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
    <div className="sar-panel-raised rounded-lg p-4" data-testid={props.testId}>
      <div className="flex items-center justify-between gap-3">
        <p className="sar-section-label">{props.label}</p>
        <button
          className="sar-button rounded-md px-2 py-1 text-[11px]"
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
