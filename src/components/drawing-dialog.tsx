import { useDrawingStore } from '../features/drawings/drawing-store'
import {
  formatDistance,
  geodesicDistance,
  geodesicPolygonArea,
  magneticToTrue,
  trueToMagnetic,
} from '../features/drawings/drawing-math'
import { LPB_CATEGORIES, LPB_PERCENTILE_ORDER, LPB_RING_COLORS } from '../features/drawings/lpb-data'
import { SEARCH_AREA_STATUSES, type DrawingDraft } from '../features/drawings/drawing-types'

/**
 * Renders the modal drawing form used for create/edit flows.
 */
export function DrawingDialog() {
  const controller = useDrawingStore((state) => state.controller)
  const dialog = useDrawingStore((state) => state.dialog)
  const saving = useDrawingStore((state) => state.saving)
  const runtimeError = useDrawingStore((state) => state.error)

  if (dialog === null || controller === null) {
    return null
  }

  const draft = dialog.draft

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/70 px-4 py-8 backdrop-blur-sm"
      data-testid="drawing-dialog"
    >
      <div className="w-full max-w-3xl rounded-3xl border border-stone-700 bg-stone-900 p-6 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-300">
              {dialog.mode === 'create' ? 'New Drawing' : 'Edit Drawing'}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-stone-50">
              {DRAWING_DIALOG_TITLES[draft.type]}
            </h2>
          </div>
          <button
            className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-200"
            onClick={() => controller.closeDialog()}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <section className="grid gap-4 md:grid-cols-2">
            <Field
              label="Name"
              onChange={(value) => controller.updateDraft({ ...draft, name: value })}
              testId="drawing-name-input"
              value={draft.name}
            />
            <Field
              label="Description"
              onChange={(value) => controller.updateDraft({ ...draft, description: value })}
              testId="drawing-description-input"
              value={draft.description}
            />
          </section>

          {draft.type === 'line' ? (
            <LineSection
              draft={draft}
            />
          ) : null}

          {draft.type === 'search_area' ? (
            <SearchAreaSection
              draft={draft}
              onChange={(nextDraft) => controller.updateDraft(nextDraft)}
            />
          ) : null}

          {draft.type === 'range_ring' ? (
            <RangeRingSection
              draft={draft}
              onChange={(nextDraft) => controller.updateDraft(nextDraft)}
            />
          ) : null}

          {draft.type === 'bearing_line' ? (
            <BearingLineSection
              draft={draft}
              onChange={(nextDraft) => controller.updateDraft(nextDraft)}
            />
          ) : null}

          {draft.type === 'search_sector' ? (
            <SearchSectorSection
              draft={draft}
              onChange={(nextDraft) => controller.updateDraft(nextDraft)}
            />
          ) : null}

          {runtimeError !== null ? <p className="text-sm text-rose-300">{runtimeError}</p> : null}

          <div className="flex justify-between gap-3">
            <div>
              {dialog.mode === 'edit' ? (
                <button
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100"
                  data-testid="drawing-delete-btn"
                  onClick={() => void controller.deleteSelectedDrawing()}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <button
                className="rounded-lg border border-stone-600 bg-stone-950 px-4 py-2 text-sm text-stone-200"
                onClick={() => controller.closeDialog()}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 disabled:opacity-50"
                data-testid="drawing-save-btn"
                disabled={saving}
                onClick={() => void controller.saveDialog()}
                type="button"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LineSection(props: { readonly draft: Extract<DrawingDraft, { type: 'line' }> }) {
  const pointCount = props.draft.points.length
  const distanceM = calculatePolylineDistance(props.draft.points)

  return (
    <ReadOnlyGrid
      items={[
        { label: 'Vertices', value: pointCount.toString() },
        { label: 'Distance', value: formatDistance(distanceM) },
      ]}
    />
  )
}

function SearchAreaSection(props: {
  readonly draft: Extract<DrawingDraft, { type: 'search_area' }>
  readonly onChange: (draft: Extract<DrawingDraft, { type: 'search_area' }>) => void
}) {
  const areaSqM =
    props.draft.points.length >= 3 ? geodesicPolygonArea(closeRing(props.draft.points)) : 0

  return (
    <>
      <ReadOnlyGrid
        items={[
          { label: 'Vertices', value: props.draft.points.length.toString() },
          { label: 'Area', value: `${areaSqM.toFixed(0)} m²` },
        ]}
      />
      <section className="grid gap-4 md:grid-cols-2">
        <Field
          label="Team"
          onChange={(value) => props.onChange({ ...props.draft, team: value })}
          testId="drawing-search-area-team-input"
          value={props.draft.team}
        />
        <SelectField
          label="Status"
          onChange={(value) => props.onChange({ ...props.draft, status: value })}
          options={SEARCH_AREA_STATUSES}
          testId="drawing-search-area-status-input"
          value={props.draft.status}
        />
        <Field
          label="POA %"
          onChange={(value) => props.onChange({ ...props.draft, poaPercent: value })}
          testId="drawing-search-area-poa-input"
          value={props.draft.poaPercent}
        />
        <Field
          label="Terrain"
          onChange={(value) => props.onChange({ ...props.draft, terrain: value })}
          testId="drawing-search-area-terrain-input"
          value={props.draft.terrain}
        />
      </section>
      <TextAreaField
        label="Notes"
        onChange={(value) => props.onChange({ ...props.draft, notes: value })}
        testId="drawing-search-area-notes-input"
        value={props.draft.notes}
      />
    </>
  )
}

function RangeRingSection(props: {
  readonly draft: Extract<DrawingDraft, { type: 'range_ring' }>
  readonly onChange: (draft: Extract<DrawingDraft, { type: 'range_ring' }>) => void
}) {
  const ringCategory = LPB_CATEGORIES[props.draft.lpbCategory]

  return (
    <>
      <ReadOnlyGrid
        items={[
          { label: 'Centre', value: `${props.draft.center[1].toFixed(5)}, ${props.draft.center[0].toFixed(5)}` },
          { label: 'Mode', value: props.draft.mode === 'manual' ? 'Manual' : 'LPB' },
        ]}
      />

      <section>
        <p className="text-xs uppercase tracking-[0.2em] text-stone-300">Range Ring Mode</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(['manual', 'lpb'] as const).map((mode) => (
            <label
              className={`rounded-xl border px-3 py-2 text-sm ${
                props.draft.mode === mode
                  ? 'border-amber-300 bg-amber-300/10 text-amber-100'
                  : 'border-stone-700 bg-stone-950 text-stone-200'
              }`}
              data-testid={`drawing-range-ring-mode-${mode}`}
              key={mode}
            >
              <input
                checked={props.draft.mode === mode}
                className="sr-only"
                name="range-ring-mode"
                onChange={() => props.onChange({ ...props.draft, mode })}
                type="radio"
                value={mode}
              />
              {mode === 'manual' ? 'Manual' : 'LPB'}
            </label>
          ))}
        </div>
      </section>

      {props.draft.mode === 'manual' ? (
        <section className="grid gap-4 md:grid-cols-2">
          <Field
            label="Radius (m)"
            onChange={(value) => props.onChange({ ...props.draft, manualRadiusM: value })}
            testId="drawing-range-ring-radius-input"
            value={props.draft.manualRadiusM}
          />
          <Field
            label="Ring Count"
            onChange={(value) => props.onChange({ ...props.draft, manualRingCount: value })}
            testId="drawing-range-ring-count-input"
            value={props.draft.manualRingCount}
          />
        </section>
      ) : (
        <>
          <SelectField
            label="LPB Category"
            onChange={(value) => props.onChange({ ...props.draft, lpbCategory: value })}
            options={Object.keys(LPB_CATEGORIES) as Array<keyof typeof LPB_CATEGORIES>}
            renderLabel={(value) => LPB_CATEGORIES[value].label}
            testId="drawing-range-ring-lpb-category-input"
            value={props.draft.lpbCategory}
          />
          <div className="rounded-2xl border border-stone-700 bg-stone-950/60 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-stone-300">LPB Distances</p>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              {LPB_PERCENTILE_ORDER.map((percentile) => (
                <div className="rounded-xl border border-stone-800 bg-stone-900/70 px-3 py-2" key={percentile}>
                  <p className="text-xs text-stone-400">
                    <span style={{ color: LPB_RING_COLORS[percentile] }}>{percentile.slice(1)}%</span>
                  </p>
                  <p className="mt-1 text-sm text-stone-100">
                    {formatDistance(ringCategory.distances[percentile])}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}

function BearingLineSection(props: {
  readonly draft: Extract<DrawingDraft, { type: 'bearing_line' }>
  readonly onChange: (draft: Extract<DrawingDraft, { type: 'bearing_line' }>) => void
}) {
  const bearingNumber = Number(props.draft.inputBearing)
  const trueBearing =
    Number.isFinite(bearingNumber) && props.draft.inputBearingType === 'magnetic'
      ? magneticToTrue(bearingNumber)
      : bearingNumber
  const magneticBearing =
    Number.isFinite(trueBearing) ? trueToMagnetic(trueBearing) : Number.NaN

  return (
    <>
      <ReadOnlyGrid
        items={[
          { label: 'Origin', value: `${props.draft.origin[1].toFixed(5)}, ${props.draft.origin[0].toFixed(5)}` },
          { label: 'Distance', value: props.draft.distanceM === '' ? 'Not set' : `${props.draft.distanceM} m` },
        ]}
      />
      <section className="grid gap-4 md:grid-cols-3">
        <SelectField
          label="Bearing Type"
          onChange={(value) => props.onChange({ ...props.draft, inputBearingType: value })}
          options={['true', 'magnetic'] as const}
          renderLabel={(value) => (value === 'true' ? 'True' : 'Magnetic')}
          testId="drawing-bearing-type-input"
          value={props.draft.inputBearingType}
        />
        <Field
          label="Bearing (°)"
          onChange={(value) => props.onChange({ ...props.draft, inputBearing: value })}
          testId="drawing-bearing-input"
          value={props.draft.inputBearing}
        />
        <Field
          label="Distance (m)"
          onChange={(value) => props.onChange({ ...props.draft, distanceM: value })}
          testId="drawing-bearing-distance-input"
          value={props.draft.distanceM}
        />
      </section>
      <div className="rounded-2xl border border-stone-700 bg-stone-950/60 p-4 text-sm text-stone-200">
        <p className="text-xs uppercase tracking-[0.2em] text-stone-300">Bearing Conversion</p>
        <p className="mt-2" data-testid="drawing-bearing-conversion">
          {Number.isFinite(trueBearing) && Number.isFinite(magneticBearing)
            ? `True ${trueBearing.toFixed(1)}° / Magnetic ${magneticBearing.toFixed(1)}° (fixed Ireland declination -4.5°)`
            : 'Enter a numeric bearing to see the true/magnetic conversion.'}
        </p>
      </div>
    </>
  )
}

function SearchSectorSection(props: {
  readonly draft: Extract<DrawingDraft, { type: 'search_sector' }>
  readonly onChange: (draft: Extract<DrawingDraft, { type: 'search_sector' }>) => void
}) {
  return (
    <>
      <ReadOnlyGrid
        items={[
          { label: 'Centre', value: `${props.draft.center[1].toFixed(5)}, ${props.draft.center[0].toFixed(5)}` },
          { label: 'Radius', value: props.draft.radiusM === '' ? 'Not set' : `${props.draft.radiusM} m` },
        ]}
      />
      <section className="grid gap-4 md:grid-cols-3">
        <Field
          label="Start Bearing (°)"
          onChange={(value) => props.onChange({ ...props.draft, startBearing: value })}
          testId="drawing-sector-start-input"
          value={props.draft.startBearing}
        />
        <Field
          label="End Bearing (°)"
          onChange={(value) => props.onChange({ ...props.draft, endBearing: value })}
          testId="drawing-sector-end-input"
          value={props.draft.endBearing}
        />
        <Field
          label="Radius (m)"
          onChange={(value) => props.onChange({ ...props.draft, radiusM: value })}
          testId="drawing-sector-radius-input"
          value={props.draft.radiusM}
        />
      </section>
    </>
  )
}

function Field(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId: string
}) {
  return (
    <label className="block text-sm text-stone-200">
      <span className="text-xs uppercase tracking-[0.2em] text-stone-300">{props.label}</span>
      <input
        className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

function TextAreaField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId: string
}) {
  return (
    <label className="block text-sm text-stone-200">
      <span className="text-xs uppercase tracking-[0.2em] text-stone-300">{props.label}</span>
      <textarea
        className="mt-2 min-h-28 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

function SelectField<TOption extends string>(props: {
  readonly label: string
  readonly value: TOption
  readonly onChange: (value: TOption) => void
  readonly options: readonly TOption[]
  readonly testId: string
  readonly renderLabel?: (value: TOption) => string
}) {
  return (
    <label className="block text-sm text-stone-200">
      <span className="text-xs uppercase tracking-[0.2em] text-stone-300">{props.label}</span>
      <select
        className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value as TOption)}
        value={props.value}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.renderLabel?.(option) ?? option}
          </option>
        ))}
      </select>
    </label>
  )
}

function ReadOnlyGrid(props: {
  readonly items: readonly { label: string; value: string }[]
}) {
  return (
    <section className="grid gap-4 md:grid-cols-2">
      {props.items.map((item) => (
        <div className="rounded-2xl border border-stone-700 bg-stone-950/60 p-4" key={item.label}>
          <p className="text-xs uppercase tracking-[0.2em] text-stone-300">{item.label}</p>
          <p className="mt-2 text-sm text-stone-100">{item.value}</p>
        </div>
      ))}
    </section>
  )
}

function calculatePolylineDistance(points: readonly (readonly [number, number])[]): number {
  let distance = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const next = points[index]!
    const [lon1, lat1] = previous
    const [lon2, lat2] = next
    distance += geodesicDistance(lon1, lat1, lon2, lat2)
  }

  return distance
}

function closeRing(points: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
  const first = points[0]
  if (first === undefined) {
    return points
  }

  const last = points.at(-1) ?? first
  if (first[0] === last[0] && first[1] === last[1]) {
    return points
  }

  return [...points, first]
}
const DRAWING_DIALOG_TITLES: Record<DrawingDraft['type'], string> = {
  line: 'Line Details',
  search_area: 'Search Area Details',
  range_ring: 'Range Ring Details',
  bearing_line: 'Bearing Line Details',
  search_sector: 'Search Sector Details',
}
