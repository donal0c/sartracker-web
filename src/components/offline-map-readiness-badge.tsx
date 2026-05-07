import type { OfflineMapReadiness } from '../features/map/offline-map-readiness'

type OfflineMapReadinessBadgeProps = {
  readonly readiness: OfflineMapReadiness
}

const TONE_CLASSES: Record<OfflineMapReadiness['tone'], string> = {
  danger: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
}

/**
 * Shows whether viewed map tiles are available for field-offline reuse.
 */
export function OfflineMapReadinessBadge({ readiness }: OfflineMapReadinessBadgeProps) {
  return (
    <div
      aria-live="polite"
      className={`max-w-full rounded-lg border px-3 py-2 text-xs shadow-lg shadow-black/30 backdrop-blur-sm ${TONE_CLASSES[readiness.tone]}`}
      data-testid="offline-map-readiness"
    >
      <p className="font-semibold">{readiness.label}</p>
      <p className="mt-0.5 text-[11px] opacity-85">{readiness.detail}</p>
    </div>
  )
}
