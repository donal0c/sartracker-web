import type { MissionPhase } from './mission-phase-presentation'

type WorkspaceHideInput = {
  readonly decisionOpen: boolean
  readonly actionError: string | null
  readonly phase: MissionPhase
  readonly governanceMission: { readonly id: string } | null
}

/**
 * Explains why the mission workspace must stay visible, or returns null when
 * it may be minimized or collapsed. Archive & Lock for an earlier finished
 * mission does not pin the active mission's panel open (DON-307); after
 * Finish, with no active mission, those archive controls stay visible.
 */
export function selectWorkspaceHideBlockedReason(input: WorkspaceHideInput): string | null {
  if (input.decisionOpen) {
    return 'Complete or cancel the open mission decision before hiding this workspace.'
  }
  if (input.actionError !== null) {
    return 'Resolve the mission action failure before hiding this workspace.'
  }
  if (
    input.phase === 'paused' ||
    input.phase === 'recovery' ||
    (input.governanceMission !== null && input.phase !== 'active')
  ) {
    return 'Mission pause, recovery or archive controls must remain visible.'
  }
  return null
}
