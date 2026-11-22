import type {
  Marker,
  MarkerType,
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import {
  appendTreatmentUpdate,
  buildMarkerSaveInput,
  changeMarkerDraftType,
  createMarkerDraftAtCoordinate,
  createMarkerDraftFromMarker,
  type MarkerDraft,
} from './marker-draft'
import { isMarkerDialogDirty, type MarkerDialogState, type MarkerRuntimeState } from './marker-store'
import type { MarkerAttachmentBoundary } from '../../infrastructure/marker-attachment-store/marker-attachment-boundary'
import type { DiagnosticEventInput } from '../diagnostics/diagnostic-event-log'

type MarkerStoreBoundary = Pick<MissionStore, 'listMarkers' | 'upsertMarker' | 'deleteMarker'>

type StartMarkerRuntimeDependencies = {
  readonly markerStore: MarkerStoreBoundary
  readonly attachmentStore: MarkerAttachmentBoundary
  readonly applyRuntime: (runtime: MarkerRuntimeState) => void
  readonly recordDiagnosticEvent?: (event: DiagnosticEventInput) => void | Promise<void>
}

export type MarkerRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly beginCreateAt: (lat: number, lon: number, type?: MarkerType) => void
  readonly beginCreateFromDraft: (draft: MarkerDraft) => void
  readonly beginEdit: (markerId: string) => void
  readonly updateDraft: (patch: Partial<MarkerDraft>) => void
  readonly updatePendingTreatmentUpdate: (text: string) => void
  readonly dismissError: () => void
  readonly changeDraftType: (type: MarkerDraft['type']) => void
  readonly attachEvidence: (file: File) => Promise<void>
  readonly clearAttachment: () => void
  readonly closeDialog: () => void
  readonly saveDraft: () => Promise<Marker | null>
  readonly deleteEditingMarker: () => Promise<boolean>
}

/** Owns mission marker loading and each create/edit draft session. */
export async function startMarkerRuntime(
  dependencies: StartMarkerRuntimeDependencies,
): Promise<MarkerRuntimeController> {
  let activeMissionId: string | null = null
  let markers: readonly Marker[] = []
  let loading = false
  let saving = false
  // True only while a marker save or retire is in flight; evidence ingestion also sets
  // `saving` but persists nothing, so it must not hide a discarded draft.
  let persisting = false
  let error: string | null = null
  let loadError: string | null = null
  let dialog: MarkerDialogState | null = null
  let dialogSessionId = 0
  let refreshToken = 0

  publishRuntime()

  return {
    refreshMission: async (missionId) => {
      const token = ++refreshToken
      // A draft whose save or retire is in flight is not discarded: that result reports itself.
      const discardedDraftNotice = dialog !== null && !persisting && isMarkerDialogDirty(dialog)
        ? describeDiscardedDraft(dialog)
        : null
      activeMissionId = missionId
      dialog = null
      // A mission change cannot wait for the discard confirmation, so say what was lost
      // instead of dropping unsaved marker edits silently.
      error = discardedDraftNotice
      loadError = null

      if (missionId === null) {
        markers = []
        loading = false
        publishRuntime()
        return
      }

      loading = true
      publishRuntime()
      try {
        const nextMarkers = await dependencies.markerStore.listMarkers(missionId)
        if (!isCurrentRefresh(token, missionId)) {
          return
        }

        markers = nextMarkers
      } catch (runtimeError) {
        if (!isCurrentRefresh(token, missionId)) {
          return
        }

        markers = []
        loadError = toErrorMessage(runtimeError)
        recordBeginOrLoadFailure('marker_load_failed')
      } finally {
        if (isCurrentRefresh(token, missionId)) {
          loading = false
          publishRuntime()
        }
      }
    },
    beginCreateAt: (lat, lon, type) => {
      if (activeMissionId === null) {
        return
      }

      // Deriving the marker's Irish Grid / ITM references rejects coordinates outside
      // Ireland (e.g. a map click far out to sea). Surface that as an operator-facing
      // error instead of letting it throw uncaught from the click handler, which would
      // make the marker silently fail to appear.
      let draft: MarkerDraft
      try {
        draft = createMarkerDraftAtCoordinate(lat, lon, type)
      } catch (runtimeError) {
        dialog = null
        error = toErrorMessage(runtimeError)
        recordBeginOrLoadFailure('marker_create_begin_failed')
        publishRuntime()
        return
      }

      dialog = createDialog('create', draft)
      error = null
      publishRuntime()
    },
    beginCreateFromDraft: (draft) => {
      if (activeMissionId === null) {
        return
      }

      dialog = createDialog('create', draft)
      error = null
      publishRuntime()
    },
    beginEdit: (markerId) => {
      const marker = markers.find((candidate) => candidate.id === markerId)
      if (marker === undefined) {
        error = `Marker not found: ${markerId}`
        recordBeginOrLoadFailure('marker_edit_begin_failed')
        publishRuntime()
        return
      }

      // Building the edit draft reformats persisted coordinates. Guard against a
      // malformed stored coordinate so reopening a marker can never throw uncaught and
      // leave the dialog silently unopened.
      let draft: MarkerDraft
      try {
        draft = createMarkerDraftFromMarker(marker)
      } catch (runtimeError) {
        dialog = null
        error = toErrorMessage(runtimeError)
        recordBeginOrLoadFailure('marker_edit_begin_failed')
        publishRuntime()
        return
      }

      dialog = createDialog('edit', draft)
      error = null
      publishRuntime()
    },
    updateDraft: (patch) => {
      if (dialog === null || saving) {
        return
      }

      dialog = {
        ...dialog,
        draft: {
          ...dialog.draft,
          ...patch,
        },
      }
      publishRuntime()
    },
    updatePendingTreatmentUpdate: (text) => {
      if (dialog === null || saving) return
      dialog = { ...dialog, pendingTreatmentUpdate: text }
      publishRuntime()
    },
    dismissError: () => {
      error = null
      publishRuntime()
    },
    changeDraftType: (type) => {
      if (dialog === null || saving) {
        return
      }

      dialog = {
        ...dialog,
        draft: changeMarkerDraftType(dialog.draft, type),
      }
      publishRuntime()
    },
    attachEvidence: async (file) => {
      if (activeMissionId === null || dialog === null || saving) {
        return
      }

      const missionId = activeMissionId
      const dialogId = dialog.draft.id
      const dialogCoordinates = dialog.draft.coordinates
      saving = true
      error = null
      publishRuntime()

      try {
        const attachment = await dependencies.attachmentStore.ingest(missionId, file)
        const isCurrentContext = isCurrentDialogContext(missionId, dialogId, dialogCoordinates)
        saving = false

        if (!isCurrentContext) {
          publishRuntime()
          return
        }

        dialog = {
          ...dialog,
          draft: {
            ...dialog.draft,
            attachmentPath: attachment.storedPath,
            attachmentName: attachment.fileName,
          },
        }
        publishRuntime()
      } catch (runtimeError) {
        saving = false
        // A failed ingestion for a draft a refresh already discarded must not replace
        // the discard notice: that notice is what the operator still needs to act on.
        if (isCurrentDialogContext(missionId, dialogId, dialogCoordinates)) {
          error = toErrorMessage(runtimeError)
        }
        publishRuntime()
      }
    },
    clearAttachment: () => {
      if (dialog === null || saving) {
        return
      }

      dialog = {
        ...dialog,
        draft: {
          ...dialog.draft,
          attachmentPath: null,
          attachmentName: null,
        },
      }
      publishRuntime()
    },
    closeDialog: () => {
      if (saving) {
        return
      }

      dialog = null
      error = null
      publishRuntime()
    },
    saveDraft: async () => {
      if (activeMissionId === null || dialog === null || saving) {
        return null
      }

      let draft = dialog.draft
      if (draft.type === 'casualty' && dialog.pendingTreatmentUpdate.trim() !== '') {
        try {
          draft = {
            ...draft,
            treatment: appendTreatmentUpdate({
              existingTreatment: draft.treatment,
              note: dialog.pendingTreatmentUpdate,
              timestamp: new Date(),
              updatedBy: draft.updatedBy,
            }),
          }
        } catch (runtimeError) {
          error = `The New Treatment Update could not be added: ${toErrorMessage(runtimeError)} Shorten it or press Add Update after fixing the log, then Save.`
          publishRuntime()
          return null
        }
      }

      const missionId = activeMissionId
      const sessionId = dialog.sessionId
      const mode = dialog.mode
      saving = true
      persisting = true
      error = null
      publishRuntime()

      try {
        const marker = await dependencies.markerStore.upsertMarker(
          buildMarkerSaveInput({
            missionId,
            displayOrder: draft.displayOrder ?? getNextDisplayOrder(markers),
            draft,
          }),
        )

        // The store write stands, but only the mission it was saved to may show it.
        // A refresh to another mission while the save was in flight already replaced
        // the marker list and closed this dialog.
        const sameMission = activeMissionId === missionId
        if (sameMission) {
          markers = upsertMarker(markers, marker)
        }
        void dependencies.recordDiagnosticEvent?.({
          level: 'info',
          category: 'marker',
          event: 'marker_saved',
          fields: {
            mode,
            markerType: marker.type,
            markerCount: sameMission ? markers.length : null,
            hasAttachment: marker.attachment_path !== null,
          },
        })
        if (dialog?.sessionId === sessionId) {
          dialog = null
        }
        saving = false
        persisting = false
        publishRuntime()
        return marker
      } catch (runtimeError) {
        saving = false
        persisting = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
        throw runtimeError
      }
    },
    deleteEditingMarker: async () => {
      if (dialog?.mode !== 'edit' || dialog.draft.id === null || saving) {
        return false
      }

      const markerId = dialog.draft.id
      const missionId = activeMissionId
      const sessionId = dialog.sessionId
      saving = true
      persisting = true
      error = null
      publishRuntime()

      try {
        const didDelete = await dependencies.markerStore.deleteMarker(markerId)
        if (!didDelete) {
          saving = false
          persisting = false
          publishRuntime()
          return false
        }

        if (activeMissionId === missionId) {
          markers = markers.filter((marker) => marker.id !== markerId)
        }
        if (dialog?.sessionId === sessionId) {
          dialog = null
        }
        saving = false
        persisting = false
        error = null
        publishRuntime()
        return true
      } catch (runtimeError) {
        saving = false
        persisting = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
        throw runtimeError
      }
    },
  }

  /** Captures a baseline and assigns a new identity for every opened dialog. */
  function createDialog(mode: MarkerDialogState['mode'], draft: MarkerDraft): MarkerDialogState {
    return {
      sessionId: ++dialogSessionId,
      mode,
      draft,
      baselineDraft: { ...draft, coordinates: { ...draft.coordinates } },
      pendingTreatmentUpdate: '',
    }
  }

  /** Names the marker whose unsaved edits a mission refresh discarded. */
  function describeDiscardedDraft(discarded: MarkerDialogState): string {
    const name = discarded.draft.name.trim() === '' ? 'without a name' : `"${discarded.draft.name.trim()}"`
    const treatmentNote = discarded.pendingTreatmentUpdate.trim() !== ''
      ? ', including a treatment update that had not been added,'
      : ''
    return `Unsaved changes to marker ${name} were discarded${treatmentNote} because the mission changed or reloaded. Reopen the marker and re-enter them.`
  }

  /** Records failure kind only; raw exceptions may contain locations or personal details. */
  function recordBeginOrLoadFailure(event: string): void {
    void dependencies.recordDiagnosticEvent?.({ level: 'error', category: 'marker', event })
  }

  /** Publishes the current runtime snapshot to the renderer. */
  function publishRuntime(): void {
    dependencies.applyRuntime({
      activeMissionId,
      markers,
      loading,
      saving,
      error,
      loadError,
      dialog,
    })
  }

  function isCurrentRefresh(token: number, missionId: string): boolean {
    return refreshToken === token && activeMissionId === missionId
  }

  function isCurrentDialogContext(
    missionId: string,
    dialogId: string | null,
    coordinates: MarkerDraft['coordinates'],
  ): boolean {
    return (
      activeMissionId === missionId &&
      dialog !== null &&
      dialog.draft.id === dialogId &&
      dialog.draft.coordinates.lat === coordinates.lat &&
      dialog.draft.coordinates.lon === coordinates.lon
    )
  }
}

function getNextDisplayOrder(markers: readonly Marker[]): number {
  return markers.reduce((maxOrder, marker) => Math.max(maxOrder, marker.display_order), 0) + 1
}

function upsertMarker(markers: readonly Marker[], marker: Marker): readonly Marker[] {
  const existingIndex = markers.findIndex((candidate) => candidate.id === marker.id)
  if (existingIndex === -1) {
    return [...markers, marker].sort((left, right) => left.display_order - right.display_order)
  }

  return markers.map((candidate) => (candidate.id === marker.id ? marker : candidate))
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Marker action failed.'
}
