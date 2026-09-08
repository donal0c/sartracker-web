import { useState } from 'react'

/** Lets operators leave a waiting dialog without releasing the main-process operation owner. */
export function ArchiveCancellationPending({ onDismiss }: {
  readonly onDismiss: () => void | Promise<void>
}) {
  const [closing, setClosing] = useState(false)
  const [failed, setFailed] = useState(false)
  /** Requests dismissal once; failed timeline refresh remains visible and retryable. */
  async function dismiss(): Promise<void> {
    if (closing) return
    setClosing(true)
    try { await onDismiss() } catch { setFailed(true); setClosing(false) }
  }
  return <div className="sar-readout mt-4 p-3 text-xs text-stone-200">
    <p>Cancellation is not yet confirmed. You can return to the mission while the application
      waits for safe cleanup. Refresh Saved Archives before relying on its status or retrying.
      If it remains busy, restart the application to recover.</p>
    {failed ? <p role="alert">The timeline could not refresh. Try returning again.</p> : null}
    <button className="sar-button mt-3 px-3 py-2" data-testid="archive-pending-dismiss"
      disabled={closing} onClick={() => void dismiss()} type="button">
      Return to mission
    </button>
  </div>
}
