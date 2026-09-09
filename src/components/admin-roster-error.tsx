/** Keeps a recoverable settings-load failure separate from mission action failures. */
export function AdminRosterError({ message, onRetry }: { readonly message: string | null; readonly onRetry: () => void }) {
  if (message === null) return null
  return <div className="mt-3 border border-rose-400/30 p-2 text-sm text-rose-200" role="alert">
    <p>{message}</p>
    <button className="sar-button mt-2 px-3 py-2" onClick={onRetry} type="button">Retry admin roster</button>
  </div>
}
