import type { AdminRosterStatus } from '../features/mission/use-governance-admin-roster'

type AdminIdentityFieldProps = {
  readonly adminRoster: readonly string[]
  readonly rosterStatus: AdminRosterStatus
  readonly selectedAdmin: string
  readonly setSelectedAdmin: (admin: string) => void
  readonly governanceBusy: boolean
  readonly onOpenAdminRosterSettings: () => void
  readonly testId: string
}

/**
 * Admin identity selector for governance decisions. It only says "no admins"
 * once the roster has actually loaded empty, and then explains the route to
 * Settings → Admin roster instead of leaving the operator at a dead end.
 */
export function AdminIdentityField(props: AdminIdentityFieldProps) {
  const rosterEmpty = props.rosterStatus === 'ready' && props.adminRoster.length === 0

  return (
    <div className="space-y-2">
      <label className="block space-y-2">
        <span className="text-[11px] font-medium text-stone-300">Admin Identity</span>
        <select
          className="sar-input w-full px-3 py-2 text-sm"
          data-testid={props.testId}
          disabled={props.adminRoster.length === 0}
          onChange={(event) => props.setSelectedAdmin(event.target.value)}
          value={props.selectedAdmin}
        >
          {props.adminRoster.length === 0 ? (
            <option value="">{emptySelectLabel(props.rosterStatus)}</option>
          ) : props.adminRoster.map((admin) => <option key={admin} value={admin}>{admin}</option>)}
        </select>
      </label>
      {rosterEmpty ? (
        <div
          className="border border-amber-400/40 bg-amber-950/40 p-3 text-[12px] leading-relaxed text-amber-100"
          data-testid="admin-roster-empty-notice"
          role="status"
        >
          <p className="font-semibold">No Admin Roster members are configured.</p>
          <p className="mt-1">
            This decision must be recorded by a named admin. Add the responsible admin in
            Settings → Mission Defaults → Admin roster, then Save &amp; Close to return here.
            Anything you have typed below is kept.
          </p>
          <button
            className="sar-button mt-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
            data-testid="admin-roster-open-settings"
            disabled={props.governanceBusy}
            onClick={props.onOpenAdminRosterSettings}
            type="button"
          >
            Open Admin Roster Settings
          </button>
        </div>
      ) : null}
    </div>
  )
}

function emptySelectLabel(status: AdminRosterStatus): string {
  switch (status) {
    case 'ready':
      return 'No admins configured'
    case 'error':
      return 'Admin roster unavailable'
    case 'idle':
    case 'loading':
      return 'Loading admin roster…'
  }
}
