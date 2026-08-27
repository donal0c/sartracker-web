import { lazy, Suspense } from 'react'

const GpxImportPanel = lazy(async () => {
  const module = await import('./gpx-import-panel')
  return { default: module.GpxImportPanel }
})

/** Loads the GPX workspace only when the operator opens its tools surface. */
export function DeferredGpxImportPanel() {
  return (
    <Suspense fallback={<p className="sar-helper-text">Loading GPX evidence controls…</p>}>
      <GpxImportPanel />
    </Suspense>
  )
}
