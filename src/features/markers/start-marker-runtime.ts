import type {
  Marker,
  MarkerType,
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import {
  buildMarkerSaveInput,
  changeMarkerDraftType,
  createMarkerDraftAtCoordinate,
  createMarkerDraftFromMarker,
  type MarkerDraft,
} from './marker-draft'
import type { MarkerDialogState, MarkerRuntimeState } from './marker-store'
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
  readonly beginEdit: (markerId: string) => void
  readonly updateDraft: (patch: Partial<MarkerDraft>) => void
  readonly changeDraftType: (type: MarkerDraft['type']) => void
  readonly attachEvidence: (file: File) => Promise<void>
  readonly clearAttachment: () => void
  readonly closeDialog: () => void
  readonly saveDraft: () => Promise<Marker | null>
  readonly deleteEditingMarker: () => Promise<boolean>
}

export async function startMarkerRuntime(
  dependencies: StartMarkerRuntimeDependencies,
): Promise<MarkerRuntimeController> {
  let activeMissionId: string | null = null
  let markers: readonly Marker[] = []
  let loading = false
  let saving = false
  let error: string | null = null
  let dialog: MarkerDialogState | null = null
  let refreshToken = 0

  publishRuntime()

  return {
    refreshMission: async (missionId) => {
      const token = ++refreshToken
      activeMissionId = missionId
      dialog = null
      error = null

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
        error = toErrorMessage(runtimeError)
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
        publishRuntime()
        return
      }

      dialog = { mode: 'create', draft }
      error = null
      publishRuntime()
    },
    beginEdit: (markerId) => {
      const marker = markers.find((candidate) => candidate.id === markerId)
      if (marker === undefined) {
        error = `Marker not found: ${markerId}`
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
        publishRuntime()
        return
      }

      dialog = { mode: 'edit', draft }
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
        error = toErrorMessage(runtimeError)
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

      saving = true
      error = null
      publishRuntime()

      try {
        const marker = await dependencies.markerStore.upsertMarker(
          buildMarkerSaveInput({
            missionId: activeMissionId,
            displayOrder: dialog.draft.displayOrder ?? getNextDisplayOrder(markers),
            draft: dialog.draft,
          }),
        )

        markers = upsertMarker(markers, marker)
        void dependencies.recordDiagnosticEvent?.({
          level: 'info',
          category: 'marker',
          event: 'marker_saved',
          fields: {
            mode: dialog.mode,
            markerType: marker.type,
            markerCount: markers.length,
            hasAttachment: marker.attachment_path !== null,
          },
        })
        dialog = null
        saving = false
        publishRuntime()
        return marker
      } catch (runtimeError) {
        saving = false
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
      saving = true
      error = null
      publishRuntime()

      try {
        const didDelete = await dependencies.markerStore.deleteMarker(markerId)
        if (!didDelete) {
          saving = false
          publishRuntime()
          return false
        }

        markers = markers.filter((marker) => marker.id !== markerId)
        dialog = null
        saving = false
        error = null
        publishRuntime()
        return true
      } catch (runtimeError) {
        saving = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
        throw runtimeError
      }
    },
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({
      activeMissionId,
      markers,
      loading,
      saving,
      error,
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
