import type {
  Helicopter,
  HelicopterSlotKey,
  MissionStore,
  UpsertHelicopterInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { HelicopterRuntimeState } from './helicopter-store'

type HelicopterStoreBoundary = Pick<
  MissionStore,
  'listHelicopters' | 'upsertHelicopter' | 'deleteHelicopter'
>

type StartHelicopterRuntimeDependencies = {
  readonly helicopterStore: HelicopterStoreBoundary
  readonly applyRuntime: (runtime: HelicopterRuntimeState) => void
}

export type HelicopterRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly upsertSlot: (
    input: Omit<UpsertHelicopterInput, 'mission_id'>,
  ) => Promise<Helicopter | null>
  readonly clearSlot: (slotKey: HelicopterSlotKey) => Promise<boolean>
}

const EMPTY_RUNTIME: HelicopterRuntimeState = {
  activeMissionId: null,
  helicopters: [],
  loading: false,
  saving: false,
  error: null,
}

export async function startHelicopterRuntime(
  dependencies: StartHelicopterRuntimeDependencies,
): Promise<HelicopterRuntimeController> {
  let state: HelicopterRuntimeState = EMPTY_RUNTIME
  let refreshToken = 0

  publishRuntime()

  return {
    refreshMission: async (missionId) => {
      const token = ++refreshToken
      state = {
        ...state,
        activeMissionId: missionId,
        helicopters: missionId === state.activeMissionId ? state.helicopters : [],
        loading: missionId !== null,
        error: null,
      }
      publishRuntime()

      if (missionId === null) {
        state = {
          ...state,
          helicopters: [],
          loading: false,
        }
        publishRuntime()
        return
      }

      try {
        const helicopters = await dependencies.helicopterStore.listHelicopters(missionId)
        if (token !== refreshToken || state.activeMissionId !== missionId) {
          return
        }

        state = {
          ...state,
          helicopters: sortHelicopters(helicopters),
          loading: false,
          error: null,
        }
        publishRuntime()
      } catch (error) {
        if (token !== refreshToken || state.activeMissionId !== missionId) {
          return
        }

        state = {
          ...state,
          helicopters: [],
          loading: false,
          error: toErrorMessage(error),
        }
        publishRuntime()
      }
    },
    upsertSlot: async (input) => {
      const missionId = state.activeMissionId
      if (missionId === null || state.saving) {
        return null
      }

      state = {
        ...state,
        saving: true,
        error: null,
      }
      publishRuntime()

      try {
        const helicopter = await dependencies.helicopterStore.upsertHelicopter({
          ...input,
          mission_id: missionId,
        })
        state = {
          ...state,
          helicopters: upsertHelicopter(state.helicopters, helicopter),
          saving: false,
          error: null,
        }
        publishRuntime()
        return helicopter
      } catch (error) {
        state = {
          ...state,
          saving: false,
          error: toErrorMessage(error),
        }
        publishRuntime()
        throw error
      }
    },
    clearSlot: async (slotKey) => {
      if (state.saving) {
        return false
      }

      const helicopter = state.helicopters.find((entry) => entry.slot_key === slotKey)
      if (helicopter === undefined) {
        return false
      }

      state = {
        ...state,
        saving: true,
        error: null,
      }
      publishRuntime()

      try {
        const didDelete = await dependencies.helicopterStore.deleteHelicopter(helicopter.id)
        state = {
          ...state,
          helicopters: didDelete
            ? state.helicopters.filter((entry) => entry.id !== helicopter.id)
            : state.helicopters,
          saving: false,
          error: null,
        }
        publishRuntime()
        return didDelete
      } catch (error) {
        state = {
          ...state,
          saving: false,
          error: toErrorMessage(error),
        }
        publishRuntime()
        throw error
      }
    },
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(state)
  }
}

function upsertHelicopter(
  helicopters: readonly Helicopter[],
  nextHelicopter: Helicopter,
): readonly Helicopter[] {
  const remaining = helicopters.filter(
    (entry) => entry.id !== nextHelicopter.id && entry.slot_key !== nextHelicopter.slot_key,
  )
  return sortHelicopters([...remaining, nextHelicopter])
}

function sortHelicopters(helicopters: readonly Helicopter[]): readonly Helicopter[] {
  const order: Record<HelicopterSlotKey, number> = {
    slot_1: 1,
    slot_2: 2,
    slot_3: 3,
    slot_4: 4,
  }
  return [...helicopters].sort((left, right) => order[left.slot_key] - order[right.slot_key])
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Helicopter operation failed.'
}
