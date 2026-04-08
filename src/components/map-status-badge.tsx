import type { MapHealth } from '../lib/map-health'

type MapStatusBadgeProps = {
  readonly health: MapHealth
}

const STATUS_CLASSES: Record<MapHealth['status'], string> = {
  loading: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  ready: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  degraded: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
}

export function MapStatusBadge({ health }: MapStatusBadgeProps) {
  return (
    <div
      aria-live="polite"
      className={`rounded-full border px-3 py-1 text-xs ${STATUS_CLASSES[health.status]}`}
      data-testid="map-health"
    >
      {health.message}
    </div>
  )
}
