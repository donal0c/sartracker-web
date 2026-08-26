import { InlineDecisionDialog } from './inline-decision-dialog'

const TITLE_ID = 'mission-evidence-loss-dialog-title'
const DESCRIPTION_ID = 'mission-evidence-loss-dialog-description'

type MissionEvidenceLossDialogProps = {
  readonly actionError: string | null
  readonly adminRoster: readonly string[]
  readonly evidenceLossReason: string
  readonly governanceBusy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly selectedAdmin: string
  readonly setEvidenceLossReason: (reason: string) => void
  readonly setSelectedAdmin: (admin: string) => void
}

/** Records one exact known gap without presenting it as recovered evidence. */
export function MissionEvidenceLossDialog(props: MissionEvidenceLossDialogProps) {
  return (
    <InlineDecisionDialog
      className="mt-4 border border-rose-500/40 bg-rose-950/60 p-4 shadow-xl"
      data-testid="mission-evidence-loss-dialog"
      describedBy={DESCRIPTION_ID}
      labelledBy={TITLE_ID}
      onCancel={props.onCancel}
    >
      <p className="font-semibold text-rose-300 uppercase text-[13px] tracking-wide" id={TITLE_ID}>
        Acknowledge Known Evidence Loss
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-rose-100" id={DESCRIPTION_ID}>
        This does not restore missing evidence and never permits Complete or 100%.
        It permanently records who accepted the known gap so this finished mission
        can be archived and locked with the warning retained.
      </p>
      <div className="mt-4 space-y-4">
        <label className="block space-y-2">
          <span className="text-[11px] font-medium text-stone-300">Admin Identity</span>
          <select
            className="sar-input w-full px-3 py-2 text-sm"
            data-testid="mission-evidence-loss-admin"
            onChange={(event) => props.setSelectedAdmin(event.target.value)}
            value={props.selectedAdmin}
          >
            {props.adminRoster.length === 0 ? (
              <option value="">No admins configured</option>
            ) : props.adminRoster.map((admin) => <option key={admin} value={admin}>{admin}</option>)}
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-[11px] font-medium text-stone-300">Evidence Loss Record</span>
          <textarea
            className="sar-input min-h-24 w-full px-3 py-2 text-sm"
            data-testid="mission-evidence-loss-reason"
            onChange={(event) => props.setEvidenceLossReason(event.target.value)}
            placeholder="State what happened and which incident record documents the gap."
            value={props.evidenceLossReason}
          />
        </label>
      </div>
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
          className="flex-1 bg-rose-700 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-rose-600"
          data-testid="mission-evidence-loss-confirm"
          disabled={
            props.selectedAdmin.trim() === '' ||
            props.evidenceLossReason.trim() === '' ||
            props.governanceBusy
          }
          onClick={props.onConfirm}
          type="button"
        >
          {props.governanceBusy ? 'Recording…' : 'Record Gap & Allow Archive'}
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
