import type {
  Marker,
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
import type { IngestedMarkerAttachment } from '../../infrastructure/marker-attachment-store/tauri-marker-attachment-store'

type MarkerStoreBoundary = Pick<MissionStore, 'listMarkers' | 'upsertMarker' | 'deleteMarker'>
type MarkerAttachmentStoreBoundary = {
  readonly ingest: (missionId: string, file: File) => Promise<IngestedMarkerAttachment>
}

type StartMarkerRuntimeDependencies = {
  readonly markerStore: MarkerStoreBoundary
  readonly attachmentStore: MarkerAttachmentStoreBoundary
  readonly applyRuntime: (runtime: MarkerRuntimeState) => void
}

export type MarkerRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly beginCreateAt: (lat: number, lon: number) => void
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

  publishRuntime()

  return {
    refreshMission: async (missionId) => {
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
      markers = await dependencies.markerStore.listMarkers(missionId)
      loading = false
      publishRuntime()
    },
    beginCreateAt: (lat, lon) => {
      if (activeMissionId === null) {
        return
      }

      dialog = {
        mode: 'create',
        draft: createMarkerDraftAtCoordinate(lat, lon),
      }
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

      dialog = {
        mode: 'edit',
        draft: createMarkerDraftFromMarker(marker),
      }
      error = null
      publishRuntime()
    },
    updateDraft: (patch) => {
      if (dialog === null) {
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
      if (dialog === null) {
        return
      }

      dialog = {
        ...dialog,
        draft: changeMarkerDraftType(dialog.draft, type),
      }
      publishRuntime()
    },
    attachEvidence: async (file) => {
      if (activeMissionId === null || dialog === null) {
        return
      }

      saving = true
      error = null
      publishRuntime()

      try {
        const attachment = await dependencies.attachmentStore.ingest(activeMissionId, file)
        dialog = {
          ...dialog,
          draft: {
            ...dialog.draft,
            attachmentPath: attachment.storedPath,
            attachmentName: attachment.fileName,
          },
        }
        saving = false
        publishRuntime()
      } catch (runtimeError) {
        saving = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
      }
    },
    clearAttachment: () => {
      if (dialog === null) {
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
      dialog = null
      error = null
      publishRuntime()
    },
    saveDraft: async () => {
      if (activeMissionId === null || dialog === null) {
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
      if (dialog?.mode !== 'edit' || dialog.draft.id === null) {
        return false
      }

      const didDelete = await dependencies.markerStore.deleteMarker(dialog.draft.id)
      if (!didDelete) {
        return false
      }

      markers = markers.filter((marker) => marker.id !== dialog?.draft.id)
      dialog = null
      error = null
      publishRuntime()
      return true
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
