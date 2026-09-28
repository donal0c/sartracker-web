import { useEffect, useRef, useState } from 'react'

import { loadAppSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { useSettingsWorkspaceStore } from '../settings/settings-workspace-store'
import { useMissionStore } from './mission-store'

/** Governance decisions that require an Admin Roster identity. */
export type AdminRosterDecision = 'unlock' | 'evidence-loss'

/**
 * Where the roster read stands. `ready` with an empty roster is the only state
 * that means "no admins are configured"; a failed read is never reported as that.
 */
export type AdminRosterStatus = 'idle' | 'loading' | 'ready' | 'error'

type RosterRequest = { readonly required: boolean; readonly id: number }

type RosterResult = {
  readonly requestId: number
  readonly status: 'ready' | 'error'
  readonly roster: readonly string[]
  readonly error: string | null
}

const EMPTY_ROSTER: readonly string[] = []

type GovernanceAdminRosterInput = {
  /** The decision dialog currently open, if any. Opening one (re)loads the roster. */
  readonly openDecision: AdminRosterDecision | null
  /** True while a governance action is in flight; the Settings detour is refused. */
  readonly governanceBusy: boolean
  /** Closes or reopens a decision dialog without touching its typed draft. */
  readonly setDecisionOpen: (decision: AdminRosterDecision, open: boolean) => void
}

export type GovernanceAdminRoster = {
  readonly adminRoster: readonly string[]
  readonly rosterStatus: AdminRosterStatus
  readonly rosterError: string | null
  readonly retryAdminRoster: () => void
  readonly selectedAdmin: string
  readonly setSelectedAdmin: (admin: string) => void
  readonly openAdminRosterSettings: () => void
}

/**
 * Loads the Admin Roster for governance decisions and offers a route to
 * Settings → Admin roster that returns to the same decision for the same
 * mission when Settings closes.
 *
 * This is navigation only. Membership is still enforced by the mission store
 * when the decision is submitted, roster changes keep their existing Settings
 * audit history, and nothing here selects or submits on the operator's behalf.
 */
export function useGovernanceAdminRoster(input: GovernanceAdminRosterInput): GovernanceAdminRoster {
  const { openDecision, governanceBusy, setDecisionOpen } = input
  const rosterRequired = openDecision !== null
  const [rosterRequest, setRosterRequest] = useState<RosterRequest>({ required: false, id: 0 })
  const [rosterResult, setRosterResult] = useState<RosterResult | null>(null)
  const [selectedAdmin, setSelectedAdmin] = useState('')
  const settingsReturnRef = useRef<(() => void) | null>(null)

  // Each time a decision opens, start a fresh roster read (adjusting state
  // during render rather than in an effect, so no stale roster is ever shown).
  if (rosterRequest.required !== rosterRequired) {
    setRosterRequest({
      required: rosterRequired,
      id: rosterRequired ? rosterRequest.id + 1 : rosterRequest.id,
    })
  }

  useEffect(() => {
    if (!rosterRequest.required) {
      return
    }

    let cancelled = false
    const requestId = rosterRequest.id

    void loadAppSettings()
      .then((settings) => {
        if (cancelled) {
          return
        }

        const roster = settings.missionDefaults.adminRoster
        setRosterResult({ requestId, status: 'ready', roster, error: null })
        setSelectedAdmin((current) =>
          current !== '' && roster.includes(current) ? current : (roster[0] ?? ''),
        )
      })
      .catch((error) => {
        if (!cancelled) {
          setRosterResult({ requestId, status: 'error', roster: [], error: toErrorMessage(error) })
          setSelectedAdmin('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [rosterRequest])

  const currentResult = rosterRequest.required && rosterResult?.requestId === rosterRequest.id
    ? rosterResult
    : null
  const rosterStatus: AdminRosterStatus = !rosterRequest.required
    ? 'idle'
    : (currentResult?.status ?? 'loading')
  const adminRoster = currentResult?.roster ?? EMPTY_ROSTER
  const rosterError = currentResult?.error ?? null

  useEffect(() => () => {
    settingsReturnRef.current?.()
    settingsReturnRef.current = null
  }, [])

  /** Retries only roster loading without clearing a lifecycle action failure. */
  function retryAdminRoster(): void {
    setRosterRequest((request) => ({ ...request, id: request.id + 1 }))
  }

  /**
   * Leaves the open decision for Settings → Admin roster. The dialog is closed
   * rather than left underneath, so Settings owns Escape and focus; its draft
   * stays in the view model and it reopens (reloading the roster) on return.
   */
  function openAdminRosterSettings(): void {
    const missionId = useMissionStore.getState().governanceMission?.id ?? null
    if (openDecision === null || governanceBusy || missionId === null) {
      return
    }

    const decision = openDecision
    settingsReturnRef.current?.()
    const unsubscribe = useSettingsWorkspaceStore.subscribe((state) => {
      if (state.open) {
        return
      }
      unsubscribe()
      settingsReturnRef.current = null
      if (useMissionStore.getState().governanceMission?.id === missionId) {
        setDecisionOpen(decision, true)
      }
    })
    settingsReturnRef.current = unsubscribe

    setDecisionOpen(decision, false)
    useSettingsWorkspaceStore.getState().openWorkspace('admin-roster')
  }

  return {
    adminRoster,
    rosterStatus,
    rosterError,
    retryAdminRoster,
    selectedAdmin,
    setSelectedAdmin,
    openAdminRosterSettings,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Admin roster could not be loaded.'
}
