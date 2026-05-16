import { useMarkerStore } from '../features/markers/marker-store'
import {
  CASUALTY_CONDITIONS,
  CLUE_TYPES,
  CONFIDENCE_LEVELS,
  EVACUATION_PRIORITIES,
  HAZARD_SEVERITIES,
  HAZARD_TYPES,
  SUBJECT_CATEGORIES,
} from '../features/markers/marker-definitions'
import type { MarkerType } from '../infrastructure/mission-store/tauri-mission-store'
import { DialogOverlay } from './dialog-overlay'

const MARKER_DIALOG_TITLE_ID = 'marker-dialog-title'

const MARKER_TYPE_OPTIONS: readonly { value: MarkerType; label: string }[] = [
  { value: 'ipp_lkp', label: 'IPP/LKP' },
  { value: 'clue', label: 'Clue' },
  { value: 'hazard', label: 'Hazard' },
  { value: 'casualty', label: 'Casualty' },
]

/**
 * Renders the modal marker form used for create/edit flows.
 */
export function MarkerDialog() {
  const dialog = useMarkerStore((state) => state.dialog)
  const controller = useMarkerStore((state) => state.controller)
  const saving = useMarkerStore((state) => state.saving)
  const runtimeError = useMarkerStore((state) => state.error)

  if (dialog === null || controller === null) {
    return null
  }
  const draft = dialog.draft

  return (
    <DialogOverlay
      labelledBy={MARKER_DIALOG_TITLE_ID}
      onClose={() => controller.closeDialog()}
      open={dialog !== null}
      panelClassName="max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-stone-700 bg-stone-900 p-5 shadow-2xl shadow-black/40"
      testId="marker-dialog"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-amber-300">
            {dialog.mode === 'create' ? 'New Marker' : 'Edit Marker'}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-stone-50" id={MARKER_DIALOG_TITLE_ID}>Marker Details</h2>
        </div>
        <button
          className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-200 disabled:opacity-50"
          disabled={saving}
          onClick={() => controller.closeDialog()}
          type="button"
        >
          Close
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <section>
          <p className="text-xs uppercase tracking-[0.2em] text-stone-300">Marker Type</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {MARKER_TYPE_OPTIONS.map((option) => (
              <label
                className={`rounded-xl border px-3 py-2 text-sm ${
                  draft.type === option.value
                    ? 'border-amber-300 bg-amber-300/10 text-amber-100'
                    : 'border-stone-700 bg-stone-950 text-stone-200'
                }`}
                key={option.value}
              >
                <input
                  checked={draft.type === option.value}
                  className="sr-only"
                  disabled={saving}
                  name="marker-type"
                  onChange={() => controller.changeDraftType(option.value)}
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </div>
        </section>

          <section className="grid gap-4 md:grid-cols-2">
            <ReadOnlyField label="WGS84" value={draft.coordinates.wgs84Display} />
            <ReadOnlyField
              label="ITM"
              value={`${draft.coordinates.irishGridE}, ${draft.coordinates.irishGridN}`}
            />
            <ReadOnlyField label="TM65 Grid Ref" value={draft.coordinates.tm65GridRef} />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Field
              label="Name"
              disabled={saving}
              onChange={(value) => controller.updateDraft({ name: value })}
              testId="marker-name-input"
              value={draft.name}
            />
            <Field
              label="Description"
              disabled={saving}
              onChange={(value) => controller.updateDraft({ description: value })}
              testId="marker-description-input"
              value={draft.description}
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Field
              label="Updated By"
              disabled={saving}
              onChange={(value) => controller.updateDraft({ updatedBy: value })}
              testId="marker-updated-by-input"
              value={draft.updatedBy}
            />
            <Field
              label="Coordinator IDs"
              disabled={saving}
              onChange={(value) => controller.updateDraft({ coordinatorIds: value })}
              testId="marker-coordinator-ids-input"
              value={draft.coordinatorIds}
            />
          </section>

          {draft.type === 'ipp_lkp' ? (
            <SelectField
              label="Subject Category"
              disabled={saving}
              onChange={(value) => controller.updateDraft({ subjectCategory: value })}
              options={SUBJECT_CATEGORIES}
              testId="marker-subject-category-input"
              value={draft.subjectCategory}
            />
          ) : null}

          {draft.type === 'clue' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="Clue Type"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ clueType: value })}
                options={CLUE_TYPES}
                testId="marker-clue-type-input"
                value={draft.clueType}
              />
              <SelectField
                label="Confidence"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ confidence: value })}
                options={CONFIDENCE_LEVELS}
                testId="marker-confidence-input"
                value={draft.confidence}
              />
              <Field
                label="Found By"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ foundBy: value })}
                testId="marker-found-by-input"
                value={draft.foundBy}
              />
            </div>
          ) : null}

          {draft.type === 'hazard' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="Hazard Type"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ hazardType: value })}
                options={HAZARD_TYPES}
                testId="marker-hazard-type-input"
                value={draft.hazardType}
              />
              <SelectField
                label="Severity"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ severity: value })}
                options={HAZARD_SEVERITIES}
                testId="marker-severity-input"
                value={draft.severity}
              />
            </div>
          ) : null}

          {draft.type === 'casualty' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="Condition"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ condition: value })}
                options={CASUALTY_CONDITIONS}
                testId="marker-condition-input"
                value={draft.condition}
              />
              <SelectField
                label="Evacuation Priority"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ evacuationPriority: value })}
                options={EVACUATION_PRIORITIES}
                testId="marker-evacuation-priority-input"
                value={draft.evacuationPriority}
              />
              <Field
                label="Treatment"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ treatment: value })}
                testId="marker-treatment-input"
                value={draft.treatment}
              />
              <Field
                label="Found By"
                disabled={saving}
                onChange={(value) => controller.updateDraft({ foundBy: value })}
                testId="marker-found-by-input"
                value={draft.foundBy}
              />
            </div>
          ) : null}

          {runtimeError !== null ? <p className="text-sm text-rose-300">{runtimeError}</p> : null}

          <section className="mb-16 rounded-2xl border border-stone-800 bg-stone-950/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-stone-300">Evidence Attachment</p>
                <p className="mt-1 text-sm text-stone-400">
                  Attach a photo or file that should travel with this marker.
                </p>
              </div>
              {draft.attachmentPath !== null ? (
                <button
                  className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-stone-200"
                  data-testid="marker-clear-attachment-btn"
                  disabled={saving}
                  onClick={() => controller.clearAttachment()}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <label className="mt-2 block text-sm text-stone-200">
              <span className="text-xs uppercase tracking-[0.2em] text-stone-300">Choose File</span>
              <input
                className="mt-2 block w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-300/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-amber-100"
                data-testid="marker-attachment-input"
                disabled={saving}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  if (file !== null) {
                    void controller.attachEvidence(file)
                    event.target.value = ''
                  }
                }}
                type="file"
              />
            </label>
            <p className="mt-2 text-sm text-stone-300" data-testid="marker-attachment-summary">
              {draft.attachmentName ?? 'No attachment selected.'}
            </p>
          </section>

          <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-between gap-3 border-t border-stone-700 bg-stone-900/95 px-5 py-3 shadow-[0_-18px_36px_rgba(0,0,0,0.42)] backdrop-blur">
            <div>
              {dialog.mode === 'edit' ? (
                <button
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100"
                  data-testid="marker-delete-btn"
                  onClick={() => void controller.deleteEditingMarker()}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <button
                className="rounded-lg border border-stone-600 bg-stone-950 px-4 py-2 text-sm text-stone-200 disabled:opacity-50"
                disabled={saving}
                onClick={() => controller.closeDialog()}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 disabled:opacity-50"
                data-testid="marker-save-btn"
                disabled={saving}
                onClick={() => void controller.saveDraft()}
                type="button"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
      </div>
    </DialogOverlay>
  )
}

function Field(props: {
  readonly label: string
  readonly value: string
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
  readonly testId: string
}) {
  return (
    <label className="block text-sm text-stone-200">
      <span className="text-xs uppercase tracking-[0.2em] text-stone-300">{props.label}</span>
      <input
        className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
        data-testid={props.testId}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

function SelectField<TOption extends string>(props: {
  readonly label: string
  readonly value: TOption | ''
  readonly disabled?: boolean
  readonly onChange: (value: TOption | '') => void
  readonly options: readonly TOption[]
  readonly testId: string
}) {
  return (
    <label className="block text-sm text-stone-200">
      <span className="text-xs uppercase tracking-[0.2em] text-stone-300">{props.label}</span>
      <select
        className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
        data-testid={props.testId}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value as TOption | '')}
        value={props.value}
      >
        <option value="">Select...</option>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function ReadOnlyField(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-2xl border border-stone-800 bg-stone-950/80 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-stone-300">{props.label}</p>
      <p className="mt-2 text-sm text-stone-100">{props.value}</p>
    </div>
  )
}
