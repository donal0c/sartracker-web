import { useSettingsApplyStore } from '../../features/settings/settings-apply-store'

/**
 * Shows, outside the closed Settings panel, that saved settings could not be
 * applied to the running app. Stays until dismissed or a later apply succeeds
 * [DON-352, audit M-67].
 */
export function SettingsApplyFailureNotice() {
  const failure = useSettingsApplyStore((state) => state.failure)
  const clearFailure = useSettingsApplyStore((state) => state.clearFailure)
  if (failure === null) {
    return null
  }

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[60] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 border border-rose-400/60 bg-rose-950/95 p-4 text-sm text-rose-50 shadow-2xl"
      data-testid="settings-apply-failure"
      role="alert"
    >
      <p className="font-semibold">Settings not applied</p>
      <p className="mt-1 leading-relaxed">{failure}</p>
      <button
        className="sar-button mt-3 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
        data-testid="settings-apply-failure-dismiss"
        onClick={clearFailure}
        type="button"
      >
        Dismiss
      </button>
    </div>
  )
}
