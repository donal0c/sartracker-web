import { InlineDecisionDialog } from './inline-decision-dialog'
import { AdminIdentityField } from './admin-identity-field'
import { AdminRosterError } from './admin-roster-error'
import type { AdminRosterStatus } from '../features/mission/use-governance-admin-roster'

const TITLE_ID = 'mission-unlock-dialog-title'

type MissionUnlockDialogProps = {
  readonly actionError: string | null
  readonly adminRoster: readonly string[]
  readonly rosterStatus: AdminRosterStatus
  readonly rosterError: string | null
  readonly onRetryRoster: () => void
  readonly onOpenAdminRosterSettings: () => void
  readonly governanceBusy: boolean
  readonly selectedAdmin: string
  readonly setSelectedAdmin: (admin: string) => void
  readonly unlockReason: string
  readonly setUnlockReason: (reason: string) => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Records a named Admin Roster member's audited unlock of a finalized mission. */
export function MissionUnlockDialog(props: MissionUnlockDialogProps) {
  return (
    <InlineDecisionDialog
      className="mt-4 border border-amber-500/30 bg-amber-950/50 p-4 shadow-xl"
      data-testid="mission-unlock-dialog"
      labelledBy={TITLE_ID}
      onCancel={props.onCancel}
    >
      <p className="font-semibold text-amber-300 uppercase text-[13px] tracking-wide" id={TITLE_ID}>
        Admin Unlock
      </p>
      <div className="mt-4 space-y-4">
        <AdminIdentityField
          adminRoster={props.adminRoster}
          governanceBusy={props.governanceBusy}
          onOpenAdminRosterSettings={props.onOpenAdminRosterSettings}
          rosterStatus={props.rosterStatus}
          selectedAdmin={props.selectedAdmin}
          setSelectedAdmin={props.setSelectedAdmin}
          testId="mission-unlock-admin"
        />
        <label className="block space-y-2">
          <span className="text-[11px] font-medium text-stone-300">Unlock Reason</span>
          <textarea
            className="sar-input min-h-24 w-full px-3 py-2 text-sm"
            data-testid="mission-unlock-reason"
            onChange={(event) => props.setUnlockReason(event.target.value)}
            value={props.unlockReason}
          />
        </label>
      </div>
      <AdminRosterError message={props.rosterError} onRetry={props.onRetryRoster} />
      {props.actionError === null ? null : (
        <p
          className="mt-3 border border-rose-400/30 bg-rose-400/10 p-2 text-xs font-semibold text-rose-300"
          data-testid="mission-action-error"
          role="alert"
        >
          {props.actionError}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          className="flex-1 bg-amber-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-amber-500"
          data-testid="mission-unlock-confirm"
          disabled={props.selectedAdmin.trim() === '' || props.unlockReason.trim() === '' || props.governanceBusy}
          onClick={props.onConfirm}
          type="button"
        >
          {props.governanceBusy ? 'Unlocking…' : 'Confirm Unlock'}
        </button>
        <button
          className="flex-1 bg-stone-800 px-3 py-2 text-[12px] font-semibold text-stone-200 hover:bg-stone-700"
          onClick={props.onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </InlineDecisionDialog>
  )
}
