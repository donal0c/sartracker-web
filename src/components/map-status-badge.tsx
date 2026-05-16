import type { MapHealth } from '../lib/map-health'

type MapStatusBadgeProps = {
  readonly health: MapHealth
}

const STATUS_CLASSES: Record<MapHealth['status'], string> = {
  loading: 'border-amber-300/70 bg-stone-950/95 text-amber-100',
  ready: 'border-emerald-300/70 bg-stone-950/95 text-emerald-100',
  degraded: 'border-rose-300/75 bg-stone-950/95 text-rose-50',
}

export function MapStatusBadge({ health }: MapStatusBadgeProps) {
  return (
    <div
      aria-live="polite"
      className={`border px-3 py-1.5 text-[11px] font-bold shadow-lg shadow-black/40 ${STATUS_CLASSES[health.status]}`}
      data-testid="map-health"
    >
      {health.message}
    </div>
  )
}
