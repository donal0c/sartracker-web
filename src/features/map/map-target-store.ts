import { create } from 'zustand'

const TARGET_REQUEST_LIFETIME_MS = 30_000
const TARGET_ATTACHED_LIFETIME_MS = 8_000

export type MapTargetRequest = {
  readonly id: number
  readonly latitude: number
  readonly longitude: number
  readonly label: string | null
  readonly expiresAt: number
  readonly expiresAtMonotonic: number
  readonly attached: boolean
}

type MapTargetStoreState = {
  readonly activeTarget: MapTargetRequest | null
  readonly queueTarget: (latitude: number, longitude: number, label?: string | null) => void
  readonly markTargetAttached: (id: number) => void
  readonly isTargetCurrent: (id: number) => boolean
  readonly clearActiveTarget: (id: number) => void
}

let nextTargetRequestId = 0
let activeExpirationTimer: ReturnType<typeof setTimeout> | null = null

/** Uses either elapsed time or wall time to expire; neither clock can extend the other. */
function remainingLifetime(target: MapTargetRequest): number {
  return Math.max(0, Math.min(
    target.expiresAt - Date.now(),
    target.expiresAtMonotonic - performance.now(),
  ))
}

/** Cancels the store-owned timer for the currently active target, if present. */
function clearExpirationTimer(): void {
  if (activeExpirationTimer === null) {
    return
  }

  clearTimeout(activeExpirationTimer)
  activeExpirationTimer = null
}

/** Schedules an expiry check against the request's absolute deadline. */
function scheduleExpiration(target: MapTargetRequest): void {
  clearExpirationTimer()

  const delayMs = remainingLifetime(target)
  const timer = setTimeout(() => {
    if (activeExpirationTimer === timer) {
      activeExpirationTimer = null
    }

    const currentTarget = useMapTargetStore.getState().activeTarget
    if (currentTarget?.id !== target.id) {
      return
    }

    if (remainingLifetime(currentTarget) === 0) {
      useMapTargetStore.getState().clearActiveTarget(target.id)
      return
    }

    // Recheck an early timer without extending either original deadline.
    scheduleExpiration(currentTarget)
  }, delayMs)
  activeExpirationTimer = timer
}

export const useMapTargetStore = create<MapTargetStoreState>((set, get) => ({
  activeTarget: null,
  queueTarget: (latitude, longitude, label = null) => {
    const request: MapTargetRequest = {
      id: ++nextTargetRequestId,
      latitude,
      longitude,
      label,
      expiresAt: Date.now() + TARGET_REQUEST_LIFETIME_MS,
      expiresAtMonotonic: performance.now() + TARGET_REQUEST_LIFETIME_MS,
      attached: false,
    }
    set({ activeTarget: request })

    const currentTarget = get().activeTarget
    if (currentTarget?.id === request.id) {
      scheduleExpiration(currentTarget)
    }
  },
  markTargetAttached: (id) => {
    const target = get().activeTarget
    if (target?.id !== id) {
      return
    }

    if (remainingLifetime(target) === 0) {
      get().clearActiveTarget(id)
      return
    }

    if (target.attached) {
      return
    }

    const attachedTarget: MapTargetRequest = {
      ...target,
      attached: true,
      expiresAt: Math.min(target.expiresAt, Date.now() + TARGET_ATTACHED_LIFETIME_MS),
      expiresAtMonotonic: Math.min(target.expiresAtMonotonic, performance.now() + TARGET_ATTACHED_LIFETIME_MS),
    }
    set({ activeTarget: attachedTarget })

    const currentTarget = get().activeTarget
    if (currentTarget?.id === id) {
      scheduleExpiration(currentTarget)
    }
  },
  isTargetCurrent: (id) => {
    const target = get().activeTarget
    if (target?.id !== id) {
      return false
    }

    if (remainingLifetime(target) === 0) {
      get().clearActiveTarget(id)
      return false
    }

    return true
  },
  clearActiveTarget: (id) => {
    if (get().activeTarget?.id !== id) {
      return
    }

    clearExpirationTimer()
    set({ activeTarget: null })
  },
}))
